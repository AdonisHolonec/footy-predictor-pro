import assert from "node:assert/strict";
import { test } from "node:test";

import { PUBLISHED_GLOBAL_PAGE_SIZE, listPublishedGlobalBets } from "../server-utils/globalSpecialBets.js";
import { handleGlobalSpecialBets } from "../server-utils/globalSpecialBetsApi.js";

/**
 * Consumer Global Bets — the read that exposes published GLOBAL tickets.
 *
 * The whole risk here is exposure, so these assertions are written against the
 * QUERY rather than against today's rows: a filter that happens to return the
 * right data on this fixture but is expressible by a client is still a leak.
 *
 * Three properties carry the weight:
 *
 *   1. `bet_type` and `published_at` are NOT parameters. A caller cannot ask
 *      for a draft or a USER row, because neither is something this endpoint
 *      can express — asserted on the filters the query carries.
 *
 *   2. The USER read is untouched. `listGlobalSpecialBets` still scopes to
 *      `user_id`, and the new branch passes none: a published GLOBAL ticket
 *      belongs to nobody, so scoping it to the caller would both return
 *      nothing and imply an ownership that does not exist.
 *
 *   3. Authentication is required but ADMIN is not. Requiring admin would make
 *      a consumer surface useless; requiring nothing would make it public.
 */

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fakeRes() {
  const out = { statusCode: null, body: null };
  return {
    out,
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(payload) {
      out.body = payload;
      return this;
    }
  };
}

/** Records every filter, so scope is asserted rather than inferred from output. */
function fakeSupabase({ bets = [], selections = [] } = {}) {
  const log = { queries: [] };
  return {
    log,
    from(table) {
      const ctx = { table, eqs: {}, nots: [], ins: {}, range: null, orders: [] };
      log.queries.push(ctx);
      const b = {
        select: (cols) => ((ctx.select = cols), b),
        eq: (col, val) => ((ctx.eqs[col] = val), b),
        not: (col, op, val) => (ctx.nots.push([col, op, val]), b),
        is: (col, val) => ((ctx.eqs[`is:${col}`] = val), b),
        in: (col, vals) => ((ctx.ins[col] = vals), b),
        order: (col, o) => (ctx.orders.push([col, o?.ascending]), b),
        range: (from, to) => ((ctx.range = [from, to]), b),
        then(resolve) {
          if (table === "special_bets") {
            const rows = bets.filter((x) => Object.entries(ctx.eqs).every(([k, v]) => x[k] === v));
            const filtered = ctx.nots.some(([c, , v]) => c === "published_at" && v === null)
              ? rows.filter((x) => x.published_at != null)
              : rows;
            const [from, to] = ctx.range || [0, filtered.length];
            return resolve({ data: filtered.slice(from, to + 1), error: null });
          }
          return resolve({
            data: selections.filter((s) => (ctx.ins.special_bet_id || []).includes(s.special_bet_id)),
            error: null
          });
        }
      };
      return b;
    }
  };
}

const ticket = (o = {}) => ({
  id: "g1",
  bet_date: "2026-09-05",
  variant: 3,
  bet_kind: "combo",
  status: "pending",
  bet_type: "GLOBAL",
  user_id: null,
  published_at: "2026-09-05T17:27:27.000Z",
  created_at: "2026-09-05T17:27:10.000Z",
  total_odds: "2.422",
  ...o
});

const draft = (o = {}) => ticket({ id: "g-draft", published_at: null, ...o });
const userTicket = (o = {}) => ticket({ id: "u1", bet_type: "USER", user_id: USER_ID, published_at: null, ...o });

const AUTH_OK = { ok: true, user: { id: USER_ID } };

// ── the service ────────────────────────────────────────────────────────────

test("the query fixes bet_type GLOBAL and published_at NOT NULL", async () => {
  const supabase = fakeSupabase({ bets: [ticket()] });
  await listPublishedGlobalBets({ supabase });

  const q = supabase.log.queries[0];
  assert.equal(q.table, "special_bets");
  assert.equal(q.eqs.bet_type, "GLOBAL");
  assert.deepEqual(
    q.nots.find(([c]) => c === "published_at"),
    ["published_at", "is", null]
  );
  // The caller cannot scope it to a person: a published GLOBAL ticket has none.
  assert.equal("user_id" in q.eqs, false);
});

test("drafts and USER tickets are excluded by the query, not by the caller", async () => {
  const supabase = fakeSupabase({ bets: [ticket(), draft(), userTicket()] });
  const { bets } = await listPublishedGlobalBets({ supabase });

  assert.deepEqual(
    bets.map((b) => b.id),
    ["g1"]
  );
});

test("the page is bounded and a client cannot ask for more", async () => {
  const many = Array.from({ length: 120 }, (_, i) => ticket({ id: `g${i}` }));

  const dflt = fakeSupabase({ bets: many });
  await listPublishedGlobalBets({ supabase: dflt });
  assert.deepEqual(dflt.log.queries[0].range, [0, PUBLISHED_GLOBAL_PAGE_SIZE - 1]);

  // An absurd limit is capped server-side rather than honoured.
  const huge = fakeSupabase({ bets: many });
  const { bets } = await listPublishedGlobalBets({ supabase: huge, limit: 100000 });
  assert.equal(bets.length <= 50, true, "the server ceiling must hold");
  assert.equal(huge.log.queries[0].range[1] <= 49, true);
});

test("selections come from the stored snapshot, in one keyed query", async () => {
  const supabase = fakeSupabase({
    bets: [ticket(), ticket({ id: "g2" })],
    selections: [
      { id: "s1", special_bet_id: "g1", fixture_id: 901 },
      { id: "s2", special_bet_id: "g2", fixture_id: 902 }
    ]
  });
  const { bets } = await listPublishedGlobalBets({ supabase });

  assert.deepEqual(
    bets[0].selections.map((s) => s.fixture_id),
    [901]
  );
  assert.deepEqual(
    bets[1].selections.map((s) => s.fixture_id),
    [902]
  );
  // Two queries for two tickets — never one per ticket.
  assert.equal(supabase.log.queries.length, 2);
  assert.equal(supabase.log.queries[1].ins.special_bet_id.length, 2);
  // Never predictions_history: the snapshot is authoritative.
  assert.equal(
    supabase.log.queries.some((q) => q.table === "predictions_history"),
    false
  );
});

test("no tickets yields an empty list rather than an error", async () => {
  const { bets } = await listPublishedGlobalBets({ supabase: fakeSupabase({ bets: [] }) });
  assert.deepEqual(bets, []);
});

// ── the HTTP view ──────────────────────────────────────────────────────────

const call = (req, deps) => {
  const res = fakeRes();
  return handleGlobalSpecialBets(req, res, deps).then(() => res.out);
};

test("an unauthenticated consumer is refused before anything is read", async () => {
  const supabase = fakeSupabase({ bets: [ticket()] });
  const out = await call(
    { method: "GET", query: { scope: "global" } },
    { supabase, getRequester: async () => ({ ok: false, status: 401, error: "Lipsește token-ul de autorizare." }) }
  );

  assert.equal(out.statusCode, 401);
  assert.deepEqual(supabase.log.queries, [], "nothing may be read before authentication");
});

test("an authenticated NON-admin consumer can read published Global Bets", async () => {
  const supabase = fakeSupabase({ bets: [ticket(), draft()] });
  const out = await call({ method: "GET", query: { scope: "global" } }, { supabase, getRequester: async () => AUTH_OK });

  assert.equal(out.statusCode, 200);
  assert.equal(out.body.ok, true);
  // Admin is NOT required — this is a consumer surface.
  assert.deepEqual(
    out.body.bets.map((b) => b.id),
    ["g1"]
  );
});

test("a client-supplied userId cannot switch scope", async () => {
  const supabase = fakeSupabase({ bets: [ticket(), userTicket({ published_at: "2026-09-05T00:00:00.000Z" })] });
  const out = await call(
    { method: "GET", query: { scope: "global", userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", user_id: "x" } },
    { supabase, getRequester: async () => AUTH_OK }
  );

  assert.equal(out.statusCode, 200);
  assert.equal("user_id" in supabase.log.queries[0].eqs, false, "no user predicate may reach the query");
  // The USER row is excluded by bet_type, whatever the client sent.
  assert.deepEqual(
    out.body.bets.map((b) => b.id),
    ["g1"]
  );
});

test("a client cannot request drafts through this view", async () => {
  const supabase = fakeSupabase({ bets: [draft()] });
  const out = await call(
    { method: "GET", query: { scope: "global", published_at: "null", bet_type: "USER", status: "draft" } },
    { supabase, getRequester: async () => AUTH_OK }
  );

  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.body.bets, [], "a draft must never surface");
  assert.equal(supabase.log.queries[0].eqs.bet_type, "GLOBAL", "the client's bet_type is ignored");
});

test("the USER read is untouched when scope is absent", async () => {
  const supabase = fakeSupabase({ bets: [userTicket()] });
  const out = await call({ method: "GET", query: {} }, { supabase, getRequester: async () => AUTH_OK });

  assert.equal(out.statusCode, 200);
  // The existing path still scopes to the caller.
  assert.equal(supabase.log.queries[0].eqs.user_id, USER_ID);
});

test("the response carries no payload internals", async () => {
  const supabase = fakeSupabase({
    bets: [ticket()],
    selections: [{ id: "s1", special_bet_id: "g1", fixture_id: 901, selection: "Over 2.5", odds: 1.85 }]
  });
  const out = await call({ method: "GET", query: { scope: "global" } }, { supabase, getRequester: async () => AUTH_OK });

  const wire = JSON.stringify(out.body);
  for (const forbidden of ["raw_payload", "ticket_candidates", "valueEngine", "hydration_payload", "service_role"]) {
    assert.equal(wire.includes(forbidden), false, `${forbidden} must never reach a consumer`);
  }
  // The snapshot fields the UI needs are present and unaltered.
  assert.equal(out.body.bets[0].total_odds, "2.422");
  assert.equal(out.body.bets[0].selections[0].odds, 1.85);
});
