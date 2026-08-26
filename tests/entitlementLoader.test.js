import test from "node:test";
import assert from "node:assert/strict";

import {
  ENTITLEMENT_PROFILE_COLUMNS,
  loadActiveBonusUntil,
  loadEntitlement,
  loadEntitlementProfile
} from "../server-utils/entitlement.js";
import { USER_TIERS } from "../server-utils/accessTier.js";

/**
 * PR2a — the shared entitlement loader.
 *
 * The tier RULE is already proven pure in tests/timeGrants.test.js. What this
 * file proves is the part that can regress silently once five call sites share
 * one loader: that it issues exactly ONE profile read and ONE time_grants read,
 * that the time_grants read is a direct indexed SELECT and never the
 * `active_bonus_until` RPC, and that the filters are the ones the index covers.
 *
 * A fake Supabase records every table, operation and argument, so a future edit
 * that adds a round-trip or drops `revoked_at is null` fails here rather than in
 * production on the first real grant.
 */

const NOW = Date.now();
const DAY = 864e5;
const iso = (ms) => new Date(NOW + ms).toISOString();
const UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const FREE = { role: "user", tier: "free", subscription_expires_at: null, created_at: iso(-30 * DAY) };
const PREMIUM = { role: "user", tier: "premium", subscription_expires_at: iso(15 * DAY), created_at: iso(-30 * DAY) };
const ULTRA = { role: "user", tier: "ultra", subscription_expires_at: iso(15 * DAY), created_at: iso(-30 * DAY) };

/**
 * Records every query. `grants` is the rows time_grants returns — the fake does
 * NOT re-filter them, because the point is to assert the filters the loader asks
 * for, not to reimplement Postgres.
 */
function fakeSupabase({ profile = FREE, grants = [], profileError = null, grantsError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpcCalls: [],
    rpc(name, args) {
      this.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
    from(table) {
      const rec = { table, ops: [], select: null };
      calls.push(rec);
      const chain = {
        select(cols) {
          rec.select = cols;
          return chain;
        },
        eq(c, v) {
          rec.ops.push(`eq:${c}=${v}`);
          return chain;
        },
        is(c, v) {
          rec.ops.push(`is:${c}=${v}`);
          return chain;
        },
        gt(c, v) {
          rec.ops.push(`gt:${c}=${v}`);
          return chain;
        },
        order(c, o) {
          rec.ops.push(`order:${c}:${o?.ascending ? "asc" : "desc"}`);
          return chain;
        },
        limit(n) {
          rec.ops.push(`limit:${n}`);
          return Promise.resolve({ data: grants, error: grantsError });
        },
        maybeSingle() {
          rec.ops.push("maybeSingle");
          // The error belongs to the FIRST profile read only. The legacy retry
          // (select created_at) is exactly the query that still works on an
          // un-migrated database, so failing it too would test a situation that
          // cannot happen and would hide the fallback entirely.
          const first = calls.filter((c) => c.table === "profiles").length === 1;
          return Promise.resolve({ data: profile, error: first ? profileError : null });
        }
      };
      return chain;
    }
  };
}

const grant = (msFromNow) => ({ effective_until: iso(msFromNow) });

/* ------------------------------------------------------------------ */
/* A-K. Product rule through the loader                                */
/* ------------------------------------------------------------------ */

async function tierOf(profile, grants) {
  const supabase = fakeSupabase({ profile, grants });
  const { tierInfo } = await loadEntitlement(UID, { supabase });
  return tierInfo.effectiveTier;
}

test("[A][B][C] with no bonus, the paid/free tiers are unchanged", async () => {
  assert.equal(await tierOf(FREE, []), USER_TIERS.FREE);
  assert.equal(await tierOf(PREMIUM, []), USER_TIERS.PREMIUM);
  assert.equal(await tierOf(ULTRA, []), USER_TIERS.ULTRA);
});

test("[D][E][F] an active bonus is ULTRA for every underlying tier", async () => {
  const g = [grant(5 * DAY)];
  assert.equal(await tierOf(FREE, g), USER_TIERS.ULTRA);
  assert.equal(await tierOf(PREMIUM, g), USER_TIERS.ULTRA);
  assert.equal(await tierOf(ULTRA, g), USER_TIERS.ULTRA);
});

test("[G][H][I] once the bonus is gone the underlying entitlement resumes", async () => {
  // the DB filters expired rows out, so an expired bonus reaches the loader as []
  assert.equal(await tierOf(PREMIUM, []), USER_TIERS.PREMIUM);
  assert.equal(await tierOf(ULTRA, []), USER_TIERS.ULTRA);
  const lapsedPremium = { ...PREMIUM, subscription_expires_at: iso(-1 * DAY) };
  assert.equal(await tierOf(lapsedPremium, []), USER_TIERS.FREE, "expired paid tier must NOT linger");
  assert.equal(await tierOf(lapsedPremium, [grant(3 * DAY)]), USER_TIERS.ULTRA, "…but an active bonus still applies");
});

test("[J] a window ending exactly now is not active, and the query says so", async () => {
  const supabase = fakeSupabase({ profile: FREE, grants: [] });
  await loadEntitlement(UID, { supabase });
  const tg = supabase.calls.find((c) => c.table === "time_grants");
  assert.ok(tg.ops.includes("gt:effective_until=now()"), "must be strictly greater than now, never gte");
});

test("[K] a trial plus a bonus is ULTRA, and the trial fields survive", async () => {
  const trial = { role: "user", tier: "free", premium_trial_activated_at: iso(-1 * 3600e3), created_at: iso(-2 * DAY) };
  const supabase = fakeSupabase({ profile: trial, grants: [grant(2 * DAY)] });
  const { tierInfo } = await loadEntitlement(UID, { supabase });
  assert.equal(tierInfo.effectiveTier, USER_TIERS.ULTRA);
  assert.ok(tierInfo.premiumTrialRemainingMs > 0, "the trial clock keeps running underneath the bonus");
});

/* ------------------------------------------------------------------ */
/* L-N. What the bonus must NOT touch                                  */
/* ------------------------------------------------------------------ */

test("[M][N] requestedTier and subscriptionExpiresAt are untouched by a bonus", async () => {
  const supabase = fakeSupabase({ profile: PREMIUM, grants: [grant(5 * DAY)] });
  const { tierInfo, hasActiveBonus, bonusUntil } = await loadEntitlement(UID, { supabase });
  assert.equal(tierInfo.requestedTier, "premium");
  assert.equal(tierInfo.subscriptionExpiresAt, new Date(PREMIUM.subscription_expires_at).toISOString());
  assert.equal(hasActiveBonus, true);
  assert.ok(bonusUntil);
});

test("[L] a bonus is not a subscription — hasActiveSubscription stays paid-only", async () => {
  // this is what keeps api/billing's 24h-trial gate working for a free user
  const supabase = fakeSupabase({ profile: FREE, grants: [grant(5 * DAY)] });
  const { tierInfo } = await loadEntitlement(UID, { supabase });
  assert.equal(tierInfo.effectiveTier, USER_TIERS.ULTRA);
  assert.equal(tierInfo.hasActiveSubscription, false);
  assert.equal(tierInfo.subscriptionExpiresAt, null);
});

/* ------------------------------------------------------------------ */
/* O-Q. Query count and shape — the regression this file exists for    */
/* ------------------------------------------------------------------ */

test("[O][P][Q] exactly one profile query, one time_grants query, and NO rpc", async () => {
  const supabase = fakeSupabase({ profile: PREMIUM, grants: [grant(5 * DAY)] });
  await loadEntitlement(UID, { supabase });

  const profiles = supabase.calls.filter((c) => c.table === "profiles");
  const grants = supabase.calls.filter((c) => c.table === "time_grants");
  assert.equal(profiles.length, 1, `expected 1 profiles query, saw ${profiles.length}`);
  assert.equal(grants.length, 1, `expected 1 time_grants query, saw ${grants.length}`);
  assert.equal(supabase.calls.length, 2, "no other table may be touched");
  assert.equal(supabase.rpcCalls.length, 0, "active_bonus_until RPC must not be called per request");
});

test("[Q] the bonus read is the indexed SELECT the partial index covers", async () => {
  const supabase = fakeSupabase({ profile: FREE, grants: [] });
  await loadEntitlement(UID, { supabase });
  const tg = supabase.calls.find((c) => c.table === "time_grants");
  assert.equal(tg.select, "effective_until", "select only what is needed");
  assert.ok(tg.ops.includes(`eq:user_id=${UID}`));
  assert.ok(tg.ops.includes("is:revoked_at=null"), "revoked grants must be excluded IN THE QUERY");
  assert.ok(tg.ops.includes("order:effective_until:desc"));
  assert.ok(tg.ops.includes("limit:1"), "one row is enough — the max");
});

test("the profile query names its columns and never selects everything", async () => {
  const supabase = fakeSupabase({ profile: PREMIUM, grants: [] });
  await loadEntitlement(UID, { supabase });
  const p = supabase.calls.find((c) => c.table === "profiles");
  assert.equal(p.select, ENTITLEMENT_PROFILE_COLUMNS);
  assert.ok(!p.select.includes("*"), "no select(*) in the entitlement loader");
  for (const col of [
    "role",
    "tier",
    "subscription_expires_at",
    "premium_trial_activated_at",
    "ultra_trial_activated_at",
    "created_at"
  ]) {
    assert.ok(p.select.includes(col), `missing column ${col}`);
  }
});

test("[R] a revoked grant is excluded by the query, not by the caller", async () => {
  // The loader never sees revoked rows because `is:revoked_at=null` is in the
  // query; asserting the filter is the real guarantee.
  const supabase = fakeSupabase({ profile: FREE, grants: [] });
  const { hasActiveBonus } = await loadEntitlement(UID, { supabase });
  assert.equal(hasActiveBonus, false);
  assert.ok(supabase.calls.find((c) => c.table === "time_grants").ops.includes("is:revoked_at=null"));
});

test("[S] with several active grants the latest window wins", async () => {
  // ordered desc + limit 1, so the driver returns the max first
  const supabase = fakeSupabase({ profile: FREE, grants: [grant(20 * DAY), grant(5 * DAY)] });
  const { bonusUntil, tierInfo } = await loadEntitlement(UID, { supabase });
  assert.equal(bonusUntil, iso(20 * DAY));
  assert.equal(tierInfo.effectiveTier, USER_TIERS.ULTRA);
});

/* ------------------------------------------------------------------ */
/* Caller-supplied profile, failure modes                              */
/* ------------------------------------------------------------------ */

test("a caller-supplied profile skips the profile query entirely (api/billing)", async () => {
  const supabase = fakeSupabase({ profile: null, grants: [grant(5 * DAY)] });
  const { tierInfo } = await loadEntitlement(UID, { supabase, profile: PREMIUM });
  assert.equal(tierInfo.effectiveTier, USER_TIERS.ULTRA);
  assert.equal(supabase.calls.filter((c) => c.table === "profiles").length, 0, "must not re-query the profile");
  assert.equal(supabase.calls.filter((c) => c.table === "time_grants").length, 1);
});

test("a missing profile returns nulls rather than throwing, so callers can 404", async () => {
  const supabase = fakeSupabase({ profile: null, grants: [] });
  const out = await loadEntitlement(UID, { supabase });
  assert.equal(out.profile, null);
  assert.equal(out.tierInfo, null);
  assert.equal(out.hasActiveBonus, false);
  assert.equal(supabase.calls.filter((c) => c.table === "time_grants").length, 0, "no bonus read without a profile");
});

test("a bonus read failure degrades to the paid tier instead of denying access", async () => {
  const supabase = fakeSupabase({ profile: PREMIUM, grants: [], grantsError: { message: "boom" } });
  const { tierInfo, hasActiveBonus } = await loadEntitlement(UID, { supabase });
  assert.equal(hasActiveBonus, false);
  assert.equal(tierInfo.effectiveTier, USER_TIERS.PREMIUM, "a lost bonus lookup must not cost a user what they pay for");
});

test("a real profile error propagates, but a missing-tier-column error falls back", async () => {
  const hard = fakeSupabase({ profile: null, profileError: { message: "connection reset" } });
  await assert.rejects(() => loadEntitlement(UID, { supabase: hard }), /connection reset/);

  const legacy = fakeSupabase({
    profile: { created_at: iso(-40 * DAY) },
    profileError: { message: 'column "tier" does not exist' }
  });
  const { tierInfo } = await loadEntitlement(UID, { supabase: legacy });
  assert.equal(tierInfo.effectiveTier, USER_TIERS.FREE, "an un-migrated database degrades to free, not 500");
});

test("an empty userId is rejected before any query", async () => {
  const supabase = fakeSupabase({});
  await assert.rejects(() => loadEntitlement("  ", { supabase }), /userId is required/);
  assert.equal(supabase.calls.length, 0);
});

test("the exported helpers are usable on their own", async () => {
  const supabase = fakeSupabase({ profile: ULTRA, grants: [grant(2 * DAY)] });
  assert.deepEqual(await loadEntitlementProfile(UID, { supabase }), ULTRA);
  assert.equal(await loadActiveBonusUntil(UID, { supabase }), iso(2 * DAY));
});
