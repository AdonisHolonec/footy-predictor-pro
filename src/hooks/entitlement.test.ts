import { describe, expect, it } from "vitest";
import type { User } from "../types";
import { applyEntitlementToUser, isSubscriptionExpiredFrom, parseTierStatus } from "./entitlement";

/**
 * PR2b — the entitlement rules, isolated from React.
 *
 * The bug these guard against is not arithmetic, it is a MEANING collision:
 * one field, `tier`, was used for two different questions ("what plan is this
 * user on" and "what may they do"). Every case below pins the two answers apart.
 */

const FREE_STATUS = {
  tier: "free",
  requestedTier: "free",
  subscriptionExpiresAt: null,
  hasActiveSubscription: false,
  bonusUntil: null,
  hasActiveBonus: false,
  premiumTrialRemainingMs: 0,
  ultraTrialRemainingMs: 0,
  predictCountToday: 2,
  predictLimit: 5,
  quotaExempt: false
};

const BONUS_UNTIL = "2026-09-01T12:00:00.000Z";

function withBonus(overrides: Record<string, unknown>) {
  return { ...FREE_STATUS, bonusUntil: BONUS_UNTIL, hasActiveBonus: true, tier: "ultra", ...overrides };
}

function baseUser(): User {
  return {
    id: "u1",
    email: "u@example.test",
    role: "user",
    favoriteLeagues: [],
    tier: "free",
    subscription_expires_at: null,
    premium_trial_activated_at: null,
    ultra_trial_activated_at: null,
    predict_count_today: 0
  };
}

describe("parseTierStatus", () => {
  it("[B] takes the effective tier from the server verbatim", () => {
    expect(parseTierStatus(withBonus({}))?.tier).toBe("ultra");
  });

  it("[E] FREE + bonus -> requested free, effective ultra", () => {
    const ent = parseTierStatus(withBonus({ requestedTier: "free" }))!;
    expect(ent.requestedTier).toBe("free");
    expect(ent.tier).toBe("ultra");
  });

  it("[F] PREMIUM + bonus -> requested premium, effective ultra", () => {
    const ent = parseTierStatus(withBonus({ requestedTier: "premium", hasActiveSubscription: true }))!;
    expect(ent.requestedTier).toBe("premium");
    expect(ent.tier).toBe("ultra");
  });

  it("[G] ULTRA + bonus -> both ultra, and the bonus is still reported", () => {
    const ent = parseTierStatus(withBonus({ requestedTier: "ultra", hasActiveSubscription: true }))!;
    expect(ent.requestedTier).toBe("ultra");
    expect(ent.tier).toBe("ultra");
    expect(ent.hasActiveBonus).toBe(true);
  });

  it("[J][K] propagates bonusUntil and hasActiveBonus exactly", () => {
    const ent = parseTierStatus(withBonus({}))!;
    expect(ent.bonusUntil).toBe(BONUS_UNTIL);
    expect(ent.hasActiveBonus).toBe(true);
    const none = parseTierStatus(FREE_STATUS)!;
    expect(none.bonusUntil).toBeNull();
    expect(none.hasActiveBonus).toBe(false);
  });

  it("[M] preserves subscriptionExpiresAt untouched", () => {
    const iso = "2026-08-01T00:00:00.000Z";
    expect(parseTierStatus({ ...FREE_STATUS, subscriptionExpiresAt: iso })?.subscriptionExpiresAt).toBe(iso);
  });

  it("carries quota fields through without re-deriving them", () => {
    const ent = parseTierStatus({ ...FREE_STATUS, predictCountToday: 7, predictLimit: 20, quotaExempt: true })!;
    expect(ent.predictCountToday).toBe(7);
    expect(ent.predictLimit).toBe(20);
    expect(ent.quotaExempt).toBe(true);
  });

  it("treats a null predictLimit as unlimited rather than zero", () => {
    expect(parseTierStatus({ ...FREE_STATUS, predictLimit: null })?.predictLimit).toBeNull();
  });

  it("falls back requestedTier to tier when the server omits it", () => {
    // A response shaped like the pre-PR2b server: one tier, meaning both things.
    const ent = parseTierStatus({ tier: "premium" })!;
    expect(ent.requestedTier).toBe("premium");
    expect(ent.tier).toBe("premium");
  });

  it("rejects an unusable payload instead of inventing a free user", () => {
    expect(parseTierStatus(null)).toBeNull();
    expect(parseTierStatus("ultra")).toBeNull();
    expect(parseTierStatus(undefined)).toBeNull();
  });

  it("clamps an unknown tier string to free rather than trusting it", () => {
    expect(parseTierStatus({ tier: "platinum" })?.tier).toBe("free");
  });
});

describe("isSubscriptionExpiredFrom", () => {
  it("[H] an expired subscription still reads as expired while a bonus is active", () => {
    const ent = parseTierStatus(
      withBonus({
        requestedTier: "premium",
        subscriptionExpiresAt: "2026-01-01T00:00:00.000Z",
        hasActiveSubscription: false
      })
    )!;
    expect(ent.tier).toBe("ultra");
    expect(ent.hasActiveSubscription).toBe(false);
    expect(isSubscriptionExpiredFrom(ent)).toBe(true);
  });

  it("a live subscription is not expired", () => {
    const ent = parseTierStatus({
      ...FREE_STATUS,
      requestedTier: "premium",
      tier: "premium",
      subscriptionExpiresAt: "2099-01-01T00:00:00.000Z",
      hasActiveSubscription: true
    })!;
    expect(isSubscriptionExpiredFrom(ent)).toBe(false);
  });

  it("a user who never subscribed is not 'expired'", () => {
    expect(isSubscriptionExpiredFrom(parseTierStatus(FREE_STATUS))).toBe(false);
  });

  it("[D] reports nothing at all before the server has answered", () => {
    // null is "not asked yet" — it must never be rendered as a lapsed plan.
    expect(isSubscriptionExpiredFrom(null)).toBe(false);
  });
});

describe("applyEntitlementToUser", () => {
  it("[C] writes requestedTier into user.tier — never the effective tier", () => {
    const ent = parseTierStatus(withBonus({ requestedTier: "premium" }))!;
    const next = applyEntitlementToUser(baseUser(), ent);
    expect(next.tier).toBe("premium");
    expect(ent.tier).toBe("ultra");
  });

  it("[L] a refresh cannot silently promote the stored plan", () => {
    const user = { ...baseUser(), tier: "premium" as const };
    const ent = parseTierStatus(withBonus({ requestedTier: "premium" }))!;
    // Three consecutive polls while a bonus is live.
    const after = [1, 2, 3].reduce((acc) => applyEntitlementToUser(acc, ent), user);
    expect(after.tier).toBe("premium");
  });

  it("[I] an expired bonus drops the effective tier without touching the plan", () => {
    const ent = parseTierStatus({
      ...FREE_STATUS,
      tier: "free",
      requestedTier: "premium",
      subscriptionExpiresAt: "2026-01-01T00:00:00.000Z",
      hasActiveSubscription: false
    })!;
    const next = applyEntitlementToUser({ ...baseUser(), tier: "premium" }, ent);
    expect(next.tier).toBe("premium");
    expect(ent.tier).toBe("free");
  });

  it("keeps a known expiry when the response omits one", () => {
    const user = { ...baseUser(), subscription_expires_at: "2026-05-05T00:00:00.000Z" };
    const next = applyEntitlementToUser(user, parseTierStatus(FREE_STATUS)!);
    expect(next.subscription_expires_at).toBe("2026-05-05T00:00:00.000Z");
  });

  it("does not mutate the user it was given", () => {
    const user = baseUser();
    applyEntitlementToUser(user, parseTierStatus(withBonus({ requestedTier: "ultra" }))!);
    expect(user.tier).toBe("free");
  });
});
