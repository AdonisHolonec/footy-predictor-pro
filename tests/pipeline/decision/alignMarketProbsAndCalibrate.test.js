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
