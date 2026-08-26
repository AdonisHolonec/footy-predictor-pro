import type { User, UserTier } from "../types";

/**
 * Entitlement, as the SERVER decided it. The client's job is to parse this and
 * render it — never to recompute it.
 *
 * WHY THIS MODULE EXISTS: useAuth used to mirror server-utils/accessTier.js in
 * three React memos (isSubscriptionExpired -> hasActiveSubscription ->
 * effectiveTier). Two implementations of one rule stay in step only for as long
 * as nobody adds an input to the rule. PR1 added one — bonus time — and the
 * mirror broke in the worst possible direction: `refreshTierStatus` wrote the
 * server's EFFECTIVE tier into `user.tier`, which the memos then read as the
 * REQUESTED tier. For a Premium user whose subscription lapsed while a bonus
 * was active the server says "ultra", the client stored "ultra" as the plan,
 * saw no live subscription behind it, fell through to the trial branch and
 * rendered FREE — over data the server had already masked at ULTRA.
 *
 * So the two tiers now travel separately and mean different things:
 *
 *   tier          EFFECTIVE — what the user can do right now. Feature gates.
 *   requestedTier UNDERLYING — what the user's own plan says. Subscription UI.
 *
 * Everything here is pure, so the rules below are unit-testable without a
 * React tree, a session or a network.
 */
export type ClientEntitlement = {
  /** EFFECTIVE tier: bonus and trials already applied by the server. */
  tier: UserTier;
  /** UNDERLYING requested/paid tier, independent of any bonus. */
  requestedTier: UserTier;
  subscriptionExpiresAt: string | null;
  /** PAID-only. A bonus never makes a user look subscribed. */
  hasActiveSubscription: boolean;
  bonusUntil: string | null;
  hasActiveBonus: boolean;
  premiumTrialRemainingMs: number;
  ultraTrialRemainingMs: number;
  predictCountToday: number;
  predictLimit: number | null;
  quotaExempt: boolean;
};

const TIERS: readonly UserTier[] = ["free", "premium", "ultra"];

function asTier(value: unknown, fallback: UserTier): UserTier {
  const t = String(value ?? "").toLowerCase() as UserTier;
  return TIERS.includes(t) ? t : fallback;
}

function asMs(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Parse `json.tierStatus`. Returns null for anything unusable, so the caller
 * can keep the previous answer rather than downgrading the user on a blip.
 *
 * `requestedTier` falls back to `tier` when absent: that is precisely the
 * pre-PR2b world (one tier, meaning both things), which is the only sensible
 * reading of a response that does not distinguish them.
 */
export function parseTierStatus(raw: unknown): ClientEntitlement | null {
  if (!raw || typeof raw !== "object") return null;
  const ts = raw as Record<string, unknown>;
  const tier = asTier(ts.tier, "free");
  return {
    tier,
    requestedTier: asTier(ts.requestedTier, tier),
    subscriptionExpiresAt: typeof ts.subscriptionExpiresAt === "string" ? ts.subscriptionExpiresAt : null,
    hasActiveSubscription: Boolean(ts.hasActiveSubscription),
    bonusUntil: typeof ts.bonusUntil === "string" ? ts.bonusUntil : null,
    hasActiveBonus: Boolean(ts.hasActiveBonus),
    premiumTrialRemainingMs: asMs(ts.premiumTrialRemainingMs),
    ultraTrialRemainingMs: asMs(ts.ultraTrialRemainingMs),
    predictCountToday: Math.max(0, Number(ts.predictCountToday) || 0),
    predictLimit: ts.predictLimit == null ? null : Number(ts.predictLimit),
    quotaExempt: Boolean(ts.quotaExempt)
  };
}

/**
 * Does the user's own PAID plan look lapsed?
 *
 * Two server facts combined, deliberately with no date arithmetic: a client
 * that compares timestamps itself is a client that can disagree with the
 * server about when "now" is. `subscriptionExpiresAt` present means the user
 * once had a paid window; `hasActiveSubscription` false means it is not live.
 *
 * This is about the SUBSCRIPTION, not about access. A user on an active bonus
 * still sees "your subscription expired" — because it did, and renewing is a
 * real thing they may want to do before the bonus runs out.
 */
export function isSubscriptionExpiredFrom(entitlement: ClientEntitlement | null): boolean {
  if (!entitlement) return false;
  return Boolean(entitlement.subscriptionExpiresAt) && !entitlement.hasActiveSubscription;
}

/**
 * Fold the server's answer back into the user model.
 *
 * `tier` receives `requestedTier` — THE fix. `user.tier` means "the plan this
 * user is on" everywhere it is read (admin monetisation drafts, the profile
 * row it was loaded from); writing the effective tier there made a bonus look
 * like a purchase.
 *
 * `subscription_expires_at` keeps its pre-PR2b `??` fallback so a response that
 * omits the field cannot blank a known expiry. Display truth does not depend on
 * this field any more — isSubscriptionExpiredFrom() reads the entitlement — so
 * the stickiness is harmless and the diff stays behaviour-preserving.
 */
export function applyEntitlementToUser(user: User, entitlement: ClientEntitlement): User {
  return {
    ...user,
    tier: entitlement.requestedTier,
    subscription_expires_at: entitlement.subscriptionExpiresAt ?? user.subscription_expires_at,
    predict_count_today: entitlement.predictCountToday
  };
}
