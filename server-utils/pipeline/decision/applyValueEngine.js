/**
 * Professional Value Betting Engine (sole value path — Stage07 defers here).
 * Re-evaluates across 1X2 / Double Chance / BTTS / O-U / Corners / Cards
 * using the final coherent probs. Never recommends negative EV.
 * Extracted verbatim from Stage08Decision.js (no logic changes), including
 * its own try/catch — value-engine failure must never fail predict.
 */

import { poissonOverLine } from "../../math.js";
import { buildValueEngine, buildProfessionalValueEngine } from "../../value/ValueEngine.js";
import { deriveCardsLambda, clampPct, applyStakePolicyV2 } from "../predictHelpers.js";

/**
 * @param {{ cardsQuote: object|null, leagueParams: object, modularScores: object|null,
 *   cornersBlock: object|null, pOut: object, odds: object|null, doubleChanceQuote: object|null,
 *   bttsQuote: object|null, goals15Quote: object|null, goals25Quote: object|null,
 *   goals35Quote: object|null, marketOdds: object|null, cornersPick: object|null,
 *   dataQuality: number, maxConf: number, leagueStakeCap: number, cooldownCap: number,
 *   fixtureId: number, valueEngine: object|null, valueDetected: boolean, valueType: string,
 *   finalEv: number, finalKelly: number, stakingCompact: string, reasonCodes: string[],
 *   correctScoreOdds: Record<string, number>|null, correctScoreProbsPct: Record<string, number>|null }} params
 * @returns {{ valueEngine: object|null, valueDetected: boolean, valueType: string,
 *   finalEv: number, finalKelly: number, stakingCompact: string, reasonCodes: string[] }}
 */
export function applyValueEngine({
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
  cooldownCap,
  fixtureId,
  valueEngine,
  valueDetected,
  valueType,
  finalEv,
  finalKelly,
  stakingCompact,
  reasonCodes,
  correctScoreOdds,
  correctScoreProbsPct
}) {
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
      cardsUnderProbPct: pCardsUnder,
      correctScoreOdds: correctScoreOdds || null,
      correctScoreProbsPct: correctScoreProbsPct || null
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
        cooldownCap
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

  return { valueEngine, valueDetected, valueType, finalEv, finalKelly, stakingCompact, reasonCodes };
}

export default applyValueEngine;
