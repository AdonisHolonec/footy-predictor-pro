import assert from "node:assert/strict";
import { test } from "node:test";
import { createGlobalSpecialBet, createGlobalSystemBets } from "../server-utils/globalSpecialBets.js";
import { systemTicketProbability } from "../server-utils/globalSpecialBetEngine.js";

/**
 * System creation and persistence — the arguments that reach the RPC.
 *
 * No database is involved: createGlobalSystemBets takes its Supabase client as a
 * parameter, so the suite hands it a fake that records every call. What is
 * asserted here is the contract the RPC is asked to store — kind, k, variant,
 * five legs, the product of the odds, and P(X >= k) rather than Πp — and that a
 * shape outside the product never gets that far.
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
        {
          type: "Over 2.5",
          family: "Goals",
          line: 2.5,
          odds: 1.8,
          probability: 0.7,
          valueScore: 70 - id,
          recommendable: true,
          tradable: true,
          betType: "over_under",
          period: "full_match",
          scope: "match"
        }
      ]
    },
    ...overrides
  };
}

function fakeSupabase({ historyRows = [], rpcResult = null } = {}) {
  const calls = { rpc: [] };
  const historyQuery = () => {
    const chain = {
      select: () => chain,
      in: () => chain,
      gt: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve) => resolve({ data: historyRows, error: null })
    };
    return chain;
  };
  return {
    calls,
    from: () => historyQuery(),
    async rpc(name, params) {
      calls.rpc.push({ name, params });
      return { data: typeof rpcResult === "function" ? rpcResult(params) : rpcResult, error: null };
    }
  };
}

/** `count` fixtures in one league, all identical apart from their id. */
const history = (count, leagueId = 39) =>
  Array.from({ length: count }, (_, i) => ({
    fixture_id: i + 1,
    league_id: leagueId,
    kickoff_at: KICKOFF,
    raw_payload: payload(i + 1, leagueId)
  }));

const created = (params) => ({
  ok: true,
  created: true,
  bet: {
    id: `bet-${params.p_system_k}`,
    variant: params.p_variant,
    bet_kind: params.p_bet_kind,
    system_k: params.p_system_k
  },
  selections: []
});

const systemOf = (supabase) =>
  createGlobalSystemBets({ userId: USER, betDate: BET_DATE, leagueIds: [39], now: NOW, supabase });

const build = (count, rpcResult = created) =>
  systemOf(fakeSupabase({ historyRows: history(count), rpcResult }));

// ── A. Generation from the shared pool ────────────────────────────────────

test("[A1] System reads the same candidate pool as Combo and takes exactly five", async () => {
  const supabase = fakeSupabase({ historyRows: history(6), rpcResult: created });
  const out = await systemOf(supabase);

  assert.equal(out.available, true);
  assert.equal(out.selections.length, 5, "six candidates, five selected");
  assert.equal(supabase.calls.rpc.length, 3, "one row per k, from one build");
  for (const { params } of supabase.calls.rpc) assert.equal(params.p_selections.length, 5);
});

test("[A2] fewer than five safe candidates writes nothing and says why", async () => {
  const supabase = fakeSupabase({ historyRows: history(4), rpcResult: created });
  const out = await systemOf(supabase);

  assert.equal(out.available, false);
  assert.equal(out.created, false);
  assert.equal(supabase.calls.rpc.length, 0, "nothing reaches the RPC");
  assert.equal(out.unavailable[0].reason, "insufficient_system_candidates");
  assert.equal(out.unavailable[0].available, 4);
  assert.equal(out.unavailable[0].required, 5);
  assert.equal(out.unavailable[0].betKind, "system");
});

test("[A3] a candidate failing a gate is not padded back in", async () => {
  // Five fixtures, one of them priced below the odds floor: four survive.
  const rows = history(5);
  rows[4].raw_payload.valueEngine.markets[0].odds = 1.1;
  const supabase = fakeSupabase({ historyRows: rows, rpcResult: created });
  const out = await systemOf(supabase);

  assert.equal(out.available, false);
  assert.equal(out.rejected.oddBelowMinimum, 1, "the existing gate name is untouched");
  assert.equal(supabase.calls.rpc.length, 0);
});

test("[A4] one selection per fixture: two markets on one match cannot both be taken", async () => {
  const rows = history(6);
  rows[0].raw_payload.valueEngine.markets.push({
    type: "Under 3.5",
    family: "Goals",
    line: 3.5,
    odds: 1.9,
    probability: 0.68,
    valueScore: 60,
    recommendable: true,
    tradable: true,
    betType: "over_under",
    period: "full_match",
    scope: "match"
  });
  const out = await systemOf(fakeSupabase({ historyRows: rows, rpcResult: created }));

  const ids = out.selections.map((s) => s.fixtureId);
  assert.equal(new Set(ids).size, 5, "no fixture appears twice");
});

// ── B/D. What the RPC is asked to store ───────────────────────────────────

test("[B1][D1] all three tickets are persisted as variant 5, kind system, k 3/4/5", async () => {
  const supabase = fakeSupabase({ historyRows: history(6), rpcResult: created });
  await systemOf(supabase);

  assert.deepEqual(
    supabase.calls.rpc.map(({ params }) => params.p_system_k),
    [3, 4, 5]
  );
  for (const { name, params } of supabase.calls.rpc) {
    assert.equal(name, "create_global_special_bet");
    assert.equal(params.p_bet_kind, "system");
    assert.equal(params.p_variant, 5);
    assert.equal(params.p_selections.length, 5);
    assert.equal(params.p_user_id, USER);
    assert.equal(params.p_bet_date, BET_DATE);
    assert.equal(params.p_model_version, "predictor-v3.1-test");
  }
});

test("[D2] the five legs are identical across the three tickets", async () => {
  const supabase = fakeSupabase({ historyRows: history(6), rpcResult: created });
  await systemOf(supabase);

  const [three, four, five] = supabase.calls.rpc.map(({ params }) => params.p_selections);
  assert.deepEqual(three, four);
  assert.deepEqual(four, five);
  assert.notEqual(three, four, "same content, separate arrays");
});

test("[D3] total_odds is the product of the five odds", async () => {
  const supabase = fakeSupabase({ historyRows: history(6), rpcResult: created });
  await systemOf(supabase);

  // 1.8^5 = 18.89568, rounded to the column's three decimals.
  for (const { params } of supabase.calls.rpc) {
    assert.equal(params.p_total_odds, 18.896);
    assert.ok(params.p_total_odds > 1, "the schema requires it");
  }
});

// ── C. The probability is the Poisson-binomial tail ───────────────────────

test("[C1] ticket_probability is P(X >= k): the mandated values for five legs at 0.70", async () => {
  const supabase = fakeSupabase({ historyRows: history(6), rpcResult: created });
  await systemOf(supabase);

  const byK = Object.fromEntries(
    supabase.calls.rpc.map(({ params }) => [params.p_system_k, params.p_ticket_probability])
  );
  assert.equal(byK[3], 0.8369);
  assert.equal(byK[4], 0.5282);
  assert.equal(byK[5], 0.1681);
});

test("[C2] it is never the product, except where the product is the right answer", async () => {
  const supabase = fakeSupabase({ historyRows: history(6), rpcResult: created });
  await systemOf(supabase);

  const byK = Object.fromEntries(
    supabase.calls.rpc.map(({ params }) => [params.p_system_k, params.p_ticket_probability])
  );
  const product = Number((0.7 ** 5).toFixed(4));

  assert.equal(byK[5], product, "k = n IS the product");
  assert.notEqual(byK[3], product, "a 3/5 is far likelier than all five landing");
  assert.notEqual(byK[4], product);
});

test("[C3] the tail is monotone: P(X>=3) >= P(X>=4) >= P(X>=5)", async () => {
  const supabase = fakeSupabase({ historyRows: history(6), rpcResult: created });
  await systemOf(supabase);

  const [p3, p4, p5] = supabase.calls.rpc.map(({ params }) => params.p_ticket_probability);
  assert.ok(p3 > p4 && p4 > p5, `${p3} > ${p4} > ${p5}`);
});

test("[C4] the persisted value comes from the single implementation, not a second one", async () => {
  const supabase = fakeSupabase({ historyRows: history(6), rpcResult: created });
  const out = await systemOf(supabase);

  const probabilities = out.selections.map((s) => s.probability);
  for (const { params } of supabase.calls.rpc) {
    const expected = Number(systemTicketProbability(probabilities, params.p_system_k).toFixed(4));
    assert.equal(params.p_ticket_probability, expected, `k=${params.p_system_k}`);
  }
});

// ── E. Idempotency ────────────────────────────────────────────────────────

test("[E1] a repeat returns the existing row and the probability stored with it", async () => {
  const out = await build(6, (params) => ({
    ok: true,
    created: false,
    bet: {
      id: `bet-${params.p_system_k}`,
      variant: 5,
      bet_kind: "system",
      system_k: params.p_system_k,
      ticket_probability: 0.5
    },
    selections: []
  }));

  for (const k of [3, 4, 5]) {
    assert.equal(out.bets[k].created, false, `k=${k} was not created again`);
    assert.equal(out.bets[k].ticketProbability, 0.5, "the stored figure wins over a fresh computation");
  }
});

test("[E2] a fresh creation reports the engine's own figure", async () => {
  const out = await build(6);
  assert.equal(out.bets[3].created, true);
  assert.equal(out.bets[3].ticketProbability, 0.8369);
});

// ── F. Coexistence with Combo ─────────────────────────────────────────────

test("[F1] Combo and System send different identities for the same user, date and scope", async () => {
  const comboSupabase = fakeSupabase({
    historyRows: history(6),
    rpcResult: { ok: true, created: true, bet: { id: "combo" }, selections: [] }
  });
  await createGlobalSpecialBet({
    userId: USER,
    betDate: BET_DATE,
    variant: 5,
    leagueIds: [39],
    now: NOW,
    supabase: comboSupabase
  });

  const systemSupabase = fakeSupabase({ historyRows: history(6), rpcResult: created });
  await systemOf(systemSupabase);

  const combo = comboSupabase.calls.rpc[0].params;
  const system = systemSupabase.calls.rpc.map(({ params }) => params);

  // Same user, date, scope and variant — four rows kept apart by kind and k,
  // which is exactly what migration 052 widened the identity index to hold.
  assert.equal(combo.p_variant, 5);
  assert.equal(combo.p_bet_kind, undefined, "the Combo call is unchanged: no kind is sent");
  assert.equal(combo.p_system_k, undefined);
  for (const params of system) {
    assert.equal(params.p_variant, 5);
    assert.equal(params.p_bet_kind, "system");
    assert.deepEqual(params.p_league_ids, combo.p_league_ids);
    assert.equal(params.p_bet_date, combo.p_bet_date);
  }
  assert.deepEqual(
    system.map((p) => p.p_system_k),
    [3, 4, 5]
  );
});

// ── G. Combo regression ───────────────────────────────────────────────────

test("[G1] the Combo payload is untouched — nine arguments, no kind, Πp", async () => {
  const supabase = fakeSupabase({
    historyRows: history(6),
    rpcResult: { ok: true, created: true, bet: { id: "combo", variant: 3 }, selections: [] }
  });
  await createGlobalSpecialBet({
    userId: USER,
    betDate: BET_DATE,
    variant: 3,
    leagueIds: [39],
    now: NOW,
    supabase
  });

  const { params } = supabase.calls.rpc[0];
  assert.deepEqual(Object.keys(params).sort(), [
    "p_average_confidence",
    "p_bet_date",
    "p_league_ids",
    "p_model_version",
    "p_selections",
    "p_ticket_probability",
    "p_total_odds",
    "p_user_id",
    "p_variant"
  ]);
  // Three legs at 0.70: Πp, which for a combo is the right answer.
  assert.equal(params.p_ticket_probability, Number((0.7 ** 3).toFixed(4)));
});

// ── H. The RPC contract ───────────────────────────────────────────────────

test("[H1] System sends the nine Combo arguments plus exactly the two from 052", async () => {
  const supabase = fakeSupabase({ historyRows: history(6), rpcResult: created });
  await systemOf(supabase);

  for (const { params } of supabase.calls.rpc) {
    assert.deepEqual(Object.keys(params).sort(), [
      "p_average_confidence",
      "p_bet_date",
      "p_bet_kind",
      "p_league_ids",
      "p_model_version",
      "p_selections",
      "p_system_k",
      "p_ticket_probability",
      "p_total_odds",
      "p_user_id",
      "p_variant"
    ]);
  }
});

test("[H2] the response envelope is consumed without assuming Combo-only fields", async () => {
  // A bet object carrying nothing but an id: the caller must still cope.
  const out = await build(6, (params) => ({
    ok: true,
    created: true,
    bet: { id: `bet-${params.p_system_k}` },
    selections: []
  }));

  for (const k of [3, 4, 5]) {
    assert.equal(out.bets[k].bet.id, `bet-${k}`);
    assert.equal(out.bets[k].systemK, k);
    assert.deepEqual(out.bets[k].selections, []);
  }
  assert.deepEqual(
    [out.bets[3].combinationCount, out.bets[4].combinationCount, out.bets[5].combinationCount],
    [10, 5, 1]
  );
});

test("[H3] an RPC refusal is surfaced, never swallowed", async () => {
  await assert.rejects(
    () => build(6, { ok: false, error: "system_not_enabled" }),
    /system_not_enabled/,
    "the database guard must reach the caller intact"
  );
});
