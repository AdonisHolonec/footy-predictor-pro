import Stripe from "stripe";
import { USER_TIERS } from "./accessTier.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

let stripeSingleton = null;

export function getStripe() {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) return null;
  if (!stripeSingleton) {
    // Use account default API version from the Stripe SDK.
    stripeSingleton = new Stripe(key);
  }
  return stripeSingleton;
}

export function isStripeConfigured() {
  return Boolean(
    String(process.env.STRIPE_SECRET_KEY || "").trim() &&
      String(process.env.STRIPE_PRICE_PREMIUM || "").trim() &&
      String(process.env.STRIPE_PRICE_ULTRA || "").trim()
  );
}

/** Map Stripe Price ID → app tier. */
export function tierFromPriceId(priceId) {
  const id = String(priceId || "").trim();
  if (!id) return null;
  const premium = String(process.env.STRIPE_PRICE_PREMIUM || "").trim();
  const ultra = String(process.env.STRIPE_PRICE_ULTRA || "").trim();
  if (premium && id === premium) return USER_TIERS.PREMIUM;
  if (ultra && id === ultra) return USER_TIERS.ULTRA;
  return null;
}

export function priceIdForTier(tier) {
  const t = String(tier || "").toLowerCase();
  if (t === USER_TIERS.PREMIUM) return String(process.env.STRIPE_PRICE_PREMIUM || "").trim() || null;
  if (t === USER_TIERS.ULTRA) return String(process.env.STRIPE_PRICE_ULTRA || "").trim() || null;
  return null;
}

export function publicBillingConfig() {
  return {
    configured: isStripeConfigured(),
    publishableKey: String(process.env.STRIPE_PUBLISHABLE_KEY || process.env.VITE_STRIPE_PUBLISHABLE_KEY || "").trim() || null,
    currency: String(process.env.STRIPE_CURRENCY || "eur").toLowerCase(),
    prices: {
      premium: Boolean(String(process.env.STRIPE_PRICE_PREMIUM || "").trim()),
      ultra: Boolean(String(process.env.STRIPE_PRICE_ULTRA || "").trim())
    }
  };
}

function periodEndIso(subscription) {
  const endSec = Number(subscription?.current_period_end || 0);
  if (!Number.isFinite(endSec) || endSec <= 0) return null;
  return new Date(endSec * 1000).toISOString();
}

/**
 * Sync profiles.tier from a Stripe Subscription object (service role).
 */
export async function applySubscriptionToProfile({
  userId,
  customerId,
  subscription
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return { ok: false, error: "missing_supabase_or_user" };

  const status = String(subscription?.status || "");
  const priceId = subscription?.items?.data?.[0]?.price?.id || null;
  const tierFromPrice = tierFromPriceId(priceId);
  const active =
    status === "active" || status === "trialing" || status === "past_due";

  const patch = {
    stripe_customer_id: customerId || subscription?.customer || null,
    stripe_subscription_id: subscription?.id || null,
    updated_at: new Date().toISOString()
  };

  if (active && tierFromPrice) {
    patch.tier = tierFromPrice;
    patch.subscription_expires_at = periodEndIso(subscription);
  } else if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
    patch.tier = USER_TIERS.FREE;
    patch.subscription_expires_at = null;
    patch.stripe_subscription_id = null;
  } else if (!active) {
    // incomplete / paused — do not elevate tier
    if (!tierFromPrice) {
      patch.tier = USER_TIERS.FREE;
      patch.subscription_expires_at = null;
    }
  }

  const { error } = await supabase.from("profiles").update(patch).eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, tier: patch.tier, status };
}

export async function findUserIdForCustomer(customerId) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !customerId) return null;
  const { data } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("stripe_customer_id", String(customerId))
    .maybeSingle();
  return data?.user_id || null;
}

export async function ensureStripeCustomer({ userId, email, existingCustomerId }) {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe nu este configurat (STRIPE_SECRET_KEY).");
  if (existingCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(existingCustomerId);
      if (existing && !existing.deleted) return existingCustomerId;
    } catch {
      /* create new */
    }
  }
  const customer = await stripe.customers.create({
    email: email || undefined,
    metadata: { user_id: String(userId) }
  });
  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase
      .from("profiles")
      .update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  }
  return customer.id;
}
