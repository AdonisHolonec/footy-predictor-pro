import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalizeLeagueScope,
  createGlobalSpecialBet,
  isValidBetDate,
  isValidVariant,
  listGlobalSpecialBets,
  loadCandidatePayloads,
  resolveModelVersion,
  toSelectionRows,
  unavailableResponse
} from "../server-utils/globalSpecialBets.js";

/**
 * Global Special Bet — persistence layer.
 *
 * Covers everything provable without a database: canonical scope, validation,
 * the exact snapshot handed to the RPC, and the orchestration rules (nothing is
 * written when a variant cannot be built; GET never runs the engine).
 *
 * The database-enforced guarantees — the identity unique index, RLS, the
 * ON CONFLICT concurrency path and the single-transaction atomicity of
 * create_global_special_bet() — live in 043_global_special_bets.sql and cannot
 * execute here; there is no Postgres in this suite.
 */

const BET_DATE = "2026-08-09";
const KICKOFF = "2026-08-09T18:00:00.000Z";
const NOW = Date.parse("2026-08-09T10:00:00.000Z");
const USER = "11111111-1111-1111-1111-111111111111";

function payload(id, leagueId, overrides = {}) {
  return {
    id,
    leagueId,
    kickoff: KICKOFF,
    modelVersion: "predictor-v3.1-test",
    teams: { home: `H${id}`, away: `A${id}` },
    recommended: { pick: "Over 2.5", family: "Goals", confidence: 80 },
    modelMeta: { dataQuality: 0.8 },
    valueEngine: {
      markets: [
        { type: "Over 2.5", family: "Goals", line: 2.5, odds: 1.8, valueScore: 70 - id, recommendable: true }
      ]
    },
    ...overrides
  };
}

/** Minimal Supabase stand-in: records every call so tests can assert on them. */
function fakeSupabase({ historyRows = [], rpcResult = null, bets = [], selections = [] } = {}) {
  const calls = { rpc: [], from: [], filters: [] };

  const historyQuery = () => {
    const chain = {
      select: () => chain,
      in: (col, val) => {
        calls.filters.push({ col, val });
        return chain;
      },
      gte: (col, val) => {
        calls.filters.push({ col, val });
        return chain;
      },
      lte: (col, val) => {
        calls.filters.push({ col, val });
        return chain;
      },
      then: (resolve) => resolve({ data: historyRows, error: null })
    };
    return chain;
  };

  const rowsQuery = (rows) => {
    const chain = {
      select: () => chain,
      eq: (col, val) => {
        calls.filters.push({ col, val });
        return chain;
      },
      in: (col, val) => {
        calls.filters.push({ col, val });
        return chain;
      },
      order: () => chain,
      range: () => chain,
      then: (resolve) => resolve({ data: rows, error: null })
    };
    return chain;
  };

  return {
    calls,
    from(table) {
      calls.from.push(table);
      if (table === "predictions_history") return historyQuery();
      if (table === "special_bets") return rowsQuery(bets);
      return rowsQuery(selections);
    },
    async rpc(name, params) {
      calls.rpc.push({ name, params });
      return { data: rpcResult, error: null };
    }
  };
}

// ── canonical league scope ────────────────────────────────────────────────

test("league scope is deduped and numerically sorted", () => {
  assert.deepEqual(canonicalizeLeagueScope([140, 39, 135]).leagueIds, [39, 135, 140]);
  assert.equal(canonicalizeLeagueScope([140, 39, 135]).scope, "39,135,140");
});

test("different input orders produce the same canonical scope", () => {
  const a = canonicalizeLeagueScope([39, 140, 135]);
  const b = canonicalizeLeagueScope([135, 39, 140]);
  assert.equal(a.scope, b.scope);
  assert.deepEqual(a.leagueIds, b.leagueIds);
});

test("duplicate league ids collapse to one", () => {
  assert.deepEqual(canonicalizeLeagueScope([39, 39, 140, 39]).leagueIds, [39, 140]);
  assert.equal(canonicalizeLeagueScope([39, 39, 140, 39]).scope, "39,140");
});

test("numeric sorting is not lexicographic", () => {
  // "9" would sort after "135" as text; the scope must stay numeric.
  assert.equal(canonicalizeLeagueScope([135, 9, 39]).scope, "9,39,135");
});

test("invalid league ids are dropped, not coerced", () => {
  assert.deepEqual(canonicalizeLeagueScope([39, null, "abc", 0, -5, 2.5]).leagueIds, [39]);
  assert.deepEqual(canonicalizeLeagueScope(undefined).leagueIds, []);
});

// ── validation ────────────────────────────────────────────────────────────

test("only 3, 5 and 8 are valid variants", () => {
  for (const v of [3, 5, 8, "3", "8"]) assert.equal(isValidVariant(v), true);
  for (const v of [1, 2, 4, 6, 7, 9, 0, -3, null, undefined, "abc"]) assert.equal(isValidVariant(v), false);
});

test("bet dates must be real calendar days", () => {
  assert.equal(isValidBetDate("2026-08-09"), true);
  for (const d of ["2026-8-9", "09-08-2026", "2026-02-30", "", null, "not-a-date"]) {
    assert.equal(isValidBetDate(d), false);
  }
});

// ── snapshot mapping ──────────────────────────────────────────────────────

test("selection rows carry odds, confidence and value score unchanged", () => {
  const selections = [
    {
      fixtureId: 7,
      leagueId: 39,
      kickoff: KICKOFF,
      market: "ou",
      selection: "Over 2.5",
      side: "over",
      line: 2.5,
      odds: 1.837,
      confidence: 72.5,
      valueScore: 63.25
    }
  ];

  assert.deepEqual(toSelectionRows(selections), [
    {
      fixture_id: 7,
      league_id: 39,
      kickoff_at: KICKOFF,
      market: "ou",
      selection: "Over 2.5",
      side: "over",
      line: 2.5,
      odds: 1.837,
      confidence: 72.5,
      value_score: 63.25
    }
  ]);
});

test("an unlined selection keeps null side and line rather than inventing them", () => {
  const [row] = toSelectionRows([
    {
      fixtureId: 1,
      leagueId: 39,
      kickoff: KICKOFF,
      market: "1x2",
      selection: "1",
      side: null,
      line: null,
      odds: 2.1,
      confidence: 60
    }
  ]);
  assert.equal(row.side, null);
  assert.equal(row.line, null);
  assert.equal(row.value_score, null);
});

test("model version comes from the payload, never a constant", () => {
  const payloads = new Map([[7, { modelVersion: "predictor-v3.1-abc" }]]);
  assert.equal(resolveModelVersion(payloads, [{ fixtureId: 7 }]), "predictor-v3.1-abc");
  assert.equal(resolveModelVersion(new Map(), [{ fixtureId: 7 }]), null);
});

test("the unavailable response states variant, requirement and what was available", () => {
  assert.deepEqual(unavailableResponse(8, 6), {
    available: false,
    variant: 8,
    required: 8,
    availableCandidates: 6
  });
});

// ── loading the canonical payloads ────────────────────────────────────────

test("payloads are read from raw_payload and keyed by the queried columns", async () => {
  const supabase = fakeSupabase({
    historyRows: [
      { fixture_id: 7, league_id: 39, kickoff_at: KICKOFF, raw_payload: { recommended: { confidence: 80 } } },
      { fixture_id: 8, league_id: 39, kickoff_at: KICKOFF, raw_payload: null }
    ]
  });

  const { rows, payloadsByFixtureId } = await loadCandidatePayloads(supabase, BET_DATE, [39]);

  assert.equal(rows.length, 1, "a row without a payload contributes nothing");
  assert.equal(rows[0].id, 7);
  assert.equal(rows[0].leagueId, 39);
  assert.equal(rows[0].kickoff, KICKOFF);
  assert.equal(payloadsByFixtureId.get(7).recommended.confidence, 80);
  assert.deepEqual(supabase.calls.from, ["predictions_history"]);
});

// ── generation ────────────────────────────────────────────────────────────

test("a buildable variant is persisted through the RPC with the engine's own numbers", async () => {
  const historyRows = [1, 2, 3].map((id) => ({
    fixture_id: id,
    league_id: 39,
    kickoff_at: KICKOFF,
    raw_payload: payload(id, 39)
  }));
  const supabase = fakeSupabase({
    historyRows,
    rpcResult: { ok: true, created: true, bet: { id: "bet-1", variant: 3 }, selections: [] }
  });

  const result = await createGlobalSpecialBet({
    userId: USER,
    betDate: BET_DATE,
    variant: 3,
    leagueIds: [39, 39],
    now: NOW,
    supabase
  });

  assert.equal(result.created, true);
  assert.equal(result.available, true);
  assert.equal(supabase.calls.rpc.length, 1);

  const { name, params } = supabase.calls.rpc[0];
  assert.equal(name, "create_global_special_bet");
  assert.equal(params.p_user_id, USER);
  assert.equal(params.p_variant, 3);
  assert.deepEqual(params.p_league_ids, [39], "leagues reach the RPC canonicalised");
  assert.equal(params.p_selections.length, 3);
  assert.equal(params.p_model_version, "predictor-v3.1-test");
  // The snapshot is the engine's output, not anything a caller supplied.
  assert.ok(params.p_total_odds > 1);
  assert.equal(params.p_average_confidence, 80);
  for (const s of params.p_selections) {
    assert.equal(s.odds, 1.8);
    assert.equal(s.confidence, 80);
    assert.equal(s.market, "ou");
  }
});

test("an unbuildable variant writes nothing and says why", async () => {
  const historyRows = [1, 2].map((id) => ({
    fixture_id: id,
    league_id: 39,
    kickoff_at: KICKOFF,
    raw_payload: payload(id, 39)
  }));
  const supabase = fakeSupabase({ historyRows });

  const result = await createGlobalSpecialBet({
    userId: USER,
    betDate: BET_DATE,
    variant: 8,
    leagueIds: [39],
    now: NOW,
    supabase
  });

  assert.deepEqual(result, {
    ok: true,
    created: false,
    available: false,
    variant: 8,
    required: 8,
    availableCandidates: 2
  });
  assert.equal(supabase.calls.rpc.length, 0, "nothing may be written for an unbuildable variant");
});

test("a repeat request returns the existing bet instead of creating a second one", async () => {
  const historyRows = [1, 2, 3].map((id) => ({
    fixture_id: id,
    league_id: 39,
    kickoff_at: KICKOFF,
    raw_payload: payload(id, 39)
  }));
  // What the RPC returns when ON CONFLICT DO NOTHING found the row already there.
  const supabase = fakeSupabase({
    historyRows,
    rpcResult: { ok: true, created: false, bet: { id: "bet-1" }, selections: [{ fixture_id: 1 }] }
  });

  const result = await createGlobalSpecialBet({
    userId: USER,
    betDate: BET_DATE,
    variant: 3,
    leagueIds: [39],
    now: NOW,
    supabase
  });

  assert.equal(result.created, false);
  assert.equal(result.bet.id, "bet-1");
});

test("league order and duplicates cannot produce two different identities", async () => {
  const historyRows = [1, 2, 3].map((id) => ({
    fixture_id: id,
    league_id: id === 3 ? 140 : 39,
    kickoff_at: KICKOFF,
    raw_payload: payload(id, id === 3 ? 140 : 39)
  }));

  const run = async (leagueIds) => {
    const supabase = fakeSupabase({
      historyRows,
      rpcResult: { ok: true, created: true, bet: { id: "bet-1" }, selections: [] }
    });
    await createGlobalSpecialBet({ userId: USER, betDate: BET_DATE, variant: 3, leagueIds, now: NOW, supabase });
    return supabase.calls.rpc[0].params.p_league_ids;
  };

  assert.deepEqual(await run([140, 39]), await run([39, 140, 39]));
});

test("an RPC that reports failure is surfaced, not silently swallowed", async () => {
  const historyRows = [1, 2, 3].map((id) => ({
    fixture_id: id,
    league_id: 39,
    kickoff_at: KICKOFF,
    raw_payload: payload(id, 39)
  }));
  const supabase = fakeSupabase({ historyRows, rpcResult: { ok: false, error: "selection_count_mismatch" } });

  await assert.rejects(
    () =>
      createGlobalSpecialBet({
        userId: USER,
        betDate: BET_DATE,
        variant: 3,
        leagueIds: [39],
        now: NOW,
        supabase
      }),
    /selection_count_mismatch/
  );
});

// ── reading ───────────────────────────────────────────────────────────────

test("listing reads the snapshot and never touches predictions or the engine", async () => {
  const supabase = fakeSupabase({
    bets: [{ id: "bet-1", user_id: USER, variant: 3 }],
    selections: [
      { special_bet_id: "bet-1", fixture_id: 1, odds: 1.8 },
      { special_bet_id: "bet-1", fixture_id: 2, odds: 2.1 }
    ]
  });

  const { bets } = await listGlobalSpecialBets({ userId: USER, supabase });

  assert.equal(bets.length, 1);
  assert.equal(bets[0].selections.length, 2);
  assert.equal(bets[0].selections[0].odds, 1.8, "stored odds are returned verbatim");
  assert.ok(
    !supabase.calls.from.includes("predictions_history"),
    "GET must not read predictions — that would be recomputation"
  );
  assert.deepEqual(supabase.calls.from, ["special_bets", "special_bet_selections"]);
});

test("listing is always scoped to the calling user", async () => {
  const supabase = fakeSupabase({ bets: [{ id: "bet-1", user_id: USER }], selections: [] });
  await listGlobalSpecialBets({ userId: USER, supabase });

  assert.ok(
    supabase.calls.filters.some((f) => f.col === "user_id" && f.val === USER),
    "the query must filter by the session's user id"
  );
});

test("no stored bets yields an empty list rather than an error", async () => {
  const supabase = fakeSupabase({ bets: [] });
  assert.deepEqual(await listGlobalSpecialBets({ userId: USER, supabase }), { bets: [] });
});
