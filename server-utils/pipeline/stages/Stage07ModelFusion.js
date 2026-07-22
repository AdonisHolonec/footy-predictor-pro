/**
 * Stage07ModelFusion — Elo, odds/Shin, market quotes, stacker (on calibrated 1X2), Model Lab.
 * Professional value is deferred to Stage08 on final coherent pOut.
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
  blendModelWithMarket,
  shinImpliedProbs
} from "../../advancedMath.js";
import {
  consensusMatchWinnerOdds,
  consensusOverUnderOddsAtLine,
  consensusBttsOdds,
  consensusDoubleChanceOdds,
  resolveShotsOnTargetMarketQuote,
  FIRST_HALF_GOALS_MARKET_NAMES,
  SHOTS_TOTAL_MARKET_NAMES
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
import { deriveEloInfo } from "../modelFusion/deriveEloInfo.js";
import { resolveMarketConsensus } from "../modelFusion/resolveMarketConsensus.js";
import { resolveSideMarketQuotes } from "../modelFusion/resolveSideMarketQuotes.js";
import { applyStackerBlend } from "../modelFusion/applyStackerBlend.js";
import { applyModelLabOverride } from "../modelFusion/applyModelLabOverride.js";


export const STAGE_ID = "Stage07ModelFusion";
export const STAGE_DESCRIPTION = "Elo, odds/Shin, early value, market quotes, stacker, Model Lab.";

/**
 * @param {object} context
 */
export async function run(context) {
  if (context.halted || context.fixture?.aborted) return context;

  const f = context.fixture;
  const league = context.league;
  if (!f || !league) return context;

  const lId = league.lId;
  const leagueParams = league.leagueParams;
  const leagueProfile = league.leagueProfile;
  const marketRollingMap = league.marketRollingMap;
  const standingsMap = league.standingsMap;
  const leagueStandings = league.leagueStandings;

  const season = context.season;
  const shrinkageK = context.shrinkageK;
  const poissonCorrelation = context.poissonCorrelation;
  const oddsByFixtureId = context.oddsByFixtureId;
  const liveRollingCache = context.liveRollingCache;
  const statsBudgetRef = context.statsBudgetRef;
  const calibrationMaps = context.calibrationMaps;
  const stackerWeightsMap = context.stackerWeightsMap;
  const engineWeights = context.engineWeights;
  const activeModelId = context.activeModelId;
  const riskContext = context.riskContext;

  const fixtureId = f.fixtureId;
  const fx = f.fx;
  const homeName = f.homeName;
  const awayName = f.awayName;
  const homeIdStr = f.homeIdStr;
  const awayIdStr = f.awayIdStr;
  const refereeName = f.refereeName;

  let method = f.method;
  let lambdaHome = f.lambdaHome;
  let lambdaAway = f.lambdaAway;
  let luckStats = f.luckStats;
  let strengthMeta = f.strengthMeta;
  let modularScores = f.modularScores;
  let xgLambdasForSources = f.xgLambdasForSources;
  let formHomeStr = f.formHomeStr;
  let formAwayStr = f.formAwayStr;
  let confidenceCtx = f.confidenceCtx;
  let fhFractionsHome = f.fhFractionsHome;
  let fhFractionsAway = f.fhFractionsAway;
  let calc = f.calc;
  let p = f.p;
  let pRaw = f.pRaw;
  let monteCarlo = f.monteCarlo;
  let cornersBlock = f.cornersBlock;
  let shotsOnTargetBlock = f.shotsOnTargetBlock;
  let shotsTotalBlock = f.shotsTotalBlock;
  let rollingHome = f.rollingHome;
  let rollingAway = f.rollingAway;
  let liveRollingApplied = f.liveRollingApplied;
  let xgModelMeta = f.xgModelMeta;
  let firstHalfProbs = f.firstHalfProbs;
  let firstHalfMeta = f.firstHalfMeta;
  let leagueCalibMaps = f.leagueCalibMaps;
  let calTriple = f.calTriple;
  let calibrationApplied = f.calibrationApplied;
  let eloInfo = f.eloInfo;
  let odds = f.odds;
  let oddsReq = f.oddsReq;
  let valueDetected = f.valueDetected;
  let valueType = f.valueType;
  let finalEv = f.finalEv;
  let finalKelly = f.finalKelly;
  let stakingCompact = f.stakingCompact;
  let stakingBreakdown = f.stakingBreakdown;
  let reasonCodes = f.reasonCodes;
  let valueEngine = f.valueEngine;
  let leagueMultiplier = f.leagueMultiplier;
  let leagueStakeCap = f.leagueStakeCap;
  let blendW = f.blendW;
  let marketOdds = f.marketOdds;
  let marketProbs = f.marketProbs;
  let goals15Quote = f.goals15Quote;
  let goals25Quote = f.goals25Quote;
  let goals35Quote = f.goals35Quote;
  let bttsQuote = f.bttsQuote;
  let doubleChanceQuote = f.doubleChanceQuote;
  let cardsQuote = f.cardsQuote;
  let cornersPick = f.cornersPick;
  let stackerEntry = f.stackerEntry;
  let dataQualityEarly = f.dataQualityEarly;
  let pFinal = f.pFinal;
  let stackerApplied = f.stackerApplied;
  let p1Adj = f.p1Adj;
  let pXAdj = f.pXAdj;
  let p2Adj = f.p2Adj;
  let appliedModelId = f.appliedModelId;
  let driftPenalty = f.driftPenalty;
  let dataQuality = f.dataQuality;
  let qualityPenalty = f.qualityPenalty;
  let confidenceEngine = f.confidenceEngine;
  let finalPick1X2 = f.finalPick1X2;
  let topSelection = f.topSelection;
  let topPick = f.topPick;
  let maxConf = f.maxConf;
  let recommendedQuote = f.recommendedQuote;
  let stakePolicy = f.stakePolicy;
  let pOut = f.pOut;
  let teamContext = f.teamContext;
  let topFeatures = f.topFeatures;
  let evaluation = f.evaluation;
  let explanation = f.explanation;
  let featureImportance = f.featureImportance;
  let predictionContributions = f.predictionContributions;
  let predictionRow = f.predictionRow;

  try {
    // === ELO DERIVATIVE (independent probability source) ===
    eloInfo = await deriveEloInfo({ lId, homeIdStr, awayIdStr, homeAdv: leagueParams.homeAdv });

    odds = null;
    valueDetected = false;
    valueType = "";
    finalEv = 0;
    finalKelly = 0;
    stakingCompact = "";
    stakingBreakdown = undefined;
    reasonCodes = [];
    valueEngine = null;
    leagueMultiplier = getLeagueConfidenceMultiplier(Number(lId));
    leagueStakeCap = getLeagueStakeCap(Number(lId));
    blendW = getModelMarketBlendWeight(method, Number(lId));

    // === MARKET CONSENSUS + SHIN DE-VIG ===
    ({ oddsReq, odds, marketProbs } = await resolveMarketConsensus({ fixtureId, oddsByFixtureId }));

    // === SIDE-MARKET QUOTES (corners / SOT / shots total / first-half / goals lines / BTTS / DC / cards) ===
    ({
      marketOdds,
      goals15Quote,
      goals25Quote,
      goals35Quote,
      bttsQuote,
      doubleChanceQuote,
      cardsQuote,
      cornersPick
    } = resolveSideMarketQuotes({ oddsReq, cornersBlock, shotsOnTargetBlock, shotsTotalBlock, firstHalfProbs }));

    // --- Stage07ModelFusion: stacker / market / Model Lab ---
    // Stacker features use *calibrated* 1X2 (never raw Poisson alone). After stacker,
    // still blend with Shin market so calibration is never bypassed.
    ({ stackerEntry, dataQualityEarly, pFinal, stackerApplied } = applyStackerBlend({
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
    }));

    p1Adj = blendByPenalty(pFinal.p1 * 100, leagueMultiplier);
    pXAdj = blendByPenalty(pFinal.pX * 100, leagueMultiplier);
    p2Adj = blendByPenalty(pFinal.p2 * 100, leagueMultiplier);
    const sumAdj = p1Adj + pXAdj + p2Adj;
    if (sumAdj > 0) {
      p1Adj = (p1Adj / sumAdj) * 100;
      pXAdj = (pXAdj / sumAdj) * 100;
      p2Adj = (p2Adj / sumAdj) * 100;
    }

    // === AUTO MODEL SELECTION ===
    // Apply the automatically-promoted model. Default "E"/everything is a no-op
    // (keeps the full calibration+stacker+market stack). Simpler promoted models
    // override the final 1X2 from their reconstructed sources for this fixture.
    ({ p1Adj, pXAdj, p2Adj, appliedModelId } = applyModelLabOverride({
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
    }));

    driftPenalty = riskContext.avgDist
      ? Math.abs(p1Adj - riskContext.avgDist.p1) +
        Math.abs(pXAdj - riskContext.avgDist.pX) +
        Math.abs(p2Adj - riskContext.avgDist.p2)
      : 0;
    if (driftPenalty > 24) {
      finalKelly = Math.min(finalKelly, 1.5);
      reasonCodes.push("drift_penalty");
    }

    dataQuality = dataQualityScore({
      method,
      hasOdds: !!odds,
      hasLuckStats: !!luckStats,
      hasTeamIds: !!homeIdStr && !!awayIdStr
    });
    qualityPenalty = dataQuality < 0.6 ? 0.9 : 1;

  } finally {
  
    Object.assign(f, {
      method,
      lambdaHome,
      lambdaAway,
      luckStats,
      strengthMeta,
      modularScores,
      xgLambdasForSources,
      formHomeStr,
      formAwayStr,
      confidenceCtx,
      fhFractionsHome,
      fhFractionsAway,
      calc,
      p,
      pRaw,
      monteCarlo,
      cornersBlock,
      shotsOnTargetBlock,
      shotsTotalBlock,
      rollingHome,
      rollingAway,
      liveRollingApplied,
      xgModelMeta,
      firstHalfProbs,
      firstHalfMeta,
      leagueCalibMaps,
      calTriple,
      calibrationApplied,
      eloInfo,
      odds,
      oddsReq,
      valueDetected,
      valueType,
      finalEv,
      finalKelly,
      stakingCompact,
      stakingBreakdown,
      reasonCodes,
      valueEngine,
      leagueMultiplier,
      leagueStakeCap,
      blendW,
      marketOdds,
      marketProbs,
      goals15Quote,
      goals25Quote,
      goals35Quote,
      bttsQuote,
      doubleChanceQuote,
      cardsQuote,
      cornersPick,
      stackerEntry,
      dataQualityEarly,
      pFinal,
      stackerApplied,
      p1Adj,
      pXAdj,
      p2Adj,
      appliedModelId,
      driftPenalty,
      dataQuality,
      qualityPenalty,
      confidenceEngine,
      finalPick1X2,
      topSelection,
      topPick,
      maxConf,
      recommendedQuote,
      stakePolicy,
      pOut,
      teamContext,
      topFeatures,
      evaluation,
      explanation,
      featureImportance,
      predictionContributions,
      predictionRow
    });
  }

  if (!context.stageMarks) context.stageMarks = {};
  context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
