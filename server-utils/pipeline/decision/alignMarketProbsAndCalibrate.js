/**
 * Rebuild O/U + BTTS from the score PMF reweighted to the fused 1X2 so tip
 * markets stay coherent, then apply side-market isotonic calibration.
 * Extracted verbatim from Stage08Decision.js (no logic changes).
 */

import { computeMatchProbs, reweightPmfTo1x2, blendBttsWithEmpirical, computeEmpiricalBttsRate } from "../../math.js";
import { applyLeagueMarketPriors } from "../../leagueProfiles/LeagueProfile.js";
import { applySideMarketCalibration, pickCalibrationMapForLeague } from "../../isotonicCalibration.js";

/**
 * @param {{ p: object, scorePmf: object|null, lambdaHome: number, lambdaAway: number,
 *   fixtureId: number, p1Adj: number, pXAdj: number, p2Adj: number, leagueParams: object,
 *   calibrationMaps: object, lId: number, hStats: object|null, aStats: object|null }} params
 *   hStats/aStats are optional — when present and carrying clean-sheet/failed-to-score
 *   rates (server-utils/math.js:extractAdvancedGoalsAverages), the final BTTS/GG value
 *   gets a small empirical blend (see below); otherwise behaviour is unchanged.
 * @returns {{ marketProbsAligned: object, rawSideMarketsPct: object,
 *   calibratedSideMarketsPct: object, sideCalibrationAny: boolean }}
 */
export function alignMarketProbsAndCalibrate({
  p,
  scorePmf,
  lambdaHome,
  lambdaAway,
  fixtureId,
  p1Adj,
  pXAdj,
  p2Adj,
  leagueParams,
  calibrationMaps,
  lId,
  hStats,
  aStats
}) {
  let marketProbsAligned = p;
  if (scorePmf?.cells?.length) {
    try {
      const alignedPmf = reweightPmfTo1x2(scorePmf, {
        p1: p1Adj,
        pX: pXAdj,
        p2: p2Adj
      });
      const calcAligned = computeMatchProbs(lambdaHome, lambdaAway, fixtureId, { pmf: alignedPmf });
      if (calcAligned?.probs) {
        marketProbsAligned = applyLeagueMarketPriors(calcAligned.probs, leagueParams);
      }
    } catch {
      marketProbsAligned = p;
    }
  }
  // Persist pre-side-cal markets for train/serve lock on O/U + BTTS maps.
  const rawSideMarketsPct = {
    pO15: marketProbsAligned.pO15,
    pO25: marketProbsAligned.pO25,
    pU35: marketProbsAligned.pU35,
    pGG: marketProbsAligned.pGG
  };
  const sideMaps = pickCalibrationMapForLeague(calibrationMaps, lId);
  const sideCalEnabled = String(process.env.SIDE_MARKET_CALIBRATION || "1") !== "0";
  let sideCalibrationAny = false;
  if (sideCalEnabled && sideMaps) {
    const calSides = applySideMarketCalibration(marketProbsAligned, sideMaps);
    marketProbsAligned = calSides;
    sideCalibrationAny = Boolean(calSides.sideCalibrationAny);
  }
  const calibratedSideMarketsPct = {
    pO15: marketProbsAligned.pO15,
    pO25: marketProbsAligned.pO25,
    pU35: marketProbsAligned.pU35,
    pGG: marketProbsAligned.pGG
  };

  // Empirical clean-sheet / failed-to-score refinement — strictly AFTER the raw/calibrated
  // snapshots above, so train/serve calibration-map data is never touched by this. Only the
  // served pGG (and its derived pNGG downstream) is adjusted; falls back to the unchanged
  // value whenever the four rates aren't all available (see blendBttsWithEmpirical).
  // cleanSheetBlendApplied/empiricalBttsRate are debug-only observability fields (Sprint 2) —
  // computed alongside the real blend, never fed back into marketProbsAligned themselves.
  let cleanSheetBlendApplied = false;
  let empiricalBttsRate = null;
  if (marketProbsAligned.pGG != null) {
    const rates = {
      cleanSheetRateHome: hStats?.cleanSheetRateHome,
      cleanSheetRateAway: aStats?.cleanSheetRateAway,
      failedToScoreRateHome: hStats?.failedToScoreRateHome,
      failedToScoreRateAway: aStats?.failedToScoreRateAway
    };
    empiricalBttsRate = computeEmpiricalBttsRate(rates);
    const blendedPGG = blendBttsWithEmpirical(marketProbsAligned.pGG, rates);
    if (blendedPGG !== marketProbsAligned.pGG) {
      cleanSheetBlendApplied = true;
      marketProbsAligned = { ...marketProbsAligned, pGG: blendedPGG };
    }
  }

  return {
    marketProbsAligned,
    rawSideMarketsPct,
    calibratedSideMarketsPct,
    sideCalibrationAny,
    cleanSheetBlendApplied,
    empiricalBttsRate
  };
}

export default alignMarketProbsAndCalibrate;
