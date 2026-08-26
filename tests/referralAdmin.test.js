import assert from "node:assert/strict";
import fs from "node:fs";
import { mock, test } from "node:test";

/**
 * PR3d1 unit layer — the admin referral endpoints.
 *
 * WHAT IS DELIBERATELY NOT HERE: atomicity, the cap, grant revocation and every
 * state transition. Those live in migration 064 and are proven against real Postgres
 * in tests/integration/referralAdmin.db.test.js — including the forced-failure
 * rollback and cap restoration. A fake cannot roll back a transaction.
 *
 * What IS tested here: that nothing reaches a browser that should not, that every
 * route refuses a non-admin before doing any work, and that retry and reversal
 * resolve everything from an attribution id rather than from anything the caller
 * chose to send.
 */

const ATTR = "aaaa1111-2222-4222-8222-aaaaaaaaaaaa";
const INVITER = "bbbb1111-2222-4222-8222-bbbbbbbbbbbb";
const INVITEE = "cccc1111-2222-4222-8222-cccccccccccc";
const IP_HASH = "d".repeat(64);

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

/** One referral row shaped like the database returns it, ip_hash included. */
function dbRow(overrides = {}) {
  return {
    id: ATTR,
    inviter_id: INVITER,
    invitee_id: INVITEE,
    code: "ABCD234567",
    state: "rewarded",
    attributed_at: "2026-08-01T10:00:00.000Z",
    qualified_at: "2026-08-02T10:00:00.000Z",
    rewarded_at: "2026-08-02T10:00:01.000Z",
    inviter_rewarded_at: "2026-08-02T10:00:01.000Z",
    invitee_rewarded_at: "2026-08-02T10:00:01.000Z",
    rejected_reason: null,
    ip_hash: IP_HASH,
    created_at: "2026-08-01T10:00:00.000Z",
    ...overrides
  };
}

let loads = 0;

/**
 * Load the handler with admin auth, Supabase and the reward service mocked.
 *
 * `assertAdmin` reaches Supabase, which no unit test may do, so it is replaced —
 * which is also what lets the non-admin cases be asserted at all.
 */
async function loadAdminApi({ admin = true, rows = [dbRow()], grants = [], reward, reverse } = {}) {
  // Clear here rather than trusting every caller's finally: node:test refuses to
  // re-mock a module that is still mocked, and one missed reset would cascade into
  // every later test as an unrelated ERR_INVALID_STATE.
  mock.restoreAll();
  const calls = [];
  mock.module("../server-utils/authAdmin.js", {
    namedExports: {
      assertAdmin: async () =>
        admin
          ? { ok: true, user: { id: "admin-1", email: "admin@example.test" } }
          : { ok: false, status: 403, error: "Este necesar acces de administrator." }
    }
  });
  mock.module("../server-utils/adminUserEmails.js", {
    namedExports: {
      mapUserIdsToEmails: async (_sb, ids) => new Map((ids || []).map((id) => [id, `${id.slice(0, 4)}@example.test`]))
    }
  });
  mock.module("../server-utils/referralRewards.js", {
    namedExports: {
      /*
        referrals.js imports these to derive earnedDays and capRemaining, and
        referralAdminApi.js pulls referrals.js in transitively. A mock that omits
        them fails the whole module graph at import time.
      */
      REFERRAL_INVITER_CAP: 10,
      REFERRAL_REWARD_DAYS: 5,
      attemptRewardForAttribution: async (id) => {
        calls.push({ fn: "retry", id });
        return reward ?? { ok: true, reason: null, inviterCapped: false, rewardedAt: "2026-08-02T10:00:01.000Z" };
      },
      reverseReferral: async (id, reason) => {
        calls.push({ fn: "reverse", id, reason });
        return (
          reverse ?? {
            ok: true,
            reason: null,
            state: "reversed",
            reversedAt: "2026-08-03T10:00:00.000Z",
            inviterGrantRevoked: true,
            inviteeGrantRevoked: true
          }
        );
      }
    }
  });
  mock.module("../server-utils/supabaseAdmin.js", {
    namedExports: {
      assertSupabaseConfigured: () => ({ ok: true }),
      getSupabaseAdmin: () => ({
        from(table) {
          const chain = {
            select: () => chain,
            order: () => chain,
            range: () => chain,
            eq: () => chain,
            is: () => chain,
            in: () => chain,
            then: (resolve) =>
              Promise.resolve(
                table === "time_grants" ? { data: grants, error: null } : { data: rows, error: null, count: rows.length }
              ).then(resolve)
          };
          return chain;
        }
      })
    }
  });
  loads += 1;
  const mod = await import(`../server-utils/referralAdminApi.js?t=${loads}`);
  return { handle: mod.handleReferralAdmin, calls, reset: () => mock.restoreAll() };
}

const adminReq = (view, extra = {}) => ({
  query: { view, ...(extra.query || {}) },
  method: extra.method || "GET",
  headers: { authorization: "Bearer t" },
  body: extra.body
});

/* ----------------------------------------------------------- authorization */

for (const [view, method] of [
  ["referrals", "GET"],
  ["reverse-referral", "POST"],
  ["retry-referral-reward", "POST"]
]) {
  test(`[auth] a non-admin is refused on ?view=${view} before any work`, async () => {
    const api = await loadAdminApi({ admin: false });
    try {
      const res = mockRes();
      await api.handle(adminReq(view, { method, body: { attributionId: ATTR, reason: "x" } }), res);
      assert.equal(res.statusCode, 403);
      assert.equal(api.calls.length, 0, "no referral work may happen for a non-admin");
    } finally {
      api.reset();
    }
  });
}

test("[auth] an admin can list referrals", async () => {
  const api = await loadAdminApi();
  try {
    const res = mockRes();
    await api.handle(adminReq("referrals"), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.referrals.length, 1);
    assert.equal(res.body.total, 1);
  } finally {
    api.reset();
  }
});

test("[auth] the wrong method is refused on every view", async () => {
  for (const [view, badMethod] of [
    ["referrals", "POST"],
    ["reverse-referral", "GET"],
    ["retry-referral-reward", "GET"]
  ]) {
    const api = await loadAdminApi();
    try {
      const res = mockRes();
      await api.handle(adminReq(view, { method: badMethod }), res);
      assert.equal(res.statusCode, 405, `${view} must refuse ${badMethod}`);
    } finally {
      api.reset();
    }
  }
});

/* ----------------------------------------------------------------- privacy */

test("[privacy] the payload carries NO ip_hash and no raw address", async () => {
  const api = await loadAdminApi();
  try {
    const res = mockRes();
    await api.handle(adminReq("referrals"), res);
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes(IP_HASH), "the hash exists only to be compared server-side");
    assert.ok(!body.includes("ip_hash"), "not even the field name");
    assert.ok(!/[0-9]{1,3}(\.[0-9]{1,3}){3}/.test(body), "and never a dotted quad");
    // Only the derived signal survives.
    assert.equal(res.body.referrals[0].ipSignal, "different");
  } finally {
    api.reset();
  }
});

test("[privacy] two rows sharing an address report a MATCH, and still no hash", async () => {
  const api = await loadAdminApi({
    rows: [
      dbRow(),
      dbRow({ id: "eeee1111-2222-4222-8222-eeeeeeeeeeee", invitee_id: "ffff1111-2222-4222-8222-ffffffffffff" })
    ]
  });
  try {
    const res = mockRes();
    await api.handle(adminReq("referrals"), res);
    assert.deepEqual(
      res.body.referrals.map((r) => r.ipSignal),
      ["match", "match"]
    );
    assert.ok(!JSON.stringify(res.body).includes(IP_HASH));
  } finally {
    api.reset();
  }
});

test("[privacy] a missing hash reports unavailable, never a false 'different'", async () => {
  const api = await loadAdminApi({ rows: [dbRow({ ip_hash: null })] });
  try {
    const res = mockRes();
    await api.handle(adminReq("referrals"), res);
    assert.equal(res.body.referrals[0].ipSignal, "unavailable");
  } finally {
    api.reset();
  }
});

test("[privacy] no Stripe identifier or secret can appear in the payload", async () => {
  const api = await loadAdminApi();
  try {
    const res = mockRes();
    await api.handle(adminReq("referrals"), res);
    const body = JSON.stringify(res.body).toLowerCase();
    for (const forbidden of ["cus_", "sk_live", "sk_test", "whsec_", "stripe", "eyj", "authorization"]) {
      assert.ok(!body.includes(forbidden), `${forbidden} must never reach an admin browser`);
    }
  } finally {
    api.reset();
  }
});

test("[privacy] emails are present for an admin, with masked forms for the table", async () => {
  const api = await loadAdminApi();
  try {
    const res = mockRes();
    await api.handle(adminReq("referrals"), res);
    const row = res.body.referrals[0];
    // Justified: AdminUsersTable already shows emails, and a uuid is unactionable
    // for someone deciding whether to reverse a reward.
    assert.match(row.inviterEmail, /@example\.test$/);
    assert.match(row.inviterEmailMasked, /^.…@example\.test$/, "the list renders the masked form");
    assert.ok(row.idShort.length < row.id.length, "the table gets a uuid prefix");
  } finally {
    api.reset();
  }
});

test("[privacy] the source file cannot log an email, a hash or a body", () => {
  const source = fs.readFileSync("server-utils/referralAdminApi.js", "utf8");
  const logs = source.match(/console\.(log|error)\([\s\S]*?\);/g) || [];
  assert.ok(logs.length >= 2, "reversal and retry are both logged");
  for (const line of logs) {
    for (const forbidden of ["email", "ip_hash", "ipSignal", "req.body", "authorization"]) {
      assert.ok(!line.includes(forbidden), `${forbidden} must not be logged`);
    }
  }
  assert.ok(
    logs.some((l) => l.includes("admin_id")),
    "the acting admin must be recorded"
  );
  assert.ok(
    logs.some((l) => l.includes("attribution_id")),
    "and the attribution"
  );
});

/* ----------------------------------------------------------------- filters */

test("[filter] the qualified-but-unrewarded queue is a first-class filter", async () => {
  const api = await loadAdminApi({
    rows: [dbRow({ state: "qualified", rewarded_at: null, inviter_rewarded_at: null })]
  });
  try {
    const res = mockRes();
    await api.handle(adminReq("referrals", { query: { filter: "unrewarded" } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.filter, "unrewarded");
    assert.equal(res.body.referrals[0].unrewarded, true, "earned but not delivered");
  } finally {
    api.reset();
  }
});

test("[filter] an unknown filter is refused, not interpreted", async () => {
  const api = await loadAdminApi();
  try {
    const res = mockRes();
    await api.handle(adminReq("referrals", { query: { filter: "state=rewarded or 1=1" } }), res);
    assert.equal(res.statusCode, 400);
  } finally {
    api.reset();
  }
});

test("[filter] a capped referral is flagged so the table can explain it", async () => {
  const api = await loadAdminApi({ rows: [dbRow({ inviter_rewarded_at: null })] });
  try {
    const res = mockRes();
    await api.handle(adminReq("referrals"), res);
    assert.equal(res.body.referrals[0].inviterCapped, true, "rewarded, but the inviter earned nothing");
  } finally {
    api.reset();
  }
});

test("[paging] the page size is clamped rather than trusted", async () => {
  const api = await loadAdminApi();
  try {
    const res = mockRes();
    await api.handle(adminReq("referrals", { query: { limit: "100000", offset: "-5" } }), res);
    assert.equal(res.body.limit, 100, "ceiling applies");
    assert.equal(res.body.offset, 0, "a negative offset is not an instruction");
  } finally {
    api.reset();
  }
});

/* ------------------------------------------------------------------- retry */

test("[retry] goes through the EXISTING reward path, resolved by attribution id", async () => {
  const api = await loadAdminApi();
  try {
    const res = mockRes();
    await api.handle(
      adminReq("retry-referral-reward", {
        method: "POST",
        body: { attributionId: ATTR, inviterId: "forged", grantId: "forged", days: 500 }
      }),
      res
    );
    assert.equal(res.statusCode, 200);
    const call = api.calls.find((c) => c.fn === "retry");
    assert.equal(call.id, ATTR, "only the attribution id is used");
    assert.equal(api.calls.length, 1, "and no second reward path exists");
  } finally {
    api.reset();
  }
});

test("[retry] a double click converges — already_rewarded is success", async () => {
  const api = await loadAdminApi({
    reward: { ok: true, reason: "already_rewarded", inviterCapped: false, rewardedAt: "2026-08-02T10:00:01.000Z" }
  });
  try {
    for (let i = 0; i < 2; i += 1) {
      const res = mockRes();
      await api.handle(adminReq("retry-referral-reward", { method: "POST", body: { attributionId: ATTR } }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.reason, "already_rewarded");
    }
  } finally {
    api.reset();
  }
});

test("[retry] a referral that is not qualified is refused deterministically", async () => {
  const api = await loadAdminApi({ reward: { ok: false, reason: "not_qualified" } });
  try {
    const res = mockRes();
    await api.handle(adminReq("retry-referral-reward", { method: "POST", body: { attributionId: ATTR } }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.reason, "not_qualified");
  } finally {
    api.reset();
  }
});

test("[retry] a missing attribution id is a 400, not an attempt", async () => {
  const api = await loadAdminApi();
  try {
    const res = mockRes();
    await api.handle(adminReq("retry-referral-reward", { method: "POST", body: {} }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(api.calls.length, 0);
  } finally {
    api.reset();
  }
});

/* ---------------------------------------------------------------- reversal */

test("[reverse] a reason is REQUIRED before anything is called", async () => {
  for (const body of [
    { attributionId: ATTR },
    { attributionId: ATTR, reason: "" },
    { attributionId: ATTR, reason: "   " }
  ]) {
    const api = await loadAdminApi();
    try {
      const res = mockRes();
      await api.handle(adminReq("reverse-referral", { method: "POST", body }), res);
      assert.equal(res.statusCode, 400);
      assert.equal(api.calls.length, 0, "nothing may be revoked without a recorded reason");
    } finally {
      api.reset();
    }
  }
});

test("[reverse] everything is resolved from the attribution id — grants cannot be named", async () => {
  const api = await loadAdminApi();
  try {
    const res = mockRes();
    await api.handle(
      adminReq("reverse-referral", {
        method: "POST",
        body: {
          attributionId: ATTR,
          reason: "duplicate account",
          inviterId: "forged",
          inviteeId: "forged",
          grantId: "forged-grant",
          userId: "forged"
        }
      }),
      res
    );
    const call = api.calls.find((c) => c.fn === "reverse");
    assert.deepEqual([call.id, call.reason], [ATTR, "duplicate account"]);
    assert.equal(api.calls.length, 1, "no forged identifier reaches the service");
  } finally {
    api.reset();
  }
});

test("[reverse] a successful reversal returns a sanitised body", async () => {
  const api = await loadAdminApi();
  try {
    const res = mockRes();
    await api.handle(
      adminReq("reverse-referral", { method: "POST", body: { attributionId: ATTR, reason: "fraud review" } }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(res.body).sort(), [
      "attributionId",
      "inviteeGrantRevoked",
      "inviterGrantRevoked",
      "ok",
      "reason",
      "reversedAt",
      "state"
    ]);
    assert.equal(res.body.state, "reversed");
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes("@"), "no email");
    assert.ok(!body.includes(IP_HASH), "no hash");
  } finally {
    api.reset();
  }
});

test("[reverse] a refusal maps to a deterministic status, never a raw error", async () => {
  for (const [reason, status] of [
    ["not_found", 404],
    ["not_rewarded", 409],
    ["reason_required", 409],
    ["reason_too_long", 409]
  ]) {
    const api = await loadAdminApi({ reverse: { ok: false, reason } });
    try {
      const res = mockRes();
      await api.handle(
        adminReq("reverse-referral", { method: "POST", body: { attributionId: ATTR, reason: "x" } }),
        res
      );
      assert.equal(res.statusCode, status, `${reason} -> ${status}`);
      assert.deepEqual(Object.keys(res.body).sort(), ["ok", "reason"]);
    } finally {
      api.reset();
    }
  }
});

/* --------------------------------------------------------------- no bypass */

test("[safety] the admin layer has no grant path of its own", () => {
  const source = fs.readFileSync("server-utils/referralAdminApi.js", "utf8");
  assert.ok(!source.includes("grantBonusDays"), "admins pay through reward_referral or not at all");
  assert.ok(!/from\s+["'][^"']*timeGrants/.test(source), "and never import the ledger directly");
  assert.ok(!/\.rpc\(\s*["']grant_bonus_days/.test(source));
  assert.match(source, /attemptRewardForAttribution/, "retry reuses the existing path");
  assert.match(source, /reverseReferral/, "reversal reuses the 064 transaction");
});

test("[safety] every view calls assertAdmin before touching Supabase", () => {
  const source = fs.readFileSync("server-utils/referralAdminApi.js", "utf8");
  const handler = source.slice(source.indexOf("export async function handleReferralAdmin"));
  const adminAt = handler.indexOf("assertAdmin(req)");
  const supabaseAt = handler.indexOf("getSupabaseAdmin()");
  assert.ok(adminAt > 0 && supabaseAt > adminAt, "authorization precedes any data access");
});

test("[safety] api/admin.js routes all three views through the admin handler", () => {
  const source = fs.readFileSync("api/admin.js", "utf8");
  for (const view of ["referrals", "reverse-referral", "retry-referral-reward"]) {
    assert.ok(source.includes(`"${view}"`), `${view} must be dispatched`);
  }
  assert.match(source, /handleReferralAdmin\(req, res\)/);
});
