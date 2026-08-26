import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import {
  BENIGN_QUALIFY_REASONS,
  PENDING_QUALIFY_REASONS,
  REFERRAL_CAMPAIGN,
  REFERRAL_INVITER_CAP,
  attemptQualificationForUser,
  attemptRewardForAttribution,
  qualifyReferral,
  rewardReferral
} from "../server-utils/referralRewards.js";
import { STANDARD_BONUS_DAYS } from "../server-utils/timeGrants.js";

/**
 * PR3c unit layer — the JavaScript half of qualification and reward.
 *
 * WHAT IS DELIBERATELY NOT HERE: eligibility, the cap, atomicity, lock ordering and
 * every state transition. Those live in migration 063 and are proven against real
 * Postgres in tests/integration/referralRewards.db.test.js — including the 9/10/11
 * cap boundary, the concurrent cap race, reciprocal-referral deadlock ordering and
 * partial-failure rollback. A fake cannot disagree with a transaction, which is
 * exactly why asserting those here would only test the fake.
 *
 * What IS tested below: that this layer maps the database's answer faithfully, never
 * invents one, never throws into the Predict response, and that the constants
 * duplicated between JS and SQL cannot silently drift apart.
 */

const MIGRATION = fs.readFileSync("supabase/migrations/063_referral_rewards.sql", "utf8");
const ATTR = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const USER = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

/** Minimal PostgREST-shaped fake. Records every call so shape can be asserted. */
function fakeSupabase({ attribution = null, readError = null, rpc = {} } = {}) {
  const rpcCalls = [];
  return {
    rpcCalls,
    rpc(name, args) {
      rpcCalls.push({ name, args });
      const handler = rpc[name];
      if (!handler) return Promise.resolve({ data: null, error: { message: `no rpc ${name}` } });
      return Promise.resolve(typeof handler === "function" ? handler(args) : handler);
    },
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: attribution, error: readError })
      };
      return chain;
    }
  };
}

const qualifyRpc = (row) => ({ qualify_referral: () => ({ data: [row], error: null }) });
const rewardRpc = (row) => ({ reward_referral: () => ({ data: [row], error: null }) });

/* ------------------------------------------------- constant parity with SQL */

test("[parity] the bonus length is 5 and agrees with the migration", () => {
  // Duplicating a constant across two languages is only safe when drift FAILS.
  assert.equal(STANDARD_BONUS_DAYS, 5);
  assert.match(MIGRATION, /v_days\s+constant\s+integer\s*:=\s*5;/, "migration must grant 5 days");
});

test("[parity] the inviter cap is 10 and agrees with the migration", () => {
  assert.equal(REFERRAL_INVITER_CAP, 10);
  assert.match(MIGRATION, /v_cap\s+constant\s+integer\s*:=\s*10;/, "migration must cap at 10");
});

test("[parity] the campaign tag agrees with the migration metadata", () => {
  assert.equal(REFERRAL_CAMPAIGN, "v1");
  assert.match(MIGRATION, /'campaign',\s*'v1'/);
});

test("[parity] the migration grants the two documented sources, and only those", () => {
  assert.match(MIGRATION, /'referral_inviter'/);
  assert.match(MIGRATION, /'referral_invitee'/);
  for (const forbidden of ["admin_grant", "compensation", "promo_campaign"]) {
    assert.ok(!MIGRATION.includes(`'${forbidden}'`), `${forbidden} is not a referral source`);
  }
});

test("[parity] idempotency keys follow ref:v1:<attribution>:<role>", () => {
  assert.match(MIGRATION, /'ref:v1:'\s*\|\|\s*v_a\.id::text\s*\|\|\s*':inviter'/);
  assert.match(MIGRATION, /'ref:v1:'\s*\|\|\s*v_a\.id::text\s*\|\|\s*':invitee'/);
});

test("[parity] reference_id is the attribution id on every grant call", () => {
  /*
    FOUR call sites, not two: the uuid lock ordering forks into an inviter-first and
    an invitee-first branch, and each branch issues both grants (the invitee-first
    branch's inviter call being the one the cap can skip). Every one of them must
    carry the attribution id twice — once inside the idempotency key and once as
    reference_id — so a reward is always traceable back to the referral that earned it.
  */
  const chunks = MIGRATION.split("public.grant_bonus_days(").slice(1);
  assert.equal(chunks.length, 4, "two lock-order branches x two grants");
  for (const chunk of chunks) {
    const args = chunk.slice(0, chunk.indexOf(") g;"));
    assert.match(args, /'ref:v1:' \|\| v_a\.id::text \|\| ':(inviter|invitee)'/, "idempotency key");
    assert.match(args, /':(inviter|invitee)', v_a\.id::text,/, "reference_id = attribution id");
    assert.match(args, /v_days/, "days must be the shared constant, never a literal");
  }
});

/* ------------------------------------------------------------ qualification */

test("[qualify] a successful qualification is mapped faithfully", async () => {
  const supabase = fakeSupabase({
    rpc: qualifyRpc({ ok: true, reason: null, qualified_at: "2026-09-01T10:00:00.000Z" })
  });
  const out = await qualifyReferral(ATTR, { supabase });
  assert.deepEqual(out, { ok: true, reason: null, qualifiedAt: "2026-09-01T10:00:00.000Z" });
  assert.deepEqual(supabase.rpcCalls[0], { name: "qualify_referral", args: { p_attribution_id: ATTR } });
});

for (const reason of [
  "email_unverified",
  "no_qualifying_predict",
  "not_new_account",
  "expired",
  "rejected",
  "reversed",
  "not_found",
  "state_changed"
]) {
  test(`[qualify] surfaces "${reason}" from the database verbatim`, async () => {
    const supabase = fakeSupabase({ rpc: qualifyRpc({ ok: false, reason, qualified_at: null }) });
    const out = await qualifyReferral(ATTR, { supabase });
    assert.equal(out.ok, false);
    assert.equal(out.reason, reason);
  });
}

test("[qualify] already_qualified and already_rewarded are BENIGN, not failures", () => {
  // A retried Predict hook re-qualifies an already-qualified row. That is the
  // system converging, and it must not read as an error anywhere.
  assert.deepEqual([...BENIGN_QUALIFY_REASONS].sort(), ["already_qualified", "already_rewarded"]);
  assert.deepEqual([...PENDING_QUALIFY_REASONS].sort(), ["email_unverified", "no_qualifying_predict"]);
  for (const benign of BENIGN_QUALIFY_REASONS) {
    assert.ok(!PENDING_QUALIFY_REASONS.includes(benign), "benign and pending must not overlap");
  }
});

test("[qualify] a transport error throws rather than reporting a false refusal", async () => {
  const supabase = fakeSupabase({ rpc: { qualify_referral: () => ({ data: null, error: { message: "boom" } }) } });
  await assert.rejects(() => qualifyReferral(ATTR, { supabase }), /boom/);
});

test("[qualify] an empty attribution id is refused before any RPC", async () => {
  const supabase = fakeSupabase();
  await assert.rejects(() => qualifyReferral("", { supabase }), /attributionId is required/);
  assert.equal(supabase.rpcCalls.length, 0);
});

/* ------------------------------------------------------------------ reward */

test("[reward] a paid referral maps both grant ids and the cap count", async () => {
  const supabase = fakeSupabase({
    rpc: rewardRpc({
      ok: true,
      reason: null,
      invitee_grant_id: "g-invitee",
      inviter_grant_id: "g-inviter",
      inviter_capped: false,
      inviter_reward_count: 3,
      rewarded_at: "2026-09-01T10:00:00.000Z"
    })
  });
  const out = await rewardReferral(ATTR, { supabase });
  assert.equal(out.ok, true);
  assert.equal(out.inviteeGrantId, "g-invitee");
  assert.equal(out.inviterGrantId, "g-inviter");
  assert.equal(out.inviterCapped, false);
  assert.equal(out.inviterRewardCount, 3);
});

test("[reward] a CAPPED inviter still pays the invitee — U2", async () => {
  // The cap limits what the inviter can EARN, not what the invitee is owed.
  const supabase = fakeSupabase({
    rpc: rewardRpc({
      ok: true,
      reason: null,
      invitee_grant_id: "g-invitee",
      inviter_grant_id: null,
      inviter_capped: true,
      inviter_reward_count: 10,
      rewarded_at: "2026-09-01T10:00:00.000Z"
    })
  });
  const out = await rewardReferral(ATTR, { supabase });
  assert.equal(out.ok, true, "a capped inviter is not a failed referral");
  assert.equal(out.inviteeGrantId, "g-invitee", "the invitee is always paid");
  assert.equal(out.inviterGrantId, null, "no inviter grant exists");
  assert.equal(out.inviterCapped, true);
  assert.equal(out.inviterRewardCount, REFERRAL_INVITER_CAP);
});

test("[reward] a replay reports already_rewarded as SUCCESS so retries converge", async () => {
  const supabase = fakeSupabase({
    rpc: rewardRpc({
      ok: true,
      reason: "already_rewarded",
      invitee_grant_id: null,
      inviter_grant_id: null,
      inviter_capped: false,
      inviter_reward_count: null,
      rewarded_at: "2026-09-01T10:00:00.000Z"
    })
  });
  const out = await rewardReferral(ATTR, { supabase });
  assert.equal(out.ok, true);
  assert.equal(out.reason, "already_rewarded");
});

test("[reward] refuses to pay an attribution that is not qualified", async () => {
  const supabase = fakeSupabase({
    rpc: rewardRpc({ ok: false, reason: "not_qualified", invitee_grant_id: null, inviter_grant_id: null })
  });
  const out = await rewardReferral(ATTR, { supabase });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "not_qualified");
  assert.equal(out.inviteeGrantId, null, "no grant may exist before qualification");
});

test("[reward] a failed reward NEVER reports success — the row stays retryable", async () => {
  const supabase = fakeSupabase({
    rpc: { reward_referral: () => ({ data: null, error: { message: "deadlock detected" } }) }
  });
  const out = await attemptRewardForAttribution(ATTR, { supabase });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "reward_error");
  assert.match(out.error, /deadlock/);
});

/* ---------------------------------------------------- the per-user pipeline */

test("[pipeline] a user with no attribution costs one read and stops", async () => {
  const supabase = fakeSupabase({ attribution: null });
  const out = await attemptQualificationForUser(USER, { supabase });
  assert.deepEqual(out, { ok: false, reason: "no_attribution" });
  assert.equal(supabase.rpcCalls.length, 0, "the common path must not touch the RPCs");
});

test("[pipeline] attributed -> qualify -> reward, in that order", async () => {
  const supabase = fakeSupabase({
    attribution: { id: ATTR, state: "attributed" },
    rpc: {
      ...qualifyRpc({ ok: true, reason: null, qualified_at: "2026-09-01T10:00:00.000Z" }),
      ...rewardRpc({
        ok: true,
        reason: null,
        invitee_grant_id: "g-invitee",
        inviter_grant_id: "g-inviter",
        inviter_capped: false,
        inviter_reward_count: 0,
        rewarded_at: "2026-09-01T10:00:00.000Z"
      })
    }
  });
  const out = await attemptQualificationForUser(USER, { supabase });
  assert.equal(out.ok, true);
  assert.equal(out.attributionId, ATTR);
  assert.deepEqual(
    supabase.rpcCalls.map((c) => c.name),
    ["qualify_referral", "reward_referral"],
    "reward must never precede qualification"
  );
});

test("[pipeline] an ALREADY qualified attribution skips straight to reward", async () => {
  // The retry path after a reward transaction aborted: eligibility was already
  // decided and must not be re-decided against a clock that has since moved.
  const supabase = fakeSupabase({
    attribution: { id: ATTR, state: "qualified" },
    rpc: rewardRpc({
      ok: true,
      reason: null,
      invitee_grant_id: "g-invitee",
      inviter_grant_id: "g-inviter",
      inviter_capped: false,
      inviter_reward_count: 1,
      rewarded_at: "2026-09-01T10:00:00.000Z"
    })
  });
  const out = await attemptQualificationForUser(USER, { supabase });
  assert.equal(out.ok, true);
  assert.deepEqual(supabase.rpcCalls.map((c) => c.name), ["reward_referral"]);
});

test("[pipeline] a benign qualify reason still proceeds to reward", async () => {
  const supabase = fakeSupabase({
    attribution: { id: ATTR, state: "attributed" },
    rpc: {
      ...qualifyRpc({ ok: false, reason: "already_qualified", qualified_at: "2026-09-01T10:00:00.000Z" }),
      ...rewardRpc({
        ok: true,
        reason: null,
        invitee_grant_id: "g",
        inviter_grant_id: null,
        inviter_capped: true,
        inviter_reward_count: 10,
        rewarded_at: "2026-09-01T10:00:00.000Z"
      })
    }
  });
  const out = await attemptQualificationForUser(USER, { supabase });
  assert.equal(out.ok, true);
  assert.deepEqual(supabase.rpcCalls.map((c) => c.name), ["qualify_referral", "reward_referral"]);
});

for (const reason of ["email_unverified", "no_qualifying_predict", "not_new_account", "expired"]) {
  test(`[pipeline] "${reason}" stops before any reward`, async () => {
    const supabase = fakeSupabase({
      attribution: { id: ATTR, state: "attributed" },
      rpc: qualifyRpc({ ok: false, reason, qualified_at: null })
    });
    const out = await attemptQualificationForUser(USER, { supabase });
    assert.equal(out.ok, false);
    assert.equal(out.reason, reason);
    assert.deepEqual(supabase.rpcCalls.map((c) => c.name), ["qualify_referral"], "no reward may be attempted");
  });
}

for (const state of ["rewarded", "expired", "rejected", "reversed"]) {
  test(`[pipeline] a "${state}" attribution takes no locks at all`, async () => {
    const supabase = fakeSupabase({ attribution: { id: ATTR, state } });
    const out = await attemptQualificationForUser(USER, { supabase });
    assert.equal(out.ok, false);
    assert.equal(supabase.rpcCalls.length, 0, "a decision that cannot change must not lock rows");
  });
}

/* ---------------------------------------- the Predict path cannot be broken */

test("[predict-safety] a dead Supabase client is swallowed, never thrown", async () => {
  const out = await attemptQualificationForUser(USER, {
    supabase: {
      from() {
        throw new Error("connection reset");
      },
      rpc() {
        throw new Error("connection reset");
      }
    }
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "qualification_error");
});

test("[predict-safety] an attribution read error is swallowed, never thrown", async () => {
  const supabase = fakeSupabase({ readError: { message: "statement timeout" } });
  const out = await attemptQualificationForUser(USER, { supabase });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "qualification_error");
});

test("[predict-safety] a qualify RPC failure is swallowed, never thrown", async () => {
  const supabase = fakeSupabase({
    attribution: { id: ATTR, state: "attributed" },
    rpc: { qualify_referral: () => ({ data: null, error: { message: "57014 statement timeout" } }) }
  });
  const out = await attemptQualificationForUser(USER, { supabase });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "qualification_error");
});

test("[predict-safety] an empty user id returns rather than querying", async () => {
  for (const value of ["", null, undefined, "   "]) {
    const out = await attemptQualificationForUser(value, { supabase: fakeSupabase() });
    assert.deepEqual(out, { ok: false, reason: "no_user" });
  }
});

/* --------------------------------------------------------------- no PII */

test("[privacy] the module cannot log an email, an IP, a token or a body", () => {
  const source = fs.readFileSync("server-utils/referralRewards.js", "utf8");
  for (const forbidden of ["ip_hash", "ipHash", "authorization", "req.body", "stripe"]) {
    assert.ok(!source.includes(forbidden), `${forbidden} must never reach a referral log line`);
  }
  // `email` appears only inside the reason string 'email_unverified', never as a value.
  assert.ok(!/\bemail\s*[:=]/.test(source), "no email value may be read or logged");
});

test("[privacy] the migration puts no PII in grant metadata", () => {
  const blocks = MIGRATION.match(/jsonb_build_object\('referral'[\s\S]*?\)\)/g) || [];
  assert.ok(blocks.length >= 3, "every grant builds referral metadata");
  for (const block of blocks) {
    for (const forbidden of ["email", "ip", "stripe", "token"]) {
      assert.ok(!block.includes(`'${forbidden}'`), `${forbidden} must not appear in grant metadata`);
    }
    assert.match(block, /'campaign'[\s\S]*'role'[\s\S]*'qualifiedAt'/);
  }
});

/* ------------------------------------------------------- no direct grants */

test("[safety] the reward path never writes time_grants itself", () => {
  const source = fs.readFileSync("server-utils/referralRewards.js", "utf8");
  assert.ok(!source.includes("grantBonusDays"), "grants belong to reward_referral's transaction");
  assert.ok(!/from\s+["'][^"']*timeGrants/.test(source), "must not import the grants ledger");
  assert.ok(!/["'`]time_grants["'`]/.test(source), "must not name the grants table");
});

test("[safety] the migration issues grants ONLY through grant_bonus_days", () => {
  assert.ok(
    !/insert\s+into\s+public\.time_grants/i.test(MIGRATION),
    "a direct insert would bypass idempotency, stacking and the advisory lock"
  );
  assert.match(MIGRATION, /public\.grant_bonus_days\(/);
});

test("[safety] migration 063 is additive — it destroys nothing from 062", () => {
  for (const forbidden of [/drop\s+table/i, /drop\s+function\s+public\.claim_referral/i, /drop\s+policy/i]) {
    assert.ok(!forbidden.test(MIGRATION), "063 must be additive only");
  }
});

test("[safety] both functions are service_role only", () => {
  for (const fn of ["qualify_referral", "reward_referral"]) {
    assert.match(
      MIGRATION,
      new RegExp(`revoke all on function public\\.${fn}\\(uuid\\) from public, anon, authenticated;`),
      `${fn} must be revoked from clients`
    );
    assert.match(
      MIGRATION,
      new RegExp(`grant execute on function public\\.${fn}\\(uuid\\) to service_role;`),
      `${fn} must be granted to service_role`
    );
  }
});

test("[safety] the reward function never re-checks expiry", () => {
  // Once earned, a delivery retry must not confiscate the reward. The window is
  // qualification's business and appears exactly once in the migration.
  const rewardFn = MIGRATION.slice(MIGRATION.indexOf("function public.reward_referral"));
  assert.ok(!rewardFn.includes("interval '30 days'"), "expiry belongs to qualify_referral alone");
  assert.match(rewardFn, /pg_advisory_xact_lock/, "the cap lock must be transaction-scoped");
});

/* ------------------------------------------- §25 Predict regression guard */

test("[predict-safety] a THROWING qualification hook cannot fail the Predict path", async () => {
  /*
    The contract says attemptQualificationForUser never throws. This proves Predict
    survives even when that contract is broken — a TypeError, a bad import, a
    refactor that lets something escape. Predict losing a response is unrecoverable;
    a deferred reward is not.
  */
  const { mock } = await import("node:test");
  mock.module("../server-utils/referralRewards.js", {
    namedExports: {
      attemptQualificationForUser: async () => {
        throw new TypeError("contract violated");
      }
    }
  });
  const upserted = [];
  mock.module("../server-utils/supabaseAdmin.js", {
    namedExports: {
      getSupabaseAdmin: () => ({
        from: () => ({
          upsert: async (rows) => {
            upserted.push(...rows);
            return { error: null };
          }
        })
      })
    }
  });
  try {
    const mod = await import("../server-utils/linkUserPredictionFixtures.js?predictSafety=1");
    const out = await mod.linkUserPredictionFixtures("user-1", [101, 102]);
    assert.deepEqual(out, { ok: true, linked: 2 }, "the ownership link must still report success");
    assert.equal(upserted.length, 2, "and the ownership rows must still have been written");
  } finally {
    mock.restoreAll();
  }
});

test("[predict-safety] the hook runs only AFTER the ownership write succeeds", () => {
  const source = fs.readFileSync("server-utils/linkUserPredictionFixtures.js", "utf8");
  const errorReturn = source.indexOf('return { ok: false, linked: 0, error:');
  const hookCall = source.indexOf("await attemptQualificationForUser(userId)");
  assert.ok(errorReturn > 0 && hookCall > errorReturn, "a failed link must return before qualifying");
  // And it is guarded, so a contract violation cannot escape into Predict.
  assert.match(source, /try \{\s*await attemptQualificationForUser\(userId\);\s*\} catch/);
});
