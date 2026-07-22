/**
 * Auto model-lab override — applies the automatically-promoted blend recipe.
 * Default "E" (everything) is a no-op that keeps the full
 * calibration+stacker+market stack; simpler promoted recipes override the
 * final 1X2 from their reconstructed sources for this fixture.
 * Extracted verbatim from Stage07ModelFusion.js (no logic changes).
 */

import { blendModel, getModelById } from "../../modelLab/ModelLab.js";
import { buildXgSourceProbs } from "../PredictorV2.js";

/**
 * @param {{ activeModelId: string|null, xgLambdasForSources: object|null, fixtureId: number,
 *   poissonCorrelation: number, leagueParams: object, pRaw: {p1:number,pX:number,p2:number},
 *   eloInfo: object|null, marketProbs: object|null, modularScores: object|null,
 *   p1Adj: number, pXAdj: number, p2Adj: number }} params
 * @returns {{ p1Adj: number, pXAdj: number, p2Adj: number, appliedModelId: string }}
 */
export function applyModelLabOverride({
  activeModelId,
  xgLambdasForSources,
  fixtureId,
  poissonCorrelation,
  leagueParams,
  pRaw,
  eloInfo,
  marketProbs,
  modularScores,
  p1Adj,
  pXAdj,
  p2Adj
}) {
  let appliedModelId = "E";
  if (activeModelId && !["E", "EVERYTHING"].includes(String(activeModelId).toUpperCase())) {
    try {
      const model = getModelById(activeModelId);
      if (model) {
        const toFrac = (t) => (t ? { p1: t.p1 / 100, pX: t.pX / 100, p2: t.p2 / 100 } : null);
        const xgSourceProbs =
          buildXgSourceProbs(xgLambdasForSources?.xgHome, xgLambdasForSources?.xgAway, {
            fixtureId,
            correlation: poissonCorrelation,
            rho: leagueParams.rho
          }) || toFrac(pRaw);
        const sources = {
          poisson: toFrac(pRaw),
          xg: xgSourceProbs,
          elo: eloInfo?.probs ? { p1: eloInfo.probs.p1, pX: eloInfo.probs.pX, p2: eloInfo.probs.p2 } : null,
          market: marketProbs ? { p1: marketProbs.p1, pX: marketProbs.pX, p2: marketProbs.p2 } : null,
          everything: { p1: p1Adj / 100, pX: pXAdj / 100, p2: p2Adj / 100 }
        };
        const injuriesDetail = modularScores?.injuries?.detail || modularScores?.injuries?.details || null;
        const injuries = injuriesDetail
          ? { home: Number(injuriesDetail.home) || 1, away: Number(injuriesDetail.away) || 1 }
          : null;
        const blended = blendModel(model, sources, injuries);
        if (blended && Number.isFinite(blended.p1)) {
          p1Adj = blended.p1 * 100;
          pXAdj = blended.pX * 100;
          p2Adj = blended.p2 * 100;
          appliedModelId = model.id;
        }
      }
    } catch {
      appliedModelId = "E";
    }
  }

  return { p1Adj, pXAdj, p2Adj, appliedModelId };
}

export default applyModelLabOverride;
