import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ADMIN_GLOBAL_VARIANTS,
  GLOBAL_TICKET_LIST_LIMIT,
  defaultBetDate,
  handleGlobalTicketAdmin
} from "../server-utils/globalTicketAdminApi.js";
import { publishGlobalTicket } from "../server-utils/globalTicketService.js";
import { buildTicketCandidates } from "../server-utils/ticketCandidateColumn.js";

/**
 * Admin Global Tickets HTTP surface — the FIRST production caller of the GLOBAL
 * ticket backend.
 *
 * Because it is the first, none of 2B-i's guarantees can be assumed to survive
 * the trip through HTTP. These tests assert the whole chain, and they weight
 * four things:
 *
 *   1. AUTHORIZATION BEFORE ANYTHING. A non-admin must be refused before a pool
 *      is read. Asserted by counting queries on the double, not by reading the
 *      status code — a 403 issued after the pool loaded is still a leak.
 *
 *   2. THE CLIENT CANNOT DECIDE ELIGIBILITY. A browser POSTing leagueIds, a
 *      userId or selections must change nothing. Asserted by sending them and
 *      comparing the resulting RPC arguments byte for byte against a clean call.
 *
 *   3. NO PAYLOAD LEAKS TO THE BROWSER. The response is an explicit allow-list;
 *      raw_payload, ticket_candidates and the candidate pool must never appear.
 *
 *   4. PUBLISH IS NARROW. Only a GLOBAL draft, only once, and a USER ticket
 *      reaching this path must be refused rather than quietly published.
 *
 * Kickoffs are dated 2099 so the loader's `kickoff_at > now` filter cannot make
 * the suite depend on the day it runs.
 */

const ADMIN_OK = { assertAdmin: async () => ({ ok: true, user: { id: "admin-1" } }) };
const KICKOFF = "2099-09-05T18:00:00.000Z";

/** Minimal res double: records status and body. */
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

const goodMarket = (o = {}) => ({
  type: "Over 2.5",
  family: "Goals",
  line: 2.5,
  odds: 1.9,
  probability: 0.7,
  valueScore: 60,
  recommendable: true,
  tradable: true,
  betType: "over_under",
  period: "full_match",
  scope: "match",
  ...o
});

/** A predictions_history row carrying a usable projection. */
const candidateRow = (id, leagueId) => ({
  fixture_id: id,
  league_id: leagueId,
  kickoff_at: KICKOFF,
  league_name: `League ${leagueId}`,
  model_version: "v3.1",
  ticket_candidates: buildTicketCandidates({
    id,
    leagueId,
    kickoff: KICKOFF,
    teams: { home: `Home ${id}`, away: `Away ${id}` },
    recommended: { confidence: 80 },
    modelMeta: { dataQuality: 0.8 },
    insufficientData: false,
    valueEngine: { markets: [goodMarket({ probability: 0.9 - id * 0.01 })] }
  })
});

/** A stored GLOBAL ticket, as special_bets holds one. */
const storedTicket = (o = {}) => ({
  id: "bet-1",
  bet_date: "2026-09-05",
  variant: 3,
  bet_kind: "combo",
  system_k: null,
  status: "pending",
  bet_type: "GLOBAL",
  bet_source: "ADMIN_PREDICTIONS",
  user_id: null,
  league_ids: null,
  league_scope: null,
  published_at: null,
  created_at: "2026-09-05T00:30:00.000Z",
  settled_at: null,
  total_odds: "2.422",
  average_confidence: "80.00",
  ticket_probability: "0.8754",
  model_version: "v3.1",
  ...o
});

/**
 * Supabase double covering the three shapes this surface uses: the candidate
 * read, the special_bets list/read, and the publish update.
 */
function fakeSupabase({ candidates = [], bets = [], selections = [], rpc, onUpdate } = {}) {
  const log = { from: [], selects: [], rpc: [], updates: [], filters: [] };

  return {
    log,
    from(table) {
      log.from.push(table);
      const ctx = { table, mode: "read", patch: null, eqs: {} };
      const b = {
        select(cols) {
          log.selects.push([table, cols]);
          return b;
        },
        update(patch) {
          ctx.mode = "write";
          ctx.patch = patch;
          return b;
        },
        is: (...a) => (log.filters.push([table, "is", ...a]), b),
        not: (...a) => (log.filters.push([table, "not", ...a]), b),
        gt: (...a) => (log.filters.push([table, "gt", ...a]), b),
        in: (...a) => (log.filters.push([table, "in", ...a]), b),
        eq(col, val) {
          ctx.eqs[col] = val;
          log.filters.push([table, "eq", col, val]);
          return b;
        },
        order: (...a) => (log.filters.push([table, "order", ...a]), b),
        limit: (...a) => (log.filters.push([table, "limit", ...a]), b),
        maybeSingle: () =>
          Promise.resolve({ data: bets.find((x) => x.id === ctx.eqs.id) ?? null, error: null }),
        then(res, rej) {
          if (ctx.mode === "write") {
            log.updates.push({ table, patch: ctx.patch, eqs: { ...ctx.eqs } });
            const outcome = onUpdate ? onUpdate(ctx.eqs, ctx.patch) : null;
            return Promise.resolve(
              outcome ?? { data: [storedTicket({ published_at: ctx.patch.published_at })], error: null }
            ).then(res, rej);
          }
          if (table === "predictions_history") return Promise.resolve({ data: candidates, error: null }).then(res, rej);
          if (table === "special_bets") return Promise.resolve({ data: bets, error: null }).then(res, rej);
          return Promise.resolve({ data: selections, error: null }).then(res, rej);
        }
      };
      return b;
    },
    async rpc(name, args) {
      log.rpc.push([name, args]);
      return rpc ? rpc(name, args) : { data: { ok: true, created: true, bet: storedTicket(), selections: [] }, error: null };
    }
  };
}

const call = (req, deps) => {
  const res = fakeRes();
  return handleGlobalTicketAdmin(req, res, deps).then(() => res.out);
};

const poolOf = (n) => Array.from({ length: n }, (_, i) => candidateRow(i + 1, 39 + (i % 3)));

// ── authorization ──────────────────────────────────────────────────────────

test("an anonymous caller is refused before anything is read", async () => {
  const supabase = fakeSupabase({ candidates: poolOf(5) });
  const out = await call(
    { query: { view: "global-tickets" }, method: "POST", body: { variant: 3 } },
    { supabase, assertAdmin: async () => ({ ok: false, status: 401, error: "Lipsește token-ul de autorizare." }) }
  );

  assert.equal(out.statusCode, 401);
  assert.equal(out.body.ok, false);
  // Not one query, not one RPC. A refusal after the pool loaded is still a leak.
  assert.deepEqual(supabase.log.from, []);
  assert.deepEqual(supabase.log.rpc, []);
});

test("an authenticated non-admin is refused with zero reads and zero writes", async () => {
  const supabase = fakeSupabase({ candidates: poolOf(5) });
  for (const view of ["global-tickets", "publish-global-ticket"]) {
    const out = await call(
      { query: { view }, method: "POST", body: { variant: 3, id: "bet-1" } },
      { supabase, assertAdmin: async () => ({ ok: false, status: 403, error: "Este necesar acces de administrator." }) }
    );
    assert.equal(out.statusCode, 403, view);
  }
  assert.deepEqual(supabase.log.from, []);
  assert.deepEqual(supabase.log.updates, []);
});

test("the admin list is refused to a non-admin too — reads are not public", async () => {
  const supabase = fakeSupabase({ bets: [storedTicket()] });
  const out = await call(
    { query: { view: "global-tickets" }, method: "GET" },
    { supabase, assertAdmin: async () => ({ ok: false, status: 403, error: "no" }) }
  );
  assert.equal(out.statusCode, 403);
  assert.deepEqual(supabase.log.from, []);
});

// ── variant validation ─────────────────────────────────────────────────────

test("only the variants 2B-i builds are accepted", async () => {
  assert.deepEqual(ADMIN_GLOBAL_VARIANTS, [3, 5, 8]);

  for (const variant of [4, 0, -1, 2, 10, "abc", null, undefined]) {
    const supabase = fakeSupabase({ candidates: [] });
    const out = await call(
      { query: { view: "global-tickets" }, method: "POST", body: { variant } },
      { supabase, ...ADMIN_OK }
    );
    assert.equal(out.statusCode, 400, `variant ${variant}`);
    assert.equal(out.body.error, "invalid_variant");
    // Rejected before any read.
    assert.deepEqual(supabase.log.from, []);
  }
});

test("a system ticket is refused by name, never answered with a combo", async () => {
  const supabase = fakeSupabase({ candidates: poolOf(8) });
  const out = await call(
    { query: { view: "global-tickets" }, method: "POST", body: { variant: 5, betKind: "system" } },
    { supabase, ...ADMIN_OK }
  );

  assert.equal(out.statusCode, 400);
  assert.equal(out.body.error, "unsupported_bet_kind");
  assert.deepEqual(supabase.log.rpc, []);
});

test("unknown views and wrong methods are refused", async () => {
  const supabase = fakeSupabase({});
  assert.equal((await call({ query: { view: "nonsense" }, method: "GET" }, { supabase, ...ADMIN_OK })).statusCode, 400);
  assert.equal(
    (await call({ query: { view: "global-tickets" }, method: "DELETE" }, { supabase, ...ADMIN_OK })).statusCode,
    405
  );
  assert.equal(
    (await call({ query: { view: "publish-global-ticket" }, method: "GET" }, { supabase, ...ADMIN_OK })).statusCode,
    405
  );
});

// ── the client cannot decide eligibility ───────────────────────────────────

test("creation goes through the GLOBAL RPC and supplies no owner or league scope", async () => {
  const supabase = fakeSupabase({ candidates: poolOf(5) });
  const out = await call({ query: { view: "global-tickets" }, method: "POST", body: { variant: 3 } }, { supabase, ...ADMIN_OK });

  assert.equal(out.statusCode, 201);
  assert.deepEqual(
    supabase.log.rpc.map(([name]) => name),
    ["create_global_ticket"]
  );

  const args = supabase.log.rpc[0][1];
  for (const forbidden of ["p_user_id", "p_league_ids", "p_bet_type", "p_bet_source", "p_published_at"]) {
    assert.equal(forbidden in args, false, `${forbidden} must never be sent`);
  }
});

test("client-supplied leagueIds, userId and selections change nothing", async () => {
  const candidates = [candidateRow(1, 39), candidateRow(2, 140), candidateRow(3, 78)];

  const clean = fakeSupabase({ candidates });
  const outClean = await call(
    { query: { view: "global-tickets" }, method: "POST", body: { variant: 3 } },
    { supabase: clean, ...ADMIN_OK }
  );

  const hostile = fakeSupabase({ candidates });
  const outHostile = await call(
    {
      query: { view: "global-tickets" },
      method: "POST",
      body: {
        variant: 3,
        leagueIds: [39],
        userId: "00000000-0000-4000-8000-000000000000",
        favourites: [39],
        selections: [{ fixtureId: 999, odds: 100 }]
      }
    },
    { supabase: hostile, ...ADMIN_OK }
  );

  // Identical RPC arguments: nothing the browser sent reached the write.
  assert.deepEqual(hostile.log.rpc[0][1], clean.log.rpc[0][1]);
  assert.deepEqual(outHostile.body.ticket.selections, outClean.body.ticket.selections);
  // And no league predicate was ever applied to the candidate read.
  assert.deepEqual(
    hostile.log.filters.filter(([t, , col]) => t === "predictions_history" && String(col).includes("league")),
    []
  );
});

test("the loader stays admin-wide: every league in the pool reaches the ticket", async () => {
  const supabase = fakeSupabase({ candidates: [candidateRow(1, 39), candidateRow(2, 140), candidateRow(3, 78)] });
  const out = await call({ query: { view: "global-tickets" }, method: "POST", body: { variant: 3 } }, { supabase, ...ADMIN_OK });

  assert.equal(out.body.leaguesConsidered, 3);
});

test("the candidate read never names raw_payload or hydration_payload", async () => {
  const supabase = fakeSupabase({ candidates: poolOf(5) });
  await call({ query: { view: "global-tickets" }, method: "POST", body: { variant: 3 } }, { supabase, ...ADMIN_OK });

  const wire = JSON.stringify(supabase.log.selects);
  assert.equal(wire.includes("raw_payload"), false);
  assert.equal(wire.includes("hydration_payload"), false);
});

// ── thin pool ──────────────────────────────────────────────────────────────

test("no populated candidates is a 200 state, not an error", async () => {
  const supabase = fakeSupabase({ candidates: [] });
  const out = await call({ query: { view: "global-tickets" }, method: "POST", body: { variant: 3 } }, { supabase, ...ADMIN_OK });

  assert.equal(out.statusCode, 200);
  assert.equal(out.body.ok, true);
  assert.equal(out.body.available, false);
  assert.equal(out.body.poolState, "no_populated_predictions");
  assert.deepEqual(supabase.log.rpc, [], "nothing may be written when nothing can be built");
});

test("an insufficient pool reports the variant asked for, never a smaller one", async () => {
  const supabase = fakeSupabase({ candidates: [candidateRow(1, 39), candidateRow(2, 140)] });
  const out = await call({ query: { view: "global-tickets" }, method: "POST", body: { variant: 8 } }, { supabase, ...ADMIN_OK });

  assert.equal(out.statusCode, 200);
  assert.equal(out.body.available, false);
  assert.equal(out.body.poolState, "insufficient_candidates");
  assert.equal(out.body.variant, 8);
  assert.equal(out.body.required, 8);
  assert.equal(out.body.candidatesAvailable, 2);
  assert.deepEqual(supabase.log.rpc, []);
});

test("a thin-pool response carries counts, never candidate payloads", async () => {
  const supabase = fakeSupabase({ candidates: [candidateRow(1, 39)] });
  const out = await call({ query: { view: "global-tickets" }, method: "POST", body: { variant: 3 } }, { supabase, ...ADMIN_OK });

  const wire = JSON.stringify(out.body);
  assert.equal(wire.includes("raw_payload"), false);
  assert.equal(wire.includes("ticket_candidates"), false);
  assert.equal(wire.includes("valueEngine"), false);
  // `rejected` is a counter map; every value must be a number.
  for (const value of Object.values(out.body.rejected || {})) assert.equal(typeof value, "number");
});

// ── duplicates ─────────────────────────────────────────────────────────────

test("a repeat generation reports the stored ticket as a duplicate, with 200 not 201", async () => {
  const supabase = fakeSupabase({
    candidates: poolOf(5),
    rpc: () => ({ data: { ok: true, created: false, bet: storedTicket(), selections: [] }, error: null })
  });
  const out = await call({ query: { view: "global-tickets" }, method: "POST", body: { variant: 3 } }, { supabase, ...ADMIN_OK });

  assert.equal(out.statusCode, 200);
  assert.equal(out.body.created, false);
  assert.equal(out.body.duplicate, true);
  assert.equal(out.body.ticket.id, "bet-1");
});

// ── draft creation ─────────────────────────────────────────────────────────

test("a created ticket is a GLOBAL, admin-sourced, unpublished draft", async () => {
  const supabase = fakeSupabase({ candidates: poolOf(5) });
  const out = await call({ query: { view: "global-tickets" }, method: "POST", body: { variant: 3 } }, { supabase, ...ADMIN_OK });

  assert.equal(out.statusCode, 201);
  assert.equal(out.body.ticket.betType, "GLOBAL");
  assert.equal(out.body.ticket.betSource, "ADMIN_PREDICTIONS");
  assert.equal(out.body.ticket.publishedAt, null, "creation must never publish");
});

test("the server picks bet_date; a malformed client date is discarded", async () => {
  assert.match(defaultBetDate(Date.parse("2026-09-05T10:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);

  const supabase = fakeSupabase({ candidates: poolOf(5) });
  await call(
    { query: { view: "global-tickets" }, method: "POST", body: { variant: 3, betDate: "not-a-date; drop table" } },
    { supabase, ...ADMIN_OK }
  );
  assert.match(supabase.log.rpc[0][1].p_bet_date, /^\d{4}-\d{2}-\d{2}$/);
});

// ── the list ───────────────────────────────────────────────────────────────

test("the admin list is bounded and includes drafts", async () => {
  const supabase = fakeSupabase({
    bets: [storedTicket(), storedTicket({ id: "bet-2", published_at: "2026-09-05T01:00:00.000Z" })]
  });
  const out = await call({ query: { view: "global-tickets" }, method: "GET" }, { supabase, ...ADMIN_OK });

  assert.equal(out.statusCode, 200);
  assert.equal(out.body.tickets.length, 2);
  assert.equal(out.body.limit, GLOBAL_TICKET_LIST_LIMIT);
  assert.equal(out.body.tickets[0].publishedAt, null);
  assert.equal(out.body.tickets[1].publishedAt, "2026-09-05T01:00:00.000Z");
  // A limit was applied to the QUERY, not to the response.
  assert.ok(supabase.log.filters.some(([t, kind]) => t === "special_bets" && kind === "limit"));
});

test("the list caps a client-supplied limit", async () => {
  const supabase = fakeSupabase({ bets: [storedTicket()] });
  const out = await call({ query: { view: "global-tickets", limit: "100000" }, method: "GET" }, { supabase, ...ADMIN_OK });
  assert.equal(out.body.limit, 100);
});

test("the ticket view exposes an explicit field set and no database row", async () => {
  const supabase = fakeSupabase({ bets: [storedTicket()] });
  const out = await call({ query: { view: "global-tickets" }, method: "GET" }, { supabase, ...ADMIN_OK });

  assert.deepEqual(Object.keys(out.body.tickets[0]).sort(), [
    "averageConfidence",
    "betDate",
    "betKind",
    "betSource",
    "betType",
    "createdAt",
    "id",
    "modelVersion",
    "publishedAt",
    "selections",
    "settledAt",
    "status",
    "systemK",
    "ticketProbability",
    "totalOdds",
    "variant"
  ]);
  // The snake_case row shape must not survive into the response.
  assert.equal("user_id" in out.body.tickets[0], false);
  assert.equal("league_scope" in out.body.tickets[0], false);
});

// ── publish ────────────────────────────────────────────────────────────────

test("publishing a draft sets published_at through a GLOBAL-and-draft predicate", async () => {
  const supabase = fakeSupabase({ bets: [storedTicket()] });
  const out = await call(
    { query: { view: "publish-global-ticket" }, method: "POST", body: { id: "bet-1" } },
    { supabase, ...ADMIN_OK }
  );

  assert.equal(out.statusCode, 200);
  assert.equal(out.body.ok, true);

  const update = supabase.log.updates[0];
  assert.deepEqual(Object.keys(update.patch), ["published_at"], "publish writes ONE column");
  assert.equal(update.eqs.bet_type, "GLOBAL", "a USER ticket must not be reachable");
  assert.ok(
    supabase.log.filters.some(
      ([t, kind, col, val]) => t === "special_bets" && kind === "is" && col === "published_at" && val === null
    )
  );
});

test("a USER ticket cannot be published through the GLOBAL path", async () => {
  const supabase = fakeSupabase({
    bets: [storedTicket({ id: "user-1", bet_type: "USER", bet_source: "USER_PREDICTIONS" })],
    onUpdate: () => ({ data: [], error: null })
  });
  const out = await call(
    { query: { view: "publish-global-ticket" }, method: "POST", body: { id: "user-1" } },
    { supabase, ...ADMIN_OK }
  );

  assert.equal(out.statusCode, 400);
  assert.equal(out.body.error, "not_global");
});

test("an already-published ticket is a 409, not a silent re-publish", async () => {
  const supabase = fakeSupabase({
    bets: [storedTicket({ published_at: "2026-09-05T01:00:00.000Z" })],
    onUpdate: () => ({ data: [], error: null })
  });
  const out = await call(
    { query: { view: "publish-global-ticket" }, method: "POST", body: { id: "bet-1" } },
    { supabase, ...ADMIN_OK }
  );

  assert.equal(out.statusCode, 409);
  assert.equal(out.body.error, "already_published");
});

test("an unknown ticket is a 404 and a missing id a 400", async () => {
  const supabase = fakeSupabase({ bets: [], onUpdate: () => ({ data: [], error: null }) });
  assert.equal(
    (await call({ query: { view: "publish-global-ticket" }, method: "POST", body: { id: "nope" } }, { supabase, ...ADMIN_OK }))
      .statusCode,
    404
  );
  assert.equal(
    (await call({ query: { view: "publish-global-ticket" }, method: "POST", body: {} }, { supabase, ...ADMIN_OK })).statusCode,
    400
  );
});

test("publishGlobalTicket refuses a non-string id without touching the database", async () => {
  const supabase = fakeSupabase({});
  assert.deepEqual(await publishGlobalTicket(supabase, null), { ok: false, reason: "invalid_id" });
  assert.deepEqual(supabase.log.updates, []);
});

// ── failure handling ───────────────────────────────────────────────────────

test("a backend failure is a 500 that leaks no database detail", async () => {
  const supabase = fakeSupabase({
    candidates: poolOf(5),
    rpc: () => {
      throw Object.assign(new Error('column "secret_column" does not exist'), { code: "42703" });
    }
  });
  const out = await call({ query: { view: "global-tickets" }, method: "POST", body: { variant: 3 } }, { supabase, ...ADMIN_OK });

  assert.equal(out.statusCode, 500);
  assert.equal(out.body.ok, false);
  assert.equal(out.body.error, "Eroare internă.");
  assert.equal(JSON.stringify(out.body).includes("secret_column"), false);
});
