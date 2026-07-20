/**
 * Stage07ModelFusion — Elo, odds/Shin, early value, market quotes, stacker, Model Lab.
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
    eloInfo = null;
    if (homeIdStr && awayIdStr) {
      try {
        const pair = await lookupEloPair(lId, Number(homeIdStr), Number(awayIdStr));
        if (pair) {
          const eloProbs = eloProbabilities(pair.eloHome, pair.eloAway, {
            homeAdvElo: 60 + (leagueParams.homeAdv - 1) * 200
          });
          eloInfo = {
            eloHome: Number(pair.eloHome.toFixed(1)),
            eloAway: Number(pair.eloAway.toFixed(1)),
            eloSpread: Number(((pair.eloHome) - pair.eloAway).toFixed(1)),
            thin: pair.thin,
            probs: eloProbs
          };
        }
      } catch {
        eloInfo = null;
      }
    }
    
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
    
    oddsReq = await getOddsForFixture(fixtureId, oddsByFixtureId, 86400);
    marketOdds = undefined;
    const consensus = oddsReq.ok ? consensusMatchWinnerOdds(oddsReq.data) : null;
    marketProbs = null;
    if (consensus) {
      // Shin's method în loc de eliminarea proporţională a marjei — corectează long-shot bias.
      const shin = shinImpliedProbs(consensus.home, consensus.draw, consensus.away);
      marketProbs = shin ? { p1: shin.p1, pX: shin.pX, p2: shin.p2 } : null;
      odds = {
        home: consensus.home,
        draw: consensus.draw,
        away: consensus.away,
        bookmaker: `median(${consensus.bookmakersUsed})`,
        bookmakersUsed: consensus.bookmakersUsed,
        marginMethod: shin ? "shin" : "proportional",
        shinZ: shin && Number.isFinite(shin.z) ? Number(shin.z.toFixed(4)) : undefined
      };
      const blended = blendModelWithMarket({
        model: { p1: p.p1 / 100, pX: p.pX / 100, p2: p.p2 / 100 },
        market: marketProbs,
        modelWeight: blendW
      });
    
      const candidates = [
        { type: "1", prob: blended?.p1 ?? p.p1 / 100, odd: consensus.home, confidence: p.p1, marketProb: marketProbs?.p1 ?? null },
        { type: "X", prob: blended?.pX ?? p.pX / 100, odd: consensus.draw, confidence: p.pX, marketProb: marketProbs?.pX ?? null },
        { type: "2", prob: blended?.p2 ?? p.p2 / 100, odd: consensus.away, confidence: p.p2, marketProb: marketProbs?.p2 ?? null }
      ].filter((c) => isGoodNum(c.odd) && c.odd >= 1.3);
    
      const dqEarly = dataQualityScore({
        method,
        hasOdds: !!odds,
        hasLuckStats: !!luckStats,
        hasTeamIds: !!homeIdStr && !!awayIdStr
      });
    
      // === VALUE ENGINE (predicted probability + bookmaker odds) ===
      // Hard rule: negative EV selections are never recommendable.
      valueEngine = buildValueEngine(
        candidates.map((c) => ({
          probability: c.prob,
          odds: c.odd,
          type: c.type,
          confidencePct: c.confidence
        }))
      );
    
      const scored = candidates
        .map((c) => {
          const ev = calculateEV(c.prob, c.odd);
          const value = evaluateValue(c.prob, c.odd, {
            type: c.type,
            confidencePct: c.confidence
          });
          const rawEdge = c.prob * c.odd;
          const marketGapPct = c.marketProb === null ? 0 : Math.abs(c.prob - c.marketProb) * 100;
          const volatility = 1 - Math.abs(c.confidence - 50) / 50;
          const ensembleStake = calculateEnsembleStake({
            probability: c.prob,
            odds: c.odd,
            confidencePct: c.confidence,
            marketVolatility: volatility,
            marketGapPct,
            dataQuality: dqEarly
          });
          const kelly = calculateKelly(c.prob, c.odd, c.confidence >= 65);
          const noBet = evaluateNoBetZone({
            edge: rawEdge,
            evPct: ev,
            confidencePct: c.confidence,
            marketGapPct
          });
          const score = (rawEdge - 1) * 120 + ev * 0.35 + ensembleStake.stakePct * 2;
          return { ...c, ev, rawEdge, score, ensembleStake, kelly, noBet, marketGapPct, value };
        })
        // HARD RULE: never recommend negative (or zero) EV — Value Engine gate + legacy no-bet zone.
        .filter((c) => c.value.recommendable && c.ev > 0 && !c.value.negativeEV && c.noBet.allowBet)
        .sort((a, b) => b.score - a.score);
    
      const dq = dqEarly;
    
      if (scored.length > 0) {
        const best = scored[0];
        valueDetected = true;
        valueType = best.type;
        finalEv = best.ev;
        finalKelly = best.ensembleStake.stakePct || best.kelly;
        stakingCompact = `S:${finalKelly.toFixed(2)}% • E:${finalEv.toFixed(1)}%`;
        stakingBreakdown = best.ensembleStake.components;
        reasonCodes = [`selected_${best.type}`, "market_calibrated", "ensemble_staking", "value_engine"];
    
        // Absolute safety net: never ship a negative-EV recommendation.
        if (!(finalEv > 0) || best.value.negativeEV || !best.value.recommendable) {
          valueDetected = false;
          valueType = "";
          finalEv = 0;
          finalKelly = 0;
          stakingCompact = "";
          stakingBreakdown = undefined;
          reasonCodes.push("negative_ev_rejected");
        }
    
        if (dq < 0.55) {
          valueDetected = false;
          valueType = "";
          finalEv = 0;
          finalKelly = 0;
          stakingCompact = "";
          stakingBreakdown = undefined;
          reasonCodes.push("min_sample_guardrail");
        }
      } else {
        const analyzed = candidates
          .map((c) => {
            const ev = calculateEV(c.prob, c.odd);
            const value = evaluateValue(c.prob, c.odd, {
              type: c.type,
              confidencePct: c.confidence
            });
            const rawEdge = c.prob * c.odd;
            const marketGapPct = c.marketProb === null ? 0 : Math.abs(c.prob - c.marketProb) * 100;
            const reasons = evaluateNoBetZone({
              edge: rawEdge,
              evPct: ev,
              confidencePct: c.confidence,
              marketGapPct
            }).reasons;
            if (value.negativeEV || ev <= 0) reasons.push("negative_ev");
            else if (!value.recommendable) reasons.push("value_engine_below_threshold");
            return reasons;
          })
          .flat();
        reasonCodes = Array.from(new Set(analyzed)).slice(0, 4);
      }
    
      // Keep valueEngine.detected aligned with the final recommendation gate.
      if (valueEngine) {
        valueEngine = {
          ...valueEngine,
          detected: Boolean(valueDetected && finalEv > 0),
          ...(valueDetected
            ? {
                type: valueType,
                expectedValue: finalEv,
                kellyPct: finalKelly,
                positiveEV: finalEv > 0,
                negativeEV: false,
                signal: finalEv >= 1.25 ? "positive" : finalEv > 0 ? "neutral" : "negative",
                recommendable: Boolean(valueDetected && finalEv > 0)
              }
            : {})
        };
      }
    }
    
    goals15Quote = null;
    goals25Quote = null;
    goals35Quote = null;
    bttsQuote = null;
    doubleChanceQuote = null;
    cardsQuote = null;
    cornersPick = null;
    if (oddsReq.ok && oddsReq.data) {
      try {
      cornersPick = cornersBlock ? deriveBestOverUnderPick(cornersBlock.total) : null;
      const shotsOnTargetPick = shotsOnTargetBlock ? deriveBestOverUnderPick(shotsOnTargetBlock.total) : null;
      const shotsOnTargetHomePick = shotsOnTargetBlock?.home
        ? deriveBestOverUnderPick(shotsOnTargetBlock.home)
        : null;
      const shotsOnTargetAwayPick = shotsOnTargetBlock?.away
        ? deriveBestOverUnderPick(shotsOnTargetBlock.away)
        : null;
      const shotsTotalPick = shotsTotalBlock ? deriveBestOverUnderPick(shotsTotalBlock.total) : null;
      const firstHalfPick = firstHalfProbs
        ? (Number(firstHalfProbs.pO15) || 0) >= 50
          ? { pick: "Over 1.5 FH", line: 1.5 }
          : { pick: "Under 1.5 FH", line: 1.5 }
        : null;
    
      const selectOddByPick = (quote, pick) => {
        if (!quote || !pick) return null;
        const isOver = String(pick).toLowerCase().includes("over");
        return isOver ? quote.over : quote.under;
      };

      const shotsSourceLabel = (sourceKind) => {
        if (sourceKind === "shots_total") return "total shots";
        if (sourceKind === "team_home") return "home SOT";
        if (sourceKind === "team_away") return "away SOT";
        return "SOT";
      };

      /** Align stored pick/line to the quoted book line when nearest-line fallback was used. */
      const buildOuQuotePayload = (pick, quote, sourceKind = null) => {
        if (!pick) return undefined;
        const side = String(pick.pick || "").toLowerCase().includes("under") ? "under" : "over";
        const src = sourceKind || quote?.sourceKind || null;
        // Cross-market fallbacks keep the model SOT line; only true SOT quotes may snap line.
        const allowSnap = !src || src === "sot";
        const matchedLine = Number(quote?.line);
        const line =
          allowSnap && Number.isFinite(matchedLine) ? matchedLine : pick.line;
        const pickLabel = `${side === "over" ? "Over" : "Under"} ${Number(line).toFixed(1)}`;
        const odd = selectOddByPick(quote, side === "over" ? "Over" : "Under");
        const bookLabel = quote
          ? src && src !== "sot"
            ? `${shotsSourceLabel(src)} · median(${quote.bookmakersUsed})`
            : `median(${quote.bookmakersUsed})`
          : null;
        return {
          pick: pickLabel,
          line,
          odd: odd ?? null,
          requestedLine: pick.line,
          bookLine: Number.isFinite(matchedLine) ? matchedLine : null,
          lineExact: quote ? Boolean(quote.lineExact) : null,
          bookmaker: bookLabel,
          bookmakersUsed: quote?.bookmakersUsed || 0,
          oddSource: src
        };
      };
    
      const cornersQuote = cornersPick
        ? consensusOverUnderOddsAtLine(
            oddsReq.data,
            [
              "Corners Over Under",
              "Corners Over/Under",
              "Total Corners",
              "Total Corners Over/Under",
              "Corner Over/Under",
              "Corners"
            ],
            cornersPick.line,
            { maxLineDelta: 1, kind: "corners" }
          )
        : null;
      const shotsOnTargetQuote = shotsOnTargetPick
        ? resolveShotsOnTargetMarketQuote(oddsReq.data, {
            matchLine: shotsOnTargetPick.line,
            homeLine: shotsOnTargetHomePick?.line ?? null,
            awayLine: shotsOnTargetAwayPick?.line ?? null
          })
        : null;
      const shotsTotalQuote = shotsTotalPick
        ? consensusOverUnderOddsAtLine(
            oddsReq.data,
            SHOTS_TOTAL_MARKET_NAMES,
            shotsTotalPick.line,
            { maxLineDelta: 2, kind: "shots_total" }
          )
        : null;
      const firstHalfQuote = firstHalfPick
        ? consensusOverUnderOddsAtLine(
            oddsReq.data,
            FIRST_HALF_GOALS_MARKET_NAMES,
            firstHalfPick.line,
            { maxLineDelta: 0.5, kind: "first_half_goals" }
          )
        : null;
      goals15Quote = consensusOverUnderOddsAtLine(
        oddsReq.data,
        ["Goals Over/Under", "Goals Over Under", "Total Goals"],
        1.5
      );
      goals25Quote = consensusOverUnderOddsAtLine(
        oddsReq.data,
        ["Goals Over/Under", "Goals Over Under", "Total Goals"],
        2.5
      );
      goals35Quote = consensusOverUnderOddsAtLine(
        oddsReq.data,
        ["Goals Over/Under", "Goals Over Under", "Total Goals"],
        3.5
      );
      bttsQuote = consensusBttsOdds(oddsReq.data);
      doubleChanceQuote = consensusDoubleChanceOdds(oddsReq.data);
      const cardsLine = Number(process.env.VALUE_CARDS_LINE || 3.5);
      cardsQuote = consensusOverUnderOddsAtLine(
        oddsReq.data,
        [
          "Cards Over/Under",
          "Total Cards",
          "Bookings",
          "Cards",
          "Yellow Cards Over/Under",
          "Total Bookings"
        ],
        cardsLine
      );
      if (cardsQuote) cardsQuote.line = cardsLine;
    
      marketOdds = {
        goals15: goals15Quote
          ? {
              pick: "Over 1.5",
              line: 1.5,
              odd: goals15Quote.over,
              over: goals15Quote.over ?? null,
              under: goals15Quote.under ?? null,
              bookmaker: `median(${goals15Quote.bookmakersUsed})`,
              bookmakersUsed: goals15Quote.bookmakersUsed || 0
            }
          : undefined,
        goals25: goals25Quote
          ? {
              pick: "Over 2.5",
              line: 2.5,
              odd: goals25Quote.over,
              over: goals25Quote.over ?? null,
              under: goals25Quote.under ?? null,
              bookmaker: `median(${goals25Quote.bookmakersUsed})`,
              bookmakersUsed: goals25Quote.bookmakersUsed || 0
            }
          : undefined,
        goals35: goals35Quote
          ? {
              pick: "Over 3.5",
              line: 3.5,
              odd: goals35Quote.over,
              over: goals35Quote.over ?? null,
              under: goals35Quote.under ?? null,
              bookmaker: `median(${goals35Quote.bookmakersUsed})`,
              bookmakersUsed: goals35Quote.bookmakersUsed || 0
            }
          : undefined,
        btts: bttsQuote
          ? {
              pick: "GG",
              odd: bttsQuote.yes,
              bookmaker: `median(${bttsQuote.bookmakersUsed})`,
              bookmakersUsed: bttsQuote.bookmakersUsed || 0
            }
          : undefined,
        corners: buildOuQuotePayload(cornersPick, cornersQuote),
        shotsOnTarget: buildOuQuotePayload(
          shotsOnTargetPick,
          shotsOnTargetQuote,
          shotsOnTargetQuote?.sourceKind || null
        ),
        shotsTotal: buildOuQuotePayload(shotsTotalPick, shotsTotalQuote, "shots_total"),
        firstHalfGoals: firstHalfPick
          ? {
              pick: firstHalfPick.pick,
              line: Number.isFinite(Number(firstHalfQuote?.line))
                ? Number(firstHalfQuote.line)
                : firstHalfPick.line,
              odd: selectOddByPick(firstHalfQuote, firstHalfPick.pick),
              bookmaker: firstHalfQuote ? `median(${firstHalfQuote.bookmakersUsed})` : null,
              bookmakersUsed: firstHalfQuote?.bookmakersUsed || 0
            }
          : undefined,
        doubleChance: doubleChanceQuote
          ? {
              homeDraw: doubleChanceQuote.homeDraw,
              homeAway: doubleChanceQuote.homeAway,
              drawAway: doubleChanceQuote.drawAway,
              bookmaker: `median(${doubleChanceQuote.bookmakersUsed})`,
              bookmakersUsed: doubleChanceQuote.bookmakersUsed || 0
            }
          : undefined,
        cards: cardsQuote
          ? {
              pick: "Cards Over/Under",
              line: cardsQuote.line ?? 3.5,
              odd: cardsQuote.over,
              over: cardsQuote.over,
              under: cardsQuote.under,
              bookmaker: `median(${cardsQuote.bookmakersUsed})`,
              bookmakersUsed: cardsQuote.bookmakersUsed || 0
            }
          : undefined
      };
      } catch {
        // Defensive: market-specific odds extraction must never fail the whole predict pipeline.
        marketOdds = undefined;
      }
    }
    
    // --- Stage07ModelFusion: stacker / market / Model Lab ---
    // === STACKER (ML) or calibrated+market blend ===
    // Construim features şi aplicăm stacker dacă avem greutăţi active pentru liga aceasta.
    stackerEntry = pickStackerWeightsForLeague(stackerWeightsMap, lId);
    dataQualityEarly = dataQualityScore({
      method,
      hasOdds: !!odds,
      hasLuckStats: !!luckStats,
      hasTeamIds: !!homeIdStr && !!awayIdStr
    });
    pFinal = null;
    stackerApplied = false;
    if (stackerEntry?.weights) {
      const feats = extractStackerFeatures({
        poissonProbs: { p1: pRaw.p1 / 100, pX: pRaw.pX / 100, p2: pRaw.p2 / 100 },
        marketProbs,
        eloSpread: eloInfo?.eloSpread || 0,
        dataQuality: dataQualityEarly,
        homeAdv: leagueParams.homeAdv,
        rho: leagueParams.rho
      });
      const stacked = applyStacker(feats, stackerEntry.weights);
      if (stacked) {
        pFinal = stacked;
        stackerApplied = true;
      }
    }
    if (!pFinal) {
      // Fallback: model calibrat + blend liniar cu piaţa + drift penalty.
      const modelFrac = { p1: calTriple.p1, pX: calTriple.pX, p2: calTriple.p2 };
      const blended = marketProbs
        ? blendModelWithMarket({ model: modelFrac, market: marketProbs, modelWeight: blendW })
        : modelFrac;
      pFinal = blended || modelFrac;
    }
    
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
    appliedModelId = "E";
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
  
    if (typeof row !== "undefined" && row) f.row = row;
    if (typeof aborted !== "undefined" && aborted) f.aborted = true;
  }

  if (!context.stageMarks) context.stageMarks = {};
  context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
