import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ATTRIBUTION_WINDOW_DAYS,
  CLAIM_REASONS,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  claimReferral,
  generateReferralCode,
  getOrCreateReferralCode,
  getReferralStatus,
  isAttributionExpired
} from "../server-utils/referrals.js";
import { handleReferralApi } from "../server-utils/referralApi.js";

/**
 * PR3a unit layer — the JavaScript half of referral attribution.
 *
 * WHAT IS DELIBERATELY NOT HERE: email normalisation and the self-referral rules.
 * Those live in SQL (`referral_normalize_email`, `claim_referral`) precisely so
 * there is ONE implementation, and they are proven against real Postgres in
 * tests/integration/referrals.db.test.js — including the exact-email, normalized,
 * Gmail +tag, Gmail dot and Stripe-customer cases. Asserting them again against a
 * fake here would only test the fake. What IS tested below is that this layer maps
 * the database's answer faithfully and never invents one.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Minimal PostgREST-shaped fake. Records every call so shape can be asserted. */
function fakeSupabase({ rows = {}, rpc = {}, insertResults = [] } = {}) {
  const calls = [];
  const rpcCalls = [];
  const inserts = [...insertResults];
  return {
    calls,
    rpcCalls,
    rpc(name, args) {
      rpcCalls.push({ name, args });
      const handler = rpc[name];
      if (!handler) return Promise.resolve({ data: null, error: { message: `no rpc ${name}` } });
      return Promise.resolve(typeof handler === "function" ? handler(args) : handler);
    },
    from(table) {
      const q = { table, op: "select", filters: [] };
      calls.push(q);
      const chain = {
        select() {
          return chain;
        },
        eq(c, v) {
          q.filters.push([c, v]);
          return chain;
        },
        is(c, v) {
          q.filters.push([c, v]);
          return chain;
        },
        insert(payload) {
          q.op = "insert";
          q.payload = payload;
          const next = inserts.shift();
          return {
            select: () => ({ maybeSingle: () => Promise.resolve(next ?? { data: payload, error: null }) })
          };
        },
        maybeSingle() {
          const value = rows[table];
          const resolved = typeof value === "function" ? value(q) : value;
          return Promise.resolve(resolved ?? { data: null, error: null });
        }
      };
      return chain;
    }
  };
}

/* ------------------------------------------------------- code generation */

test("[code] generated codes are exactly 10 chars from the declared alphabet", () => {
  assert.equal(REFERRAL_CODE_LENGTH, 10);
  for (let i = 0; i < 500; i += 1) {
    const code = generateReferralCode();
    assert.equal(code.length, 10, `wrong length: ${code}`);
    for (const ch of code) {
      assert.ok(REFERRAL_CODE_ALPHABET.includes(ch), `char ${ch} outside alphabet in ${code}`);
    }
  }
});

test("[code] the alphabet excludes the characters people misread", () => {
  // Crockford base32: no I/L/O/U. A code is read off a screen and typed on a phone.
  for (const ch of ["I", "L", "O", "U"]) {
    assert.ok(!REFERRAL_CODE_ALPHABET.includes(ch), `${ch} must not be in the alphabet`);
  }
  assert.equal(REFERRAL_CODE_ALPHABET.length, 32);
  assert.equal(new Set(REFERRAL_CODE_ALPHABET).size, 32, "alphabet must have no duplicates");
});

test("[code] codes are not derived from anything predictable", () => {
  // 500 draws with zero repeats is not proof of a CSPRNG, but a code derived from
  // a timestamp or a counter fails it immediately.
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) seen.add(generateReferralCode());
  assert.equal(seen.size, 500, "generated codes repeated");
});

/* ------------------------------------------------ getOrCreateReferralCode */

test("[getOrCreate] an existing ACTIVE code is returned, and nothing is inserted", async () => {
  const supabase = fakeSupabase({ rows: { referral_codes: { data: { code: "ABCD234567" }, error: null } } });
  const out = await getOrCreateReferralCode("user-1", { supabase });
  assert.deepEqual(out, { code: "ABCD234567", created: false });
  assert.equal(supabase.calls.filter((c) => c.op === "insert").length, 0, "must not insert when a code exists");
});

test("[getOrCreate] a first-time inviter gets a new code inserted", async () => {
  const supabase = fakeSupabase({
    rows: { referral_codes: { data: null, error: null } },
    insertResults: [{ data: { code: "NEWCODE234" }, error: null }]
  });
  const out = await getOrCreateReferralCode("user-1", { supabase, generateCode: () => "NEWCODE234" });
  assert.deepEqual(out, { code: "NEWCODE234", created: true });
});

test("[getOrCreate] a DISABLED code is never revived — a replacement is issued", async () => {
  /*
    The active-code read filters `disabled_at is null`, so a user whose only row is
    disabled reads as having none. Reviving it would undo the one lever available
    against a leaked code.
  */
  const supabase = fakeSupabase({
    rows: { referral_codes: { data: null, error: null } },
    insertResults: [{ data: { code: "REPLACED22" }, error: null }]
  });
  const out = await getOrCreateReferralCode("user-1", { supabase, generateCode: () => "REPLACED22" });
  assert.equal(out.code, "REPLACED22");
  assert.equal(out.created, true);

  const read = supabase.calls.find((c) => c.op === "select");
  assert.deepEqual(read.filters, [["user_id", "user-1"], ["disabled_at", null]], "must filter to active codes only");
  const insert = supabase.calls.find((c) => c.op === "insert");
  assert.equal(insert.payload.code, "REPLACED22");
  assert.equal(insert.payload.user_id, "user-1");
});

test("[collision] a duplicate code retries with a fresh one instead of failing", async () => {
  const supabase = fakeSupabase({
    rows: { referral_codes: { data: null, error: null } },
    insertResults: [
      { data: null, error: { code: "23505", message: "duplicate key" } },
      { data: { code: "SECOND2345" }, error: null }
    ]
  });
  let n = 0;
  const out = await getOrCreateReferralCode("user-1", {
    supabase,
    generateCode: () => (n++ === 0 ? "FIRST12345" : "SECOND2345")
  });
  assert.deepEqual(out, { code: "SECOND2345", created: true });
  assert.equal(n, 2, "must have generated a second code");
});

test("[collision] a non-unique-violation error is surfaced, not retried away", async () => {
  const supabase = fakeSupabase({
    rows: { referral_codes: { data: null, error: null } },
    insertResults: [{ data: null, error: { code: "42501", message: "permission denied" } }]
  });
  await assert.rejects(
    () => getOrCreateReferralCode("user-1", { supabase, generateCode: () => "X" }),
    /permission denied/
  );
});

test("[getOrCreate] refuses an empty user id rather than allocating an orphan code", async () => {
  await assert.rejects(() => getOrCreateReferralCode("", { supabase: fakeSupabase() }), /userId is required/);
});

/* --------------------------------------------------------- claimReferral */

function claimRpc(result) {
  return { rpc: { claim_referral: () => ({ data: [result], error: null }) } };
}

test("[claim] a valid claim returns the attribution", async () => {
  const supabase = fakeSupabase(
    claimRpc({
      ok: true,
      reason: null,
      attribution_id: "attr-1",
      inviter_id: "inviter-1",
      code: "ABCD234567",
      state: "attributed",
      attributed_at: "2026-08-27T10:00:00.000Z"
    })
  );
  const out = await claimReferral({ userId: "invitee-1", code: "abcd234567" }, { supabase });
  assert.equal(out.ok, true);
  assert.equal(out.attribution.state, "attributed");
  assert.equal(out.attribution.id, "attr-1");
});

test("[claim] the invitee id comes from the caller, and no inviter can be forged", async () => {
  const supabase = fakeSupabase(
    claimRpc({ ok: true, attribution_id: "a", inviter_id: "i", code: "C", state: "attributed", attributed_at: null })
  );
  await claimReferral({ userId: "invitee-1", code: "CODE", inviterId: "forged" }, { supabase });
  const args = supabase.rpcCalls[0].args;
  assert.equal(args.p_invitee_id, "invitee-1");
  assert.deepEqual(Object.keys(args).sort(), ["p_code", "p_invitee_id", "p_ip_hash"]);
  assert.ok(!("p_inviter_id" in args), "the RPC must have no inviter parameter to forge");
});

test("[claim] ip is never persisted in PR3a — p_ip_hash is null", async () => {
  const supabase = fakeSupabase(
    claimRpc({ ok: true, attribution_id: "a", inviter_id: "i", code: "C", state: "attributed", attributed_at: null })
  );
  await claimReferral({ userId: "invitee-1", code: "CODE", ip: "203.0.113.9" }, { supabase });
  assert.equal(supabase.rpcCalls[0].args.p_ip_hash, null, "no IP hash until a stable secret exists");
});

for (const reason of Object.values(CLAIM_REASONS)) {
  test(`[claim] surfaces "${reason}" from the database verbatim`, async () => {
    const supabase = fakeSupabase(claimRpc({ ok: false, reason }));
    const out = await claimReferral({ userId: "invitee-1", code: "CODE" }, { supabase });
    assert.deepEqual(out, { ok: false, reason });
  });
}

test("[claim] refuses an empty user id", async () => {
  await assert.rejects(
    () => claimReferral({ userId: "", code: "C" }, { supabase: fakeSupabase() }),
    /userId is required/
  );
});

/* ---------------------------------------------------------------- window */

test(`[window] the qualification window is ${ATTRIBUTION_WINDOW_DAYS} days`, () => {
  assert.equal(ATTRIBUTION_WINDOW_DAYS, 30);
  const now = Date.parse("2026-09-30T00:00:00.000Z");
  assert.equal(isAttributionExpired(new Date(now - 29 * DAY).toISOString(), now), false, "day 29 is open");
  assert.equal(isAttributionExpired(new Date(now - 30 * DAY).toISOString(), now), false, "day 30 exactly is open");
  assert.equal(isAttributionExpired(new Date(now - 31 * DAY).toISOString(), now), true, "day 31 is closed");
});

test("[window] an unparseable timestamp is not treated as expired", () => {
  // Failing open here is deliberate: expiry denies a reward, and a clock or parse
  // problem must not silently deny one.
  assert.equal(isAttributionExpired("not-a-date"), false);
  assert.equal(isAttributionExpired(null), false);
});

/* ---------------------------------------------------------------- status */

function statusSupabase(attribution) {
  return fakeSupabase({
    rows: {
      referral_codes: { data: { code: "ABCD234567" }, error: null },
      referral_attributions: { data: attribution, error: null }
    },
    rpc: {
      referral_inviter_summary: () => ({
        data: [{ attributed_count: 3, qualified_count: 2, rewarded_count: 1 }],
        error: null
      })
    }
  });
}

test("[status] reports inviter counts and the caller's own attribution", async () => {
  const now = Date.parse("2026-09-01T00:00:00.000Z");
  const supabase = statusSupabase({
    state: "attributed",
    attributed_at: "2026-08-27T10:00:00.000Z",
    qualified_at: null,
    rewarded_at: null
  });
  const out = await getReferralStatus("user-1", { supabase, now });
  assert.equal(out.code, "ABCD234567");
  assert.deepEqual(out.inviter, { attributed: 3, qualified: 2, rewarded: 1 });
  assert.equal(out.invitee.state, "attributed");
  assert.equal(out.invitee.expired, false);
});

test("[status] expiry is DERIVED, so the stored state stays 'attributed'", async () => {
  const now = Date.parse("2026-10-15T00:00:00.000Z");
  const supabase = statusSupabase({
    state: "attributed",
    attributed_at: "2026-08-27T10:00:00.000Z",
    qualified_at: null,
    rewarded_at: null
  });
  const out = await getReferralStatus("user-1", { supabase, now });
  assert.equal(out.invitee.expired, true, "past 30 days");
  assert.equal(out.invitee.state, "attributed", "no cron rewrites the row; the window is computed");
});

test("[status] never returns an inviter id to the caller", async () => {
  const supabase = statusSupabase({ state: "attributed", attributed_at: "2026-08-27T10:00:00.000Z" });
  const out = await getReferralStatus("user-1", { supabase });
  assert.ok(!JSON.stringify(out).includes("inviter_id"), "raw inviter_id must not leak");
  assert.ok(!("inviterId" in out.invitee), "invitee must not learn who referred them");
});

test("[status] a user with no attribution reports null rather than a fabricated one", async () => {
  const supabase = statusSupabase(null);
  const out = await getReferralStatus("user-1", { supabase });
  assert.equal(out.invitee, null);
});

/* ------------------------------------------------------------------- API */

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

test("[api] an unauthenticated request is refused before any referral work", async () => {
  const res = mockRes();
  await handleReferralApi({ query: { view: "code" }, method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

test("[api] auth is checked before the view is dispatched", async () => {
  // A token-less probe must not be able to enumerate which views exist.
  for (const view of ["nope", "claim", "status"]) {
    const res = mockRes();
    await handleReferralApi({ query: { view }, method: "GET", headers: {} }, res);
    assert.equal(res.statusCode, 401, `view=${view} leaked before auth`);
  }
});
