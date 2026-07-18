/**
 * Stage02FeatureCollection — team stats, form, moduleInputs, early xG, engineCtx.
 * Algorithms unchanged; hands engineCtx to Stage03 via context.fixture.
 */

import { getWithCache } from "../../fetcher.js";
import {
  computeMatchProbs,
  clampLambda,
  extractFormMultiplier,
  extractAdvancedGoalsAverages,
  extractFirstHalfFractions,
  deriveFirstHalfLambdas,
  normalizeTeamStatisticsPayload,
  strengthRatingsLambdas,
  poissonOverLine
} from "../../math.js";
import { PredictionEngine, summarizeModuleScores, getPredictionWeights } from "../../prediction/PredictionEngine.js";
import { collectModuleInputs } from "../../PredictionEngine/moduleInputs.js";
import {
  buildConfidenceEngine,
  attachRecommendationExplanation
} from "../../confidence/ConfidenceEngine.js";
import { buildPredictionExplanation } from "../../explanation/PredictionExplanation.js";
import { buildFeatureImportance } from "../../importance/FeatureImportanceEngine.js";
import { buildPredictionContributions } from "../../importance/PredictionContributions.js";
import { blendModel, getModelById } from "../../modelLab/ModelLab.js";
import {
  buildValueEngine,
  buildProfessionalValueEngine,
  evaluateValue
} from "../../value/ValueEngine.js";
import {
  calculateEV,
  calculateKellyQuarter as calculateKelly,
  calculateEnsembleStake,
  blendModelWithMarket,
  evaluateNoBetZone,
  shinImpliedProbs
} from "../../advancedMath.js";
import {
  consensusMatchWinnerOdds,
  consensusOverUnderOddsAtLine,
  consensusBttsOdds,
  consensusDoubleChanceOdds
} from "../../marketOdds.js";
import { getOddsForFixture } from "../../oddsPrefetch.js";
import {
  MODEL_VERSION,
  getModelMarketBlendWeight,
  getLeagueConfidenceMultiplier,
  getLeagueStakeCap
} from "../../modelConstants.js";
import { applyLeagueMarketPriors } from "../../leagueProfiles/LeagueProfile.js";
import { buildPredictionLaboratory } from "../../predictionLaboratory/PredictionLaboratory.js";
import { runMonteCarloSimulation } from "../../monteCarlo/MonteCarloEngine.js";
import {
  pickCalibrationMapForLeague,
  applyCalibratedTriple
} from "../../isotonicCalibration.js";
import {
  pickStackerWeightsForLeague,
  extractStackerFeatures,
  applyStacker
} from "../../mlStacker.js";
import { lookupEloPair, eloProbabilities } from "../../teamElo.js";
import { deriveMarketLambdas } from "../../teamMarketRolling.js";
import { deriveXgLambdas } from "../../xg/RollingXgModel.js";
import {
  PREDICTOR_V2_VERSION,
  blendLambdasWithXg,
  resolveFixtureXg,
  buildXgSourceProbs,
  buildPipelineTrace
} from "../PredictorV2.js";
import {
  isGoodNum,
  roundDisplayRate,
  clampPct,
  buildPoissonMarketBlock,
  hasUsableRolling,
  buildLiveRollingForTeam,
  selectTopPick,
  coerceFormFromTeamStats,
  buildTeamContext,
  extendProbsWithMarkets,
  dataQualityScore,
  deriveBestOverUnderPick,
  blendByPenalty,
  applyStakePolicyV2,
  marketTier
} from "../predictHelpers.js";



export const STAGE_ID = "Stage02FeatureCollection";
export const STAGE_DESCRIPTION =
  "Team stats, form, moduleInputs, early xG, engine/confidence context.";

export async function run(context) {
  if (context.halted || context.fixture?.aborted) return context;
  const f = context.fixture;
  const league = context.league;
  if (!f || !league) return context;

  const lId = league.lId;
  const leagueParams = league.leagueParams;
  const marketRollingMap = league.marketRollingMap;
  const standingsMap = league.standingsMap;
  const leagueStandings = league.leagueStandings;

  const season = context.season;
  const shrinkageK = context.shrinkageK;
  const oddsByFixtureId = context.oddsByFixtureId;

  const fixtureId = f.fixtureId;
  const fx = f.fx;
  const homeName = f.homeName;
  const awayName = f.awayName;
  const homeIdStr = f.homeIdStr;
  const awayIdStr = f.awayIdStr;
  const refereeName = f.refereeName;

  let method = f.method ?? "none";
  let formHomeStr = null;
  let formAwayStr = null;
  let confidenceCtx = null;
  let fhFractionsHome = null;
  let fhFractionsAway = null;
  let engineCtx = null;
  let hStats = null;
  let aStats = null;
  let hMulti = null;
  let aMulti = null;

  if (homeIdStr && awayIdStr) {
    // Independent cache keys — fetch in parallel (same TTL / payloads as sequential).
    const [tsH, tsA] = await Promise.all([
      getWithCache("/teams/statistics", { league: lId, season, team: homeIdStr }, 86400),
      getWithCache("/teams/statistics", { league: lId, season, team: awayIdStr }, 86400)
    ]);
    const tsHNorm = tsH.ok && tsH.data ? normalizeTeamStatisticsPayload(tsH.data) : null;
    const tsANorm = tsA.ok && tsA.data ? normalizeTeamStatisticsPayload(tsA.data) : null;
    if (tsHNorm) {
      formHomeStr = coerceFormFromTeamStats(tsHNorm);
      fhFractionsHome = extractFirstHalfFractions(tsHNorm);
    }
    if (tsANorm) {
      formAwayStr = coerceFormFromTeamStats(tsANorm);
      fhFractionsAway = extractFirstHalfFractions(tsANorm);
    }
    if (tsH.ok && tsA.ok && tsHNorm && tsANorm) {
      hStats = extractAdvancedGoalsAverages(tsHNorm);
      aStats = extractAdvancedGoalsAverages(tsANorm);
      if (hStats && aStats) {
        hMulti = extractFormMultiplier(tsHNorm.response?.form);
        aMulti = extractFormMultiplier(tsANorm.response?.form);
        const rowH = standingsMap.get(homeIdStr);
        const rowA = standingsMap.get(awayIdStr);
        const moduleInputs = await collectModuleInputs({
          fixtureId,
          homeTeamId: homeIdStr,
          awayTeamId: awayIdStr,
          leagueId: lId,
          season,
          fixtureDate: fx.fixture?.date,
          oddsData: oddsByFixtureId.get(Number(fixtureId)),
          fx
        });
        const earlyRollingHome = homeIdStr ? marketRollingMap.get(Number(homeIdStr)) : null;
        const earlyRollingAway = awayIdStr ? marketRollingMap.get(Number(awayIdStr)) : null;
        const earlyXg = resolveFixtureXg({
          rollingHome: earlyRollingHome,
          rollingAway: earlyRollingAway,
          leagueAvg: leagueParams.leagueAvg,
          homeAdv: leagueParams.homeAdv,
          awayAdv: leagueParams.awayAdv
        });
        engineCtx = {
          hStats,
          aStats,
          formHome: tsHNorm.response?.form,
          formAway: tsANorm.response?.form,
          hFormMulti: hMulti,
          aFormMulti: aMulti,
          leagueParams,
          homeStandingsRow: rowH || null,
          awayStandingsRow: rowA || null,
          refereeName: refereeName || undefined,
          fixtureId,
          fixtureDate: fx.fixture?.date,
          homeTeamId: homeIdStr,
          awayTeamId: awayIdStr,
          shrinkageK,
          ...(earlyXg
            ? {
                xgHome: earlyXg.xgHome,
                xgAway: earlyXg.xgAway,
                xgSource: earlyXg.source
              }
            : {}),
          ...moduleInputs
        };
        confidenceCtx = {
          hStats,
          aStats,
          formHome: tsHNorm.response?.form,
          formAway: tsANorm.response?.form,
          hFormMulti: hMulti,
          aFormMulti: aMulti,
          leagueParams,
          homeStandingsRow: rowH || null,
          awayStandingsRow: rowA || null,
          refereeName: refereeName || undefined,
          homeTeamId: homeIdStr,
          awayTeamId: awayIdStr,
          fixtureDate: fx.fixture?.date,
          ...moduleInputs,
          ...(earlyXg
            ? { xgHome: earlyXg.xgHome, xgAway: earlyXg.xgAway, xgSource: earlyXg.source }
            : {})
        };
      }
    }
  }

  Object.assign(f, {
    method,
    formHomeStr,
    formAwayStr,
    confidenceCtx,
    fhFractionsHome,
    fhFractionsAway,
    engineCtx,
    hStats,
    aStats,
    hMulti,
    aMulti
  });

  if (!context.stageMarks) context.stageMarks = {};
  context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
