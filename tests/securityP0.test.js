import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedCronOrInternalRequest } from "../server-utils/cronRequestAuth.js";
import { tierDailyActionLimit, tierDailyLimit, USER_TIERS } from "../server-utils/accessTier.js";

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
