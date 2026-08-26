import test from "node:test";
import assert from "node:assert/strict";

import { resolveEffectiveTierFromProfile, USER_TIERS } from "../server-utils/accessTier.js";
import {
  GRANT_SOURCES,
  STANDARD_BONUS_DAYS,
  grantBonusDays,
  revokeGrant,
  getActiveBonusUntil
} from "../server-utils/timeGrants.js";

/**
 * PR1 — bonus-time ledger + entitlement foundation.
 *
 * PRODUCT RULE UNDER TEST: bonus time is ALWAYS ultra, for everyone. It does not
 * extend the paid tier, it replaces it for the length of the window, and when the
 * window ends the paid tier resumes untouched.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE:
 *
 * The entitlement half is a pure function, so it is proven exactly here. The
 * stacking and idempotency half lives in SQL (migration 061), and SQL cannot be
 * executed from this suite — tests/integration/timeGrantsRls.db.test.js covers it
 * against a real Postgres. What IS proven here for the service layer is the
 * contract: argument validation, the RPC actually called, the arguments passed, and
 * the shape returned. The stacking arithmetic itself is asserted as a model below so
 * the intended semantics are pinned in a readable place, and the DB suite proves the
 * SQL matches that model.
 */

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const iso = (msFromNow) => new Date(NOW + msFromNow).toISOString();

const FREE = { tier: "free", subscription_expires_at: null };
const PREMIUM = { tier: "premium", subscription_expires_at: iso(15 * DAY) };
const ULTRA = { tier: "ultra", subscription_expires_at: iso(15 * DAY) };

/* ------------------------------------------------------------------ */
/* A-D. Bonus always grants ULTRA                                      */
/* ------------------------------------------------------------------ */

test("[A] a +5 day bonus from now is active and resolves to ultra", () => {
  const bonusUntil = iso(STANDARD_BONUS_DAYS * DAY);
  const r = resolveEffectiveTierFromProfile(FREE, bonusUntil);
  assert.equal(r.effectiveTier, USER_TIERS.ULTRA);
  assert.equal(r.hasActiveBonus, true);
  assert.equal(r.bonusUntil, new Date(bonusUntil).toISOString());
});

test("[C] FREE + active bonus -> ULTRA", () => {
  const r = resolveEffectiveTierFromProfile(FREE, iso(5 * DAY));
  assert.equal(r.effectiveTier, USER_TIERS.ULTRA);
  // the user's own plan is untouched by the bonus
  assert.equal(r.requestedTier, "free");
  assert.equal(r.hasActiveSubscription, false);
});

test("[B] PREMIUM + active bonus -> ULTRA, and the paid expiry is not moved", () => {
  const r = resolveEffectiveTierFromProfile(PREMIUM, iso(5 * DAY));
  assert.equal(r.effectiveTier, USER_TIERS.ULTRA);
  assert.equal(r.requestedTier, "premium");
  assert.equal(r.hasActiveSubscription, true);
  assert.equal(r.subscriptionExpiresAt, new Date(PREMIUM.subscription_expires_at).toISOString());
});

test("[D] ULTRA + active bonus -> ULTRA (no double-counting, no error)", () => {
  const r = resolveEffectiveTierFromProfile(ULTRA, iso(5 * DAY));
  assert.equal(r.effectiveTier, USER_TIERS.ULTRA);
  assert.equal(r.requestedTier, "ultra");
});

/* ------------------------------------------------------------------ */
/* E-G. Fallback once the bonus expires                                */
/* ------------------------------------------------------------------ */

test("[E] PREMIUM restored after the bonus expires — paid expiry unchanged", () => {
  const r = resolveEffectiveTierFromProfile(PREMIUM, iso(-1 * DAY));
  assert.equal(r.effectiveTier, USER_TIERS.PREMIUM, "must fall back to the paid tier, not free");
  assert.equal(r.hasActiveBonus, false);
  assert.equal(r.subscriptionExpiresAt, new Date(PREMIUM.subscription_expires_at).toISOString());
});

test("[F] FREE restored after the bonus expires", () => {
  const r = resolveEffectiveTierFromProfile(FREE, iso(-1 * DAY));
  assert.equal(r.effectiveTier, USER_TIERS.FREE);
  assert.equal(r.hasActiveBonus, false);
});

test("[G] paid ULTRA survives bonus expiry", () => {
  const r = resolveEffectiveTierFromProfile(ULTRA, iso(-1 * DAY));
  assert.equal(r.effectiveTier, USER_TIERS.ULTRA);
});

test("[integration] premium until +15d with a bonus ending +5d: ultra now, premium after", () => {
  const during = resolveEffectiveTierFromProfile(PREMIUM, iso(5 * DAY));
  assert.equal(during.effectiveTier, USER_TIERS.ULTRA);

  // Same profile, bonus now in the past: premium is back and its expiry never moved.
  const after = resolveEffectiveTierFromProfile(PREMIUM, iso(-1));
  assert.equal(after.effectiveTier, USER_TIERS.PREMIUM);
  assert.equal(after.subscriptionExpiresAt, during.subscriptionExpiresAt);
});

test("[integration] a bonus outliving the paid window leaves the user FREE afterwards", () => {
  // premium expired 1 day ago, bonus still running -> ultra now, free once it ends.
  const lapsed = { tier: "premium", subscription_expires_at: iso(-1 * DAY) };
  assert.equal(resolveEffectiveTierFromProfile(lapsed, iso(3 * DAY)).effectiveTier, USER_TIERS.ULTRA);
  assert.equal(resolveEffectiveTierFromProfile(lapsed, iso(-1)).effectiveTier, USER_TIERS.FREE);
});

/* ------------------------------------------------------------------ */
/* O-T. Existing semantics must not move                               */
/* ------------------------------------------------------------------ */

test("[T] omitting bonusUntil reproduces the pre-bonus behaviour exactly", () => {
  for (const p of [FREE, PREMIUM, ULTRA]) {
    const withoutArg = resolveEffectiveTierFromProfile(p);
    const withNull = resolveEffectiveTierFromProfile(p, null);
    assert.equal(withoutArg.effectiveTier, withNull.effectiveTier);
    assert.equal(withoutArg.hasActiveBonus, false);
    assert.equal(withoutArg.bonusUntil, null);
  }
  assert.equal(resolveEffectiveTierFromProfile(FREE).effectiveTier, USER_TIERS.FREE);
  assert.equal(resolveEffectiveTierFromProfile(PREMIUM).effectiveTier, USER_TIERS.PREMIUM);
  assert.equal(resolveEffectiveTierFromProfile(ULTRA).effectiveTier, USER_TIERS.ULTRA);
});

test("[P][Q] the 24h trial windows are unchanged, with and without a bonus", () => {
  const premiumTrial = { tier: "free", premium_trial_activated_at: iso(-1 * 60 * 60 * 1000) };
  const ultraTrial = { tier: "free", ultra_trial_activated_at: iso(-1 * 60 * 60 * 1000) };
  assert.equal(resolveEffectiveTierFromProfile(premiumTrial).effectiveTier, USER_TIERS.PREMIUM);
  assert.equal(resolveEffectiveTierFromProfile(ultraTrial).effectiveTier, USER_TIERS.ULTRA);
  assert.ok(resolveEffectiveTierFromProfile(premiumTrial).premiumTrialRemainingMs > 0);

  // an expired trial stays expired; a lapsed bonus does not resurrect it
  const stale = { tier: "free", premium_trial_activated_at: iso(-48 * 60 * 60 * 1000) };
  assert.equal(resolveEffectiveTierFromProfile(stale).effectiveTier, USER_TIERS.FREE);
  assert.equal(resolveEffectiveTierFromProfile(stale, iso(-1)).effectiveTier, USER_TIERS.FREE);
});

test("[R][S] open-ended paid tier and requestedTier are unaffected by the bonus", () => {
  const openEnded = { tier: "ultra", subscription_expires_at: null };
  const r = resolveEffectiveTierFromProfile(openEnded, iso(5 * DAY));
  assert.equal(r.hasActiveSubscription, true, "open-ended paid tier must still read as active");
  assert.equal(r.requestedTier, "ultra");
  assert.equal(r.effectiveTier, USER_TIERS.ULTRA);
});

test("[T] the function is pure: same inputs, same output, no mutation of the profile", () => {
  const profile = { ...PREMIUM };
  const snapshot = JSON.stringify(profile);
  const a = resolveEffectiveTierFromProfile(profile, iso(5 * DAY));
  const b = resolveEffectiveTierFromProfile(profile, iso(5 * DAY));
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(profile), snapshot, "profile must not be mutated");
});

test("[O] a bonus is never reported as a subscription or a paid expiry", () => {
  // A bonus must not leak into subscriptionExpiresAt — that column belongs to Stripe.
  const r = resolveEffectiveTierFromProfile(FREE, iso(5 * DAY));
  assert.equal(r.subscriptionExpiresAt, null, "a free user with a bonus still has no paid expiry");
  assert.equal(r.hasActiveSubscription, false, "a bonus is not a subscription");
});

/* ------------------------------------------------------------------ */
/* M-N + service contract. Validation happens before any DB call.      */
/* ------------------------------------------------------------------ */

function fakeSupabase(handler) {
  return {
    calls: [],
    rpc(fn, args) {
      this.calls.push({ fn, args });
      return Promise.resolve(handler(fn, args));
    }
  };
}

test("[M][N] zero, negative and non-integer day counts are rejected before any RPC", async () => {
  const supabase = fakeSupabase(() => ({ data: [], error: null }));
  for (const days of [0, -1, -5, 1.5, "5", null, undefined, NaN]) {
    await assert.rejects(
      () => grantBonusDays({ userId: "u1", days, source: "admin_grant", idempotencyKey: "k" }, { supabase }),
      /days must be a positive integer/,
      `days=${JSON.stringify(days)} must be rejected`
    );
  }
  assert.equal(supabase.calls.length, 0, "no RPC may be issued for an invalid grant");
});

test("an unknown source and a missing idempotency key are rejected before any RPC", async () => {
  const supabase = fakeSupabase(() => ({ data: [], error: null }));
  await assert.rejects(
    () => grantBonusDays({ userId: "u1", days: 5, source: "free_lunch", idempotencyKey: "k" }, { supabase }),
    /unknown source/
  );
  await assert.rejects(
    () => grantBonusDays({ userId: "u1", days: 5, source: "admin_grant", idempotencyKey: "  " }, { supabase }),
    /idempotencyKey is required/
  );
  assert.equal(supabase.calls.length, 0);
});

test("the ledger accepts arbitrary positive durations, not only the standard 5", async () => {
  const supabase = fakeSupabase(() => ({ data: [{ id: "g", created: true }], error: null }));
  for (const days of [1, 5, 14, 30, 365]) {
    await grantBonusDays({ userId: "u1", days, source: "compensation", idempotencyKey: `k-${days}` }, { supabase });
  }
  assert.deepEqual(
    supabase.calls.map((c) => c.args.p_days),
    [1, 5, 14, 30, 365]
  );
  assert.equal(STANDARD_BONUS_DAYS, 5, "the standard campaign duration is 5 days");
});

test("[K] a replayed idempotency key returns the original grant with created:false", async () => {
  const existing = {
    id: "grant-1",
    user_id: "u1",
    days: 5,
    effective_until: iso(5 * DAY),
    idempotency_key: "same-key",
    created: false
  };
  const supabase = fakeSupabase(() => ({ data: [existing], error: null }));
  const out = await grantBonusDays(
    { userId: "u1", days: 5, source: "referral_inviter", idempotencyKey: "same-key" },
    { supabase }
  );
  assert.equal(out.created, false, "a replay must not report a new grant");
  assert.equal(out.grant.id, "grant-1");
  assert.equal(out.grant.effective_until, existing.effective_until, "a replay must not re-stack");
  assert.equal(out.grant.created, undefined, "the flag is not leaked into the grant row");
});

test("grantBonusDays delegates stacking to the database, never computing it locally", async () => {
  const supabase = fakeSupabase(() => ({ data: [{ id: "g", created: true }], error: null }));
  await grantBonusDays(
    {
      userId: "u1",
      days: 5,
      source: "promo_campaign",
      idempotencyKey: "k1",
      referenceId: "camp-1",
      metadata: { a: 1 }
    },
    { supabase }
  );
  const { fn, args } = supabase.calls[0];
  assert.equal(fn, "grant_bonus_days");
  assert.deepEqual(args, {
    p_user_id: "u1",
    p_days: 5,
    p_source: "promo_campaign",
    p_idempotency_key: "k1",
    p_reference_id: "camp-1",
    p_metadata: { a: 1 }
  });
  // No effective_until is sent: the DB computes the window under an advisory lock.
  assert.equal("p_effective_until" in args, false);
});

test("[J] revokeGrant is a flag, not a delete, and is idempotent", async () => {
  const supabase = fakeSupabase(() => ({
    data: [
      {
        id: "g1",
        user_id: "u1",
        effective_until: iso(5 * DAY),
        revoked_at: iso(0),
        revoked_reason: "refund",
        revoked: true
      }
    ],
    error: null
  }));
  const out = await revokeGrant({ grantId: "g1", reason: "refund" }, { supabase });
  assert.equal(supabase.calls[0].fn, "revoke_time_grant");
  assert.equal(out.revoked, true);
  assert.ok(out.grant.effective_until, "the original window is preserved for audit");
  assert.equal(out.grant.revoked_reason, "refund");

  // second revoke reports false without erasing the first
  const again = fakeSupabase(() => ({ data: [{ id: "g1", revoked: false, revoked_reason: "refund" }], error: null }));
  assert.equal((await revokeGrant({ grantId: "g1", reason: "other" }, { supabase: again })).revoked, false);
});

test("getActiveBonusUntil returns null when there is no active window", async () => {
  const none = fakeSupabase(() => ({ data: null, error: null }));
  assert.equal(await getActiveBonusUntil("u1", { supabase: none }), null);
  const some = fakeSupabase(() => ({ data: iso(5 * DAY), error: null }));
  assert.ok(await getActiveBonusUntil("u1", { supabase: some }));
  assert.equal(some.calls[0].fn, "active_bonus_until");
});

test("RPC failures surface as errors rather than a silent null entitlement", async () => {
  const broken = fakeSupabase(() => ({ data: null, error: { message: "boom" } }));
  await assert.rejects(() => getActiveBonusUntil("u1", { supabase: broken }), /active_bonus_until failed/);
  await assert.rejects(
    () => grantBonusDays({ userId: "u1", days: 5, source: "admin_grant", idempotencyKey: "k" }, { supabase: broken }),
    /grant_bonus_days failed/
  );
});

test("the ledger exposes exactly the five agreed sources, referral ones reserved", () => {
  assert.deepEqual(
    [...GRANT_SOURCES],
    ["referral_inviter", "referral_invitee", "admin_grant", "compensation", "promo_campaign"]
  );
});

/* ------------------------------------------------------------------ */
/* [H][I] Sequential stacking — the MODEL the SQL must implement       */
/* ------------------------------------------------------------------ */

/**
 * The intended arithmetic, written out so the rule is reviewable in one place.
 * migration 061's grant_bonus_days must match this, and the .db suite proves it does.
 */
function stackModel(currentBonusUntilMs, nowMs, days) {
  const base = Math.max(nowMs, currentBonusUntilMs ?? 0);
  return base + days * DAY;
}

test("[H] sequential stacking: +5 on day 0 then +5 on day 2 lands on day 10, not day 7", () => {
  const day0 = NOW;
  const first = stackModel(null, day0, STANDARD_BONUS_DAYS);
  assert.equal(first, day0 + 5 * DAY, "first grant runs 5 days from now");

  const day2 = day0 + 2 * DAY;
  const second = stackModel(first, day2, STANDARD_BONUS_DAYS);
  assert.equal(second, day0 + 10 * DAY, "the second grant must EXTEND the first");

  // the naive rule would have thrown the second grant away
  const naive = Math.max(first, day2 + 5 * DAY);
  assert.equal(naive, day0 + 7 * DAY);
  assert.notEqual(second, naive, "max(existing, now+days) is the bug this guards against");
});

test("[I] many grants accumulate; a grant issued after expiry restarts from now", () => {
  const day0 = NOW;
  let until = null;
  for (let i = 0; i < 4; i++) until = stackModel(until, day0, STANDARD_BONUS_DAYS);
  assert.equal(until, day0 + 20 * DAY, "4 x 5 days stack to 20");

  // once the window has lapsed, the base is `now`, not the stale end
  const later = day0 + 60 * DAY;
  assert.equal(stackModel(until, later, STANDARD_BONUS_DAYS), later + 5 * DAY);
});

test("[J-model] a revoked grant must not contribute to the base", () => {
  // modelled as: revoked rows are excluded before MAX() is taken
  const grants = [
    { until: NOW + 3 * DAY, revoked: false },
    { until: NOW + 30 * DAY, revoked: true }
  ];
  const maxActive = Math.max(...grants.filter((g) => !g.revoked).map((g) => g.until));
  assert.equal(maxActive, NOW + 3 * DAY, "the revoked 30-day grant must be ignored");
  assert.equal(stackModel(maxActive, NOW, 5), NOW + 8 * DAY);
});
