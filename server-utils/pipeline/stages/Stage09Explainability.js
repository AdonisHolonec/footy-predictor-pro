/**
 * Stage09Explainability — FI, contributions, laboratory, prediction row.
 * Body moved from runFixtureComposite.js (bind/write-back; algorithms unchanged).
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
import { blendLambdasWithXg, resolveFixtureXg, buildXgSourceProbs } from "../xgLambdaBlend.js";
import { PIPELINE_TRACE_VERSION, buildPipelineTrace } from "../pipelineTrace.js";
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


export const STAGE_ID = "Stage09Explainability";
export const STAGE_DESCRIPTION = "FI, contributions, laboratory, prediction row.";

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

  let row = f.row;

  try {
    // --- Stage09Explainability: FI + contributions + laboratory ---
    featureImportance = buildFeatureImportance({
      pick: topPick,
      pickProb: maxConf,
      confidence: maxConf,
      strengthMeta,
      leagueParams,
      modularScores,
      confidenceEngine,
      odds,
      hasOdds: Boolean(odds),
      shin: marketProbs || null,
      marketProbs,
      hFormMulti: confidenceCtx?.hFormMulti,
      aFormMulti: confidenceCtx?.aFormMulti
    });
    
    // Signed per-module contribution attribution for this prediction.
    predictionContributions = buildPredictionContributions({
      pick: topPick,
      confidence: maxConf,
      overallConfidence: confidenceEngine?.overall ?? maxConf,
      strengthMeta,
      modularScores,
      weights: engineWeights,
      eloInfo,
      probsRaw: pRaw,
      probsFinal: { p1: p1Adj, pX: pXAdj, p2: p2Adj },
      leagueParams
    });
    
    topFeatures = [
      ...(featureImportance.topFeatures || []),
      `method:${method}`,
      `dq:${dataQuality.toFixed(2)}`
    ].slice(0, 10);
    
    predictionRow = {
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
      lambdas: { home: roundDisplayRate(lambdaHome), away: roundDisplayRate(lambdaAway) },
      monteCarlo,
      teamContext,
      leagueStandings,
      probs: pOut,
      odds,
      luckStats,
      valueBet: {
        detected: valueDetected,
        type: valueType,
        ev: finalEv,
        kelly: finalKelly,
        stakePlan: stakingCompact,
        ensemble: stakingBreakdown,
        reasons: reasonCodes
      },
      valueEngine: valueEngine || buildValueEngine([]),
      marketOdds,
      confidenceEngine,
      explanation,
      featureImportance,
      predictionContributions,
      leagueProfile,
      predictions: {
        oneXtwo: finalPick1X2,
        // prag corect 50 pentru pieţe binare (anterior 55 era greşit:
        // pGG=52% afişa "NGG" deşi GG era mai probabil)
        gg: p.pGG >= 50 ? "GG" : "NGG",
        over25: p.pO25 >= 50 ? "Peste 2.5" : "Sub 2.5",
        correctScore: calc.bestScore,
        marketTiers: {
          oneXtwo: {
            pick: finalPick1X2,
            prob: Number(
              finalPick1X2 === "1" ? p1Adj : finalPick1X2 === "2" ? p2Adj : pXAdj
            ).toFixed(1) * 1,
            tier: marketTier(
              finalPick1X2 === "1" ? p1Adj : finalPick1X2 === "2" ? p2Adj : pXAdj
            )
          },
          gg: {
            pick: p.pGG >= 50 ? "GG" : "NGG",
            prob: Number(p.pGG >= 50 ? p.pGG : 100 - p.pGG).toFixed(1) * 1,
            tier: marketTier(Math.max(p.pGG, 100 - p.pGG))
          },
          over25: {
            pick: p.pO25 >= 50 ? "Peste 2.5" : "Sub 2.5",
            prob: Number(p.pO25 >= 50 ? p.pO25 : 100 - p.pO25).toFixed(1) * 1,
            tier: marketTier(Math.max(p.pO25, 100 - p.pO25))
          },
          correctScore: {
            pick: calc.bestScore,
            prob: Number(calc.bestScoreProb || 0).toFixed(1) * 1,
            tier: marketTier(Math.min(95, (calc.bestScoreProb || 0) * 3))
          }
        }
      },
      recommended: {
        pick: topPick,
        confidence: maxConf,
        odd: Number.isFinite(Number(recommendedQuote.odd)) ? Number(recommendedQuote.odd) : null,
        oddSource: recommendedQuote.source || null,
        bookmakersUsed: recommendedQuote.bookmakersUsed || 0
      },
      modelMeta: {
        method,
        probsModel: calc?.modelMeta?.method || "unknown",
        dataQuality: Number(dataQuality.toFixed(3)),
        leagueMultiplier: Number(leagueMultiplier.toFixed(3)),
        driftPenalty: Number(driftPenalty.toFixed(3)),
        cooldownCap: Number(riskContext.cooldownCap.toFixed(2)),
        stakeBucket: stakePolicy.bucket,
        stakeCap: stakePolicy.dynamicCap,
        reasonCodes,
        modelVersion: MODEL_VERSION,
        gridMax: calc?.modelMeta?.gridMax,
        massCaptured: calc?.modelMeta?.massCaptured,
        topPickLift: topSelection.lift,
        topPickAlternates: topSelection.alternates,
        leagueParams: {
          leagueAvg: leagueParams.leagueAvg,
          homeAdv: leagueParams.homeAdv,
          awayAdv: leagueParams.awayAdv,
          rho: leagueParams.rho,
          blendWeight: Number(blendW.toFixed(3)),
          goalFrequency: leagueParams.goalFrequency,
          drawFrequency: leagueParams.drawFrequency,
          bttsRate: leagueParams.bttsRate,
          overFrequency: leagueParams.overFrequency,
          corners: leagueParams.corners,
          cards: leagueParams.cards,
          possessionTendency: leagueParams.possessionTendency,
          profileKey: leagueParams.profileKey
        },
        strengthMeta: strengthMeta || undefined,
        modularScores: modularScores || undefined,
        activeModel: appliedModelId,
        xgModel: xgModelMeta,
        predictorVersion: PIPELINE_TRACE_VERSION,
        pipeline: buildPipelineTrace({
          fetch: { ok: true, detail: "api-football+cache" },
          cache: { ok: true, detail: "getWithCache" },
          features: { ok: Boolean(confidenceCtx?.hStats), detail: "teamStats+moduleInputs" },
          predictionEngine: { ok: method === "modular-engine" || Boolean(modularScores), detail: method },
          poisson: { ok: Boolean(calc?.probs), detail: calc?.modelMeta?.method || null },
          elo: { ok: Boolean(eloInfo), detail: eloInfo ? `spread=${eloInfo.eloSpread}` : "unavailable" },
          xg: {
            ok: Boolean(xgModelMeta?.applied),
            detail: xgModelMeta?.blendedIntoLambda
              ? `blended:${xgModelMeta.source}`
              : xgModelMeta?.source || "lambda_fallback"
          },
          injuries: {
            ok: modularScores?.injuries?.available !== false && Boolean(modularScores?.injuries),
            detail: modularScores?.injuries ? "module" : "neutral"
          },
          weather: {
            ok: Boolean(modularScores?.weather),
            detail: modularScores?.weather?.details?.reason || modularScores?.weather?.detail?.reason || null
          },
          referee: {
            ok: Boolean(refereeName),
            detail: refereeName || "unassigned"
          },
          lineups: {
            ok: Boolean(modularScores?.lineup),
            detail: modularScores?.lineup ? "module" : "neutral"
          },
          restDays: {
            ok: Boolean(modularScores?.restDays),
            detail: modularScores?.restDays ? "module" : "neutral"
          },
          motivation: {
            ok: Boolean(modularScores?.motivation),
            detail: modularScores?.motivation ? "standings_rank" : "neutral"
          },
          calibration: {
            ok: calibrationApplied,
            detail: calibrationApplied ? "maps_applied" : "skipped"
          },
          confidence: {
            ok: Boolean(confidenceEngine),
            detail: confidenceEngine?.overall != null ? `overall=${confidenceEngine.overall}` : null
          },
          recommendation: {
            ok: Boolean(topPick),
            detail: topPick || null
          },
          featureImportance: {
            ok: Boolean(featureImportance?.topFeatures?.length || predictionContributions),
            detail: predictionContributions ? "contributions+fi" : "fi"
          },
          prediction: { ok: true, detail: "row_emitted" }
        }),
        calibrationApplied,
        stackerApplied,
        stackerSampleSize: stackerEntry?.sampleSize || null,
        calibrationSampleSize: leagueCalibMaps
          ? Math.max(
              leagueCalibMaps["1"]?.sampleSize || 0,
              leagueCalibMaps["X"]?.sampleSize || 0,
              leagueCalibMaps["2"]?.sampleSize || 0
            )
          : null,
        elo: eloInfo
          ? {
              home: eloInfo.eloHome,
              away: eloInfo.eloAway,
              spread: eloInfo.eloSpread,
              thin: eloInfo.thin
            }
          : undefined,
        eloSpread: eloInfo?.eloSpread ?? undefined,
        firstHalf: firstHalfMeta || undefined
      },
      auditLog: {
        reasonCodes,
        topFeatures
      },
      modelVersion: MODEL_VERSION,
      evaluation
    };
    predictionRow.predictionLaboratory = buildPredictionLaboratory(predictionRow);
    row = predictionRow;
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
  }

  if (!context.stageMarks) context.stageMarks = {};
  context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
