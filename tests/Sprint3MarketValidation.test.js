import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateCardsMarket,
  evaluateCleanSheetMarket,
  evaluateMotivationMarket,
  evaluateCorrectScoreMarket,
  buildSprint3MarketValidationReport
} from "../server-utils/backtest/Sprint3MarketValidation.js";

function settledRow(overrides = {}) {
  return {
    score_home: 1,
    score_away: 1,
    league_id: 39,
    league_name: "EPL",
    raw_payload: {},
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

test("evaluateCardsMarket: zero coverage when probs.cards is absent (flag off)", () => {
  const rows = [settledRow(), settledRow()];
  const out = evaluateCardsMarket(rows);
  assert.equal(out.coverage, 0);
  assert.equal(out.sampleCount, 0);
  assert.equal(out.verdict, "insufficient_sample");
  assert.match(out.reason, /PREDICT_ENABLE_CARDS/);
});

test("evaluateCardsMarket: coverage without gradable sample when marketResults.cardsTotal is missing", () => {
  const rows = [
    settledRow({ raw_payload: { probs: { cards: { total: { o3_5: 60, o4_5: 40 } } } } })
  ];
  const out = evaluateCardsMarket(rows);
  assert.equal(out.coverage, 1);
  assert.equal(out.sampleCount, 0);
  assert.match(out.reason, /cardsTotal/);
});

test("evaluateCardsMarket: scores real Brier/LogLoss/accuracy when actual totals exist", () => {
  const rows = Array.from({ length: 20 }, () =>
    settledRow({
      raw_payload: {
        probs: { cards: { total: { o3_5: 80 } } },
        marketResults: { cardsTotal: 5 } // over 3.5 -> actual=1, prediction 80% over -> correct
      }
    })
  );
  const out = evaluateCardsMarket(rows, { minSample: 10 });
  assert.equal(out.coverage, 20);
  assert.equal(out.sampleCount, 20);
  assert.ok(out.brier < 0.1);
  assert.equal(out.accuracyPct, 100);
  assert.equal(out.verdict, "neutral");
  assert.ok(out.calibrationBuckets.length > 0);
});

// ---------------------------------------------------------------------------
// Clean Sheet
// ---------------------------------------------------------------------------

test("evaluateCleanSheetMarket: reuses Sprint1FeatureReport and adds degradedCases", () => {
  const improvingRows = Array.from({ length: 32 }, () =>
    settledRow({
      score_home: 1,
      score_away: 1,
      raw_payload: {
        evaluation: { calibratedSideMarketsPct: { pGG: 50 } },
        probs: { pGG: 85 }
      }
    })
  );
  const out = evaluateCleanSheetMarket(improvingRows);
  assert.equal(out.sampleCount, 32);
  assert.equal(out.verdict, "improved");
  assert.equal(out.degradedCases, 0);
  assert.ok(out.improvementPct > 0);
});

test("evaluateCleanSheetMarket: counts degraded rows when the blend moves away from actual", () => {
  const degradingRows = Array.from({ length: 32 }, () =>
    settledRow({
      score_home: 1,
      score_away: 1,
      raw_payload: {
        evaluation: { calibratedSideMarketsPct: { pGG: 80 } },
        probs: { pGG: 20 }
      }
    })
  );
  const out = evaluateCleanSheetMarket(degradingRows);
  assert.equal(out.degradedCases, 32);
  assert.equal(out.verdict, "degraded");
});

test("evaluateCleanSheetMarket: pre-deploy rows (identical baseline/enhanced) are excluded from the evaluation sample and never reported as degraded (Sprint 4.5 fix)", () => {
  const preDeployRows = Array.from({ length: 43 }, () =>
    settledRow({
      score_home: 0,
      score_away: 0,
      raw_payload: { evaluation: { calibratedSideMarketsPct: { pGG: 42 } }, probs: { pGG: 42 } }
    })
  );
  const postDeployRows = Array.from({ length: 4 }, () =>
    settledRow({
      score_home: 0,
      score_away: 0,
      raw_payload: { evaluation: { calibratedSideMarketsPct: { pGG: 45 } }, probs: { pGG: 53 } }
    })
  );
  const out = evaluateCleanSheetMarket([...preDeployRows, ...postDeployRows]);
  assert.equal(out.totalRowsAnalyzed, 47);
  assert.equal(out.featureAvailableCount, 47);
  assert.equal(out.featureAppliedCount, 4);
  assert.equal(out.skippedCount, 43);
  assert.equal(out.sampleCount, 4);
  assert.equal(out.coverage, 47);
  assert.equal(out.verdict, "insufficient_sample");
  // No pre-deploy row can ever be "degraded" (baseline===enhanced trivially) — only
  // the 4 applied rows are even eligible to count.
  assert.ok(out.degradedCases <= 4);
});

// ---------------------------------------------------------------------------
// Motivation
// ---------------------------------------------------------------------------

test("evaluateMotivationMarket: zero sample when no rows carry debug metadata", () => {
  const rows = [settledRow(), settledRow()];
  const out = evaluateMotivationMarket(rows);
  assert.equal(out.sampleCount, 0);
  assert.equal(out.verdict, "insufficient_sample");
  assert.equal(out.reason, "PREDICT_DEBUG_METADATA was disabled during prediction generation.");
  assert.equal(out.action, "Enable flag and collect new predictions.");
});

test("evaluateMotivationMarket: splits active/inactive, groups by keyword, flags insufficient sample below minSample", () => {
  const activeRow = (correct, keywordHome) =>
    settledRow({
      score_home: correct ? 2 : 0,
      score_away: 0,
      raw_payload: {
        probs: { p1: 70, pX: 20, p2: 10 },
        modelMeta: {
          debug: {
            motivation: { active: true, source: "standings_rank", competitionKeywordHome: keywordHome, competitionKeywordAway: null }
          }
        }
      }
    });
  const inactiveRow = (correct) =>
    settledRow({
      score_home: correct ? 2 : 0,
      score_away: 0,
      raw_payload: {
        probs: { p1: 70, pX: 20, p2: 10 },
        modelMeta: { debug: { motivation: { active: false, source: null, competitionKeywordHome: null, competitionKeywordAway: null } } }
      }
    });

  const rows = [
    ...Array.from({ length: 5 }, () => activeRow(true, "champion")),
    ...Array.from({ length: 2 }, () => inactiveRow(true))
  ];
  const out = evaluateMotivationMarket(rows, { minSample: 3 });
  assert.equal(out.activatedCount, 5);
  assert.equal(out.inactiveCount, 2);
  // inactive group (2) is below minSample=3 -> comparison not meaningful
  assert.equal(out.verdict, "insufficient_sample");
  const champion = out.byKeyword.find((k) => k.keyword === "champion");
  assert.equal(champion.sampleCount, 5);
  assert.equal(champion.accuracyPct, 100);
  const relegation = out.byKeyword.find((k) => k.keyword === "relegation");
  assert.equal(relegation.sampleCount, 0);
  assert.equal(relegation.accuracyPct, null);
});

test("evaluateMotivationMarket: computes a real accuracy delta once both groups clear minSample", () => {
  const row = (active, correct) =>
    settledRow({
      score_home: correct ? 2 : 0,
      score_away: 0,
      raw_payload: {
        probs: { p1: 70, pX: 20, p2: 10 },
        modelMeta: { debug: { motivation: { active, source: active ? "standings_rank" : null, competitionKeywordHome: null, competitionKeywordAway: null } } }
      }
    });
  const rows = [
    ...Array.from({ length: 32 }, () => row(true, true)), // active, always correct
    ...Array.from({ length: 32 }, () => row(false, false)) // inactive, always wrong
  ];
  const out = evaluateMotivationMarket(rows);
  assert.equal(out.activeAccuracyPct, 100);
  assert.equal(out.inactiveAccuracyPct, 0);
  assert.equal(out.improvementPct, 100);
  assert.equal(out.verdict, "improved");
  assert.equal(out.degradedCases, 0);
});

// ---------------------------------------------------------------------------
// Correct Score
// ---------------------------------------------------------------------------

function correctScoreRow({ homeGoals, awayGoals, candidates }) {
  return settledRow({
    score_home: homeGoals,
    score_away: awayGoals,
    raw_payload: {
      valueEngine: { markets: candidates }
    }
  });
}

test("evaluateCorrectScoreMarket: zero sample when no Correct Score candidates persisted", () => {
  const rows = [settledRow(), settledRow()];
  const out = evaluateCorrectScoreMarket(rows);
  assert.equal(out.sampleCount, 0);
  assert.equal(out.verdict, "insufficient_sample");
});

test("evaluateCorrectScoreMarket: computes top1/top3/avgAssignedProbability and ROI on recommended picks", () => {
  const win = () =>
    correctScoreRow({
      homeGoals: 2,
      awayGoals: 1,
      candidates: [
        { type: "Correct Score 2-1", family: "Correct Score", probability: 0.18, odds: 7.5, bestMarket: true },
        { type: "Correct Score 1-1", family: "Correct Score", probability: 0.15, odds: 6.0, bestMarket: false },
        { type: "Correct Score 1-0", family: "Correct Score", probability: 0.12, odds: 8.0, bestMarket: false }
      ]
    });
  const loss = () =>
    correctScoreRow({
      homeGoals: 0,
      awayGoals: 0,
      candidates: [
        { type: "Correct Score 2-1", family: "Correct Score", probability: 0.18, odds: 7.5, bestMarket: true },
        { type: "Correct Score 1-1", family: "Correct Score", probability: 0.15, odds: 6.0, bestMarket: false }
      ]
    });

  const rows = [...Array.from({ length: 25 }, win), ...Array.from({ length: 5 }, loss)];
  const out = evaluateCorrectScoreMarket(rows, { minSample: 10 });
  assert.equal(out.sampleCount, 30);
  // win() rows: actual "2-1" is the top-probability candidate -> hits top1 and top3.
  // loss() rows: actual "0-0" never appears among that row's candidates -> misses both.
  assert.equal(out.top1AccuracyPct, Number(((25 / 30) * 100).toFixed(2)));
  assert.equal(out.top3AccuracyPct, Number(((25 / 30) * 100).toFixed(2)));
  assert.equal(out.recommendedCount, 30);
  assert.equal(out.recommendedHitRatePct, Number(((25 / 30) * 100).toFixed(2)));
  assert.equal(out.roiSimulation.stakedBets, 30);
  assert.equal(out.roiSimulation.lossCount, 5);
  // PnL: 25 wins * (7.5-1) + 5 losses * (-1) = 25*6.5 - 5 = 162.5 - 5 = 157.5 ; stake 30 -> ROI% = 157.5/30*100
  assert.equal(out.roiSimulation.roiPct, Number(((157.5 / 30) * 100).toFixed(2)));
  assert.equal(out.degradedCases, 5);
  assert.equal(out.verdict, "improved");
});

test("evaluateCorrectScoreMarket: avgAssignedProbabilityPct is 0 when actual score never appears among candidates", () => {
  const rows = Array.from({ length: 12 }, () =>
    correctScoreRow({
      homeGoals: 3,
      awayGoals: 3,
      candidates: [{ type: "Correct Score 1-0", family: "Correct Score", probability: 0.2, odds: 8, bestMarket: true }]
    })
  );
  const out = evaluateCorrectScoreMarket(rows, { minSample: 5 });
  assert.equal(out.avgAssignedProbabilityPct, 0);
  assert.equal(out.top1AccuracyPct, 0);
});

test("evaluateCorrectScoreMarket: engineStatus flags 'odds unavailable, no algorithm issue' when familiesSupported has Correct Score but familiesPresent doesn't (Sprint 4 real-data shape)", () => {
  const rows = [
    settledRow({
      raw_payload: {
        valueEngine: {
          familiesSupported: ["1X2", "Double Chance", "BTTS", "Over/Under", "Corners", "Cards", "Correct Score"],
          familiesPresent: ["1X2", "Double Chance", "BTTS", "Over/Under", "Corners"],
          markets: []
        },
        marketOdds: { btts: {}, corners: {}, goals25: {}, goals35: {} }
      }
    })
  ];
  const out = evaluateCorrectScoreMarket(rows);
  assert.equal(out.engineStatus.active, true);
  assert.equal(out.engineStatus.oddsAvailableCount, 0);
  assert.equal(out.engineStatus.oddsMissingCount, 1);
  assert.match(out.engineStatus.diagnosis, /Bookmaker odds unavailable/);
  assert.match(out.engineStatus.diagnosis, /No algorithm issue detected/);
  assert.deepEqual(out.engineStatus.availableMarketKeys, ["btts", "corners", "goals25", "goals35"]);
  assert.deepEqual(out.engineStatus.missingMarketKeys, ["correctScore"]);
});

test("evaluateCorrectScoreMarket: engineStatus reports engine not detected when no row carries valueEngine.familiesSupported", () => {
  const out = evaluateCorrectScoreMarket([settledRow(), settledRow()]);
  assert.equal(out.engineStatus.active, false);
  assert.match(out.engineStatus.diagnosis, /not detected/);
});

// ---------------------------------------------------------------------------
// Full report
// ---------------------------------------------------------------------------

test("buildSprint3MarketValidationReport: assembles all four features, filters unsettled rows, maps verdict->recommendation", () => {
  const rows = [
    settledRow(),
    { score_home: null, score_away: null, raw_payload: {} } // unsettled, excluded
  ];
  const report = buildSprint3MarketValidationReport(rows);
  assert.equal(report.totalSamples, 1);
  assert.equal(report.features.length, 4);
  for (const f of report.features) {
    assert.ok(["keep", "tune", "disable", "insufficient_sample"].includes(f.recommendation));
    assert.ok(Number.isFinite(f.coveragePct));
  }
  const cards = report.features.find((f) => f.market === "Cards Market");
  assert.equal(cards.recommendation, "insufficient_sample");
});
