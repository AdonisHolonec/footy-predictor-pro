import assert from "node:assert/strict";
import { test } from "node:test";
import { createGlobalSpecialBet, createGlobalSystemBets } from "../server-utils/globalSpecialBets.js";
import { SYSTEM_K_VALUES, systemTicketProbability } from "../server-utils/globalSpecialBetEngine.js";

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

/**
 * TABLE-AWARE. The creation path now also reads `special_bets` /
 * `special_bet_selections` to learn which fixtures this user's other tickets of
 * the same day already used (cross-ticket diversification). These cases have no
 * stored tickets, so those tables answer empty and the exclusion set is empty —
 * which is what makes the RPC payloads below the same as they always were.
 *
 * A table-blind stub would hand the history rows back for every query and the
 * reader would then treat every fixture as already used.
 */
function fakeSupabase({ historyRows = [], rpcResult = null, storedBets = [], storedSelections = [] } = {}) {
  const calls = { rpc: [] };
  const query = (table) => {
    const rowsFor = () => {
      if (table === "special_bets") return storedBets;
      if (table === "special_bet_selections") return storedSelections;
      return historyRows;
    };
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      not: () => chain,
      in: () => chain,
      gt: () => chain,
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve) => resolve({ data: rowsFor(), error: null })
    };
    return chain;
  };
  return {
    calls,
    from: (table) => query(table),
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

/**
 * One invocation, one k, one ticket.
 *
 * `systemK` has NO default here on purpose. An earlier draft defaulted it to 3,
 * which silently turned `systemOf(supabase, undefined)` into a valid request and
 * hid the very case [I4] exists to check. There is no product default k, so the
 * helper must not invent one either: every call names its k.
 */
const systemOf = (supabase, systemK) =>
  createGlobalSystemBets({ userId: USER, betDate: BET_DATE, leagueIds: [39], systemK, now: NOW, supabase });

const build = (count, rpcResult = created, systemK = 3) =>
  systemOf(fakeSupabase({ historyRows: history(count), rpcResult }), systemK);

/**
 * The same pool built once per k — three DELIBERATE, SEPARATE invocations.
 *
 * This replaced the single call that used to return three tickets. A test that
 * wants to compare the three shapes now has to ask for each one, which is the
 * point: nothing produces more than one ticket by itself.
 */
async function eachK(count = 6, rpcResult = created) {
  const out = {};
  for (const k of SYSTEM_K_VALUES) {
    const supabase = fakeSupabase({ historyRows: history(count), rpcResult });
    const result = await systemOf(supabase, k);
    out[k] = { supabase, result, params: supabase.calls.rpc[0]?.params ?? null };
  }
  return out;
}

// ── A. Generation from the shared pool ────────────────────────────────────

test("[A1] System reads the same candidate pool as Combo and takes exactly five", async () => {
  const supabase = fakeSupabase({ historyRows: history(6), rpcResult: created });
  const out = await systemOf(supabase, 3);

  assert.equal(out.available, true);
  assert.equal(out.engineSelections.length, 5, "six candidates, five selected");
  // Was 3, "one row per k, from one build". That WAS the defect: one five-leg
  // opinion became three stored tickets and three stakes.
  assert.equal(supabase.calls.rpc.length, 1, "one invocation writes exactly one ticket");
  assert.equal(supabase.calls.rpc[0].params.p_selections.length, 5);
});

test("[A2] fewer than five safe candidates writes nothing and says why", async () => {
  const supabase = fakeSupabase({ historyRows: history(4), rpcResult: created });
  const out = await systemOf(supabase, 3);

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
  const out = await systemOf(supabase, 3);

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
  const out = await systemOf(fakeSupabase({ historyRows: rows, rpcResult: created }), 3);

  const ids = out.engineSelections.map((s) => s.fixtureId);
  assert.equal(new Set(ids).size, 5, "no fixture appears twice");
});

// ── B/D. What the RPC is asked to store ───────────────────────────────────

test("[B1][D1] the requested k is persisted as variant 5, kind system", async () => {
  // Each k is asked for on its own. Previously one call produced all three.
  const all = await eachK();

  for (const k of SYSTEM_K_VALUES) {
    const { supabase, params } = all[k];
    assert.equal(supabase.calls.rpc.length, 1, `k=${k} wrote one row`);
    assert.equal(supabase.calls.rpc[0].name, "create_global_special_bet");
    assert.equal(params.p_system_k, k, "the k stored is the k requested");
    assert.equal(params.p_bet_kind, "system");
    assert.equal(params.p_variant, 5);
    assert.equal(params.p_selections.length, 5);
    assert.equal(params.p_user_id, USER);
    assert.equal(params.p_bet_date, BET_DATE);
    assert.equal(params.p_model_version, "predictor-v3.1-test");
  }
});

test("[D2] the five legs are the same whichever k is asked for", async () => {
  // The pool does not depend on k — only how many of it must win does. Three
  // separate invocations, not one call returning three tickets.
  const all = await eachK();

  assert.deepEqual(all[3].params.p_selections, all[4].params.p_selections);
  assert.deepEqual(all[4].params.p_selections, all[5].params.p_selections);
  assert.notEqual(all[3].params.p_selections, all[4].params.p_selections, "separate arrays");
});

test("[D3] total_odds is the product of the five odds", async () => {
  const all = await eachK();

  // 1.8^5 = 18.89568, rounded to the column's three decimals. Same for every k:
  // it describes the legs, not the payout.
  for (const k of SYSTEM_K_VALUES) {
    assert.equal(all[k].params.p_total_odds, 18.896);
    assert.ok(all[k].params.p_total_odds > 1, "the schema requires it");
  }
});

// ── C. The probability is the Poisson-binomial tail ───────────────────────

test("[C1] ticket_probability is P(X >= k): the mandated values for five legs at 0.70", async () => {
  const all = await eachK();

  assert.equal(all[3].params.p_ticket_probability, 0.8369);
  assert.equal(all[4].params.p_ticket_probability, 0.5282);
  assert.equal(all[5].params.p_ticket_probability, 0.1681);
});

test("[C2] it is never the product, except where the product is the right answer", async () => {
  const all = await eachK();
  const product = Number((0.7 ** 5).toFixed(4));

  assert.equal(all[5].params.p_ticket_probability, product, "k = n IS the product");
  assert.notEqual(all[3].params.p_ticket_probability, product, "a 3/5 is far likelier than all five landing");
  assert.notEqual(all[4].params.p_ticket_probability, product);
});

test("[C3] the tail is monotone: P(X>=3) >= P(X>=4) >= P(X>=5)", async () => {
  const all = await eachK();

  const p3 = all[3].params.p_ticket_probability;
  const p4 = all[4].params.p_ticket_probability;
  const p5 = all[5].params.p_ticket_probability;
  assert.ok(p3 > p4 && p4 > p5, `${p3} > ${p4} > ${p5}`);
});

test("[C4] the persisted value comes from the single implementation, not a second one", async () => {
  const all = await eachK();

  for (const k of SYSTEM_K_VALUES) {
    const probabilities = all[k].result.engineSelections.map((s) => s.probability);
    const expected = Number(systemTicketProbability(probabilities, k).toFixed(4));
    assert.equal(all[k].params.p_ticket_probability, expected, `k=${k}`);
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

  assert.equal(out.created, false, "the row already existed");
  assert.equal(out.ticketProbability, 0.5, "the stored figure wins over a fresh computation");
});

test("[E2] a fresh creation reports the engine's own figure", async () => {
  const out = await build(6, created, 3);
  assert.equal(out.created, true);
  assert.equal(out.systemK, 3);
  assert.equal(out.ticketProbability, 0.8369);
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

  const all = await eachK();

  const combo = comboSupabase.calls.rpc[0].params;
  const system = SYSTEM_K_VALUES.map((k) => all[k].params);

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
  const all = await eachK();

  for (const k of SYSTEM_K_VALUES) {
    assert.deepEqual(Object.keys(all[k].params).sort(), [
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
  const thin = (params) => ({
    ok: true,
    created: true,
    bet: { id: `bet-${params.p_system_k}` },
    selections: []
  });

  const combinationsByK = {};
  for (const k of SYSTEM_K_VALUES) {
    const out = await build(6, thin, k);
    assert.equal(out.bet.id, `bet-${k}`);
    assert.equal(out.systemK, k);
    assert.deepEqual(out.selections, [], "an empty echo is not an empty ticket");
    assert.equal(out.engineSelections.length, 5, "the engine's legs survive a thin echo");
    combinationsByK[k] = out.combinationCount;
  }
  assert.deepEqual(combinationsByK, { 3: 10, 4: 5, 5: 1 });
});

test("[H3] an RPC refusal is surfaced, never swallowed", async () => {
  await assert.rejects(
    () => build(6, { ok: false, error: "system_not_enabled" }),
    /system_not_enabled/,
    "the database guard must reach the caller intact"
  );
});

// ── I. Cardinality — the permanent contract ───────────────────────────────
//
// A System is ONE ticket of five selections with ONE k. 3/5, 4/5 and 5/5 are
// three shapes the ticket can take, not three tickets a punter placed. The
// generator used to build all three from a single pool, so one opinion became
// three stored rows and three stakes. These tests exist so it cannot come back.

test("[I1] one selected system k produces exactly one ticket", async () => {
  for (const k of SYSTEM_K_VALUES) {
    const supabase = fakeSupabase({ historyRows: history(6), rpcResult: created });
    const out = await systemOf(supabase, k);

    assert.equal(supabase.calls.rpc.length, 1, `k=${k}: exactly one RPC`);
    assert.equal(supabase.calls.rpc[0].params.p_system_k, k, "the k stored is the k requested");
    assert.equal(supabase.calls.rpc[0].params.p_selections.length, 5);
    assert.equal(out.systemK, k);
    assert.equal(out.created, true);
  }
});

test("[I2] the generator does not create 3/5, 4/5 and 5/5 together", async () => {
  const supabase = fakeSupabase({ historyRows: history(6), rpcResult: created });
  await systemOf(supabase, 3);

  const ks = supabase.calls.rpc.map(({ params }) => params.p_system_k);
  assert.deepEqual(ks, [3], "asking for a 3/5 must not also write a 4/5 or a 5/5");
  assert.ok(!ks.includes(4), "no 4/5 appeared on its own");
  assert.ok(!ks.includes(5), "no 5/5 appeared on its own");
});

test("[I3] a second shape exists only when it is asked for separately", async () => {
  // Same five legs, two deliberate invocations: two tickets, because a caller
  // asked twice — not because one call decided to write both.
  const first = fakeSupabase({ historyRows: history(6), rpcResult: created });
  const second = fakeSupabase({ historyRows: history(6), rpcResult: created });

  const a = await systemOf(first, 3);
  const b = await systemOf(second, 4);

  assert.equal(first.calls.rpc.length, 1);
  assert.equal(second.calls.rpc.length, 1);
  assert.equal(a.systemK, 3);
  assert.equal(b.systemK, 4);
  assert.deepEqual(
    first.calls.rpc[0].params.p_selections,
    second.calls.rpc[0].params.p_selections,
    "the same pool, so the same five legs"
  );
});

test("[I4] a k outside the product is refused before anything is written", async () => {
  // Number(null) is 0 and Number("3") is 3: both would slip past a coercing
  // check, and both must be refused. 2 and 6 are integers the product does not
  // sell; 3.5 is not a shape at all.
  for (const badK of [null, undefined, 0, 2, 6, 3.5, "3", NaN, -1]) {
    const supabase = fakeSupabase({ historyRows: history(6), rpcResult: created });
    const out = await systemOf(supabase, badK);

    assert.equal(supabase.calls.rpc.length, 0, `k=${String(badK)} reached the database`);
    assert.equal(out.available, false);
    assert.equal(out.created, false);
    assert.equal(out.unavailable[0].betKind, "system");
    assert.ok(
      ["invalid_k", "unsupported_k"].includes(out.unavailable[0].reason),
      `k=${String(badK)} gave reason ${out.unavailable[0].reason}`
    );
    assert.deepEqual(out.unavailable[0].supportedK, [...SYSTEM_K_VALUES]);
  }
});

test("[I5] a valid k with too thin a pool still writes nothing", async () => {
  // The two refusals stay distinguishable: a bad k is not a thin pool.
  const supabase = fakeSupabase({ historyRows: history(4), rpcResult: created });
  const out = await systemOf(supabase, 4);

  assert.equal(supabase.calls.rpc.length, 0);
  assert.equal(out.unavailable[0].reason, "insufficient_system_candidates");
});
