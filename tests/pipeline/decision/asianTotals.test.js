import assert from "node:assert/strict";
import { test } from "node:test";
import {
  splitAsianLine,
  isQuarterLine,
  settleOuAsian,
  payoutMultiplier,
  asianOuDistribution,
  asianExpectedValuePct
} from "../../../server-utils/asianTotals.js";
import {
  settleOuValidation,
  validationFromOu,
  resolveRecommendedValidation
} from "../../../server-utils/cardMarketSettlement.js";
import {
  settleSelection,
  aggregateBetStatus,
  computeSettledTotalOdds,
  SELECTION_STATUS,
  BET_STATUS
} from "../../../server-utils/globalSpecialBetSettlement.js";
import { collectGlobalCandidates } from "../../../server-utils/globalSpecialBetEngine.js";
import { priceLineFromBlock, repriceCandidateLine } from "../../../server-utils/pipeline/decision/repriceCandidateLine.js";
import { evaluateValue } from "../../../server-utils/value/ValueEngine.js";
import { formatLineLabel } from "../../../server-utils/marketIdentity.js";

/* ------------------------------------------------------------ line splitting */

test("splitAsianLine: 10 / 10.5 stand alone; quarters split to their components", () => {
  assert.deepEqual(splitAsianLine(10), [10]);
  assert.deepEqual(splitAsianLine(10.5), [10.5]);
  assert.deepEqual(splitAsianLine(10.25), [10, 10.5]);
  assert.deepEqual(splitAsianLine(10.75), [10.5, 11]);
  assert.equal(splitAsianLine(10.3), null, "a non-quarter step is unsupported, never rounded");
  assert.equal(isQuarterLine(10.25), true);
  assert.equal(isQuarterLine(10.75), true);
  assert.equal(isQuarterLine(10), false);
  assert.equal(isQuarterLine(10.5), false);
});

/* ------------------------------------------------- settlement matrix (§11) */

test("integer line settlement: Under/Over 10 across 9/10/11", () => {
  assert.equal(settleOuAsian("under", 10, 9), "win");
  assert.equal(settleOuAsian("under", 10, 10), "push");
  assert.equal(settleOuAsian("under", 10, 11), "loss");
  assert.equal(settleOuAsian("over", 10, 9), "loss");
  assert.equal(settleOuAsian("over", 10, 10), "push");
  assert.equal(settleOuAsian("over", 10, 11), "win");
});

test("half line settlement: Under/Over 10.5 — no push, unchanged behaviour", () => {
  assert.equal(settleOuAsian("under", 10.5, 10), "win");
  assert.equal(settleOuAsian("under", 10.5, 11), "loss");
  assert.equal(settleOuAsian("over", 10.5, 10), "loss");
  assert.equal(settleOuAsian("over", 10.5, 11), "win");
});

test("quarter .25 settlement: Under/Over 10.25 across 9/10/11", () => {
  assert.equal(settleOuAsian("under", 10.25, 9), "win", "full win");
  assert.equal(settleOuAsian("under", 10.25, 10), "half_win", "half win / half push");
  assert.equal(settleOuAsian("under", 10.25, 11), "loss", "full loss");
  assert.equal(settleOuAsian("over", 10.25, 9), "loss", "full loss");
  assert.equal(settleOuAsian("over", 10.25, 10), "half_loss", "half loss / half push");
  assert.equal(settleOuAsian("over", 10.25, 11), "win", "full win");
});

test("quarter .75 settlement: Under/Over 10.75 across 10/11/12", () => {
  assert.equal(settleOuAsian("under", 10.75, 10), "win", "full win");
  assert.equal(settleOuAsian("under", 10.75, 11), "half_loss", "half loss / half push");
  assert.equal(settleOuAsian("under", 10.75, 12), "loss", "full loss");
  assert.equal(settleOuAsian("over", 10.75, 10), "loss", "full loss");
  assert.equal(settleOuAsian("over", 10.75, 11), "half_win", "half win / half push");
  assert.equal(settleOuAsian("over", 10.75, 12), "win", "full win");
});

test("payoutMultiplier: win=odds · push=1 · loss=0 · half_win=(o+1)/2 · half_loss=0.5", () => {
  assert.equal(payoutMultiplier("win", 1.8), 1.8);
  assert.equal(payoutMultiplier("push", 1.8), 1);
  assert.equal(payoutMultiplier("loss", 1.8), 0);
  assert.equal(payoutMultiplier("half_win", 1.8), 1.4);
  assert.equal(payoutMultiplier("half_loss", 1.8), 0.5);
  assert.equal(payoutMultiplier("pending", 1.8), null);
});

/* ----------------------------------------------- settlement via validation */

test("settleOuValidation / validationFromOu carry Asian outcomes; absent totals stay pending", () => {
  assert.equal(validationFromOu("FT", "under", 10, 10), "push");
  assert.equal(validationFromOu("FT", "under", 10.25, 10), "half_win");
  assert.equal(validationFromOu("FT", "over", 10.75, 11), "half_win");
  assert.equal(validationFromOu("FT", "under", 10.5, 10), "win", ".5 unchanged");
  assert.equal(validationFromOu("NS", "under", 10, 10), "pending", "not final");
  assert.equal(validationFromOu("FT", "under", 10, null), "pending", "no answer ≠ zero");
  assert.equal(settleOuValidation("under", 10, ""), null, "empty stat is ungraded");
});

test("resolveRecommendedValidation settles integer Corners as push against cornersTotal", () => {
  const args = (total) => ({
    pick: "Under 10",
    family: "Corners",
    status: "FT",
    score: { home: 1, away: 1 },
    marketTotals: { cornersTotal: total }
  });
  assert.equal(resolveRecommendedValidation(args(9)), "win");
  assert.equal(resolveRecommendedValidation(args(10)), "push");
  assert.equal(resolveRecommendedValidation(args(11)), "loss");
});

/* --------------------------------------------------------- probability (§7) */

// Real corners block shape: ladder at .5 lines + its own lambdas (fixture 1607612).
const BLOCK = {
  total: { o7_5: 62, o8_5: 48.4, o9_5: 35.5, o10_5: 24.5, o11_5: 15.8, o12_5: 9.6 },
  lambdaHome: 6.93,
  lambdaAway: 1.63,
  correlation: 0.08
};

test("distribution masses sum to 1; .5 has no push; integer has explicit push mass", () => {
  for (const line of [9, 9.25, 9.5, 9.75, 10, 10.25]) {
    for (const side of ["over", "under"]) {
      const d = asianOuDistribution(BLOCK, side, line);
      const sum = d.pWin + d.pPush + d.pHalfWin + d.pHalfLoss + d.pLoss;
      assert.ok(Math.abs(sum - 1) < 1e-9, `${side} ${line}: masses sum to 1 (got ${sum})`);
    }
  }
  const half = asianOuDistribution(BLOCK, "under", 9.5);
  assert.equal(half.pPush + half.pHalfWin + half.pHalfLoss, 0, ".5 has no push/half mass");
  const integer = asianOuDistribution(BLOCK, "under", 10);
  assert.ok(integer.pPush > 0, "integer line carries explicit P(X == 10)");
  assert.equal(integer.pHalfWin + integer.pHalfLoss, 0);
  const quarter = asianOuDistribution(BLOCK, "under", 10.25);
  assert.ok(quarter.pHalfWin > 0, "Under 10.25 half-result mass is P(X == 10)");
  assert.equal(quarter.pPush, 0, "a quarter line never pushes fully");
  assert.ok(Math.abs(quarter.pHalfWin - integer.pPush) < 1e-9, "same P(X=10) mass, reused");
});

test("Under 9 / 9.25 / 9.5 / 9.75 are economically distinct — no shared floor()'d value", () => {
  const d = (line) => asianOuDistribution(BLOCK, "under", line);
  const d9 = d(9);
  const d925 = d(9.25);
  const d95 = d(9.5);
  const d975 = d(9.75);
  // Full-win thresholds are exact asian semantics: 9 and 9.25 need X<=8;
  // 9.5 and 9.75 need X<=9 — two strictly different levels, not one.
  assert.ok(Math.abs(d9.pWin - d925.pWin) < 1e-9);
  assert.ok(Math.abs(d95.pWin - d975.pWin) < 1e-9);
  assert.ok(d9.pWin < d95.pWin, "P(X<=8) < P(X<=9)");
  // Within each pair the RISK differs: push/half mass separates them...
  assert.ok(d9.pPush > 0 && d925.pHalfWin > 0 && d925.pPush === 0);
  assert.ok(d975.pHalfLoss > 0 && d95.pHalfLoss === 0 && d95.pPush === 0);
  // ...so all four price to different EVs at identical odds.
  const evs = [d9, d925, d95, d975].map((x) => Math.round(asianExpectedValuePct(x, 1.9) * 100));
  assert.equal(new Set(evs).size, 4, `four distinct EVs, got ${evs.join(", ")}`);
});

test("priceLineFromBlock: probabilityPct is P(full win) and carries the distribution", () => {
  const under10 = priceLineFromBlock(BLOCK, "under", 10);
  const under105 = priceLineFromBlock(BLOCK, "under", 10.5);
  // Under 10.5 from the ladder: unchanged legacy value (100 - 24.5).
  assert.equal(under105.probabilityPct, 75.5);
  // Under 10 excludes the push mass — strictly below Under 10.5, never equal.
  assert.ok(under10.probabilityPct < under105.probabilityPct);
  assert.ok(under10.asian.pPush > 0);
  // Over at an integer line: P(win) = P(X > L) — same value as Over at L+0.5.
  const over10 = priceLineFromBlock(BLOCK, "over", 10);
  assert.equal(over10.probabilityPct, priceLineFromBlock(BLOCK, "over", 10.5).probabilityPct);
});

test("repriceCandidateLine attaches the asian distribution to tradable selections", () => {
  const sel = repriceCandidateLine({
    block: BLOCK,
    side: "under",
    requestedLine: 10.5,
    quote: {
      line: 10,
      over: 1.95,
      under: 1.85,
      bookmakersUsed: 2,
      market: { betType: "total", period: "full_match", scope: "match" }
    },
    expectedMarket: { betType: "total", period: "full_match", scope: "match" }
  });
  assert.equal(sel.tradable, true);
  assert.ok(sel.asian && sel.asian.pPush > 0);
  assert.equal(sel.probabilityLine, 10, "line preserved exactly — never nudged to 10.5");
});

/* ------------------------------------------------------------- EV semantics */

test("asian EV replaces the binary formula: a fair integer line prices to EV 0", () => {
  // Symmetric fair book: pWin 45%, push 10%, loss 45% at odds 2.0 → EV = 0.
  const fair = { pWin: 0.45, pPush: 0.1, pHalfWin: 0, pHalfLoss: 0, pLoss: 0.45 };
  const ev = evaluateValue(0.45, 2.0, { type: "Under 10", family: "Corners", asian: fair });
  assert.equal(ev.expectedValue, 0);
  // The binary formula would have called this -10% (0.45*2-1) — or +10% if it
  // had (wrongly) used P(non-loss)=0.55. Both are wrong; the distribution isn't.
  const binary = evaluateValue(0.45, 2.0, { type: "Under 10", family: "Corners" });
  assert.equal(binary.expectedValue, -10);
});

test("half outcomes weigh half in EV; displayed probability stays P(full win)", () => {
  // Under 10.25 style: 40% full win, 20% half win, 40% loss at odds 2.0:
  // EV = 0.4*1 + 0.2*0.5 - 0.4 = 0.10 → +10%.
  const dist = { pWin: 0.4, pPush: 0, pHalfWin: 0.2, pHalfLoss: 0, pLoss: 0.4 };
  const ev = evaluateValue(0.4, 2.0, { type: "Under 10.25", family: "Corners", asian: dist });
  assert.equal(ev.expectedValue, 10);
  assert.equal(ev.probability, 0.4);
});

/* ------------------------------------------------------------------- GSB */

const NOW = Date.parse("2026-08-12T00:00:00Z");
const gsbFixture = (cornersTotal) => ({
  status: "FT",
  score: { home: 1, away: 1 },
  marketTotals: { cornersTotal }
});
const gsbSelection = (side, line) => ({
  market: "corners",
  side,
  line,
  selection: `${side} ${formatLineLabel(line)}`,
  kickoff_at: "2026-08-11T18:00:00Z"
});

test("GSB: integer push settles the leg VOID immediately — never LOST", () => {
  assert.equal(settleSelection(gsbSelection("under", 10), gsbFixture(9), NOW), SELECTION_STATUS.WON);
  assert.equal(settleSelection(gsbSelection("under", 10), gsbFixture(10), NOW), SELECTION_STATUS.VOID);
  assert.equal(settleSelection(gsbSelection("under", 10), gsbFixture(11), NOW), SELECTION_STATUS.LOST);
  assert.equal(settleSelection(gsbSelection("over", 10), gsbFixture(10), NOW), SELECTION_STATUS.VOID);
});

test("GSB: one push leg among winners keeps the bet WON at multiplier 1.00", () => {
  const statuses = [SELECTION_STATUS.WON, SELECTION_STATUS.VOID, SELECTION_STATUS.WON];
  assert.equal(aggregateBetStatus(statuses), BET_STATUS.WON);
  const settled = computeSettledTotalOdds(
    [
      { status: SELECTION_STATUS.WON, odds: 1.5 },
      { status: SELECTION_STATUS.VOID, odds: 1.85 },
      { status: SELECTION_STATUS.WON, odds: 2.0 }
    ],
    BET_STATUS.WON
  );
  assert.equal(settled, 3.0, "void leg contributes exactly 1.00");
});

test("GSB engine refuses quarter-line legs explicitly (no approximation)", () => {
  const row = (line, type) => ({
    id: 1,
    leagueId: 39,
    kickoff: new Date(NOW + 3_600_000).toISOString(),
    teams: { home: "A", away: "B" },
    league: "Premier League",
    recommended: { confidence: 80 },
    modelMeta: { dataQuality: 0.8 },
    valueEngine: {
      markets: [
        {
          type,
          family: "Corners",
          line,
          odds: 1.9,
          probability: 0.7,
          valueScore: 70,
          recommendable: true,
          tradable: true,
          betType: "corners",
          period: "full_match",
          scope: "match"
        }
      ]
    }
  });
  const quarter = collectGlobalCandidates({ rows: [row(10.25, "Under 10.25")], leagueIds: [39], now: NOW });
  assert.equal(quarter.candidates.length, 0);
  assert.equal(quarter.rejected.quarterLineUnsupported, 1);

  const integer = collectGlobalCandidates({ rows: [row(10, "Under 10")], leagueIds: [39], now: NOW });
  assert.equal(integer.candidates.length, 1, "integer lines stay eligible (push → void)");
  assert.equal(integer.candidates[0].selection, "Under 10", "lossless label in the snapshot");
});

/* -------------------------------------------------------- line formatting */

test("line formatting stays lossless end to end", () => {
  assert.equal(formatLineLabel(10), "10");
  assert.equal(formatLineLabel(10.25), "10.25");
  assert.equal(formatLineLabel(10.5), "10.5");
  assert.equal(formatLineLabel(10.75), "10.75");
});
