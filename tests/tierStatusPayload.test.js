import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { resolveEffectiveTierFromProfile } from "../server-utils/accessTier.js";
import { buildTierStatusPayload } from "../server-utils/tierStatusPayload.js";

/**
 * PR2b [A] — the contract the client now treats as entitlement truth.
 *
 * The payload is built from a REAL resolveEffectiveTierFromProfile() result
 * rather than a hand-written tierInfo: the point of these fields is that they
 * agree with the server's own tier decision, and a fabricated input would
 * assert nothing about that agreement.
 */

const DAY = 24 * 60 * 60 * 1000;
const future = (ms) => new Date(Date.now() + ms).toISOString();
const past = (ms) => new Date(Date.now() - ms).toISOString();

function payloadFor(profile, bonusUntil, { quotaExempt = false, predictCount = 0, dailyLimit = 5 } = {}) {
  const tierInfo = resolveEffectiveTierFromProfile(profile, bonusUntil);
  const effectiveTier = quotaExempt ? "ultra" : tierInfo.effectiveTier;
  return buildTierStatusPayload({ tierInfo, effectiveTier, predictCount, dailyLimit, quotaExempt });
}

test("[A] the payload carries tier, requestedTier, bonusUntil and hasActiveBonus", () => {
  const bonusUntil = future(5 * DAY);
  const out = payloadFor({ role: "user", tier: "premium", subscription_expires_at: past(DAY) }, bonusUntil);

  assert.equal(out.tier, "ultra", "effective tier must reflect the bonus");
  assert.equal(out.requestedTier, "premium", "the user's own plan is untouched by a bonus");
  assert.equal(out.bonusUntil, bonusUntil);
  assert.equal(out.hasActiveBonus, true);
  assert.equal(out.hasActiveSubscription, false, "a bonus is not a subscription");
});

test("[11] the change is additive — every pre-PR2b field survives with its name", () => {
  const out = payloadFor({ role: "user", tier: "premium", subscription_expires_at: future(30 * DAY) }, null, {
    predictCount: 4,
    dailyLimit: 20
  });
  for (const key of [
    "tier",
    "requestedTier",
    "subscriptionExpiresAt",
    "premiumTrialRemainingMs",
    "ultraTrialRemainingMs",
    "predictCountToday",
    "predictLimit",
    "quotaExempt"
  ]) {
    assert.ok(key in out, `pre-PR2b field ${key} must still be present`);
  }
  assert.equal(out.tier, "premium");
  assert.equal(out.predictCountToday, 4);
  assert.equal(out.predictLimit, 20);
});

test("no bonus -> bonusUntil null and hasActiveBonus false, never undefined", () => {
  const out = payloadFor({ role: "user", tier: "free" }, null);
  assert.equal(out.bonusUntil, null);
  assert.equal(out.hasActiveBonus, false);
  assert.equal(typeof out.hasActiveSubscription, "boolean");
});

test("an expired bonus window does not resurrect a lapsed plan", () => {
  const out = payloadFor({ role: "user", tier: "premium", subscription_expires_at: past(DAY) }, past(2 * DAY));
  assert.equal(out.tier, "free");
  assert.equal(out.requestedTier, "premium");
  assert.equal(out.hasActiveBonus, false);
});

test("a live subscription reports hasActiveSubscription true alongside a bonus", () => {
  const out = payloadFor({ role: "user", tier: "premium", subscription_expires_at: future(30 * DAY) }, future(5 * DAY));
  assert.equal(out.tier, "ultra");
  assert.equal(out.requestedTier, "premium");
  assert.equal(out.hasActiveSubscription, true);
  assert.equal(out.hasActiveBonus, true);
});

test("quotaExempt forces ultra and unlimited without rewriting the plan", () => {
  const out = payloadFor({ role: "admin", tier: "free" }, null, {
    quotaExempt: true,
    dailyLimit: Number.POSITIVE_INFINITY
  });
  assert.equal(out.tier, "ultra");
  assert.equal(out.requestedTier, "free");
  assert.equal(out.predictLimit, null, "an exempt user has no limit to render");
  assert.equal(out.quotaExempt, true);
});

test("an infinite daily limit is sent as null rather than Infinity", () => {
  // JSON.stringify turns Infinity into null anyway; doing it here keeps the
  // contract explicit instead of relying on a serialiser quirk.
  const out = payloadFor({ role: "user", tier: "ultra", subscription_expires_at: future(DAY) }, null, {
    dailyLimit: Number.POSITIVE_INFINITY
  });
  assert.equal(out.predictLimit, null);
});

test("both api/fixtures.js tierStatus sites go through the shared builder", () => {
  // The two payloads were byte-identical literals and drifting them apart is
  // exactly the failure this PR is about: one path GATES access, the other
  // DISPLAYS it. Guard the single source rather than the two copies.
  const source = readFileSync(new URL("../api/fixtures.js", import.meta.url), "utf8");
  const uses = source.match(/buildTierStatusPayload\(/g) || [];
  assert.equal(uses.length, 2, "both call sites build the payload through the helper");
  assert.ok(!/tierStatus:\s*\{/.test(source), "no hand-rolled tierStatus literal may remain");
});
