/**
 * Stage03LambdaGeneration — PredictionEngine λ / fallback / standings; insufficientData abort.
 * Consumes context.fixture.engineCtx from Stage02.
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



export const STAGE_ID = "Stage03LambdaGeneration";
export const STAGE_DESCRIPTION =
  "PredictionEngine λ / fallback / standings; insufficientData abort.";

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
  let lambdaHome = f.lambdaHome;
  let lambdaAway = f.lambdaAway;
  let luckStats = f.luckStats;
  let strengthMeta = f.strengthMeta;
  let modularScores = f.modularScores;
  const formHomeStr = f.formHomeStr;
  const formAwayStr = f.formAwayStr;
  const engineCtx = f.engineCtx;
  const hStats = f.hStats;
  const aStats = f.aStats;
  const hMulti = f.hMulti;
  const aMulti = f.aMulti;

  if (engineCtx && hStats && aStats) {
    let sr = null;
    try {
      sr = PredictionEngine.build(engineCtx);
    } catch {
      sr = null;
    }
    if (!sr || !isGoodNum(sr.lambdaHome) || !isGoodNum(sr.lambdaAway)) {
      sr = strengthRatingsLambdas(hStats, aStats, hMulti, aMulti, {
        leagueAvgGoals: leagueParams.leagueAvg,
        leagueAvgHome: leagueParams.leagueAvgHome,
        leagueAvgAway: leagueParams.leagueAvgAway,
        homeAdv: leagueParams.homeAdv,
        awayAdv: leagueParams.awayAdv,
        homePlayed: hStats.playedHome || hStats.played,
        awayPlayed: aStats.playedAway || aStats.played,
        shrinkageK
      });
      if (sr && isGoodNum(sr.lambdaHome) && isGoodNum(sr.lambdaAway)) {
        method = "strength-ratings";
      }
    } else {
      method = sr.method || "modular-engine";
      modularScores = summarizeModuleScores(sr.moduleScores);
    }
    if (sr && isGoodNum(sr.lambdaHome) && isGoodNum(sr.lambdaAway)) {
      lambdaHome = sr.lambdaHome;
      lambdaAway = sr.lambdaAway;
      strengthMeta = sr.strengthMeta;
      luckStats = {
        hG: roundDisplayRate(hStats.gfHome),
        hXG: roundDisplayRate(sr.lambdaHome),
        aG: roundDisplayRate(aStats.gfAway),
        aXG: roundDisplayRate(sr.lambdaAway),
        intensityNote: "expected_rate_from_strength_model"
      };
    }
  }

  if (!isGoodNum(lambdaHome)) {
    const rowH = standingsMap.get(homeIdStr);
    const rowA = standingsMap.get(awayIdStr);
    if (rowH && rowA) {
      method = "standings";
      const phH = Math.max(1, Number(rowH.all?.played) || 1);
      const phA = Math.max(1, Number(rowA.all?.played) || 1);
      const gfH = Number(rowH.all?.goals?.for) / phH;
      const gaH = Number(rowH.all?.goals?.against) / phH;
      const gfA = Number(rowA.all?.goals?.for) / phA;
      const gaA = Number(rowA.all?.goals?.against) / phA;

      const SK = 4;
      const atkHs = (phH * gfH + SK * leagueParams.leagueAvg) / (phH + SK);
      const defHs = (phH * gaH + SK * leagueParams.leagueAvg) / (phH + SK);
      const atkAs = (phA * gfA + SK * leagueParams.leagueAvg) / (phA + SK);
      const defAs = (phA * gaA + SK * leagueParams.leagueAvg) / (phA + SK);

      lambdaHome = clampLambda((atkHs + defAs) / 2 * leagueParams.homeAdv);
      lambdaAway = clampLambda((atkAs + defHs) / 2 * leagueParams.awayAdv);
    }
  }

  Object.assign(f, {
    method,
    lambdaHome,
    lambdaAway,
    luckStats,
    strengthMeta,
    modularScores
  });

  if (!isGoodNum(lambdaHome)) {
    const teamContextEarly = buildTeamContext({
      homeIdStr,
      awayIdStr,
      standingsMap,
      formHome: formHomeStr,
      formAway: formAwayStr
    });
    f.row = {
      id: fixtureId,
      leagueId: Number(lId),
      league: fx.league?.name || "Unknown",
      logos: { league: fx.league?.logo, home: fx.teams?.home?.logo, away: fx.teams?.away?.logo },
      teams: { home: homeName, away: awayName },
      fixtureTeamIds:
        homeIdStr && awayIdStr
          ? { home: Number(homeIdStr) || undefined, away: Number(awayIdStr) || undefined }
          : undefined,
      kickoff: fx.fixture?.date,
      status: fx.fixture?.status?.short,
      score: {
        home: typeof fx.goals?.home === "number" ? fx.goals.home : null,
        away: typeof fx.goals?.away === "number" ? fx.goals.away : null
      },
      referee: refereeName || undefined,
      venue: f.venue || undefined,
      insufficientData: true,
      insufficientReason: "no_team_or_standings_data",
      teamContext: teamContextEarly,
      leagueStandings,
      probs: {
        p1: 0, pX: 0, p2: 0, pGG: 0, pO25: 0, pU35: 0, pO15: 0,
        pDC1X: 0, pDC12: 0, pDCX2: 0, pU15: 0, pNGG: 0, pU25: 0
      },
      recommended: { pick: "", confidence: 0 },
      predictions: { oneXtwo: "", gg: "", over25: "", correctScore: "" },
      valueBet: { detected: false, type: "", ev: 0, kelly: 0, stakePlan: "", reasons: ["insufficient_data"] },
      valueEngine: buildValueEngine([]),
      confidenceEngine: buildConfidenceEngine({ refereeName: refereeName || undefined }),
      modelMeta: {
        method: "insufficient_data",
        dataQuality: 0,
        modelVersion: MODEL_VERSION,
        reasonCodes: ["insufficient_data"]
      },
      modelVersion: MODEL_VERSION,
      evaluation: { track: "none" }
    };
    f.aborted = true;
    if (!context.stageMarks) context.stageMarks = {};
    context.stageMarks[STAGE_ID] = { status: "insufficient_data", at: Date.now() };
    return context;
  }

  if (!context.stageMarks) context.stageMarks = {};
  context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
