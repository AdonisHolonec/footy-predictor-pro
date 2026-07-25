/**
 * Stage08Decision — Confidence, top pick, stake policy, pro ValueEngine, pOut, explanation inputs.
 * Body moved from runFixtureComposite.js (bind/write-back; algorithms unchanged).
 */

import { getWithCache } from "../../fetcher.js";
import {
  clampLambda,
  extractFormMultiplier,
  extractAdvancedGoalsAverages,
  extractFirstHalfFractions,
  deriveFirstHalfLambdas,
  normalizeTeamStatisticsPayload,
  strengthRatingsLambdas
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
import { matchedCompetitionKeyword } from "../../PredictionEngine/MotivationEngine.js";
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
import { resolveCorrectScoreOddsWithFallback } from "../decision/resolveCorrectScoreOdds.js";
import {
  MODEL_VERSION,
  getModelMarketBlendWeight,
  getLeagueConfidenceMultiplier,
  getLeagueStakeCap
} from "../../modelConstants.js";
import { buildPredictionLaboratory } from "../../predictionLaboratory/PredictionLaboratory.js";
import { applyCalibratedTriple } from "../../isotonicCalibration.js";
import {
  pickStackerWeightsForLeague,
  extractStackerFeatures,
  applyStacker
} from "../../mlStacker.js";
import { lookupEloPair, eloProbabilities } from "../../teamElo.js";
import { deriveMarketLambdas } from "../../teamMarketRolling.js";
import { deriveXgLambdas } from "../../xg/RollingXgModel.js";
import { blendLambdasWithXg, resolveFixtureXg, buildXgSourceProbs } from "../xgLambdaBlend.js";
import { PIPELINE_TRACE_VERSION, buildPipelineTrace } from "../pipelineTrace.js";
import {
  isGoodNum,
  roundDisplayRate,
  clampPct,
  buildPoissonMarketBlock,
  hasUsableRolling,
  buildLiveRollingForTeam,
  coerceFormFromTeamStats,
  buildTeamContext,
  extendProbsWithMarkets,
  dataQualityScore,
  deriveBestOverUnderPick,
  blendByPenalty,
  applyStakePolicyV2,
  marketTier
} from "../predictHelpers.js";
import { alignMarketProbsAndCalibrate } from "../decision/alignMarketProbsAndCalibrate.js";
import { selectTopPickAndQuote } from "../decision/selectTopPickAndQuote.js";
import { applyValueEngine } from "../decision/applyValueEngine.js";


export const STAGE_ID = "Stage08Decision";
export const STAGE_DESCRIPTION = "Confidence, top pick, stake policy, pro ValueEngine, pOut, explanation inputs.";

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
  let engineCtx = f.engineCtx;
  let debugMeta = f.debugMeta;
  let fhFractionsHome = f.fhFractionsHome;
  let fhFractionsAway = f.fhFractionsAway;
  let calc = f.calc;
  let p = f.p;
  let pRaw = f.pRaw;
  let monteCarlo = f.monteCarlo;
  let cornersBlock = f.cornersBlock;
  let shotsOnTargetBlock = f.shotsOnTargetBlock;
  let shotsTotalBlock = f.shotsTotalBlock;
  let cardsBlock = f.cardsBlock;
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
    // --- Stage08Decision: confidence + value + recommendation ---
    // === CONFIDENCE ENGINE (independent of λ/Poisson/pick selection) ===
    // Built from context only; never feeds back into λ / probs / pick.
    // Recommendation WHY is attached after topPick is known (explanation only).
    confidenceEngine = buildConfidenceEngine({
      ...(confidenceCtx || {}),
      homePlayed: strengthMeta?.homePlayed ?? confidenceCtx?.hStats?.playedHome ?? confidenceCtx?.hStats?.played ?? null,
      awayPlayed: strengthMeta?.awayPlayed ?? confidenceCtx?.aStats?.playedAway ?? confidenceCtx?.aStats?.played ?? null,
      bookmakersUsed: odds?.bookmakersUsed ?? null,
      shinZ: odds?.shinZ ?? null,
      hasOdds: Boolean(odds),
      dataQuality
    });
    
    finalPick1X2 = p1Adj >= pXAdj && p1Adj >= p2Adj ? "1" : p2Adj > p1Adj && p2Adj > pXAdj ? "2" : "X";

    // === MARKET PROBS REALIGNMENT + SIDE-MARKET CALIBRATION ===
    // Rebuild O/U + BTTS from score PMF reweighted to fused 1X2 so tip markets stay coherent.
    const aligned = alignMarketProbsAndCalibrate({
      p,
      scorePmf: f.scorePmf,
      lambdaHome,
      lambdaAway,
      fixtureId,
      p1Adj,
      pXAdj,
      p2Adj,
      leagueParams,
      calibrationMaps,
      lId,
      hStats: confidenceCtx?.hStats,
      aStats: confidenceCtx?.aStats
    });
    const marketProbsAligned = aligned.marketProbsAligned;
    const rawSideMarketsPct = aligned.rawSideMarketsPct;
    const calibratedSideMarketsPct = aligned.calibratedSideMarketsPct;
    const sideCalibrationAny = aligned.sideCalibrationAny;

    // === OPTIONAL DEBUG METADATA (Sprint 2 observability, report-only) ===
    // Never read by any prediction/decision logic above or below this block. Gated by
    // PREDICT_DEBUG_METADATA (default off) and, even when on, stripped for every tier in
    // accessTier.js — only requests that bypass tier masking entirely (cron / quota-exempt
    // admin, see Stage11Masking.js) can ever see it. Purely additive to modelMeta.
    if (String(process.env.PREDICT_DEBUG_METADATA || "").trim() === "1") {
      const motivationScore = modularScores?.motivation || null;
      const motivationDetail = motivationScore?.details || motivationScore?.detail || null;
      debugMeta = {
        motivation: {
          active: Boolean(motivationDetail?.available),
          source: motivationDetail?.source || null,
          multiplierHome: Number.isFinite(Number(motivationDetail?.home)) ? Number(motivationDetail.home) : null,
          multiplierAway: Number.isFinite(Number(motivationDetail?.away)) ? Number(motivationDetail.away) : null,
          competitionKeywordHome: matchedCompetitionKeyword(engineCtx?.homeStandingsRow?.description),
          competitionKeywordAway: matchedCompetitionKeyword(engineCtx?.awayStandingsRow?.description)
        },
        cleanSheet: {
          blendApplied: Boolean(aligned.cleanSheetBlendApplied),
          empiricalBttsRate: aligned.empiricalBttsRate ?? null
        }
      };
    } else {
      debugMeta = null;
    }

    // === TOP PICK SELECTION + RECOMMENDED QUOTE ===
    // Alegerea pick-ului top ia în considerare TOATE pieţele (Peste 1.5 / 2.5 / 3.5, Sub *, GG, NGG, 1X2)
    // şi penalizează pieţele banal-sigure (Peste 1.5 la exact baseline nu e informativ).
    ({ topSelection, topPick, maxConf, recommendedQuote } = selectTopPickAndQuote({
      marketProbsAligned,
      p1Adj,
      pXAdj,
      p2Adj,
      leagueMultiplier,
      qualityPenalty,
      odds,
      bttsQuote,
      goals15Quote,
      goals25Quote,
      goals35Quote
    }));
    stakePolicy = applyStakePolicyV2({
      stakePct: finalKelly,
      confidencePct: maxConf,
      dataQuality,
      leagueStakeCap,
      cooldownCap: riskContext.cooldownCap
    });
    finalKelly = stakePolicy.stakePct;
    if (valueDetected) {
      stakingCompact = `S:${finalKelly.toFixed(2)}% • E:${finalEv.toFixed(1)}%`;
    }
    reasonCodes.push(`stake_bucket_${stakePolicy.bucket}`);
    
    if (dataQuality < 0.55) reasonCodes.push("low_data_quality");
    if (leagueMultiplier < 0.93) reasonCodes.push("league_multiplier_penalty");
    if (finalKelly >= stakePolicy.dynamicCap && valueDetected) reasonCodes.push("stake_capped");
    reasonCodes = Array.from(new Set(reasonCodes)).slice(0, 8);
    
    pOut = extendProbsWithMarkets({
      ...marketProbsAligned,
      p1: clampPct(p1Adj),
      pX: clampPct(pXAdj),
      p2: clampPct(p2Adj)
    });
    if (firstHalfProbs) {
      pOut.firstHalf = firstHalfProbs;
    }
    if (cornersBlock) pOut.corners = cornersBlock;
    if (shotsOnTargetBlock) pOut.shotsOnTarget = shotsOnTargetBlock;
    if (shotsTotalBlock) pOut.shotsTotal = shotsTotalBlock;
    if (cardsBlock) pOut.cards = cardsBlock;

    // Correct Score value candidates — odds parsed from the same already-fetched oddsReq,
    // with a one-shot per-fixture fallback fetch when the batch response is missing this
    // market (Sprint 8, see resolveCorrectScoreOdds.js). Probabilities reused directly from
    // the already-computed score PMF (f.scorePmf), no Poisson rerun. Gracefully absent
    // (null) when odds or the PMF aren't available.
    const correctScoreOddsResult = await resolveCorrectScoreOddsWithFallback(oddsReq, fixtureId);
    let correctScoreProbsPct = null;
    if (correctScoreOddsResult && Array.isArray(f.scorePmf?.cells)) {
      correctScoreProbsPct = {};
      for (const cell of f.scorePmf.cells) {
        correctScoreProbsPct[`${cell.home}-${cell.away}`] = cell.prob * 100;
      }
    }

    // === PROFESSIONAL VALUE BETTING ENGINE (sole value path — Stage07 defers here) ===
    // Re-evaluate across 1X2 · Double Chance · BTTS · O/U · Corners · Cards · Correct Score
    // using final coherent probs. Never recommend negative EV.
    ({ valueEngine, valueDetected, valueType, finalEv, finalKelly, stakingCompact, reasonCodes } = applyValueEngine({
      cardsQuote,
      leagueParams,
      modularScores,
      cornersBlock,
      pOut,
      odds,
      doubleChanceQuote,
      bttsQuote,
      goals15Quote,
      goals25Quote,
      goals35Quote,
      marketOdds,
      cornersPick,
      dataQuality,
      maxConf,
      leagueStakeCap,
      cooldownCap: riskContext.cooldownCap,
      fixtureId,
      valueEngine,
      valueDetected,
      valueType,
      finalEv,
      finalKelly,
      stakingCompact,
      correctScoreOdds: correctScoreOddsResult?.scores ?? null,
      correctScoreProbsPct,
      reasonCodes
    }));

    teamContext = buildTeamContext({
      homeIdStr,
      awayIdStr,
      standingsMap,
      formHome: formHomeStr,
      formAway: formAwayStr
    });
    
    // Placeholder — replaced after featureImportance is built (see below).
    topFeatures = [
      `method:${method}`,
      `dq:${dataQuality.toFixed(2)}`,
      stackerApplied ? "stacker:on" : calibrationApplied ? "cal:on" : `blend:${blendW.toFixed(2)}`,
      `leagueMul:${leagueMultiplier.toFixed(2)}`,
      `stakeCap:${stakePolicy.dynamicCap.toFixed(2)}`,
      `bucket:${stakePolicy.bucket}`,
      strengthMeta ? `atkDef:${strengthMeta.atkH?.toFixed(2)}` : "standings",
      eloInfo ? `elo:${eloInfo.eloSpread.toFixed(0)}` : "elo:none"
    ];
    
    evaluation = {
      recommendedTrack: stackerApplied
        ? "ml_stacker_1x2"
        : calibrationApplied
          ? "calibrated_1x2_and_side_markets"
          : "model_1x2_and_side_markets",
      valueBetTrack: valueDetected
        ? stackerApplied
          ? "stacker_1x2_vs_median_odds"
          : "blended_1x2_vs_median_odds"
        : "none",
      modelProbs1x2Pct: { p1: p1Adj, pX: pXAdj, p2: p2Adj },
      rawPoissonProbs1x2Pct: { p1: pRaw.p1, pX: pRaw.pX, p2: pRaw.p2 },
      calibratedProbs1x2Pct: calibrationApplied
        ? { p1: calTriple.p1 * 100, pX: calTriple.pX * 100, p2: calTriple.p2 * 100 }
        : undefined,
      rawSideMarketsPct,
      calibratedSideMarketsPct,
      sideCalibrationApplied: sideCalibrationAny,
      stackerProbs1x2Pct: stackerApplied
        ? { p1: pFinal.p1 * 100, pX: pFinal.pX * 100, p2: pFinal.p2 * 100 }
        : undefined,
      recommended1x2: finalPick1X2,
      modelVersion: MODEL_VERSION,
      marketBlendWeight: blendW,
      stackerApplied,
      calibrationApplied
    };
    
    // Attach WHY for this recommendation — explanation only; scores unchanged.
    confidenceEngine = attachRecommendationExplanation(confidenceEngine, {
      pick: topPick,
      pickProb: maxConf
    });
    
    // Explainable prediction — reasons only from finite real inputs (no generic copy).
    explanation = buildPredictionExplanation({
      pick: topPick,
      confidence: maxConf,
      strengthMeta,
      leagueParams,
      lambdas: { home: lambdaHome, away: lambdaAway },
      luckStats,
      probs: pOut,
      formHome: formHomeStr,
      formAway: formAwayStr,
      teamContext,
      odds,
      marketOdds,
      shin: marketProbs || null,
      shinImplied: marketProbs || null,
      refereeName: refereeName || null,
      refereeStats: null,
      elo: eloInfo
        ? { home: eloInfo.eloHome, away: eloInfo.eloAway, spread: eloInfo.eloSpread }
        : null,
      eloSpread: eloInfo?.eloSpread ?? null
    });
    
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
      engineCtx,
      debugMeta,
      fhFractionsHome,
      fhFractionsAway,
      calc,
      p,
      pRaw,
      monteCarlo,
      cornersBlock,
      shotsOnTargetBlock,
      shotsTotalBlock,
      cardsBlock,
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
