import assert from "node:assert/strict";
import { test } from "node:test";
import { collectGlobalCandidates } from "../server-utils/globalSpecialBetEngine.js";
import {
  MISSING_STATS_VOID_AFTER_MS,
  officialTotalForFamily,
  resolveTotalsSelection,
  settleGlobalSpecialBet,
  settleSelection,
  shotsStatisticFor
} from "../server-utils/globalSpecialBetSettlement.js";

/**
 * T2 — shots legs were structurally unsettleable.
 *
 * Production (2026-08-22): every shots leg ever stored had side=null, and the
 * lifetime tally was 23 void / 0 won / 0 lost. Two defects, both here:
 *
 *   1. The engine derived `side` with the ^-anchored goals parser. Shots market
 *      types are prefixed by the value layer ("SOT Over 7.5", "Shots Under 29.5"),
 *      so the parse returned null and settleOuAsian(null, …) never graded.
 *   2. Settlement read shotsOnTargetTotal for EVERY shots leg. Total shots and
 *      shots on target share the `shots` family, so "Shots Under 29.5" would have
 *      been graded against the SOT count even with a side.
 *
 * A real leg from the audit: fixture 1622620, "Shots Under 29.5", marketResults
 * { shotsTotal: 29, shotsOnTargetTotal: 7 } — a clear win, voided at 48h.
 */

const NOW = Date.parse("2026-08-09T10:00:00.000Z");
const KICKOFF = "2026-08-09T18:00:00.000Z";
const KICKOFF_MS = Date.parse(KICKOFF);
const JUST_AFTER = KICKOFF_MS + 60 * 60 * 1000;
const AT_48H = KICKOFF_MS + MISSING_STATS_VOID_AFTER_MS;

function fixture(id, leagueId, markets) {
  return {
    id,
    leagueId,
    kickoff: KICKOFF,
    teams: { home: `Home ${id}`, away: `Away ${id}` },
    recommended: { pick: "Over 2.5", family: "Goals", confidence: 80 },
    modelMeta: { dataQuality: 0.8 },
    valueEngine: { markets }
  };
}

function market(overrides = {}) {
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

function candidateFor(m) {
  const { candidates } = collectGlobalCandidates({ rows: [fixture(1, 39, [m])], leagueIds: [39], now: NOW });
  assert.equal(candidates.length, 1, "the market must survive the hard filters");
  return candidates[0];
}

const leg = (overrides = {}) => ({
  id: "sel-1",
  fixture_id: 1622620,
  market: "shots",
  selection: "Shots Under 29.5",
  side: "under",
  line: 29.5,
  odds: 1.45,
  status: "pending",
  kickoff_at: KICKOFF,
  ...overrides
});

/** The audit fixture: FT 2-2 with both shots statistics known. */
const finished = (marketTotals = { cornersTotal: 12, shotsTotal: 29, shotsOnTargetTotal: 7 }) => ({
  status: "FT",
  score: { home: 2, away: 2 },
  marketTotals
});

// ── engine: side and label ────────────────────────────────────────────────

test("a shots-on-target market stores an explicit side and keeps its SOT prefix", () => {
  const c = candidateFor(
    market({ type: "SOT Over 7.5", family: "Shots on Target", line: 7.5, betType: "total", probability: 0.8, odds: 1.5 })
  );
  assert.equal(c.market, "shots");
  assert.equal(c.side, "over");
  assert.equal(c.line, 7.5);
  assert.equal(c.selection, "SOT Over 7.5");
});

test("a total-shots market stores an explicit side and keeps its Shots prefix", () => {
  const c = candidateFor(
    market({ type: "Shots Under 29.5", family: "Shots", line: 29.5, betType: "total", probability: 0.8, odds: 1.45 })
  );
  assert.equal(c.market, "shots");
  assert.equal(c.side, "under");
  assert.equal(c.line, 29.5);
  assert.equal(c.selection, "Shots Under 29.5");
});

test("the stored label is rebuilt from the lossless line, prefix intact", () => {
  // The value layer already formats the type losslessly; the snapshot must agree
  // with it rather than re-rounding. An integer line stays an integer.
  const c = candidateFor(
    market({ type: "SOT Over 8", family: "Shots on Target", line: 8, betType: "total", probability: 0.8, odds: 1.5 })
  );
  assert.equal(c.side, "over");
  assert.equal(c.selection, "SOT Over 8");
});

test("unprefixed totals (goals, corners) and pick markets are unchanged", () => {
  const goals = candidateFor(market());
  assert.deepEqual([goals.market, goals.side, goals.selection], ["ou", "over", "Over 2.5"]);

  const corners = candidateFor(
    market({ type: "Under 9.5", family: "Corners", line: 9.5, betType: "corners", probability: 0.8, odds: 1.5 })
  );
  assert.deepEqual([corners.market, corners.side, corners.selection], ["corners", "under", "Under 9.5"]);

  const dc = candidateFor(
    market({ type: "1X", family: "Double Chance", line: null, betType: "double_chance", probability: 0.8, odds: 1.3 })
  );
  assert.deepEqual([dc.market, dc.side, dc.line, dc.selection], ["dc", null, null, "1X"]);
});

// ── settlement: which statistic ───────────────────────────────────────────

test("shotsStatisticFor reads the statistic from the label prefix, case-insensitively", () => {
  assert.equal(shotsStatisticFor("SOT Over 7.5"), "shotsOnTargetTotal");
  assert.equal(shotsStatisticFor("sot under 4.5"), "shotsOnTargetTotal");
  assert.equal(shotsStatisticFor("Shots on Target Over 5.5"), "shotsOnTargetTotal");
  assert.equal(shotsStatisticFor("Shots Under 29.5"), "shotsTotal");
  assert.equal(shotsStatisticFor("Shot Over 20.5"), "shotsTotal");
  // No prefix: which statistic? Unknown — never guessed.
  assert.equal(shotsStatisticFor("Over 7.5"), null);
  assert.equal(shotsStatisticFor(""), null);
  assert.equal(shotsStatisticFor(null), null);
});

test("officialTotalForFamily: a shots leg is read from the statistic its label names", () => {
  const fx = finished();
  assert.equal(officialTotalForFamily("shots", fx, "SOT Over 7.5"), 7);
  assert.equal(officialTotalForFamily("shots", fx, "Shots Under 29.5"), 29);
  assert.equal(officialTotalForFamily("shots", fx, "Over 7.5"), null, "unprefixed shots label cannot be graded");
  assert.equal(officialTotalForFamily("shots", fx), null, "no label at all cannot be graded");
  assert.equal(officialTotalForFamily("shots", finished({ shotsOnTargetTotal: 7 }), "Shots Under 29.5"), null, "total shots absent");
  assert.equal(officialTotalForFamily("shots", finished({ shotsTotal: 29 }), "SOT Over 7.5"), null, "SOT absent");
  // Other families ignore the label.
  assert.equal(officialTotalForFamily("corners", fx, "SOT Over 7.5"), 12);
  assert.equal(officialTotalForFamily("ou", fx, "SOT Over 7.5"), 4);
  assert.equal(officialTotalForFamily("cards", fx, "Cards Over 3.5"), null, "unknown family stays null");
});

// ── settlement: legs ──────────────────────────────────────────────────────

test("the audit leg — Shots Under 29.5 with shotsTotal 29 — is WON, not graded against SOT", () => {
  // Old code: side=null → pending → void at 48h. Even with a side it would have
  // read shotsOnTargetTotal (7 < 29.5 → "won" by accident of the wrong number).
  assert.equal(settleSelection(leg(), finished(), JUST_AFTER), "won");
  assert.equal(settleSelection(leg({ line: 28.5 }), finished(), JUST_AFTER), "lost");
});

test("a SOT leg settles against shotsOnTargetTotal only", () => {
  const sot = leg({ selection: "SOT Over 7.5", side: "over", line: 7.5 });
  assert.equal(settleSelection(sot, finished(), JUST_AFTER), "lost", "7 on target is not over 7.5");
  assert.equal(settleSelection(leg({ selection: "SOT Over 6.5", side: "over", line: 6.5 }), finished(), JUST_AFTER), "won");
  // shotsTotal=29 must never leak into a SOT grade.
  assert.equal(settleSelection(sot, finished({ shotsTotal: 29 }), JUST_AFTER), "pending");
});

test("legacy rows with side=null are graded from their stored label", () => {
  // Every pre-T2 shots leg looks like this: line present, side missing.
  const legacySot = leg({ selection: "SOT Over 6.5", side: null, line: 6.5 });
  const legacyShots = leg({ selection: "Shots Under 29.5", side: null, line: 29.5 });
  assert.equal(settleSelection(legacySot, finished(), JUST_AFTER), "won");
  assert.equal(settleSelection(legacyShots, finished(), JUST_AFTER), "won");
  assert.equal(settleSelection(leg({ selection: "SOT Over 7.5", side: null, line: 7.5 }), finished(), JUST_AFTER), "lost");
});

test("resolveTotalsSelection: stored side/line win; the label only fills what is missing", () => {
  assert.deepEqual(resolveTotalsSelection({ selection: "SOT Over 7.5", side: "over", line: 7.5 }), { side: "over", line: 7.5 });
  assert.deepEqual(resolveTotalsSelection({ selection: "SOT Over 7.5", side: null, line: 7.5 }), { side: "over", line: 7.5 });
  assert.deepEqual(resolveTotalsSelection({ selection: "SOT Over 7.5", side: null, line: null }), { side: "over", line: 7.5 });
  // A stored line is the authority even when the label disagrees.
  assert.deepEqual(resolveTotalsSelection({ selection: "SOT Over 7.5", side: null, line: 8.5 }), { side: "over", line: 8.5 });
  assert.deepEqual(resolveTotalsSelection({ selection: "1X", side: null, line: null }), { side: null, line: null });
  assert.deepEqual(resolveTotalsSelection({ selection: "Shots Under 29,5", side: "under", line: "29.5" }), { side: "under", line: 29.5 });
});

test("a shots leg with no usable statistic stays pending and voids at 48h — still never guessed", () => {
  const noStats = finished({});
  assert.equal(settleSelection(leg(), noStats, JUST_AFTER), "pending");
  assert.equal(settleSelection(leg(), noStats, AT_48H), "void");
  // Unprefixed legacy label: ambiguous statistic → same honest path.
  const ambiguous = leg({ selection: "Under 29.5", side: null, line: 29.5 });
  assert.equal(settleSelection(ambiguous, finished(), JUST_AFTER), "pending");
  assert.equal(settleSelection(ambiguous, finished(), AT_48H), "void");
});

test("integer shots line pushes to VOID (1.00) exactly like other totals", () => {
  assert.equal(settleSelection(leg({ selection: "Shots Under 29", line: 29 }), finished(), JUST_AFTER), "void");
});

// ── settlement: the whole bet ─────────────────────────────────────────────

test("a bet mixing a SOT leg, a total-shots leg and a corners leg settles each against its own figure", () => {
  const bet = { id: "bet-1", status: "pending", settled_total_odds: null };
  const selections = [
    leg({ id: "a", fixture_id: 1, selection: "SOT Over 6.5", side: "over", line: 6.5, odds: 1.5 }),
    leg({ id: "b", fixture_id: 2, selection: "Shots Under 29.5", side: null, line: 29.5, odds: 1.45 }),
    leg({ id: "c", fixture_id: 3, market: "corners", selection: "Over 9.5", side: "over", line: 9.5, odds: 1.4 })
  ];
  const fixturesById = new Map([
    [1, finished()],
    [2, finished()],
    [3, finished()]
  ]);

  const result = settleGlobalSpecialBet({ bet, selections, fixturesById, now: JUST_AFTER });

  assert.deepEqual(
    result.selections.map((s) => [s.id, s.status]),
    [
      ["a", "won"],
      ["b", "won"],
      ["c", "won"]
    ]
  );
  assert.equal(result.betStatus, "won");
  assert.equal(result.settledTotalOdds, Number((1.5 * 1.45 * 1.4).toFixed(3)));
});
