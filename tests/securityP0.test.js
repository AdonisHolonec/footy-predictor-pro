import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedCronOrInternalRequest } from "../server-utils/cronRequestAuth.js";
import {
  resolveEffectiveTierFromProfile,
  tierDailyActionLimit,
  tierDailyLimit,
  USER_TIERS
} from "../server-utils/accessTier.js";
import { tierFromPriceId } from "../server-utils/stripeBilling.js";

function mockReq({ headers = {}, query = {} } = {}) {
  return { headers, query };
}

describe("Security P0 — cron auth", () => {
  it("accepts Bearer CRON_SECRET", () => {
    const prev = process.env.CRON_SECRET;
    const prevNode = process.env.NODE_ENV;
    const prevVercel = process.env.VERCEL_ENV;
    process.env.CRON_SECRET = "test-secret-abc";
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    try {
      assert.equal(
        isAuthorizedCronOrInternalRequest(
          mockReq({ headers: { authorization: "Bearer test-secret-abc" } })
        ),
        true
      );
      assert.equal(
        isAuthorizedCronOrInternalRequest(mockReq({ headers: { "x-cron-secret": "test-secret-abc" } })),
        true
      );
    } finally {
      process.env.CRON_SECRET = prev;
      process.env.NODE_ENV = prevNode;
      process.env.VERCEL_ENV = prevVercel;
    }
  });

  it("rejects query ?secret= in production", () => {
    const prev = process.env.CRON_SECRET;
    const prevNode = process.env.NODE_ENV;
    const prevVercel = process.env.VERCEL_ENV;
    process.env.CRON_SECRET = "test-secret-abc";
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    try {
      assert.equal(
        isAuthorizedCronOrInternalRequest(mockReq({ query: { secret: "test-secret-abc" } })),
        false
      );
    } finally {
      process.env.CRON_SECRET = prev;
      process.env.NODE_ENV = prevNode;
      process.env.VERCEL_ENV = prevVercel;
    }
  });

  it("allows query ?secret= outside production for local scripts", () => {
    const prev = process.env.CRON_SECRET;
    const prevNode = process.env.NODE_ENV;
    const prevVercel = process.env.VERCEL_ENV;
    process.env.CRON_SECRET = "test-secret-abc";
    process.env.NODE_ENV = "development";
    process.env.VERCEL_ENV = "development";
    try {
      assert.equal(
        isAuthorizedCronOrInternalRequest(mockReq({ query: { secret: "test-secret-abc" } })),
        true
      );
    } finally {
      process.env.CRON_SECRET = prev;
      process.env.NODE_ENV = prevNode;
      process.env.VERCEL_ENV = prevVercel;
    }
  });
});

describe("Security P0 — tier quotas", () => {
  it("Premium and Ultra daily match limits are >= Free", () => {
    const free = tierDailyLimit(USER_TIERS.FREE);
    const premium = tierDailyLimit(USER_TIERS.PREMIUM);
    const ultra = tierDailyLimit(USER_TIERS.ULTRA);
    assert.ok(premium >= free, `premium ${premium} < free ${free}`);
    assert.ok(ultra >= premium, `ultra ${ultra} < premium ${premium}`);
  });

  it("Premium and Ultra daily action limits are >= Free", () => {
    const free = tierDailyActionLimit(USER_TIERS.FREE);
    const premium = tierDailyActionLimit(USER_TIERS.PREMIUM);
    const ultra = tierDailyActionLimit(USER_TIERS.ULTRA);
    assert.ok(premium >= free);
    assert.ok(ultra >= premium);
  });
});

describe("Stripe billing helpers", () => {
  it("maps price IDs to tiers from env", () => {
    const prevP = process.env.STRIPE_PRICE_PREMIUM;
    const prevU = process.env.STRIPE_PRICE_ULTRA;
    process.env.STRIPE_PRICE_PREMIUM = "price_premium_test";
    process.env.STRIPE_PRICE_ULTRA = "price_ultra_test";
    try {
      assert.equal(tierFromPriceId("price_premium_test"), "premium");
      assert.equal(tierFromPriceId("price_ultra_test"), "ultra");
      assert.equal(tierFromPriceId("price_other"), null);
    } finally {
      process.env.STRIPE_PRICE_PREMIUM = prevP;
      process.env.STRIPE_PRICE_ULTRA = prevU;
    }
  });
});

describe("Trial vs paid subscription priority", () => {
  it("active 24h trial grants tier when no paid sub", () => {
    const now = Date.now();
    const info = resolveEffectiveTierFromProfile({
      tier: "free",
      subscription_expires_at: null,
      premium_trial_activated_at: new Date(now - 60 * 60 * 1000).toISOString(),
      ultra_trial_activated_at: null
    });
    assert.equal(info.effectiveTier, "premium");
    assert.equal(info.hasActiveSubscription, false);
    assert.ok(info.premiumTrialRemainingMs > 0);
  });

  it("paid subscription beats an active free trial", () => {
    const now = Date.now();
    const info = resolveEffectiveTierFromProfile({
      tier: "ultra",
      subscription_expires_at: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      premium_trial_activated_at: new Date(now - 60 * 60 * 1000).toISOString(),
      ultra_trial_activated_at: null
    });
    assert.equal(info.effectiveTier, "ultra");
    assert.equal(info.hasActiveSubscription, true);
    assert.ok(info.premiumTrialRemainingMs > 0);
  });
});
