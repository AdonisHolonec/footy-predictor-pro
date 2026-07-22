/**
 * Stacker application + market blend fallback.
 * Stacker features use *calibrated* 1X2 (never raw Poisson alone). After the
 * stacker, still blend with the Shin market so calibration is never bypassed.
 * Extracted verbatim from Stage07ModelFusion.js (no logic changes).
 */

import { dataQualityScore } from "../predictHelpers.js";
import { pickStackerWeightsForLeague, extractStackerFeatures, applyStacker } from "../../mlStacker.js";
import { blendModelWithMarket } from "../../advancedMath.js";

/**
 * @param {{ stackerWeightsMap: Map, lId: number, method: string, odds: object|null,
 *   luckStats: object|null, homeIdStr: string, awayIdStr: string, calTriple: object|null,
 *   eloInfo: object|null, leagueParams: object, marketProbs: object|null, blendW: number,
 *   pRaw: {p1:number,pX:number,p2:number} }} params
 * @returns {{ stackerEntry: object|null, dataQualityEarly: number, pFinal: {p1:number,pX:number,p2:number},
 *   stackerApplied: boolean }}
 */
export function applyStackerBlend({
  stackerWeightsMap,
  lId,
  method,
  odds,
  luckStats,
  homeIdStr,
  awayIdStr,
  calTriple,
  eloInfo,
  leagueParams,
  marketProbs,
  blendW,
  pRaw
}) {
  const stackerEntry = pickStackerWeightsForLeague(stackerWeightsMap, lId);
  const dataQualityEarly = dataQualityScore({
    method,
    hasOdds: !!odds,
    hasLuckStats: !!luckStats,
    hasTeamIds: !!homeIdStr && !!awayIdStr
  });

  let pFinal = null;
  let stackerApplied = false;
  const calibratedFrac = {
    p1: Number(calTriple?.p1),
    pX: Number(calTriple?.pX),
    p2: Number(calTriple?.p2)
  };
  const hasCalibrated =
    Number.isFinite(calibratedFrac.p1) && Number.isFinite(calibratedFrac.pX) && Number.isFinite(calibratedFrac.p2);

  if (stackerEntry?.weights && hasCalibrated) {
    const feats = extractStackerFeatures({
      poissonProbs: calibratedFrac,
      marketProbs,
      eloSpread: eloInfo?.eloSpread || 0,
      dataQuality: dataQualityEarly,
      homeAdv: leagueParams.homeAdv,
      rho: leagueParams.rho
    });
    const stacked = applyStacker(feats, stackerEntry.weights);
    if (stacked) {
      pFinal = marketProbs
        ? blendModelWithMarket({ model: stacked, market: marketProbs, modelWeight: blendW }) || stacked
        : stacked;
      stackerApplied = true;
    }
  }
  if (!pFinal) {
    // Fallback: model calibrat + blend liniar cu piaţa + drift penalty.
    const modelFrac = hasCalibrated ? calibratedFrac : { p1: pRaw.p1 / 100, pX: pRaw.pX / 100, p2: pRaw.p2 / 100 };
    const blended = marketProbs
      ? blendModelWithMarket({ model: modelFrac, market: marketProbs, modelWeight: blendW })
      : modelFrac;
    pFinal = blended || modelFrac;
  }

  return { stackerEntry, dataQualityEarly, pFinal, stackerApplied };
}

export default applyStackerBlend;
