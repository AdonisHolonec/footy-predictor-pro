/**
 * The `tierStatus` payload — the client's ONLY source of entitlement truth.
 *
 * WHY THIS IS A FUNCTION AND NOT TWO OBJECT LITERALS: api/fixtures.js builds
 * this shape at two call sites (the `?tierStatus=1` handler and the per-date
 * branch) and they were byte-identical. PR2a removed exactly this duplication
 * on the query side for exactly this reason: a field added to one site and not
 * the other is how the path that GATES access drifts from the path that
 * DISPLAYS it. PR2b adds three fields, so the two literals would have had to
 * stay in lockstep by hand forever.
 *
 * FIELD SEMANTICS — the distinction the whole of PR2b rests on:
 *
 *   tier          EFFECTIVE tier. What the user can actually do right now,
 *                 bonus and trials already applied. Feature gates read this.
 *   requestedTier UNDERLYING tier. What the user's own plan says, independent
 *                 of any bonus. Subscription UI reads this.
 *
 * They diverge the moment a bonus grant exists: an expired Premium user with an
 * active bonus is `tier: "ultra", requestedTier: "premium"`. The client used to
 * receive only `tier`, store it as the requested tier and re-derive the
 * effective tier from it — which, with a real grant, renders a FREE badge over
 * ULTRA data.
 *
 * `hasActiveSubscription` is sent rather than re-derived on the client because
 * "is this subscription still live" is a date comparison against server time,
 * and a client that does its own date maths is a client that can disagree with
 * the server. It stays PAID-ONLY: a bonus never makes a user look subscribed.
 */

/**
 * @param {object} args
 * @param {object} args.tierInfo        resolveEffectiveTierFromProfile() result
 * @param {string} args.effectiveTier   post-quotaExempt tier the request was served at
 * @param {number} args.predictCount    predictions already used today
 * @param {number} args.dailyLimit      may be Infinity for exempt/unlimited
 * @param {boolean} args.quotaExempt
 */
export function buildTierStatusPayload({ tierInfo, effectiveTier, predictCount, dailyLimit, quotaExempt }) {
  return {
    tier: effectiveTier,
    requestedTier: tierInfo.requestedTier,
    subscriptionExpiresAt: tierInfo.subscriptionExpiresAt,
    hasActiveSubscription: Boolean(tierInfo.hasActiveSubscription),
    bonusUntil: tierInfo.bonusUntil ?? null,
    hasActiveBonus: Boolean(tierInfo.hasActiveBonus),
    premiumTrialRemainingMs: tierInfo.premiumTrialRemainingMs,
    ultraTrialRemainingMs: tierInfo.ultraTrialRemainingMs,
    predictCountToday: predictCount,
    predictLimit: quotaExempt || !Number.isFinite(dailyLimit) ? null : dailyLimit,
    quotaExempt
  };
}

export default { buildTierStatusPayload };
