/**
 * Professional Value Betting Engine (sole value path — Stage07 defers here).
 * Re-evaluates across 1X2 / Double Chance / BTTS / O-U / Corners / Cards
 * using the final coherent probs. Never recommends negative EV.
 * Extracted verbatim from Stage08Decision.js (no logic changes), including
 * its own try/catch — value-engine failure must never fail predict.
 */

import { buildValueEngine, buildProfessionalValueEngine } from "../../value/ValueEngine.js";
import { applyStakePolicyV2 } from "../predictHelpers.js";

/**
 * @param {{ pOut: object, odds: object|null, doubleChanceQuote: object|null,
 *   bttsQuote: object|null, goals15Quote: object|null, goals25Quote: object|null,
 *   goals35Quote: object|null, cornersSelections: Array<object>|null,
 *   cardsSelections: Array<object>|null,
 *   dataQuality: number, maxConf: number, leagueStakeCap: number, cooldownCap: number,
 *   fixtureId: number, valueEngine: object|null, valueDetected: boolean, valueType: string,
 *   finalEv: number, finalKelly: number, stakingCompact: string, reasonCodes: string[],
 *   correctScoreOdds: Record<string, number>|null, correctScoreProbsPct: Record<string, number>|null }} params
 * @returns {{ valueEngine: object|null, valueDetected: boolean, valueType: string,
 *   finalEv: number, finalKelly: number, stakingCompact: string, reasonCodes: string[] }}
 */
export function applyValueEngine({
  pOut,
  odds,
  doubleChanceQuote,
  bttsQuote,
  goals15Quote,
  goals25Quote,
  goals35Quote,
  cornersSelections,
  cardsSelections,
  shotsTotalSelections,
  shotsOnTargetSelections,
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
    // Corners and Cards arrive as selections already priced at the bookmaker's own
    // lines (Stage08 -> enumerateLineSelections). Best Value still optimises EV — it
    // simply can no longer do so against a probability that belongs to another line.
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
      cornersSelections: cornersSelections || null,
      cardsSelections: cardsSelections || null,
      shotsTotalSelections: shotsTotalSelections || null,
      shotsOnTargetSelections: shotsOnTargetSelections || null,
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
