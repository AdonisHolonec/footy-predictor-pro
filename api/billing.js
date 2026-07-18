/**
 * Billing API (Stripe Checkout + Portal + Webhook + trial).
 * Single serverless function to stay within Vercel Hobby (12 fn) limit.
 *
 * GET  /api/billing?view=config     — public: whether Stripe is configured
 * POST /api/billing?view=checkout   — JWT: { tier: "premium"|"ultra" } → { url }
 * POST /api/billing?view=portal     — JWT → { url } Customer Portal
 * POST /api/billing?view=webhook    — Stripe webhook (raw body)
 * POST /api/billing?view=trial      — JWT: activate 24h trial
 *
 * Rewrites: /api/stripe-webhook → webhook, /api/activate-trial → trial
 */
import { getRequester } from "../server-utils/authAdmin.js";
import { resolveEffectiveTierFromProfile } from "../server-utils/accessTier.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import {
  applySubscriptionToProfile,
  ensureStripeCustomer,
  findUserIdForCustomer,
  getStripe,
  isStripeConfigured,
  priceIdForTier,
  publicBillingConfig
} from "../server-utils/stripeBilling.js";

export const config = {
  api: {
    bodyParser: false
  }
};

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function attachJsonBody(req) {
  const raw = await readRawBody(req);
  if (!raw.length) {
    req.body = {};
    return;
  }
  try {
    req.body = JSON.parse(raw.toString("utf8"));
  } catch {
    req.body = {};
  }
}

function parseBody(req) {
  let body = req.body || {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch {
      body = {};
    }
  }
  return body && typeof body === "object" ? body : {};
}

function appOrigin(req) {
  const fromEnv = String(process.env.APP_BASE_URL || process.env.VITE_APP_URL || "").replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const proto = String(req.headers["x-forwarded-proto"] || "https");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  if (host) return `${proto}://${host}`;
  return "https://footy-predictor-pro.vercel.app";
}

async function handleConfig(_req, res) {
  return res.status(200).json({ ok: true, ...publicBillingConfig() });
}

async function handleCheckout(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }
  if (!isStripeConfigured()) {
    return res.status(503).json({
      ok: false,
      error: "Stripe nu este configurat. Setează STRIPE_SECRET_KEY, STRIPE_PRICE_PREMIUM, STRIPE_PRICE_ULTRA."
    });
  }

  const requester = await getRequester(req);
  if (!requester.ok) {
    return res.status(requester.status || 401).json({ ok: false, error: requester.error });
  }

  const body = parseBody(req);
  const tier = String(body.tier || "").toLowerCase();
  const priceId = priceIdForTier(tier);
  if (!priceId) {
    return res.status(400).json({ ok: false, error: "Tier invalid. Folosește premium sau ultra." });
  }

  const cfg = assertSupabaseConfigured();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase indisponibil." });

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, stripe_customer_id, stripe_subscription_id, is_blocked, tier, subscription_expires_at")
    .eq("user_id", requester.user.id)
    .maybeSingle();
  if (profileError) return res.status(500).json({ ok: false, error: profileError.message });
  if (!profile) return res.status(404).json({ ok: false, error: "Profilul nu a fost găsit." });
  if (profile.is_blocked) return res.status(403).json({ ok: false, error: "Cont blocat." });

  // App 24h trials must never block paid Checkout.
  const stripe = getStripe();
  const origin = appOrigin(req);
  const customerId = await ensureStripeCustomer({
    userId: requester.user.id,
    email: requester.user.email,
    existingCustomerId: profile.stripe_customer_id
  });

  // If they already have an active Stripe subscription, upgrade/downgrade via Portal
  // instead of opening a second Checkout (which Stripe often rejects).
  if (profile.stripe_subscription_id) {
    try {
      const existing = await stripe.subscriptions.retrieve(String(profile.stripe_subscription_id));
      const status = String(existing?.status || "");
      if (["active", "trialing", "past_due"].includes(status)) {
        const portal = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${origin}/workspace?billing=portal`
        });
        return res.status(200).json({
          ok: true,
          url: portal.url,
          mode: "portal",
          message: "Ai deja un abonament activ — te redirecționăm la portal pentru upgrade/gestionare."
        });
      }
    } catch {
      /* fall through to new Checkout */
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/workspace?billing=success&tier=${encodeURIComponent(tier)}`,
    cancel_url: `${origin}/workspace?billing=cancel`,
    client_reference_id: requester.user.id,
    allow_promotion_codes: true,
    metadata: { user_id: requester.user.id, tier },
    subscription_data: {
      metadata: { user_id: requester.user.id, tier }
    }
  });

  return res.status(200).json({ ok: true, url: session.url, sessionId: session.id, mode: "checkout" });
}

async function handlePortal(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }
  if (!isStripeConfigured()) {
    return res.status(503).json({ ok: false, error: "Stripe nu este configurat." });
  }

  const requester = await getRequester(req);
  if (!requester.ok) {
    return res.status(requester.status || 401).json({ ok: false, error: requester.error });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase indisponibil." });

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", requester.user.id)
    .maybeSingle();
  if (error) return res.status(500).json({ ok: false, error: error.message });

  let customerId = profile?.stripe_customer_id || null;
  if (!customerId) {
    customerId = await ensureStripeCustomer({
      userId: requester.user.id,
      email: requester.user.email,
      existingCustomerId: null
    });
  }

  const stripe = getStripe();
  const origin = appOrigin(req);
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/workspace?billing=portal`
  });

  return res.status(200).json({ ok: true, url: portal.url });
}

async function handleTrial(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }

  const requester = await getRequester(req);
  if (!requester.ok) {
    return res.status(requester.status || 401).json({ ok: false, error: requester.error });
  }

  const cfg = assertSupabaseConfigured();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase nu este disponibil." });

  const body = parseBody(req);
  const tier = String(body.tier || "").toLowerCase();
  if (!["premium", "ultra"].includes(tier)) {
    return res.status(400).json({ ok: false, error: "Tier de trial invalid. Folosește premium sau ultra." });
  }

  const trialField = tier === "premium" ? "premium_trial_activated_at" : "ultra_trial_activated_at";

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      "user_id, tier, subscription_expires_at, stripe_subscription_id, premium_trial_activated_at, ultra_trial_activated_at"
    )
    .eq("user_id", requester.user.id)
    .maybeSingle();
  if (profileError) return res.status(500).json({ ok: false, error: profileError.message });
  if (!profile) return res.status(404).json({ ok: false, error: "Profilul nu a fost găsit." });

  const tierInfo = resolveEffectiveTierFromProfile(profile);
  if (tierInfo.hasActiveSubscription) {
    return res.status(409).json({
      ok: false,
      error: "Ai deja un abonament plătit activ. Folosește Upgrade / Manage billing — trial-ul nu e necesar."
    });
  }
  if (profile[trialField]) {
    return res.status(409).json({ ok: false, error: "Acest trial a fost deja folosit." });
  }
  // Only one free 24h trial window at a time (the other remains available after expiry).
  if (tier === "premium" && tierInfo.ultraTrialRemainingMs > 0) {
    return res.status(409).json({
      ok: false,
      error: "Trial Ultra este deja activ. Poți face Upgrade plătit oricând din Abonament Stripe."
    });
  }
  if (tier === "ultra" && tierInfo.premiumTrialRemainingMs > 0) {
    return res.status(409).json({
      ok: false,
      error: "Trial Premium este deja activ. Poți face Upgrade Ultra plătit oricând din Abonament Stripe."
    });
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ [trialField]: nowIso })
    .eq("user_id", requester.user.id);
  if (updateError) {
    return res.status(500).json({ ok: false, error: updateError.message });
  }

  return res.status(200).json({
    ok: true,
    tier,
    activatedAt: nowIso,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    canSubscribe: true
  });
}

async function resolveUserIdFromSubscription(subscription) {
  const metaUser = subscription?.metadata?.user_id;
  if (metaUser) return String(metaUser);
  const customerId = typeof subscription?.customer === "string" ? subscription.customer : subscription?.customer?.id;
  return findUserIdForCustomer(customerId);
}

async function handleWebhook(req, res, rawBody) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }

  const stripe = getStripe();
  const whSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!stripe || !whSecret) {
    return res.status(503).json({ ok: false, error: "Stripe webhook neconfigurat." });
  }

  let event;
  try {
    const signature = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(rawBody, signature, whSecret);
  } catch (err) {
    console.error("[billing:webhook] signature", err?.message || err);
    return res.status(400).json({ ok: false, error: `Webhook Error: ${err?.message || "invalid"}` });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode !== "subscription") break;
        const userId = session.client_reference_id || session.metadata?.user_id;
        const subId = session.subscription;
        if (!userId || !subId) break;
        const subscription = await stripe.subscriptions.retrieve(String(subId));
        await applySubscriptionToProfile({
          userId: String(userId),
          customerId: String(session.customer || ""),
          subscription
        });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const userId = await resolveUserIdFromSubscription(subscription);
        if (!userId) {
          console.warn("[billing:webhook] no user for subscription", subscription.id);
          break;
        }
        await applySubscriptionToProfile({
          userId,
          customerId: String(subscription.customer || ""),
          subscription
        });
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (!subId) break;
        const subscription = await stripe.subscriptions.retrieve(String(subId));
        const userId = await resolveUserIdFromSubscription(subscription);
        if (!userId) break;
        await applySubscriptionToProfile({
          userId,
          customerId: String(subscription.customer || invoice.customer || ""),
          subscription
        });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("[billing:webhook] handler", event.type, err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "handler failed" });
  }

  return res.status(200).json({ ok: true, received: true });
}

function resolveView(req) {
  const q = String(req.query.view || "").toLowerCase();
  if (q) return q;
  const url = String(req.url || "");
  if (url.includes("stripe-webhook")) return "webhook";
  if (url.includes("activate-trial")) return "trial";
  if (req.headers["stripe-signature"]) return "webhook";
  return "config";
}

export default async function handler(req, res) {
  const view = resolveView(req);
  try {
    if (view === "webhook") {
      const rawBody = await readRawBody(req);
      return handleWebhook(req, res, rawBody);
    }
    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
      await attachJsonBody(req);
    }
    if (view === "config") return handleConfig(req, res);
    if (view === "checkout") return handleCheckout(req, res);
    if (view === "portal") return handlePortal(req, res);
    if (view === "trial") return handleTrial(req, res);
    return res.status(400).json({
      ok: false,
      error: "view invalid. Folosește config, checkout, portal, trial sau webhook."
    });
  } catch (err) {
    console.error("[billing]", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "Billing error" });
  }
}
