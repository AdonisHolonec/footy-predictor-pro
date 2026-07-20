import { createClient } from "@vercel/kv";

export const USER_TIERS = {
  FREE: "free",
  PREMIUM: "premium",
  ULTRA: "ultra"
};

export const CONFIDENCE_CATEGORY_THRESHOLDS = [
  { min: 75, label: "High" },
  { min: 60, label: "Medium" },
  { min: 0, label: "Low" }
];

const kv = createClient({
  url: process.env.KV_REST_API_URL || process.env.Database_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.Database_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
});

const FREE_DAYS_LIMIT = Math.max(1, Number(process.env.FREE_TIER_DAYS_LIMIT || 10));

/** Daily match caps — Premium/Ultra must never be below Free (audit P0). */
function buildMatchLimitByTier() {
  const free = Math.max(1, Number(process.env.FREE_TIER_DAILY_MATCH_LIMIT || 10));
  let premium = Math.max(1, Number(process.env.PREMIUM_TIER_DAILY_MATCH_LIMIT || 25));
  let ultra = Math.max(1, Number(process.env.ULTRA_TIER_DAILY_MATCH_LIMIT || 50));
  if (premium < free) premium = free;
  if (ultra < premium) ultra = premium;
  return {
    [USER_TIERS.FREE]: free,
    [USER_TIERS.PREMIUM]: premium,
    [USER_TIERS.ULTRA]: ultra
  };
}

const LIMIT_BY_TIER = buildMatchLimitByTier();

/** Daily warm/predict *action* caps (Supabase RPC), separate from match-row KV quota. */
function buildActionLimitByTier() {
  const free = Math.max(1, Number(process.env.FREE_TIER_DAILY_ACTION_LIMIT || 3));
  let premium = Math.max(1, Number(process.env.PREMIUM_TIER_DAILY_ACTION_LIMIT || 10));
  let ultra = Math.max(1, Number(process.env.ULTRA_TIER_DAILY_ACTION_LIMIT || 30));
  if (premium < free) premium = free;
  if (ultra < premium) ultra = premium;
  return {
    [USER_TIERS.FREE]: free,
    [USER_TIERS.PREMIUM]: premium,
    [USER_TIERS.ULTRA]: ultra
  };
}

const ACTION_LIMIT_BY_TIER = buildActionLimitByTier();

function parseDate(input) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isFinite(d.getTime()) ? d : null;
}

function hoursRemaining(fromDate, hours) {
  const start = parseDate(fromDate);
  if (!start) return 0;
  const end = start.getTime() + hours * 60 * 60 * 1000;
  return Math.max(0, end - Date.now());
}

export function confidenceCategory(confidencePct) {
  const c = Number(confidencePct);
  if (!Number.isFinite(c)) return null;
  for (const t of CONFIDENCE_CATEGORY_THRESHOLDS) {
    if (c >= t.min) return t.label;
  }
  return "Low";
}

export function resolveEffectiveTierFromProfile(profile) {
  const now = Date.now();
  const requestedTier = String(profile?.tier || USER_TIERS.FREE).toLowerCase();
  const subscriptionExpiresAt = parseDate(profile?.subscription_expires_at);
  const hasOpenEndedPaidTier =
    !subscriptionExpiresAt && (requestedTier === USER_TIERS.PREMIUM || requestedTier === USER_TIERS.ULTRA);
  const hasActiveSubscription = Boolean(
    (subscriptionExpiresAt && subscriptionExpiresAt.getTime() > now) || hasOpenEndedPaidTier
  );
  const premiumTrialRemainingMs = hoursRemaining(profile?.premium_trial_activated_at, 24);
  const ultraTrialRemainingMs = hoursRemaining(profile?.ultra_trial_activated_at, 24);

  // Paid subscription always beats free 24h trials so Upgrade/Checkout still grants access.
  let effectiveTier = USER_TIERS.FREE;
  if (hasActiveSubscription && (requestedTier === USER_TIERS.PREMIUM || requestedTier === USER_TIERS.ULTRA)) {
    effectiveTier = requestedTier;
  } else if (ultraTrialRemainingMs > 0) {
    effectiveTier = USER_TIERS.ULTRA;
  } else if (premiumTrialRemainingMs > 0) {
    effectiveTier = USER_TIERS.PREMIUM;
  }

  return {
    requestedTier,
    effectiveTier,
    hasActiveSubscription,
    subscriptionExpiresAt: subscriptionExpiresAt ? subscriptionExpiresAt.toISOString() : null,
    premiumTrialRemainingMs,
    ultraTrialRemainingMs
  };
}

export function isFreeWindowExpired(profileCreatedAtISO) {
  const created = parseDate(profileCreatedAtISO);
  if (!created) return false;
  const ageMs = Date.now() - created.getTime();
  return ageMs > FREE_DAYS_LIMIT * 24 * 60 * 60 * 1000;
}

export function tierDailyLimit(tier) {
  return LIMIT_BY_TIER[String(tier || USER_TIERS.FREE)] ?? LIMIT_BY_TIER[USER_TIERS.FREE];
}

export function tierDailyActionLimit(tier) {
  return ACTION_LIMIT_BY_TIER[String(tier || USER_TIERS.FREE)] ?? ACTION_LIMIT_BY_TIER[USER_TIERS.FREE];
}

function keyForPredictCount(userId, usageDay) {
  return `footy_tier_predict_count:${String(userId)}:${String(usageDay)}`;
}

export async function getPredictCountToday(userId, usageDay, options = {}) {
  if (!userId || !usageDay) return 0;
  const failClosed = options.failClosed === true;
  try {
    const val = await kv.get(keyForPredictCount(userId, usageDay));
    return Math.max(0, Number(val) || 0);
  } catch (err) {
    if (failClosed) throw err;
    return 0;
  }
}

export async function incrementPredictCountToday(userId, usageDay) {
  const key = keyForPredictCount(userId, usageDay);
  const next = await kv.incr(key);
  // Retention >24h to survive timezone/day-boundary mismatch safely.
  await kv.expire(key, 48 * 60 * 60);
  return Math.max(0, Number(next) || 0);
}

export async function incrementPredictCountBy(userId, usageDay, amount) {
  const delta = Math.max(0, Math.floor(Number(amount) || 0));
  if (delta <= 0) return getPredictCountToday(userId, usageDay);
  const key = keyForPredictCount(userId, usageDay);
  const next = await kv.incrby(key, delta);
  await kv.expire(key, 48 * 60 * 60);
  return Math.max(0, Number(next) || 0);
}

export async function decrementPredictCountToday(userId, usageDay) {
  const key = keyForPredictCount(userId, usageDay);
  try {
    const next = await kv.decr(key);
    return Math.max(0, Number(next) || 0);
  } catch {
    return 0;
  }
}

export async function decrementPredictCountBy(userId, usageDay, amount) {
  const delta = Math.max(0, Math.floor(Number(amount) || 0));
  if (delta <= 0) return getPredictCountToday(userId, usageDay);
  const key = keyForPredictCount(userId, usageDay);
  try {
    const next = await kv.decrby(key, delta);
    return Math.max(0, Number(next) || 0);
  } catch {
    return 0;
  }
}

export function maskPredictionForTier(row, tier) {
  const next = JSON.parse(JSON.stringify(row || {}));
  const effectiveTier = String(tier || USER_TIERS.FREE);

  if (!next?.probs) return next;

  if (effectiveTier === USER_TIERS.FREE) {
    delete next.probs.corners;
    delete next.probs.shotsOnTarget;
    delete next.probs.shotsTotal;
    delete next.probs.firstHalf;
    // Keep recommended confidence + value EV for FocusCard (recomandat / goluri).
    // Still hide Kelly / stake plan and advanced model internals.
    if (next.valueBet) {
      next.valueBet = {
        detected: Boolean(next.valueBet.detected),
        type: next.valueBet.type || "",
        ev: Number.isFinite(Number(next.valueBet.ev)) ? Number(next.valueBet.ev) : 0,
        kelly: 0,
        stakePlan: ""
      };
    }
    if (next.modelMeta) {
      delete next.modelMeta.topPickLift;
      delete next.modelMeta.topPickAlternates;
      delete next.modelMeta.elo;
      delete next.modelMeta.eloSpread;
    }
    return next;
  }

  if (effectiveTier === USER_TIERS.PREMIUM) {
    delete next.probs.shotsOnTarget;
    delete next.probs.shotsTotal;
    delete next.probs.firstHalf;
    const category = confidenceCategory(next?.recommended?.confidence);
    next.recommended = {
      ...next.recommended,
      confidence: null,
      confidenceCategory: category
    };
    // Keep value detector but remove precise EV/edge internals.
    if (next.valueBet) {
      next.valueBet = {
        detected: Boolean(next.valueBet.detected),
        type: next.valueBet.type || "",
        stakePlan: next.valueBet.stakePlan || ""
      };
    }
    if (next.modelMeta) {
      delete next.modelMeta.topPickLift;
      delete next.modelMeta.topPickAlternates;
      delete next.modelMeta.elo;
      delete next.modelMeta.eloSpread;
    }
  }

  return next;
}
