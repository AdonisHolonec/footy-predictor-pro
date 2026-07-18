/**
 * Stage05Simulation — single Monte Carlo on final λ, then side markets + FH.
 * P4: hydrate / late xG moved to Stage04 (finalizeLambdasWithRollingXg) before Poisson.
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


export const STAGE_ID = "Stage05Simulation";
export const STAGE_DESCRIPTION =
  "Single Monte Carlo on final λ, then corners/SOT/shots + first-half markets.";

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
    // P4: rolling / xG already finalized in Stage04 — reuse for side markets.
    rollingHome = f.rollingHome ?? (homeIdStr ? marketRollingMap.get(Number(homeIdStr)) : null);
    rollingAway = f.rollingAway ?? (awayIdStr ? marketRollingMap.get(Number(awayIdStr)) : null);
    liveRollingApplied = Boolean(f.liveRollingApplied);
    if (f.xgModelMeta) xgModelMeta = f.xgModelMeta;
    if (f.xgLambdasForSources) xgLambdasForSources = f.xgLambdasForSources;

    // === MONTE CARLO once on final λ (reuse Stage04 score PMF when present) ===
    monteCarlo = null;
    try {
      monteCarlo = runMonteCarloSimulation(lambdaHome, lambdaAway, {
        fixtureId,
        correlation: poissonCorrelation,
        rho: leagueParams.rho,
        pmf: f.scorePmf || undefined
      });
    } catch (mcErr) {
      console.warn("[monte-carlo]", fixtureId, mcErr?.message || mcErr);
      monteCarlo = null;
    }

    // === PIEŢE CORNERE + ŞUTURI LA POARTĂ (Poisson din rolling stats) ===
    cornersBlock = null;
    shotsOnTargetBlock = null;
    shotsTotalBlock = null;

    const cornersLambdas = deriveMarketLambdas({
      rollingHome,
      rollingAway,
      baseAvgTotal: leagueParams.cornersAvgTotal,
      marketKey: "corners",
      homeAdv: leagueParams.homeAdv,
      awayAdv: leagueParams.awayAdv
    });
    cornersBlock = {
      ...buildPoissonMarketBlock({
        lambdaHome: cornersLambdas.lambdaHome,
        lambdaAway: cornersLambdas.lambdaAway,
        lines: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
        teamLines: [3.5, 4.5, 5.5]
      }),
      sampleHome: cornersLambdas.sampleHome,
      sampleAway: cornersLambdas.sampleAway,
      usedFallback: cornersLambdas.usedFallback,
      liveRollingApplied,
      leagueBaseline: leagueParams.cornersAvgTotal
    };
    
    const sotLambdas = deriveMarketLambdas({
      rollingHome,
      rollingAway,
      baseAvgTotal: leagueParams.sotAvgTotal,
      marketKey: "sot",
      homeAdv: leagueParams.homeAdv,
      awayAdv: leagueParams.awayAdv
    });
    shotsOnTargetBlock = {
      ...buildPoissonMarketBlock({
        lambdaHome: sotLambdas.lambdaHome,
        lambdaAway: sotLambdas.lambdaAway,
        lines: [6.5, 7.5, 8.5, 9.5, 10.5],
        teamLines: [2.5, 3.5, 4.5]
      }),
      sampleHome: sotLambdas.sampleHome,
      sampleAway: sotLambdas.sampleAway,
      usedFallback: sotLambdas.usedFallback,
      liveRollingApplied,
      leagueBaseline: leagueParams.sotAvgTotal
    };
    
    // şuturi totale — util ca signal suplimentar (ex. 20.5 total shots)
    const shotsLambdas = deriveMarketLambdas({
      rollingHome,
      rollingAway,
      baseAvgTotal: leagueParams.shotsAvgTotal,
      marketKey: "shots_total",
      homeAdv: leagueParams.homeAdv,
      awayAdv: leagueParams.awayAdv
    });
    shotsTotalBlock = {
      ...buildPoissonMarketBlock({
        lambdaHome: shotsLambdas.lambdaHome,
        lambdaAway: shotsLambdas.lambdaAway,
        lines: [18.5, 20.5, 22.5, 24.5],
        teamLines: []
      }),
      sampleHome: shotsLambdas.sampleHome,
      sampleAway: shotsLambdas.sampleAway,
      usedFallback: shotsLambdas.usedFallback,
      liveRollingApplied
    };
    
    // === PRIMA REPRIZĂ ===
    // Derivăm λ FH din λ full match + fracţiile pe bucketele de minute (0 calls noi).
    // computeMatchProbs cu acele λ dă direct 1X2/GG/O0.5/O1.5/O2.5 pentru prima repriză.
    // Pentru FH aplicăm un ρ mai slab: low-scoring deja favorizează 0-0, overkill să mai adăugăm corecţie.
    firstHalfProbs = null;
    firstHalfMeta = null;
    if (fhFractionsHome || fhFractionsAway) {
      const fh = deriveFirstHalfLambdas({
        lambdaHomeFull: lambdaHome,
        lambdaAwayFull: lambdaAway,
        fhFractionsHome,
        fhFractionsAway
      });
      if (fh && isGoodNum(fh.lambdaHomeFH) && isGoodNum(fh.lambdaAwayFH)) {
        const fhCalc = computeMatchProbs(fh.lambdaHomeFH, fh.lambdaAwayFH, fixtureId, {
          correlation: 0.08,
          rho: leagueParams.rho * 0.6
        });
        if (fhCalc?.probs) {
          const fp = fhCalc.probs;
          firstHalfProbs = {
            p1: clampPct(fp.p1),
            pX: clampPct(fp.pX),
            p2: clampPct(fp.p2),
            pGG: clampPct(fp.pGG),
            pO05: clampPct(fp.pO05),
            pO15: clampPct(fp.pO15),
            pO25: clampPct(fp.pO25),
            bestScore: fhCalc.bestScore,
            bestScoreProb: clampPct(fhCalc.bestScoreProb || 0)
          };
          firstHalfMeta = {
            lambdaHome: roundDisplayRate(fh.lambdaHomeFH),
            lambdaAway: roundDisplayRate(fh.lambdaAwayFH),
            scaleHome: fh.meta.scaleHome,
            scaleAway: fh.meta.scaleAway,
            baselineUsed: fh.meta.baselineUsed
          };
        }
      }
    }
    
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
  
    if (typeof row !== "undefined" && row) f.row = row;
    if (typeof aborted !== "undefined" && aborted) f.aborted = true;
  }

  if (!context.stageMarks) context.stageMarks = {};
  context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
