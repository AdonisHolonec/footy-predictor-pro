import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acknowledgeReferralBonuses,
  listPendingReferralBonuses,
  sanitizeDisplayName
} from "../server-utils/referralNotifications.js";

/**
 * Referral bonus notifications — the server half.
 *
 * The assertions that matter most are the negative ones. This is the only place in
 * the product where one user's identity is shown to another, so most of what
 * follows checks what is NOT in the payload: no email, no user id, no attribution
 * id, no ledger internals. A test that only proved the happy path would let any of
 * those ride along the first time somebody widened a `select`.
 */

const INVITER = "11111111-1111-1111-1111-111111111111";
const INVITEE = "22222222-2222-2222-2222-222222222222";
const ATTRIBUTION = "33333333-3333-3333-3333-333333333333";
const GRANT = "44444444-4444-4444-4444-444444444444";

/**
 * A table-keyed double. Every query records itself so the tests can assert the
 * QUERY COUNT as well as the answer — an N+1 regression is invisible otherwise.
 */
function fakeSupabase({ grants = [], seen = [], attributions = [], profiles = [] } = {}) {
  const calls = [];
  const tables = {
    time_grants: grants,
    referral_grant_notifications: seen,
    referral_attributions: attributions,
    profiles
  };
  return {
    calls,
    from(table) {
      const q = { table, filters: [] };
      calls.push(q);
      const chain = {
        select() {
          return chain;
        },
        eq(c, v) {
          q.filters.push([c, "eq", v]);
          return chain;
        },
        in(c, v) {
          q.filters.push([c, "in", v]);
          return chain;
        },
        is(c, v) {
          q.filters.push([c, "is", v]);
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        upsert(rows) {
          q.upserted = rows;
          return Promise.resolve({ error: null });
        },
        then(resolve) {
          const rows = (tables[table] || []).filter((row) =>
            q.filters.every(([c, op, v]) => {
              if (op === "eq") return row[c] === v;
              if (op === "in") return v.includes(row[c]);
              if (op === "is") return v === null ? row[c] == null : row[c] === v;
              return true;
            })
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        }
      };
      return chain;
    }
  };
}

const inviterGrant = (over = {}) => ({
  id: GRANT,
  user_id: INVITER,
  source: "referral_inviter",
  days: 5,
  reference_id: ATTRIBUTION,
  revoked_at: null,
  created_at: "2026-08-27T10:00:00Z",
  // Columns a careless select("*") would happily ship to the client.
  idempotency_key: "ref:v1:33333333:inviter",
  metadata: { secret: "must not leak" },
  ...over
});

/* ------------------------------------------------------- inviter identity */

test("inviter bonus carries the invitee's public display name", async () => {
  const db = fakeSupabase({
    grants: [inviterGrant()],
    attributions: [{ id: ATTRIBUTION, invitee_id: INVITEE }],
    profiles: [{ user_id: INVITEE, display_name: "Andrei Popescu" }]
  });
  const [bonus] = await listPendingReferralBonuses(INVITER, { supabase: db });
  assert.equal(bonus.role, "inviter");
  assert.equal(bonus.inviteeName, "Andrei Popescu");
  assert.equal(bonus.days, 5);
  assert.equal(bonus.grantId, GRANT);
});

test("the payload leaks NOTHING beyond the five presentation fields", async () => {
  const db = fakeSupabase({
    grants: [inviterGrant()],
    attributions: [{ id: ATTRIBUTION, invitee_id: INVITEE }],
    profiles: [{ user_id: INVITEE, display_name: "Andrei" }]
  });
  const [bonus] = await listPendingReferralBonuses(INVITER, { supabase: db });
  assert.deepEqual(Object.keys(bonus).sort(), ["days", "grantId", "grantedAt", "inviteeName", "role"]);

  // Nothing identifying the invitee, the attribution, or the ledger row survives.
  const serialized = JSON.stringify(bonus);
  assert.ok(!serialized.includes(INVITEE), "invitee uuid leaked");
  assert.ok(!serialized.includes(INVITER), "inviter uuid leaked");
  assert.ok(!serialized.includes(ATTRIBUTION), "attribution id leaked");
  assert.ok(!serialized.includes("@"), "an email-shaped value leaked");
  assert.ok(!serialized.includes("must not leak"), "grant metadata leaked");
  assert.ok(!serialized.includes("idempotency"), "idempotency key leaked");
});

test("an invitee bonus never names anyone — the inviter stays anonymous", async () => {
  const db = fakeSupabase({
    grants: [inviterGrant({ user_id: INVITEE, source: "referral_invitee" })],
    attributions: [{ id: ATTRIBUTION, invitee_id: INVITEE }],
    profiles: [{ user_id: INVITER, display_name: "Someone Else" }]
  });
  const [bonus] = await listPendingReferralBonuses(INVITEE, { supabase: db });
  assert.equal(bonus.role, "invitee");
  assert.equal(bonus.inviteeName, null);
  assert.ok(!JSON.stringify(bonus).includes("Someone Else"));
});

test("an invitee with no display name leaves the inviter with an anonymous notice", async () => {
  const db = fakeSupabase({
    grants: [inviterGrant()],
    attributions: [{ id: ATTRIBUTION, invitee_id: INVITEE }],
    profiles: [{ user_id: INVITEE, display_name: null }]
  });
  const [bonus] = await listPendingReferralBonuses(INVITER, { supabase: db });
  // null, never undefined and never a placeholder string the UI would print.
  assert.equal(bonus.inviteeName, null);
});

/* --------------------------------------------------------- name sanitising */

test("a display name that is an email address is refused, not shown", () => {
  assert.equal(sanitizeDisplayName("andrei@gmail.com"), null);
});

test("control characters cannot restructure the rendered line", () => {
  assert.equal(sanitizeDisplayName("Andrei\nPopescu"), null);
  assert.equal(sanitizeDisplayName("Andrei\u0000"), null);
});

test("HTML-like names survive as TEXT — escaping is React's job, not stripping", () => {
  // Deliberately NOT sanitised away: the user typed it, and it must render as the
  // characters they typed. Mangling it here would be a silent rename.
  assert.equal(sanitizeDisplayName("Ana & Bob"), "Ana & Bob");
  const script = sanitizeDisplayName("<script>alert(1)</script>");
  assert.ok(script.startsWith("<script>"), "markup-looking text was altered");
});

test("an over-long name is truncated rather than allowed to stretch the toast", () => {
  const out = sanitizeDisplayName("A".repeat(120));
  assert.equal(out.length, 40);
  assert.ok(out.endsWith("…"));
});

test("blank and one-character names are treated as no name at all", () => {
  assert.equal(sanitizeDisplayName("   "), null);
  assert.equal(sanitizeDisplayName("A"), null);
  assert.equal(sanitizeDisplayName(null), null);
});

/* ------------------------------------------------------------- which grants */

test("an already-acknowledged grant is not announced again", async () => {
  const db = fakeSupabase({
    grants: [inviterGrant()],
    seen: [{ grant_id: GRANT, user_id: INVITER }],
    attributions: [{ id: ATTRIBUTION, invitee_id: INVITEE }],
    profiles: [{ user_id: INVITEE, display_name: "Andrei" }]
  });
  assert.deepEqual(await listPendingReferralBonuses(INVITER, { supabase: db }), []);
});

test("a revoked grant is never announced as a reward", async () => {
  const db = fakeSupabase({ grants: [inviterGrant({ revoked_at: "2026-08-27T11:00:00Z" })] });
  assert.deepEqual(await listPendingReferralBonuses(INVITER, { supabase: db }), []);
});

test("non-referral grants are ignored — an admin grant is not a referral reward", async () => {
  const db = fakeSupabase({ grants: [inviterGrant({ source: "admin_grant" })] });
  assert.deepEqual(await listPendingReferralBonuses(INVITER, { supabase: db }), []);
});

test("no grants means a single query and no throw", async () => {
  const db = fakeSupabase({ grants: [] });
  assert.deepEqual(await listPendingReferralBonuses(INVITER, { supabase: db }), []);
  assert.equal(db.calls.length, 1);
});

/* ------------------------------------------------------------------ N+1 */

test("ten pending grants cost the same four queries as one", async () => {
  const grants = Array.from({ length: 10 }, (_, i) => ({
    ...inviterGrant(),
    id: `4444444${i}-4444-4444-4444-444444444444`,
    reference_id: `3333333${i}-3333-3333-3333-333333333333`
  }));
  const attributions = grants.map((g, i) => ({
    id: g.reference_id,
    invitee_id: `5555555${i}-5555-5555-5555-555555555555`
  }));
  const profiles = attributions.map((a, i) => ({ user_id: a.invitee_id, display_name: `Invitee ${i}` }));
  const db = fakeSupabase({ grants, attributions, profiles });

  const bonuses = await listPendingReferralBonuses(INVITER, { supabase: db });
  assert.equal(bonuses.length, 10);
  // grants + acknowledged + attributions + profiles. Never one lookup per grant.
  assert.equal(db.calls.length, 4, `expected 4 queries, got ${db.calls.length}`);
  // Each invitee keeps their OWN name — aggregation would have lost this.
  assert.equal(new Set(bonuses.map((b) => b.inviteeName)).size, 10);
});

/* --------------------------------------------------------- acknowledgement */

test("acknowledgement writes one row per grant, scoped to the caller", async () => {
  const db = fakeSupabase({ grants: [inviterGrant()] });
  const result = await acknowledgeReferralBonuses(INVITER, [GRANT], { supabase: db });
  assert.equal(result.acknowledged, 1);
  const write = db.calls.find((c) => c.upserted);
  assert.deepEqual(write.upserted, [{ grant_id: GRANT, user_id: INVITER }]);
});

test("a grant belonging to someone else cannot be acknowledged", async () => {
  // The grant exists, but not for this caller: the ownership re-read finds nothing.
  const db = fakeSupabase({ grants: [inviterGrant({ user_id: INVITEE })] });
  const result = await acknowledgeReferralBonuses(INVITER, [GRANT], { supabase: db });
  assert.equal(result.acknowledged, 0);
  assert.equal(
    db.calls.some((c) => c.upserted),
    false,
    "wrote a row for a grant it does not own"
  );
});

test("acknowledging nothing is a no-op, not an error", async () => {
  const db = fakeSupabase({ grants: [inviterGrant()] });
  assert.deepEqual(await acknowledgeReferralBonuses(INVITER, [], { supabase: db }), { acknowledged: 0 });
  assert.equal(db.calls.length, 0);
});

/* ------------------------------------------------------------- resilience */

test("a database failure yields an empty list rather than throwing at the caller", async () => {
  const exploding = {
    from() {
      throw new Error("connection reset");
    }
  };
  assert.deepEqual(await listPendingReferralBonuses(INVITER, { supabase: exploding }), []);
  assert.deepEqual(await acknowledgeReferralBonuses(INVITER, [GRANT], { supabase: exploding }), { acknowledged: 0 });
});
