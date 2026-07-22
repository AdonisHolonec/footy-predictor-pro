/**
 * Stage08Decision — Confidence, top pick, stake policy, pro ValueEngine, pOut, explanation inputs.
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
  poissonOverLine,
  reweightPmfTo1x2
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
  applySideMarketCalibration,
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
  marketTier,
  deriveCardsLambda
} from "../predictHelpers.js";


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
    // Rebuild O/U + BTTS from score PMF reweighted to fused 1X2 so tip markets stay coherent.
    let marketProbsAligned = p;
    const scorePmf = f.scorePmf;
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
    // Alegerea pick-ului top ia în considerare TOATE pieţele (Peste 1.5 / 2.5 / 3.5, Sub *, GG, NGG, 1X2)
    // şi penalizează pieţele banal-sigure (Peste 1.5 la exact baseline nu e informativ).
    topSelection = selectTopPick(
      {
        pO15: marketProbsAligned.pO15,
        pO25: marketProbsAligned.pO25,
        pU35: marketProbsAligned.pU35,
        pGG: marketProbsAligned.pGG
      },
      p1Adj,
      pXAdj,
      p2Adj
    );
    topPick = topSelection.pick;
    maxConf = topSelection.prob;
    maxConf = clampPct(maxConf * leagueMultiplier * qualityPenalty);
    const pickLc = String(topPick || "").trim().toLowerCase();
    recommendedQuote = (() => {
      if (!pickLc) return { odd: null, source: null, bookmakersUsed: 0 };
      if (pickLc === "1") {
        return {
          odd: Number.isFinite(Number(odds?.home)) ? Number(odds.home) : null,
          source: odds ? `median(${odds.bookmakersUsed || 0})` : null,
          bookmakersUsed: odds?.bookmakersUsed || 0
        };
      }
      if (pickLc === "x") {
        return {
          odd: Number.isFinite(Number(odds?.draw)) ? Number(odds.draw) : null,
          source: odds ? `median(${odds.bookmakersUsed || 0})` : null,
          bookmakersUsed: odds?.bookmakersUsed || 0
        };
      }
      if (pickLc === "2") {
        return {
          odd: Number.isFinite(Number(odds?.away)) ? Number(odds.away) : null,
          source: odds ? `median(${odds.bookmakersUsed || 0})` : null,
          bookmakersUsed: odds?.bookmakersUsed || 0
        };
      }
      if (pickLc === "gg" || pickLc === "ngg") {
        const odd = pickLc === "gg" ? bttsQuote?.yes : bttsQuote?.no;
        return {
          odd: Number.isFinite(Number(odd)) ? Number(odd) : null,
          source: bttsQuote ? `median(${bttsQuote.bookmakersUsed || 0})` : null,
          bookmakersUsed: bttsQuote?.bookmakersUsed || 0
        };
      }
      const ou = pickLc.match(/^(peste|sub)\s*(1[.,]5|2[.,]5|3[.,]5)$/);
      if (ou) {
        const side = ou[1] === "peste" ? "over" : "under";
        const lineRaw = ou[2].replace(",", ".");
        const quote = lineRaw === "1.5" ? goals15Quote : lineRaw === "2.5" ? goals25Quote : goals35Quote;
        const odd = quote?.[side];
        return {
          odd: Number.isFinite(Number(odd)) ? Number(odd) : null,
          source: quote ? `median(${quote.bookmakersUsed || 0})` : null,
          bookmakersUsed: quote?.bookmakersUsed || 0
        };
      }
      return { odd: null, source: null, bookmakersUsed: 0 };
    })();
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
    
    // === PROFESSIONAL VALUE BETTING ENGINE (sole value path — Stage07 defers here) ===
    // Re-evaluate across 1X2 · Double Chance · BTTS · O/U · Corners · Cards
    // using final coherent probs. Never recommend negative EV.
    try {
      const cardsLine = Number(cardsQuote?.line ?? process.env.VALUE_CARDS_LINE ?? 3.5);
      const cardsLambda = deriveCardsLambda({
        leagueParams,
        modularScores,
        cornersBlock
      });
      const pCardsOver =
        Number.isFinite(cardsLine) && cardsLambda > 0
          ? clampPct(poissonOverLine(cardsLine, cardsLambda) * 100)
          : null;
      const pCardsUnder = pCardsOver != null ? clampPct(100 - pCardsOver) : null;
    
      valueEngine = buildProfessionalValueEngine({
        probs: pOut,
        matchWinnerOdds: odds
          ? { home: odds.home, draw: odds.draw, away: odds.away }
          : null,
        doubleChanceOdds: doubleChanceQuote,
        bttsOdds: bttsQuote,
        goals15Odds: goals15Quote,
        goals25Odds: goals25Quote,
        goals35Odds: goals35Quote,
        cornersQuote: marketOdds?.corners || null,
        cornersProbPct: cornersPick?.probability ?? null,
        cardsOdds: cardsQuote
          ? { over: cardsQuote.over, under: cardsQuote.under, line: cardsLine }
          : null,
        cardsOverProbPct: pCardsOver,
        cardsUnderProbPct: pCardsUnder
      });
    
      const bestVe = valueEngine?.bestMarket;
      if (
        bestVe &&
        valueEngine.detected &&
        bestVe.recommendable !== false &&
        Number(bestVe.expectedValue) > 0 &&
        !bestVe.negativeEV &&
        dataQuality >= 0.55
      ) {
        valueDetected = true;
        valueType = bestVe.type;
        finalEv = Number(bestVe.expectedValue) || 0;
        finalKelly = Number(bestVe.kellyPct) || finalKelly;
        const restaked = applyStakePolicyV2({
          stakePct: finalKelly,
          confidencePct: maxConf,
          dataQuality,
          leagueStakeCap,
          cooldownCap: riskContext.cooldownCap
        });
        finalKelly = restaked.stakePct;
        stakingCompact = `S:${finalKelly.toFixed(2)}% • E:${finalEv.toFixed(1)}%`;
        reasonCodes = Array.from(
          new Set([
            ...reasonCodes,
            "value_engine_pro",
            `value_family_${String(bestVe.family || "other")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")}`,
            `selected_${String(bestVe.type || "").replace(/\s+/g, "_")}`
          ])
        ).slice(0, 10);
      } else if (valueEngine && (!bestVe || Number(bestVe.expectedValue) <= 0)) {
        // Absolute safety: never keep a negative/zero EV recommendation.
        if (!(finalEv > 0)) {
          valueDetected = false;
          valueType = "";
          stakingCompact = "";
        }
        valueEngine = {
          ...valueEngine,
          detected: false,
          recommendable: false,
          highlighted: false
        };
      }
    
      if (valueEngine) {
        valueEngine = {
          ...valueEngine,
          detected: Boolean(valueDetected && finalEv > 0),
          recommendable: Boolean(valueDetected && finalEv > 0 && !(finalEv <= 0)),
          ...(valueDetected && valueEngine.bestMarket
            ? {
                type: valueEngine.bestMarket.type,
                family: valueEngine.bestMarket.family,
                expectedValue: finalEv,
                kellyPct: finalKelly,
                valueScore: valueEngine.bestMarket.valueScore,
                positiveEV: finalEv > 0,
                negativeEV: false,
                signal: finalEv >= 1.25 ? "positive" : finalEv > 0 ? "neutral" : "negative",
                bestMarket: {
                  ...valueEngine.bestMarket,
                  kellyPct: finalKelly,
                  expectedValue: finalEv
                }
              }
            : {})
        };
      }
    } catch (veErr) {
      console.warn("[value-engine]", fixtureId, veErr?.message || veErr);
      if (!valueEngine) valueEngine = buildValueEngine([]);
    }
    
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
