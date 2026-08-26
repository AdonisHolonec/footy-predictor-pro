import { createClient } from "@vercel/kv";

export { pickUltraUniqueAllowedFixtures } from "./ultraUniqueQuota.js";

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
  const free = Math.max(1, Number(process.env.FREE_TIER_DAILY_ACTION_LIMIT || 5));
  let premium = Math.max(1, Number(process.env.PREMIUM_TIER_DAILY_ACTION_LIMIT || 20));
  let ultra = Math.max(1, Number(process.env.ULTRA_TIER_DAILY_ACTION_LIMIT || 50));
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

/**
 * Effective tier for one profile, optionally with an active ULTRA bonus window.
 *
 * BONUS TIME IS ALWAYS ULTRA. A bonus grant does not extend the user's paid tier —
 * it replaces it with ultra for the length of the window, then the paid tier resumes
 * untouched. Premium-until-Sep-10 plus a bonus ending Sep-15 is ultra through Sep 15,
 * then premium again until Sep 10 if that is still in the future — the paid expiry is
 * never moved, because `profiles.subscription_expires_at` belongs to Stripe and is
 * overwritten by every webhook.
 *
 * `bonusUntil` is a PARAMETER, not a lookup. This function stays pure and
 * synchronous — every consumer (Stage01, Stage10, Stage11, api/fixtures, api/warm)
 * calls it per request, and a database round-trip hidden in here would be an N+1 on
 * the predict hot path. The caller loads the profile and the bonus together and
 * passes both; `getActiveBonusUntil` in server-utils/timeGrants.js is that loader.
 *
 * Omitting the argument reproduces the pre-bonus behaviour exactly, which is what
 * every existing call site does today.
 *
 * @param {object} profile
 * @param {string|Date|null} [bonusUntil] end of the active ULTRA bonus window, if any
 */
export function resolveEffectiveTierFromProfile(profile, bonusUntil = null) {
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

  const bonusUntilDate = parseDate(bonusUntil);
  const hasActiveBonus = Boolean(bonusUntilDate && bonusUntilDate.getTime() > now);

  // Paid subscription always beats free 24h trials so Upgrade/Checkout still grants access.
  let effectiveTier = USER_TIERS.FREE;
  if (hasActiveSubscription && (requestedTier === USER_TIERS.PREMIUM || requestedTier === USER_TIERS.ULTRA)) {
    effectiveTier = requestedTier;
  } else if (ultraTrialRemainingMs > 0) {
    effectiveTier = USER_TIERS.ULTRA;
  } else if (premiumTrialRemainingMs > 0) {
    effectiveTier = USER_TIERS.PREMIUM;
  }

  // An active bonus wins outright — it is ultra for everyone, including a free user
  // and a paid premium user. It is applied AFTER the block above rather than inside
  // it so that `requestedTier` and `hasActiveSubscription` keep meaning exactly what
  // they meant before: the user's own plan, never the bonus.
  if (hasActiveBonus) {
    effectiveTier = USER_TIERS.ULTRA;
  }

  return {
    requestedTier,
    effectiveTier,
    hasActiveSubscription,
    subscriptionExpiresAt: subscriptionExpiresAt ? subscriptionExpiresAt.toISOString() : null,
    premiumTrialRemainingMs,
    ultraTrialRemainingMs,
    hasActiveBonus,
    bonusUntil: bonusUntilDate ? bonusUntilDate.toISOString() : null
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

function keyForUniquePredictFixtures(userId, usageDay) {
  return `footy_tier_predict_fixtures:${String(userId)}:${String(usageDay)}`;
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

/** Ultra unique-fixture daily counter (Redis SET cardinality). */
export async function getUniquePredictCountToday(userId, usageDay, options = {}) {
  if (!userId || !usageDay) return 0;
  const failClosed = options.failClosed === true;
  try {
    const n = await kv.scard(keyForUniquePredictFixtures(userId, usageDay));
    return Math.max(0, Number(n) || 0);
  } catch (err) {
    if (failClosed) throw err;
    return 0;
  }
}

export async function getUniquePredictFixtureIds(userId, usageDay, options = {}) {
  if (!userId || !usageDay) return new Set();
  const failClosed = options.failClosed === true;
  try {
    const members = await kv.smembers(keyForUniquePredictFixtures(userId, usageDay));
    return new Set((Array.isArray(members) ? members : []).map((m) => String(m)));
  } catch (err) {
    if (failClosed) throw err;
    return new Set();
  }
}

export async function rememberUniquePredictFixtures(userId, usageDay, fixtureIds) {
  if (!userId || !usageDay) return 0;
  const ids = [
    ...new Set(
      (Array.isArray(fixtureIds) ? fixtureIds : [])
        .map((id) => String(id ?? "").trim())
        .filter((id) => id && id !== "undefined" && id !== "null")
    )
  ];
  const key = keyForUniquePredictFixtures(userId, usageDay);
  if (ids.length > 0) {
    // @vercel/kv / Upstash: SADD returns added count; ignore return for idempotent re-runs.
    await kv.sadd(key, ...ids);
    await kv.expire(key, 48 * 60 * 60);
  }
  return getUniquePredictCountToday(userId, usageDay);
}

/** Match-quota counter for UI/headers: Ultra = unique fixtures; others = slot counter. */
export async function getTierPredictCountToday(userId, usageDay, tier, options = {}) {
  if (String(tier || "").toLowerCase() === USER_TIERS.ULTRA) {
    return getUniquePredictCountToday(userId, usageDay, options);
  }
  return getPredictCountToday(userId, usageDay, options);
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

  // Internal debug metadata (motivation/clean-sheet diagnostics, PREDICT_DEBUG_METADATA) must
  // never reach a tier-masked response, regardless of tier. Only callers that bypass this
  // function entirely (cron / quota-exempt admin — see Stage11Masking.js) can ever see it.
  if (next?.modelMeta) delete next.modelMeta.debug;

  if (!next?.probs) return next;

  if (effectiveTier === USER_TIERS.FREE) {
    delete next.probs.corners;
    delete next.probs.shotsOnTarget;
    delete next.probs.shotsTotal;
    delete next.probs.firstHalf;
    delete next.probs.cards;
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
    delete next.probs.cards;
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
