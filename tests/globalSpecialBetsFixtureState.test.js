import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FIXTURE_STATE_SELECT,
  fixtureStateFromRow,
  loadFixtureStates,
  settlePendingGlobalSpecialBets
} from "../server-utils/globalSpecialBets.js";
import {
  MISSING_STATS_VOID_AFTER_MS,
  settleGlobalSpecialBet,
  settleSelection
} from "../server-utils/globalSpecialBetSettlement.js";

/**
 * T3 — ticket settlement reads the promoted columns.
 *
 * Migration 057 moved the fixture totals the history sync writes into
 * `corners_total` / `shots_total` / `shots_on_target_total`; the sync stopped
 * writing `raw_payload.marketResults` (0 of 70 FT rows from 2026-08-19 on
 * carried it). `loadFixtureStates` still read the document field, so every
 * Corners / Shots / SOT leg on a new row saw no total and waited for the 48h
 * void. The shapes below are the production rows from the audit.
 */

const KICKOFF = "2026-08-20T16:00:00.000Z";
const KICKOFF_MS = Date.parse(KICKOFF);
const JUST_AFTER = KICKOFF_MS + 2 * 60 * 60 * 1000;
const AT_48H = KICKOFF_MS + MISSING_STATS_VOID_AFTER_MS;

/** Production row 1623434 (FT 4-0): promoted totals, no legacy document. */
const ROW_1623434 = {
  fixture_id: 1623434,
  match_status: "FT",
  score_home: 4,
  score_away: 0,
  corners_total: 10,
  shots_total: null,
  shots_on_target_total: 15,
  legacy_market_results: null
};
/** Production row 1570351 (FT 1-1): corners 16, SOT 6, shots 23. */
const ROW_1570351 = {
  fixture_id: 1570351,
  match_status: "FT",
  score_home: 1,
  score_away: 1,
  corners_total: 16,
  shots_total: 23,
  shots_on_target_total: 6,
  legacy_market_results: null
};
/** Production row 1623394 (FT 2-2): corners 9. */
const ROW_1623394 = {
  fixture_id: 1623394,
  match_status: "FT",
  score_home: 2,
  score_away: 2,
  corners_total: 9,
  shots_total: null,
  shots_on_target_total: null,
  legacy_market_results: null
};
/** Pre-057 row: promoted columns NULL, totals only in the legacy document. */
const ROW_LEGACY = {
  fixture_id: 1622620,
  match_status: "FT",
  score_home: 2,
  score_away: 2,
  corners_total: null,
  shots_total: null,
  shots_on_target_total: null,
  legacy_market_results: { cornersTotal: 12, shotsTotal: 29, shotsOnTargetTotal: 7, cardsTotal: 2 }
};

const leg = (overrides = {}) => ({
  id: "sel-1",
  fixture_id: 1623434,
  market: "corners",
  selection: "Over 8.5",
  side: "over",
  line: 8.5,
  odds: 1.4,
  status: "pending",
  kickoff_at: KICKOFF,
  ...overrides
});

// ── the mapping ───────────────────────────────────────────────────────────

test("the select names the promoted columns and only the marketResults path of the document", () => {
  for (const col of ["fixture_id", "match_status", "score_home", "score_away", "corners_total", "shots_total", "shots_on_target_total"]) {
    assert.ok(FIXTURE_STATE_SELECT.includes(col), col);
  }
  assert.ok(FIXTURE_STATE_SELECT.includes("raw_payload->marketResults"), "legacy path for pre-057 rows");
  assert.equal(/(^|[ ,])raw_payload([ ,]|$)/.test(FIXTURE_STATE_SELECT), false, "never the whole document");
});

test("A. promoted values map to the settlement keys; B. a NULL column is absent, never 0", () => {
  const state = fixtureStateFromRow(ROW_1623434);
  assert.deepEqual(state, {
    status: "FT",
    score: { home: 4, away: 0 },
    marketTotals: { cornersTotal: 10, shotsOnTargetTotal: 15 }
  });
  assert.equal("shotsTotal" in state.marketTotals, false);
  assert.notEqual(state.marketTotals.shotsTotal, 0);
});

test("C. all promoted totals missing and no legacy document → empty marketTotals, status and score intact", () => {
  const state = fixtureStateFromRow({ fixture_id: 1, match_status: "FT", score_home: 1, score_away: 0 });
  assert.deepEqual(state, { status: "FT", score: { home: 1, away: 0 }, marketTotals: {} });
});

test("D. pre-057 row: legacy raw_payload.marketResults fills what the columns do not carry", () => {
  const state = fixtureStateFromRow(ROW_LEGACY);
  assert.deepEqual(state.marketTotals, { cornersTotal: 12, shotsTotal: 29, shotsOnTargetTotal: 7 });
  assert.equal("cardsTotal" in state.marketTotals, false, "only the totals settlement grades");
});

test("E. both present and different → the promoted column wins, per key", () => {
  const state = fixtureStateFromRow({
    ...ROW_1623434,
    shots_total: null,
    legacy_market_results: { cornersTotal: 9, shotsTotal: 22, shotsOnTargetTotal: 4 }
  });
  assert.deepEqual(state.marketTotals, { cornersTotal: 10, shotsTotal: 22, shotsOnTargetTotal: 15 });
});

test("a NULL promoted column with a legacy 0 stays 0, and a legacy null stays absent", () => {
  const zero = fixtureStateFromRow({ ...ROW_LEGACY, legacy_market_results: { cornersTotal: 0 } });
  assert.deepEqual(zero.marketTotals, { cornersTotal: 0 });
  const none = fixtureStateFromRow({ ...ROW_LEGACY, legacy_market_results: { cornersTotal: null } });
  assert.deepEqual(none.marketTotals, {});
});

test("status and score come from the row exactly as before (NS row, no score)", () => {
  const state = fixtureStateFromRow({ fixture_id: 5, match_status: "NS", score_home: null, score_away: null, corners_total: null });
  assert.deepEqual(state, { status: "NS", score: { home: null, away: null }, marketTotals: {} });
});

// ── loadFixtureStates: one query, the new select, keyed by fixture id ─────

function stubSupabase(rows) {
  const calls = [];
  const chain = {
    select: (cols) => {
      calls.push({ select: cols });
      return chain;
    },
    in: (col, ids) => {
      calls.push({ in: [col, ids] });
      return Promise.resolve({ data: rows, error: null });
    }
  };
  return { calls, from: (table) => { calls.push({ from: table }); return chain; } };
}

test("loadFixtureStates issues one select on the promoted columns and maps every row", async () => {
  const sb = stubSupabase([ROW_1623434, ROW_1570351, ROW_LEGACY]);
  const map = await loadFixtureStates(sb, [1623434, "1570351", 1622620, 1623434, NaN]);
  assert.deepEqual(sb.calls[0], { from: "predictions_history" });
  assert.deepEqual(sb.calls[1], { select: FIXTURE_STATE_SELECT });
  assert.deepEqual(sb.calls[2], { in: ["fixture_id", [1623434, 1570351, 1622620]] });
  assert.equal(sb.calls.length, 3, "exactly one query for all fixtures");
  assert.equal(map.size, 3);
  assert.equal(map.get(1623434).marketTotals.cornersTotal, 10);
  assert.equal(map.get(1570351).marketTotals.shotsTotal, 23);
  assert.equal(map.get(1622620).marketTotals.cornersTotal, 12);
});

test("loadFixtureStates with no ids makes no query; a query error propagates", async () => {
  const sb = stubSupabase([]);
  assert.equal((await loadFixtureStates(sb, [])).size, 0);
  assert.equal(sb.calls.length, 0);
  const failing = { from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: new Error("57014") }) }) }) };
  await assert.rejects(() => loadFixtureStates(failing, [1]), /57014/);
});

// ── the legs settle from the promoted totals ─────────────────────────────

test("1. Corners leg settles from corners_total (1623434: 10 → Over 8.5 WON, Under 9.5 LOST)", () => {
  const fx = fixtureStateFromRow(ROW_1623434);
  assert.equal(settleSelection(leg(), fx, JUST_AFTER), "won");
  assert.equal(settleSelection(leg({ selection: "Under 9.5", side: "under", line: 9.5 }), fx, JUST_AFTER), "lost");
});

test("2. Shots leg settles from shots_total (1570351: 23 → Shots Under 29.5 WON)", () => {
  const fx = fixtureStateFromRow(ROW_1570351);
  assert.equal(
    settleSelection(leg({ fixture_id: 1570351, market: "shots", selection: "Shots Under 29.5", side: "under", line: 29.5 }), fx, JUST_AFTER),
    "won"
  );
});

test("3. SOT leg settles from shots_on_target_total (1570351: 6 → SOT Over 6.5 LOST; 1623434: 15 → WON)", () => {
  const sot = leg({ market: "shots", selection: "SOT Over 6.5", side: "over", line: 6.5 });
  assert.equal(settleSelection({ ...sot, fixture_id: 1570351 }, fixtureStateFromRow(ROW_1570351), JUST_AFTER), "lost");
  assert.equal(settleSelection(sot, fixtureStateFromRow(ROW_1623434), JUST_AFTER), "won");
});

test("4. promoted present + legacy absent → grades (the production shape since 2026-08-19)", () => {
  assert.equal(fixtureStateFromRow(ROW_1623394).marketTotals.cornersTotal, 9);
  assert.equal(settleSelection(leg({ fixture_id: 1623394, selection: "Under 11.5", side: "under", line: 11.5 }), fixtureStateFromRow(ROW_1623394), JUST_AFTER), "won");
});

test("5. promoted + stale legacy that disagrees → verdict follows the promoted column", () => {
  const fx = fixtureStateFromRow({ ...ROW_1623434, legacy_market_results: { cornersTotal: 8 } });
  // legacy 8 would LOSE Over 8.5; promoted 10 wins.
  assert.equal(settleSelection(leg(), fx, JUST_AFTER), "won");
});

test("6. a NULL promoted statistic keeps that leg pending, then voids at 48h", () => {
  const fx = fixtureStateFromRow(ROW_1623434); // shots_total is NULL
  const shots = leg({ market: "shots", selection: "Shots Under 29.5", side: "under", line: 29.5 });
  assert.equal(settleSelection(shots, fx, JUST_AFTER), "pending");
  assert.equal(settleSelection(shots, fx, AT_48H), "void");
});

test("7. every promoted total NULL → no false settlement on any totals family", () => {
  const fx = fixtureStateFromRow({ fixture_id: 9, match_status: "FT", score_home: 0, score_away: 0, corners_total: null, shots_total: null, shots_on_target_total: null });
  assert.equal(settleSelection(leg(), fx, JUST_AFTER), "pending");
  assert.equal(settleSelection(leg({ market: "shots", selection: "SOT Over 4.5", side: "over", line: 4.5 }), fx, JUST_AFTER), "pending");
  assert.equal(settleSelection(leg({ market: "shots", selection: "Shots Under 20.5", side: "under", line: 20.5 }), fx, JUST_AFTER), "pending");
});

test("8. historical row with only legacy marketResults still grades (compatibility)", () => {
  const fx = fixtureStateFromRow(ROW_LEGACY);
  assert.equal(settleSelection(leg({ fixture_id: 1622620, selection: "Over 11.5", side: "over", line: 11.5 }), fx, JUST_AFTER), "won");
  assert.equal(settleSelection(leg({ fixture_id: 1622620, market: "shots", selection: "Shots Under 29.5", side: "under", line: 29.5 }), fx, JUST_AFTER), "won");
});

test("10/14. goals-derived and pick markets still grade from the score and final status only", () => {
  const fx = fixtureStateFromRow(ROW_1623434); // 4-0
  assert.equal(settleSelection(leg({ market: "ou", selection: "Over 2.5", side: "over", line: 2.5 }), fx, JUST_AFTER), "won");
  assert.equal(settleSelection(leg({ market: "1x2", selection: "1", side: null, line: null }), fx, JUST_AFTER), "won");
  assert.equal(settleSelection(leg({ market: "dc", selection: "X2", side: null, line: null }), fx, JUST_AFTER), "lost");
  const live = fixtureStateFromRow({ ...ROW_1623434, match_status: "2H" });
  assert.equal(settleSelection(leg({ market: "ou", selection: "Over 2.5", side: "over", line: 2.5 }), live, JUST_AFTER), "pending");
  assert.equal(settleSelection(leg(), live, JUST_AFTER), "pending", "a total on a live row never settles");
});

test("12. a cancelled fixture voids regardless of totals", () => {
  const fx = fixtureStateFromRow({ ...ROW_1623434, match_status: "PST" });
  assert.equal(settleSelection(leg(), fx, JUST_AFTER), "void");
});

// ── the whole bet through settlePendingGlobalSpecialBets ─────────────────

function fakeSettlementClient({ bets, selections, fixtureRows }) {
  const writes = [];
  const selectionsTable = selections.map((s) => ({ ...s }));
  const betsTable = bets.map((b) => ({ ...b }));
  function table(name) {
    return {
      select: (cols) => ({
        eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: betsTable.filter((b) => b.status === "pending"), error: null }) }) }),
        in: (col, ids) =>
          name === "predictions_history"
            ? Promise.resolve({ data: fixtureRows.filter((r) => ids.includes(r.fixture_id)), error: null })
            : Promise.resolve({ data: selectionsTable.filter((s) => ids.includes(s.special_bet_id)), error: null }),
        _cols: cols
      }),
      update: (patch) => ({
        in: (col, ids) => ({
          select: () => {
            const hit = selectionsTable.filter((s) => ids.includes(s.id));
            hit.forEach((s) => Object.assign(s, patch));
            writes.push({ table: name, patch, ids });
            return Promise.resolve({ data: hit.map((s) => ({ id: s.id })), error: null });
          }
        }),
        eq: (col, id) => ({
          select: () => {
            const hit = betsTable.filter((b) => b.id === id);
            hit.forEach((b) => Object.assign(b, patch));
            writes.push({ table: name, patch, ids: [id] });
            return Promise.resolve({ data: hit.map((b) => ({ id: b.id })), error: null });
          }
        })
      })
    };
  }
  return { from: table, writes, betsTable, selectionsTable };
}

const PROD_BET = { id: "bet-3fb8f3d4", status: "pending", settled_total_odds: null, bet_kind: "combo", system_k: null };
const PROD_LEGS = [
  { id: "l1", special_bet_id: PROD_BET.id, fixture_id: 1623394, market: "corners", selection: "Under 11.5", side: "under", line: 11.5, odds: 1.36, status: "pending", kickoff_at: KICKOFF },
  { id: "l2", special_bet_id: PROD_BET.id, fixture_id: 1570351, market: "shots", selection: "SOT Over 6.5", side: null, line: 6.5, odds: 1.46, status: "pending", kickoff_at: KICKOFF },
  { id: "l3", special_bet_id: PROD_BET.id, fixture_id: 1623434, market: "corners", selection: "Over 7.5", side: "over", line: 7.5, odds: 1.38, status: "pending", kickoff_at: KICKOFF }
];

test("11. a production-shaped ticket settles end-to-end from promoted columns; aggregation unchanged (one lost leg → LOST)", async () => {
  const sb = fakeSettlementClient({ bets: [PROD_BET], selections: PROD_LEGS, fixtureRows: [ROW_1623394, ROW_1570351, ROW_1623434] });
  const summary = await settlePendingGlobalSpecialBets({ now: JUST_AFTER, supabase: sb });
  assert.deepEqual({ scanned: summary.scanned, settled: summary.settled, unchanged: summary.unchanged, failures: summary.failures }, { scanned: 1, settled: 1, unchanged: 0, failures: [] });
  assert.deepEqual(
    sb.selectionsTable.map((s) => [s.id, s.status]),
    [
      ["l1", "won"], // corners 9 under 11.5
      ["l2", "lost"], // SOT 6 not over 6.5 (legacy side=null, graded from label — T2)
      ["l3", "won"] // corners 10 over 7.5
    ]
  );
  assert.equal(sb.betsTable[0].status, "lost");
  assert.equal(sb.betsTable[0].settled_total_odds, null);
  assert.ok(sb.betsTable[0].settled_at);
});

test("13. re-running on the settled ticket writes nothing (idempotent)", async () => {
  const sb = fakeSettlementClient({ bets: [PROD_BET], selections: PROD_LEGS, fixtureRows: [ROW_1623394, ROW_1570351, ROW_1623434] });
  await settlePendingGlobalSpecialBets({ now: JUST_AFTER, supabase: sb });
  const before = sb.writes.length;
  const again = await settlePendingGlobalSpecialBets({ now: JUST_AFTER, supabase: sb });
  assert.equal(again.scanned, 0, "the bet is no longer pending");
  assert.equal(sb.writes.length, before);
});

test("an all-won ticket pays the product of its legs (aggregation and settled odds unchanged)", () => {
  const fixturesById = new Map([
    [1623394, fixtureStateFromRow(ROW_1623394)],
    [1623434, fixtureStateFromRow(ROW_1623434)]
  ]);
  const result = settleGlobalSpecialBet({
    bet: PROD_BET,
    selections: [PROD_LEGS[0], PROD_LEGS[2]],
    fixturesById,
    now: JUST_AFTER
  });
  assert.equal(result.betStatus, "won");
  assert.equal(result.settledTotalOdds, Number((1.36 * 1.38).toFixed(3)));
});

test("a ticket whose fixture row is missing stays pending and voids at 48h, as before", () => {
  const result = settleGlobalSpecialBet({ bet: PROD_BET, selections: [PROD_LEGS[2]], fixturesById: new Map(), now: JUST_AFTER });
  assert.equal(result.betStatus, "pending");
  const later = settleGlobalSpecialBet({ bet: PROD_BET, selections: [PROD_LEGS[2]], fixturesById: new Map(), now: AT_48H });
  assert.equal(later.betStatus, "void");
});
