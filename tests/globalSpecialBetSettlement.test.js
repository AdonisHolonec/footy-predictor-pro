import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MISSING_STATS_VOID_AFTER_MS,
  aggregateBetStatus,
  computeSettledTotalOdds,
  officialTotalForFamily,
  settleGlobalSpecialBet,
  settleSelection
} from "../server-utils/globalSpecialBetSettlement.js";

/**
 * Global Special Bet settlement.
 *
 * Every case injects `now`, so the 48-hour rule is a boundary the tests control
 * rather than a property of the machine clock.
 */

const KICKOFF = "2026-08-09T18:00:00.000Z";
const KICKOFF_MS = Date.parse(KICKOFF);
const JUST_AFTER = KICKOFF_MS + 60 * 60 * 1000;
const BEFORE_48H = KICKOFF_MS + MISSING_STATS_VOID_AFTER_MS - 1;
const AT_48H = KICKOFF_MS + MISSING_STATS_VOID_AFTER_MS;

const sel = (overrides = {}) => ({
  id: "sel-1",
  fixture_id: 900,
  market: "ou",
  selection: "Over 2.5",
  side: "over",
  line: 2.5,
  odds: 1.8,
  status: "pending",
  kickoff_at: KICKOFF,
  ...overrides
});

const finished = (overrides = {}) => ({
  status: "FT",
  score: { home: 2, away: 1 },
  marketTotals: {},
  ...overrides
});

// ── official totals ───────────────────────────────────────────────────────

test("each totals family reads its own official figure", () => {
  const fixture = finished({ marketTotals: { cornersTotal: 11, shotsOnTargetTotal: 7 } });

  assert.equal(officialTotalForFamily("ou", fixture), 3);
  assert.equal(officialTotalForFamily("corners", fixture), 11);
  // A shots leg names its statistic in the label (T2): "SOT …" is shots on
  // target, "Shots …" is total shots. The bare family alone cannot say which.
  assert.equal(officialTotalForFamily("shots", fixture, "SOT Over 6.5"), 7);
  assert.equal(officialTotalForFamily("shots", fixture), null);
});

test("a missing official figure is null, never zero", () => {
  assert.equal(officialTotalForFamily("corners", finished()), null);
  assert.equal(officialTotalForFamily("shots", finished({ marketTotals: { shotsOnTargetTotal: "" } }), "SOT Over 6.5"), null);
  assert.equal(officialTotalForFamily("ou", { status: "FT", score: {} }), null);
});

// ── per-selection settlement ──────────────────────────────────────────────

test("a totals selection settles against its own market", () => {
  const fixture = finished({
    score: { home: 2, away: 2 },
    marketTotals: { cornersTotal: 18, shotsOnTargetTotal: 7 }
  });

  assert.equal(settleSelection(sel({ market: "ou", side: "over", line: 1.5 }), fixture, JUST_AFTER), "won");
  assert.equal(settleSelection(sel({ market: "corners", side: "over", line: 7.5 }), fixture, JUST_AFTER), "won");
  assert.equal(
    settleSelection(sel({ market: "shots", selection: "SOT Under 10.5", side: "under", line: 10.5 }), fixture, JUST_AFTER),
    "won"
  );
  assert.equal(settleSelection(sel({ market: "corners", side: "under", line: 7.5 }), fixture, JUST_AFTER), "lost");
});

test("1X2, double chance and BTTS settle from the score by their pick", () => {
  const fixture = finished({ score: { home: 2, away: 1 } });
  const pick = (market, selection) => sel({ market, selection, side: null, line: null });

  assert.equal(settleSelection(pick("1x2", "1"), fixture, JUST_AFTER), "won");
  assert.equal(settleSelection(pick("1x2", "2"), fixture, JUST_AFTER), "lost");
  assert.equal(settleSelection(pick("dc", "1X"), fixture, JUST_AFTER), "won");
  assert.equal(settleSelection(pick("dc", "X2"), fixture, JUST_AFTER), "lost");
  assert.equal(settleSelection(pick("btts", "GG"), fixture, JUST_AFTER), "won");
  assert.equal(settleSelection(pick("btts", "NGG"), fixture, JUST_AFTER), "lost");
});

test("an unfinished fixture leaves the selection pending", () => {
  assert.equal(settleSelection(sel(), finished({ status: "1H" }), JUST_AFTER), "pending");
});

// ── VOID ──────────────────────────────────────────────────────────────────

test("a fixture that will never produce a result voids immediately", () => {
  for (const status of ["PST", "CANC", "ABD", "AWD", "WO"]) {
    assert.equal(settleSelection(sel(), finished({ status }), JUST_AFTER), "void", `${status} must void`);
  }
});

test("a cancelled fixture voids without waiting out the 48 hours", () => {
  assert.equal(settleSelection(sel(), finished({ status: "PST" }), KICKOFF_MS + 1), "void");
});

test("a missing official statistic stays pending inside the window", () => {
  const selection = sel({ market: "corners", side: "over", line: 7.5 });
  assert.equal(settleSelection(selection, finished({ marketTotals: {} }), BEFORE_48H), "pending");
});

test("a missing official statistic voids at the 48-hour boundary", () => {
  const fixture = finished({ marketTotals: {} });
  const selection = sel({ market: "corners", side: "over", line: 7.5 });

  assert.equal(settleSelection(selection, fixture, AT_48H), "void", "the boundary is inclusive");
  assert.equal(settleSelection(selection, fixture, AT_48H + 1), "void");
});

test("the 48-hour rule never overrides a decided selection", () => {
  const fixture = finished({ score: { home: 2, away: 2 }, marketTotals: { cornersTotal: 18 } });
  const won = sel({ market: "corners", side: "over", line: 7.5 });
  const lost = sel({ market: "corners", side: "under", line: 7.5 });

  assert.equal(settleSelection(won, fixture, AT_48H + 999999), "won");
  assert.equal(settleSelection(lost, fixture, AT_48H + 999999), "lost");
});

// ── aggregation ───────────────────────────────────────────────────────────

test("the mandated aggregation table", () => {
  assert.equal(aggregateBetStatus(["won", "won", "won"]), "won");
  assert.equal(aggregateBetStatus(["won", "won", "lost"]), "lost");
  assert.equal(aggregateBetStatus(["won", "won", "void"]), "won");
  assert.equal(aggregateBetStatus(["won", "void", "void"]), "won");
  assert.equal(aggregateBetStatus(["void", "void", "void"]), "void");
  assert.equal(aggregateBetStatus(["won", "pending", "won"]), "pending");
  assert.equal(aggregateBetStatus(["lost", "pending", "won"]), "lost");
});

test("a lost leg outranks a pending one — the conflicting case", () => {
  // Order matters: checking PENDING first would postpone a verdict that is
  // already certain, because nothing can rescue a lost leg.
  assert.equal(aggregateBetStatus(["pending", "lost"]), "lost");
  assert.equal(aggregateBetStatus(["lost", "pending", "void"]), "lost");
});

test("no selections means nothing to settle", () => {
  assert.equal(aggregateBetStatus([]), "pending");
});

// ── settled odds ──────────────────────────────────────────────────────────

test("a void leg contributes 1.00 to the settled odds", () => {
  const selections = [
    { status: "won", odds: 2 },
    { status: "won", odds: 1.5 },
    { status: "void", odds: 10 }
  ];

  assert.equal(computeSettledTotalOdds(selections, "won"), 3);
});

test("an all-void bet settles at 1.000", () => {
  const selections = [
    { status: "void", odds: 2 },
    { status: "void", odds: 3 }
  ];

  assert.equal(computeSettledTotalOdds(selections, "void"), 1);
});

test("lost and pending bets carry no settled odds", () => {
  const selections = [
    { status: "won", odds: 2 },
    { status: "lost", odds: 1.5 }
  ];

  assert.equal(computeSettledTotalOdds(selections, "lost"), null, "a lost bet has no payout to express");
  assert.equal(computeSettledTotalOdds(selections, "pending"), null, "a pending bet has no answer yet");
});

// ── whole-bet settlement ──────────────────────────────────────────────────

function betFixtures(overrides = {}) {
  const base = new Map([
    [901, finished({ score: { home: 2, away: 1 }, marketTotals: { cornersTotal: 11 } })],
    [902, finished({ score: { home: 2, away: 1 }, marketTotals: { cornersTotal: 11 } })],
    [903, finished({ score: { home: 2, away: 1 }, marketTotals: { cornersTotal: 11 } })]
  ]);
  for (const [id, fixture] of Object.entries(overrides)) base.set(Number(id), fixture);
  return base;
}

const threeSelections = () => [
  sel({ id: "a", fixture_id: 901, market: "ou", side: "over", line: 2.5, odds: 2 }),
  sel({ id: "b", fixture_id: 902, market: "corners", side: "over", line: 7.5, odds: 1.5 }),
  sel({ id: "c", fixture_id: 903, market: "1x2", selection: "1", side: null, line: null, odds: 1.6 })
];

test("3 of 3 winning settles the bet as won, with the product of the odds", () => {
  const result = settleGlobalSpecialBet({
    bet: { status: "pending", settled_total_odds: null },
    selections: threeSelections(),
    fixturesById: betFixtures(),
    now: JUST_AFTER
  });

  assert.deepEqual(
    result.selections.map((s) => s.status),
    ["won", "won", "won"]
  );
  assert.equal(result.betStatus, "won");
  assert.equal(result.settledTotalOdds, 4.8);
  assert.equal(result.isTerminal, true);
  assert.equal(result.changed, true);
});

test("one lost leg settles the bet as lost with no settled odds", () => {
  const result = settleGlobalSpecialBet({
    bet: { status: "pending", settled_total_odds: null },
    selections: threeSelections(),
    fixturesById: betFixtures({ 903: finished({ score: { home: 0, away: 1 } }) }),
    now: JUST_AFTER
  });

  assert.equal(result.betStatus, "lost");
  assert.equal(result.settledTotalOdds, null);
});

test("a cancelled fixture voids its leg and the rest still wins", () => {
  const result = settleGlobalSpecialBet({
    bet: { status: "pending", settled_total_odds: null },
    selections: threeSelections(),
    fixturesById: betFixtures({ 903: finished({ status: "PST" }) }),
    now: JUST_AFTER
  });

  assert.deepEqual(
    result.selections.map((s) => s.status),
    ["won", "won", "void"]
  );
  assert.equal(result.betStatus, "won");
  assert.equal(result.settledTotalOdds, 3, "the void leg contributes 1.00");
});

test("a selection whose fixture is missing entirely stays pending, then voids", () => {
  const params = {
    bet: { status: "pending", settled_total_odds: null },
    selections: threeSelections(),
    fixturesById: new Map()
  };

  assert.equal(settleGlobalSpecialBet({ ...params, now: BEFORE_48H }).betStatus, "pending");
  assert.equal(settleGlobalSpecialBet({ ...params, now: AT_48H }).betStatus, "void");
});

test("re-running settlement on a settled bet changes nothing", () => {
  const first = settleGlobalSpecialBet({
    bet: { status: "pending", settled_total_odds: null },
    selections: threeSelections(),
    fixturesById: betFixtures(),
    now: JUST_AFTER
  });

  // Feed the first run's own conclusions back in, as the database would hold them.
  const stored = threeSelections().map((s, i) => ({ ...s, status: first.selections[i].status }));
  const second = settleGlobalSpecialBet({
    bet: { status: first.betStatus, settled_total_odds: first.settledTotalOdds },
    selections: stored,
    fixturesById: betFixtures(),
    now: JUST_AFTER + 999999
  });

  assert.equal(second.betStatus, first.betStatus);
  assert.equal(second.settledTotalOdds, first.settledTotalOdds);
  assert.deepEqual(
    second.selections.map((s) => s.status),
    first.selections.map((s) => s.status)
  );
  assert.equal(second.changed, false, "an unchanged settlement must issue no write at all");
  assert.equal(second.selectionChanges.length, 0);
});

test("settlement is deterministic for the same inputs", () => {
  const params = {
    bet: { status: "pending", settled_total_odds: null },
    selections: threeSelections(),
    fixturesById: betFixtures(),
    now: JUST_AFTER
  };

  assert.deepEqual(settleGlobalSpecialBet(params), settleGlobalSpecialBet(params));
});
