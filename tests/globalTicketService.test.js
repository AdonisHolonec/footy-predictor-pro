import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GLOBAL_TICKET_POOL_STATES,
  generateGlobalTicket,
  generateGlobalTicketAsAdmin,
  loadGlobalCandidatePayloads
} from "../server-utils/globalTicketService.js";
import { buildTicketCandidates } from "../server-utils/ticketCandidateColumn.js";
import { collectGlobalCandidates } from "../server-utils/globalSpecialBetEngine.js";

/**
 * Global Ticket service — the admin-wide generation path.
 *
 * Four properties get the weight here, because three of them fail SILENTLY and
 * the fourth fails expensively:
 *
 *   1. SOURCE. The loader must read ticket_candidates and nothing else. A
 *      raw_payload fallback would work perfectly, produce identical tickets,
 *      and quietly restore the ~151 MB query that caused the 57014 timeouts —
 *      exactly when the pool is thin and the scan is widest. Asserted against
 *      the query the loader actually builds, not against its output.
 *
 *   2. INDEPENDENCE. A GLOBAL ticket must not narrow to any user's leagues.
 *      The guarantee is structural — the parameters do not exist — so the
 *      tests assert the STRUCTURE (arity, absence of a league predicate), not
 *      just that today's output happens to be wide.
 *
 *   3. THIN POOL. A variant that cannot be built must not be padded, must not
 *      be downgraded, and must not be answered with a shorter ticket wearing
 *      the requested number. Every boundary from 0 to 8 is pinned.
 *
 *   4. AUTHORIZATION. A non-admin must be refused BEFORE anything reads or
 *      writes. Asserted by counting queries, not by reading the status code: a
 *      403 returned after the pool was loaded is still a leak.
 *
 * No database. The Supabase client is a recording double, so every assertion
 * about the query is about the query that would have been sent.
 */

const NOW = Date.parse("2026-09-05T10:00:00.000Z");
const KICKOFF = "2026-09-05T18:00:00.000Z";
const BET_DATE = "2026-09-05";

// ── doubles ────────────────────────────────────────────────────────────────

/**
 * A Supabase double that RECORDS the chain rather than interpreting it.
 *
 * Thenable at every step, so the same builder serves `await q.limit(n)` and the
 * `q = q.not(...)` re-assignment listGlobalTickets uses.
 */
function fakeSupabase({ tables = {}, rpcResult } = {}) {
  const log = { from: [], select: [], filters: [], rpc: [] };

  const makeBuilder = (table) => {
    const record = (kind, ...args) => {
      log.filters.push([table, kind, ...args]);
      return builder;
    };
    const builder = {
      select(columns) {
        log.select.push([table, columns]);
        return builder;
      },
      not: (...a) => record("not", ...a),
      gt: (...a) => record("gt", ...a),
      gte: (...a) => record("gte", ...a),
      lte: (...a) => record("lte", ...a),
      eq: (...a) => record("eq", ...a),
      in: (...a) => record("in", ...a),
      order: (...a) => record("order", ...a),
      limit: (...a) => record("limit", ...a),
      then: (resolve, reject) =>
        Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve, reject)
    };
    return builder;
  };

  return {
    log,
    from(table) {
      log.from.push(table);
      return makeBuilder(table);
    },
    async rpc(name, args) {
      log.rpc.push([name, args]);
      return rpcResult
        ? rpcResult(name, args)
        : {
            data: {
              ok: true,
              created: true,
              bet: { id: "bet-1", bet_type: "GLOBAL", bet_source: "ADMIN_PREDICTIONS", user_id: null },
              selections: args.p_selections
            },
            error: null
          };
    }
  };
}

/** A market that passes every safety gate, so a test only varies what it means to. */
function goodMarket(overrides = {}) {
  return {
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
    ...overrides
  };
}

/** The canonical prediction document, as raw_payload holds it. */
function rawPayload(id, leagueId, markets, overrides = {}) {
  return {
    id,
    leagueId,
    kickoff: KICKOFF,
    teams: { home: `Home ${id}`, away: `Away ${id}` },
    recommended: { pick: "Over 2.5", family: "Goals", confidence: 80 },
    modelMeta: { dataQuality: 0.8 },
    insufficientData: false,
    valueEngine: { markets },
    ...overrides
  };
}

/** A predictions_history row as the loader's projection returns it. */
function historyRow(id, leagueId, markets, overrides = {}) {
  return {
    fixture_id: id,
    league_id: leagueId,
    kickoff_at: KICKOFF,
    league_name: `League ${leagueId}`,
    model_version: "v3.1",
    ticket_candidates: buildTicketCandidates(rawPayload(id, leagueId, markets, overrides))
  };
}

/** `count` fixtures, each with one passing market, spread over three leagues. */
const populatedRows = (count) =>
  Array.from({ length: count }, (_, i) =>
    historyRow(i + 1, 39 + (i % 3), [goodMarket({ probability: 0.9 - i * 0.01, odds: 1.5 })])
  );

const adminOk = { assertAdmin: async () => ({ ok: true, user: { id: "admin-1" } }) };

// ── §10 loader source ──────────────────────────────────────────────────────

test("the loader projects only the ticket-candidate columns", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(3) } });
  await loadGlobalCandidatePayloads(supabase, NOW);

  assert.deepEqual(supabase.log.select, [
    [
      "predictions_history",
      "fixture_id, league_id, kickoff_at, league_name, model_version, ticket_candidates"
    ]
  ]);
});

test("the loader never mentions raw_payload or hydration_payload", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(3) } });
  await loadGlobalCandidatePayloads(supabase, NOW);

  const everything = JSON.stringify([supabase.log.select, supabase.log.filters]);
  assert.equal(everything.includes("raw_payload"), false);
  assert.equal(everything.includes("hydration_payload"), false);
});

test("the loader excludes NULL ticket_candidates in the QUERY, not in JavaScript", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(1) } });
  await loadGlobalCandidatePayloads(supabase, NOW);

  // In the query, so an un-backfilled row costs no egress at all.
  assert.deepEqual(
    supabase.log.filters.find(([, kind]) => kind === "not"),
    ["predictions_history", "not", "ticket_candidates", "is", null]
  );
});

test("the loader is bounded and future-only", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(1) } });
  await loadGlobalCandidatePayloads(supabase, NOW);

  const kinds = Object.fromEntries(supabase.log.filters.map(([, kind, ...rest]) => [kind, rest]));
  assert.deepEqual(kinds.gt, ["kickoff_at", new Date(NOW).toISOString()]);
  assert.deepEqual(kinds.order, ["kickoff_at", { ascending: true }]);
  // The same ceiling the user path uses, imported rather than restated.
  assert.deepEqual(kinds.limit, [500]);
});

test("the loader issues exactly one query — no N+1", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(25) } });
  const { rows } = await loadGlobalCandidatePayloads(supabase, NOW);

  assert.equal(rows.length, 25);
  assert.deepEqual(supabase.log.from, ["predictions_history"]);
});

test("a row whose projection is absent is skipped, never repaired", async () => {
  const rows = populatedRows(2);
  const orphan = { ...historyRow(99, 39, [goodMarket()]), ticket_candidates: null };
  const supabase = fakeSupabase({ tables: { predictions_history: [...rows, orphan] } });

  const result = await loadGlobalCandidatePayloads(supabase, NOW);
  assert.equal(result.rows.length, 2);
  assert.equal(result.unusable, 1);
  assert.equal(result.scanned, 3);
  assert.equal(
    result.rows.some((row) => row.id === 99),
    false
  );
});

test("identity comes from the columns, not from the jsonb", async () => {
  const supabase = fakeSupabase({
    tables: { predictions_history: [historyRow(7, 140, [goodMarket()])] }
  });
  const { rows } = await loadGlobalCandidatePayloads(supabase, NOW);

  assert.equal(rows[0].id, 7);
  assert.equal(rows[0].leagueId, 140);
  assert.equal(rows[0].kickoff, KICKOFF);
  assert.equal(rows[0].league, "League 140");
  assert.equal(rows[0].modelVersion, "v3.1");
  // The projection carries no identity of its own to disagree with.
  assert.equal("fixture_id" in rows[0], false);
});

test("retained markets reach the engine unchanged", async () => {
  const market = goodMarket({ odds: 2.05, probability: 0.65, valueScore: 71.5 });
  const supabase = fakeSupabase({ tables: { predictions_history: [historyRow(1, 39, [market])] } });

  const { rows } = await loadGlobalCandidatePayloads(supabase, NOW);
  assert.deepEqual(rows[0].valueEngine.markets, [market]);
});

test("a duplicate history row cannot seed two candidates", async () => {
  const row = historyRow(1, 39, [goodMarket()]);
  const supabase = fakeSupabase({ tables: { predictions_history: [row, { ...row }] } });

  const { rows, payloadsByFixtureId } = await loadGlobalCandidatePayloads(supabase, NOW);
  assert.equal(rows.length, 1);
  assert.equal(payloadsByFixtureId.size, 1);
});

// ── §9 source independence ─────────────────────────────────────────────────

test("A: predictions in three leagues all reach the pool", async () => {
  const rows = [
    historyRow(1, 39, [goodMarket({ probability: 0.9 })]),
    historyRow(2, 140, [goodMarket({ probability: 0.85 })]),
    historyRow(3, 78, [goodMarket({ probability: 0.8 })])
  ];
  const supabase = fakeSupabase({ tables: { predictions_history: rows } });

  const result = await loadGlobalCandidatePayloads(supabase, NOW);
  assert.deepEqual(result.leagueIds, [39, 78, 140]);
});

test("A: a user who selected only one league does not narrow the GLOBAL ticket", async () => {
  const rows = [
    historyRow(1, 39, [goodMarket({ probability: 0.9 })]),
    historyRow(2, 140, [goodMarket({ probability: 0.85 })]),
    historyRow(3, 78, [goodMarket({ probability: 0.8 })])
  ];
  const supabase = fakeSupabase({ tables: { predictions_history: rows } });

  const result = await generateGlobalTicket({ betDate: BET_DATE, variant: 3, now: NOW, supabase });
  // Leagues 140 and 78 are on the ticket even though a hypothetical current
  // user selected only 39 — there is nowhere for that selection to enter.
  assert.deepEqual(result.leaguesConsidered, [39, 78, 140]);
  assert.deepEqual(
    [...new Set(result.selections.map((s) => s.league_id))].sort((a, b) => a - b),
    [39, 78, 140]
  );
});

test("B/C: the loader has no parameter a user preference could occupy", async () => {
  // One required parameter — the client. The only other is a clock with a
  // default, which is why .length reports 1. The signature itself is what the
  // guarantee rests on, so it is read rather than inferred: there is no
  // parameter a user id, a league filter or a favourites list could occupy.
  assert.equal(loadGlobalCandidatePayloads.length, 1);
  const signature = loadGlobalCandidatePayloads.toString().split("{")[0];
  assert.match(signature, /supabase/);
  assert.match(signature, /now = Date\.now\(\)/);
  for (const forbidden of ["userId", "leagueIds", "favourite", "user"]) {
    assert.equal(signature.includes(forbidden), false, forbidden + " must not be a parameter");
  }

  const rows = populatedRows(3);
  const supabase = fakeSupabase({ tables: { predictions_history: rows } });
  const other = fakeSupabase({ tables: { predictions_history: rows } });

  // A caller that tries anyway is ignored: extra arguments change no filter.
  const plain = await loadGlobalCandidatePayloads(supabase, NOW);
  const withFavourites = await loadGlobalCandidatePayloads(other, NOW, {
    userId: "user-1",
    leagueIds: [39],
    favourites: [39]
  });

  assert.deepEqual(withFavourites.leagueIds, plain.leagueIds);
  assert.deepEqual(other.log.filters, supabase.log.filters);
});

test("C: the admin's identity cannot change what the ticket contains", async () => {
  const rows = populatedRows(5);
  const build = async (adminId) => {
    const supabase = fakeSupabase({ tables: { predictions_history: rows } });
    const result = await generateGlobalTicketAsAdmin(
      { headers: { authorization: `Bearer ${adminId}` } },
      { betDate: BET_DATE, variant: 3, now: NOW, supabase },
      { assertAdmin: async () => ({ ok: true, user: { id: adminId } }) }
    );
    return result.selections;
  };

  assert.deepEqual(await build("admin-1"), await build("admin-2"));
});

test("D: no league predicate is introduced anywhere in the GLOBAL loader", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(4) } });
  await loadGlobalCandidatePayloads(supabase, NOW);

  const leagueFilters = supabase.log.filters.filter(([, , column]) =>
    String(column).includes("league")
  );
  assert.deepEqual(leagueFilters, []);
  assert.equal(
    supabase.log.filters.some(([, kind]) => kind === "in"),
    false
  );
});

// ── §5 thin-pool safety ────────────────────────────────────────────────────

test("zero populated rows is distinguished from a thin day", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: [] } });
  const result = await generateGlobalTicket({ betDate: BET_DATE, variant: 3, now: NOW, supabase });

  assert.equal(result.available, false);
  assert.equal(result.poolState, GLOBAL_TICKET_POOL_STATES.NO_POPULATED_PREDICTIONS);
  assert.equal(result.candidatesAvailable, 0);
  // Nothing was written, and the RPC was never reached.
  assert.deepEqual(supabase.log.rpc, []);
});

test("fewer candidates than the variant needs writes nothing", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(2) } });
  const result = await generateGlobalTicket({ betDate: BET_DATE, variant: 3, now: NOW, supabase });

  assert.equal(result.available, false);
  assert.equal(result.poolState, GLOBAL_TICKET_POOL_STATES.INSUFFICIENT_CANDIDATES);
  assert.equal(result.candidatesAvailable, 2);
  assert.equal(result.required, 3);
  assert.deepEqual(supabase.log.rpc, []);
});

test("each variant is built only at or above its own threshold", async () => {
  // pool size -> which of 3 / 5 / 8 may exist
  const expectations = [
    [0, []],
    [2, []],
    [3, [3]],
    [4, [3]],
    [5, [3, 5]],
    [7, [3, 5]],
    [8, [3, 5, 8]]
  ];

  for (const [poolSize, buildable] of expectations) {
    for (const variant of [3, 5, 8]) {
      const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(poolSize) } });
      const result = await generateGlobalTicket({ betDate: BET_DATE, variant, now: NOW, supabase });
      assert.equal(
        result.available,
        buildable.includes(variant),
        `pool ${poolSize}, variant ${variant}`
      );
    }
  }
});

test("a built ticket has exactly the requested number of legs — never padded", async () => {
  for (const [poolSize, variant] of [
    [3, 3],
    [5, 5],
    [8, 8],
    [12, 8]
  ]) {
    const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(poolSize) } });
    const result = await generateGlobalTicket({ betDate: BET_DATE, variant, now: NOW, supabase });

    assert.equal(result.available, true);
    assert.equal(result.selections.length, variant);
    assert.equal(supabase.log.rpc[0][1].p_variant, variant);
  }
});

test("an unbuildable 8 is refused as an 8 — never silently downgraded to a 5", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(6) } });
  const result = await generateGlobalTicket({ betDate: BET_DATE, variant: 8, now: NOW, supabase });

  assert.equal(result.available, false);
  assert.equal(result.variant, 8);
  assert.equal(result.required, 8);
  assert.equal(result.candidatesAvailable, 6);
  assert.deepEqual(supabase.log.rpc, []);
});

test("a system ticket is refused by name, not answered with a combo", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(8) } });
  await assert.rejects(
    generateGlobalTicket({ betDate: BET_DATE, variant: 5, betKind: "system", now: NOW, supabase }),
    /unsupported_bet_kind/
  );
  assert.deepEqual(supabase.log.rpc, []);
});

test("one leg per fixture, whatever the pool holds", async () => {
  // One fixture offering three passing markets cannot contribute three legs.
  const rows = [
    historyRow(1, 39, [
      goodMarket({ probability: 0.9, type: "Over 1.5", line: 1.5 }),
      goodMarket({ probability: 0.88, type: "Over 2.5", line: 2.5 }),
      goodMarket({ probability: 0.86, type: "Under 4.5", line: 4.5 })
    ]),
    historyRow(2, 140, [goodMarket({ probability: 0.84 })]),
    historyRow(3, 78, [goodMarket({ probability: 0.82 })])
  ];
  const supabase = fakeSupabase({ tables: { predictions_history: rows } });
  const result = await generateGlobalTicket({ betDate: BET_DATE, variant: 3, now: NOW, supabase });

  assert.equal(result.available, true);
  assert.equal(new Set(result.selections.map((s) => s.fixture_id)).size, 3);
});

// ── §11 authorization ──────────────────────────────────────────────────────

test("an anonymous caller is refused before anything is read", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(8) } });
  const result = await generateGlobalTicketAsAdmin(
    {},
    { betDate: BET_DATE, variant: 3, now: NOW, supabase },
    {
      assertAdmin: async () => ({
        ok: false,
        status: 401,
        error: "Lipsește token-ul de autorizare."
      })
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  // Not one query, not one write — a 403 issued after the pool was loaded would
  // still have leaked the pool.
  assert.deepEqual(supabase.log.from, []);
  assert.deepEqual(supabase.log.rpc, []);
});

test("an authenticated non-admin is refused with zero writes", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(8) } });
  const result = await generateGlobalTicketAsAdmin(
    { headers: { authorization: "Bearer user-token" } },
    { betDate: BET_DATE, variant: 3, now: NOW, supabase },
    {
      assertAdmin: async () => ({
        ok: false,
        status: 403,
        error: "Este necesar acces de administrator."
      })
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.deepEqual(supabase.log.from, []);
  assert.deepEqual(supabase.log.rpc, []);
});

test("an admin may generate", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(8) } });
  const result = await generateGlobalTicketAsAdmin(
    { headers: { authorization: "Bearer admin-token" } },
    { betDate: BET_DATE, variant: 5, now: NOW, supabase },
    adminOk
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.created, true);
  assert.equal(supabase.log.rpc.length, 1);
});

test("the RPC call carries no owner and no league scope", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(5) } });
  await generateGlobalTicket({ betDate: BET_DATE, variant: 3, now: NOW, supabase });

  const [name, args] = supabase.log.rpc[0];
  assert.equal(name, "create_global_ticket");
  // The parameters do not exist. Ownership, scope, type, source and visibility
  // are decided in SQL, where no caller can reach them.
  for (const forbidden of [
    "p_user_id",
    "p_league_ids",
    "p_bet_type",
    "p_bet_source",
    "p_published_at"
  ]) {
    assert.equal(forbidden in args, false, `${forbidden} must not be a parameter`);
  }
  assert.deepEqual(Object.keys(args).sort(), [
    "p_average_confidence",
    "p_bet_date",
    "p_model_version",
    "p_selections",
    "p_ticket_probability",
    "p_total_odds",
    "p_variant"
  ]);
});

test("the USER RPC is never called by the GLOBAL path", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(8) } });
  await generateGlobalTicket({ betDate: BET_DATE, variant: 8, now: NOW, supabase });

  assert.deepEqual(
    supabase.log.rpc.map(([name]) => name),
    ["create_global_ticket"]
  );
});

// ── §6 idempotency ─────────────────────────────────────────────────────────

test("a repeat generation reports the stored ticket, not a new one", async () => {
  const stored = {
    id: "bet-1",
    bet_type: "GLOBAL",
    bet_source: "ADMIN_PREDICTIONS",
    user_id: null,
    ticket_probability: "0.1234"
  };
  const supabase = fakeSupabase({
    tables: { predictions_history: populatedRows(5) },
    rpcResult: () => ({ data: { ok: true, created: false, bet: stored, selections: [] }, error: null })
  });

  const result = await generateGlobalTicket({ betDate: BET_DATE, variant: 3, now: NOW, supabase });
  assert.equal(result.created, false);
  assert.equal(result.available, true);
  // The number that was STORED with the ticket, never one recomputed today and
  // attributed to selections it was not computed from.
  assert.equal(result.estimatedTicketProbability, 0.1234);
});

test("a different variant is an independent ticket", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(8) } });
  await generateGlobalTicket({ betDate: BET_DATE, variant: 3, now: NOW, supabase });
  await generateGlobalTicket({ betDate: BET_DATE, variant: 5, now: NOW, supabase });

  assert.deepEqual(
    supabase.log.rpc.map(([, args]) => args.p_variant),
    [3, 5]
  );
});

// ── §7 snapshot semantics ──────────────────────────────────────────────────

test("every selection field is persisted exactly as the engine produced it", async () => {
  const market = goodMarket({ odds: 2.05, probability: 0.72, valueScore: 64.25, line: 2.5 });
  const rows = [
    historyRow(11, 39, [market]),
    historyRow(12, 140, [goodMarket({ probability: 0.66 })]),
    historyRow(13, 78, [goodMarket({ probability: 0.64 })])
  ];
  const supabase = fakeSupabase({ tables: { predictions_history: rows } });
  await generateGlobalTicket({ betDate: BET_DATE, variant: 3, now: NOW, supabase });

  const persisted = supabase.log.rpc[0][1].p_selections.find((s) => s.fixture_id === 11);
  assert.deepEqual(persisted, {
    fixture_id: 11,
    league_id: 39,
    kickoff_at: KICKOFF,
    market: "ou",
    selection: "Over 2.5",
    side: "over",
    line: 2.5,
    odds: 2.05,
    confidence: 80,
    value_score: 64.25,
    fixture_label: "Home 11 – Away 11",
    league_name: "League 39",
    probability: 0.72
  });
});

test("the ticket's model version comes from the payloads that produced it", async () => {
  const rows = populatedRows(3).map((row) => ({ ...row, model_version: "v3.7-canary" }));
  const supabase = fakeSupabase({ tables: { predictions_history: rows } });
  await generateGlobalTicket({ betDate: BET_DATE, variant: 3, now: NOW, supabase });

  assert.equal(supabase.log.rpc[0][1].p_model_version, "v3.7-canary");
});

// ── §12 parity with the canonical projection ───────────────────────────────

test("the projected pool produces the same candidates as the raw payloads", async () => {
  // A deliberately mixed population: passing markets, a sub-floor odd, an
  // unknown identity, non-recommendable markets, and a fixture with none.
  const documents = [
    rawPayload(1, 39, [
      goodMarket({ probability: 0.9 }),
      goodMarket({ probability: 0.88, odds: 1.1, type: "Over 1.5", line: 1.5 }),
      goodMarket({ recommendable: false, probability: 0.95 })
    ]),
    rawPayload(2, 140, [
      goodMarket({ probability: 0.82 }),
      goodMarket({ probability: 0.8, betType: "unknown", type: "Under 3.5", line: 3.5 })
    ]),
    rawPayload(3, 78, [goodMarket({ recommendable: false })]),
    rawPayload(4, 39, [goodMarket({ probability: 0.5 })])
  ];
  const leagueNames = [39, 140, 78, 39];

  const canonicalRows = documents.map((doc, i) => ({
    ...doc,
    league: `League ${leagueNames[i]}`,
    modelVersion: "v3.1"
  }));
  const projectedRows = documents.map((doc, i) => ({
    fixture_id: doc.id,
    league_id: doc.leagueId,
    kickoff_at: KICKOFF,
    league_name: `League ${leagueNames[i]}`,
    model_version: "v3.1",
    ticket_candidates: buildTicketCandidates(doc)
  }));

  const supabase = fakeSupabase({ tables: { predictions_history: projectedRows } });
  const { rows, leagueIds } = await loadGlobalCandidatePayloads(supabase, NOW);

  const fromRaw = collectGlobalCandidates({ rows: canonicalRows, leagueIds, now: NOW });
  const fromProjection = collectGlobalCandidates({ rows, leagueIds, now: NOW });

  // The candidates themselves are identical — that is the property the whole
  // column exists to preserve.
  assert.deepEqual(fromProjection.candidates, fromRaw.candidates);
  assert.ok(fromRaw.candidates.length > 0, "the oracle must actually produce candidates");

  /*
    The COUNTERS differ, by exactly the population the projection discarded at
    write time, and by nothing else. This is the known and documented cost of
    moving the `recommendable` gate to write time (migration 069): a market that
    was never stored cannot be counted at read time.

    Asserted rather than waived, because "the counters moved a bit" and "a gate
    started rejecting different markets" look identical from the outside.
  */
  assert.equal(fromRaw.examined - fromProjection.examined, fromRaw.rejected.notRecommendable);
  assert.equal(fromProjection.rejected.notRecommendable, 0);
  for (const [reason, count] of Object.entries(fromRaw.rejected)) {
    if (reason === "notRecommendable") continue;
    assert.equal(fromProjection.rejected[reason], count, `rejected.${reason} must not move`);
  }
});

test("a fixture whose markets were all discarded contributes nothing, from either source", async () => {
  const doc = rawPayload(5, 39, [goodMarket({ recommendable: false })]);
  // buildTicketCandidates keeps the fixture (it had markets) with an empty list.
  const projection = buildTicketCandidates(doc);
  assert.deepEqual(projection.markets, []);
  assert.equal(projection.examined, 1);
  assert.equal(projection.notRecommendable, 1);

  const supabase = fakeSupabase({
    tables: {
      predictions_history: [
        {
          fixture_id: 5,
          league_id: 39,
          kickoff_at: KICKOFF,
          league_name: "League 39",
          model_version: "v3.1",
          ticket_candidates: projection
        }
      ]
    }
  });
  const { rows, leagueIds } = await loadGlobalCandidatePayloads(supabase, NOW);
  const collected = collectGlobalCandidates({ rows, leagueIds, now: NOW });
  assert.deepEqual(collected.candidates, []);
});

// ── §14 backfill awareness ─────────────────────────────────────────────────

test("the result distinguishes what was scanned from what was usable", async () => {
  // 3 populated, 1 whose projection is unusable: the caller can tell that the
  // pool is small because of coverage, not because the day is thin.
  const rows = [...populatedRows(3), { ...historyRow(50, 39, [goodMarket()]), ticket_candidates: null }];
  const supabase = fakeSupabase({ tables: { predictions_history: rows } });
  const result = await generateGlobalTicket({ betDate: BET_DATE, variant: 3, now: NOW, supabase });

  assert.equal(result.fixturesScanned, 4);
  assert.equal(result.fixturesConsidered, 3);
  assert.equal(result.available, true);
});

test("an invalid date or variant is refused before any query", async () => {
  const supabase = fakeSupabase({ tables: { predictions_history: populatedRows(8) } });

  await assert.rejects(
    generateGlobalTicket({ betDate: "not-a-date", variant: 3, now: NOW, supabase }),
    /invalid_bet_date/
  );
  await assert.rejects(
    generateGlobalTicket({ betDate: BET_DATE, variant: 4, now: NOW, supabase }),
    /invalid_variant/
  );
  assert.deepEqual(supabase.log.from, []);
});
