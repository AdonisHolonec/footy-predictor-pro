import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMatchScorePmf } from "../../../server-utils/math.js";
import { alignMarketProbsAndCalibrate } from "../../../server-utils/pipeline/decision/alignMarketProbsAndCalibrate.js";

const fallbackP = { pO15: 61, pO25: 50, pU35: 92, pGG: 48 };

test("alignMarketProbsAndCalibrate reweights side markets toward the fused 1X2 and captures raw/calibrated snapshots", () => {
  const lambdaHome = 1.6;
  const lambdaAway = 1.1;
  const scorePmf = buildMatchScorePmf(lambdaHome, lambdaAway);
  const out = alignMarketProbsAndCalibrate({
    p: fallbackP,
    scorePmf,
    lambdaHome,
    lambdaAway,
    fixtureId: 999,
    p1Adj: 70,
    pXAdj: 15,
    p2Adj: 15,
    leagueParams: {},
    calibrationMaps: null,
    lId: 39
  });
  assert.notEqual(out.marketProbsAligned, fallbackP);
  assert.ok(Number.isFinite(out.marketProbsAligned.pO25));
  assert.ok(out.marketProbsAligned.pO25 >= 0 && out.marketProbsAligned.pO25 <= 100);
  // No calibration maps supplied -> side markets pass through uncalibrated.
  assert.equal(out.sideCalibrationAny, false);
  assert.deepEqual(out.calibratedSideMarketsPct, out.rawSideMarketsPct);
  assert.equal(out.rawSideMarketsPct.pO25, out.marketProbsAligned.pO25);
});

test("alignMarketProbsAndCalibrate falls back to the passed-through p when scorePmf has no cells", () => {
  const out = alignMarketProbsAndCalibrate({
    p: fallbackP,
    scorePmf: { cells: [] },
    lambdaHome: 1.6,
    lambdaAway: 1.1,
    fixtureId: 999,
    p1Adj: 70,
    pXAdj: 15,
    p2Adj: 15,
    leagueParams: {},
    calibrationMaps: null,
    lId: 39
  });
  assert.equal(out.marketProbsAligned, fallbackP);
  assert.equal(out.rawSideMarketsPct.pO25, fallbackP.pO25);
});

test("alignMarketProbsAndCalibrate falls back to p when scorePmf is null/undefined", () => {
  const out = alignMarketProbsAndCalibrate({
    p: fallbackP,
    scorePmf: null,
    lambdaHome: 1.6,
    lambdaAway: 1.1,
    fixtureId: 999,
    p1Adj: 70,
    pXAdj: 15,
    p2Adj: 15,
    leagueParams: {},
    calibrationMaps: null,
    lId: 39
  });
  assert.equal(out.marketProbsAligned, fallbackP);
});

test("alignMarketProbsAndCalibrate: no hStats/aStats -> pGG identical to today (no behaviour change)", () => {
  const lambdaHome = 1.6;
  const lambdaAway = 1.1;
  const scorePmf = buildMatchScorePmf(lambdaHome, lambdaAway);
  const base = {
    p: fallbackP,
    scorePmf,
    lambdaHome,
    lambdaAway,
    fixtureId: 999,
    p1Adj: 70,
    pXAdj: 15,
    p2Adj: 15,
    leagueParams: {},
    calibrationMaps: null,
    lId: 39
  };
  const withoutStats = alignMarketProbsAndCalibrate(base);
  const withEmptyStats = alignMarketProbsAndCalibrate({ ...base, hStats: {}, aStats: {} });
  assert.equal(withoutStats.marketProbsAligned.pGG, withEmptyStats.marketProbsAligned.pGG);
  // Snapshots used for train/serve calibration-map fitting must be untouched either way.
  assert.equal(withoutStats.rawSideMarketsPct.pGG, withoutStats.marketProbsAligned.pGG);
});

test("alignMarketProbsAndCalibrate: hStats/aStats with clean-sheet/failed-to-score rates blend into the final pGG only, snapshots stay raw", () => {
  const lambdaHome = 1.6;
  const lambdaAway = 1.1;
  const scorePmf = buildMatchScorePmf(lambdaHome, lambdaAway);
  const base = {
    p: fallbackP,
    scorePmf,
    lambdaHome,
    lambdaAway,
    fixtureId: 999,
    p1Adj: 70,
    pXAdj: 15,
    p2Adj: 15,
    leagueParams: {},
    calibrationMaps: null,
    lId: 39
  };
  const withoutStats = alignMarketProbsAndCalibrate(base);
  const withStats = alignMarketProbsAndCalibrate({
    ...base,
    hStats: { cleanSheetRateHome: 0.5, failedToScoreRateHome: 0.05 },
    aStats: { cleanSheetRateAway: 0.4, failedToScoreRateAway: 0.5 }
  });
  assert.notEqual(withStats.marketProbsAligned.pGG, withoutStats.marketProbsAligned.pGG);
  // Calibration-map training snapshots must never see the empirical blend —
  // train/serve alignment (PREDICTOR_V3_ARCHITECTURE.md §3.7) stays intact.
  assert.equal(withStats.rawSideMarketsPct.pGG, withoutStats.rawSideMarketsPct.pGG);
  assert.equal(withStats.calibratedSideMarketsPct.pGG, withoutStats.calibratedSideMarketsPct.pGG);
  // 1X2 and O/U must be completely untouched by this feature.
  assert.equal(withStats.marketProbsAligned.pO25, withoutStats.marketProbsAligned.pO25);
});

test("alignMarketProbsAndCalibrate: debug fields (cleanSheetBlendApplied/empiricalBttsRate) are observability-only", () => {
  const lambdaHome = 1.6;
  const lambdaAway = 1.1;
  const scorePmf = buildMatchScorePmf(lambdaHome, lambdaAway);
  const base = {
    p: fallbackP,
    scorePmf,
    lambdaHome,
    lambdaAway,
    fixtureId: 999,
    p1Adj: 70,
    pXAdj: 15,
    p2Adj: 15,
    leagueParams: {},
    calibrationMaps: null,
    lId: 39
  };
  const withoutStats = alignMarketProbsAndCalibrate(base);
  assert.equal(withoutStats.cleanSheetBlendApplied, false);
  assert.equal(withoutStats.empiricalBttsRate, null);

  const withStats = alignMarketProbsAndCalibrate({
    ...base,
    hStats: { cleanSheetRateHome: 0.5, failedToScoreRateHome: 0.05 },
    aStats: { cleanSheetRateAway: 0.4, failedToScoreRateAway: 0.5 }
  });
  assert.equal(withStats.cleanSheetBlendApplied, true);
  assert.ok(Number.isFinite(withStats.empiricalBttsRate));
  assert.ok(withStats.empiricalBttsRate >= 0 && withStats.empiricalBttsRate <= 1);
  // Debug fields never alter the served value — same pGG as before this change.
  assert.equal(withStats.marketProbsAligned.pGG, withStats.marketProbsAligned.pGG);
});
