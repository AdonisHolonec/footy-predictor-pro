/**
 * Billing API (Stripe Checkout + Customer Portal).
 *
 * GET  /api/billing?view=config     — public: whether Stripe is configured
 * POST /api/billing?view=checkout   — JWT: { tier: "premium"|"ultra" } → { url }
 * POST /api/billing?view=portal     — JWT → { url } Customer Portal
 */
import { getRequester } from "../server-utils/authAdmin.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import {
  ensureStripeCustomer,
  getStripe,
  isStripeConfigured,
  priceIdForTier,
  publicBillingConfig
} from "../server-utils/stripeBilling.js";

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
    .select("user_id, stripe_customer_id, is_blocked")
    .eq("user_id", requester.user.id)
    .maybeSingle();
  if (profileError) return res.status(500).json({ ok: false, error: profileError.message });
  if (!profile) return res.status(404).json({ ok: false, error: "Profilul nu a fost găsit." });
  if (profile.is_blocked) return res.status(403).json({ ok: false, error: "Cont blocat." });

  const stripe = getStripe();
  const origin = appOrigin(req);
  const customerId = await ensureStripeCustomer({
    userId: requester.user.id,
    email: requester.user.email,
    existingCustomerId: profile.stripe_customer_id
  });

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

  return res.status(200).json({ ok: true, url: session.url, sessionId: session.id });
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

export default async function handler(req, res) {
  const view = String(req.query.view || "config").toLowerCase();
  try {
    if (view === "config") return handleConfig(req, res);
    if (view === "checkout") return handleCheckout(req, res);
    if (view === "portal") return handlePortal(req, res);
    return res.status(400).json({ ok: false, error: "view invalid. Folosește config, checkout sau portal." });
  } catch (err) {
    console.error("[billing]", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "Billing error" });
  }
}
