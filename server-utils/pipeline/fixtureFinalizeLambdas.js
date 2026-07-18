/**
 * P4 — Finalize λ with live rolling hydrate + late xG blend BEFORE Poisson/MC.
 * Shared helper (not a stage) so Stage04 can lock λ once.
 */

import { getPredictionWeights } from "../prediction/PredictionEngine.js";
import { deriveXgLambdas } from "../xg/RollingXgModel.js";
import { blendLambdasWithXg } from "./PredictorV2.js";
import { hasUsableRolling, buildLiveRollingForTeam, roundDisplayRate } from "./predictHelpers.js";

/**
 * Hydrate thin rolling rows, derive rolling xG, blend into λ when early xG missed.
 * Mutates context.fixture (and may write liveRollingCache).
 *
 * @param {object} context
 * @returns {Promise<object>} context
 */
export async function finalizeLambdasWithRollingXg(context) {
  const f = context.fixture;
  const league = context.league;
  if (!f || !league) return context;

  const lId = league.lId;
  const leagueParams = league.leagueParams;
  const marketRollingMap = league.marketRollingMap;
  const season = context.season;
  const liveRollingCache = context.liveRollingCache || new Map();
  const statsBudgetRef = context.statsBudgetRef || { remaining: 0 };
  context.liveRollingCache = liveRollingCache;

  const homeIdStr = f.homeIdStr;
  const awayIdStr = f.awayIdStr;

  let rollingHome = homeIdStr ? marketRollingMap.get(Number(homeIdStr)) : null;
  let rollingAway = awayIdStr ? marketRollingMap.get(Number(awayIdStr)) : null;
  let liveRollingApplied = false;

  if ((!hasUsableRolling(rollingHome) || !hasUsableRolling(rollingAway)) && homeIdStr && awayIdStr) {
    const teamIdsToHydrate = [];
    if (!hasUsableRolling(rollingHome)) teamIdsToHydrate.push(Number(homeIdStr));
    if (!hasUsableRolling(rollingAway)) teamIdsToHydrate.push(Number(awayIdStr));
    for (const tid of teamIdsToHydrate) {
      const cacheKey = `${lId}:${season}:${tid}`;
      if (!liveRollingCache.has(cacheKey)) {
        const built = await buildLiveRollingForTeam({
          leagueId: Number(lId),
          season: Number(season),
          teamId: tid,
          statsBudgetRef
        });
        liveRollingCache.set(cacheKey, built);
      }
    }
    if (!hasUsableRolling(rollingHome)) {
      rollingHome = liveRollingCache.get(`${lId}:${season}:${Number(homeIdStr)}`) || rollingHome;
    }
    if (!hasUsableRolling(rollingAway)) {
      rollingAway = liveRollingCache.get(`${lId}:${season}:${Number(awayIdStr)}`) || rollingAway;
    }
    liveRollingApplied = true;
  }

  let lambdaHome = f.lambdaHome;
  let lambdaAway = f.lambdaAway;
  let luckStats = f.luckStats;
  let xgLambdasForSources = f.xgLambdasForSources;
  let xgModelMeta = { source: "lambda_fallback", applied: false, blendedIntoLambda: false };
  const strengthMeta = f.strengthMeta;

  try {
    const xgLambdas = deriveXgLambdas({
      rollingHome,
      rollingAway,
      leagueBaseXg: leagueParams.leagueAvg,
      homeAdv: leagueParams.homeAdv,
      awayAdv: leagueParams.awayAdv
    });
    if (xgLambdas && Number.isFinite(xgLambdas.xgHome) && Number.isFinite(xgLambdas.xgAway)) {
      xgLambdasForSources = xgLambdas;
      if (luckStats) {
        luckStats = {
          ...luckStats,
          hXG: roundDisplayRate(xgLambdas.xgHome),
          aXG: roundDisplayRate(xgLambdas.xgAway),
          xgSource: xgLambdas.source,
          intensityNote: "rolling_xg_model"
        };
      }
      const hadEarlyXg = Boolean(strengthMeta?.xgBlend?.applied);
      xgModelMeta = {
        source: xgLambdas.source,
        applied: true,
        sample: xgLambdas.sample,
        blendedIntoLambda: hadEarlyXg
      };
      // Late path: xG available after engine build → blend into λ before Poisson.
      if (!hadEarlyXg) {
        const xgW = Number(getPredictionWeights().expectedGoals) || 0;
        const blended = blendLambdasWithXg(
          lambdaHome,
          lambdaAway,
          xgLambdas.xgHome,
          xgLambdas.xgAway,
          xgW
        );
        if (blended.applied) {
          lambdaHome = blended.lambdaHome;
          lambdaAway = blended.lambdaAway;
          xgModelMeta.blendedIntoLambda = true;
          xgModelMeta.blendWeight = blended.weight;
        }
      }
    }
  } catch {
    xgModelMeta = { source: "lambda_fallback", applied: false, blendedIntoLambda: false };
  }

  Object.assign(f, {
    rollingHome,
    rollingAway,
    liveRollingApplied,
    lambdaHome,
    lambdaAway,
    luckStats,
    xgLambdasForSources,
    xgModelMeta,
    lambdasFinalized: true
  });

  return context;
}

export default { finalizeLambdasWithRollingXg };
