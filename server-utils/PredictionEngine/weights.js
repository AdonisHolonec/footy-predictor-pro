/**
 * PredictionEngine weights.
 *
 * Every weight is env-configurable (PREDICT_WEIGHT_*) and resolves as:
 *   DEFAULT → env manual override → auto-calibration overlay (skips env-locked keys).
 *
 * `modularBlend` is the master gate on all optional modules
 * (standings, recentMatches, h2h, restDays, referee, awayStrength,
 * injuries, lineup, odds, motivation, weather). At 0 the optional block
 * collapses to a no-op; at 1 the modules contribute their configured weights.
 * Defaults below ACTIVATE the optional modules; override any value via env.
 */

import { getPredictionManualLocks } from "../calibration/manualLocks.js";
import { getRuntimeOverlay } from "../calibration/overlayRuntime.js";
import { mergeWithAutoOverlay } from "../calibration/mergeWeights.js";

export const DEFAULT_PREDICTION_WEIGHTS = Object.freeze({
  attack: 1.0,
  defense: 1.0,
  form: 1.0,
  homeAdvantage: 1.0,
  awayStrength: 0.05,
  standings: 0.15,
  h2h: 0.1,
  referee: 0.05,
  restDays: 0.08,
  recentMatches: 0.12,
  injuries: 0.1,
  lineup: 0.08,
  odds: 0.15,
  motivation: 0.05,
  weather: 0.05,
  /** Blend strength λ toward rolling xG λ (0 = off, 1 = pure xG). */
  expectedGoals: 0.2,
  poissonCorrelation: 0.12,
  modularBlend: 1
});

function envNum(key, fallback) {
  const raw = typeof process !== "undefined" ? process.env?.[key] : undefined;
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getPredictionWeights() {
  const d = DEFAULT_PREDICTION_WEIGHTS;
  const manual = {
    attack: envNum("PREDICT_WEIGHT_ATTACK", d.attack),
    defense: envNum("PREDICT_WEIGHT_DEFENSE", d.defense),
    form: envNum("PREDICT_WEIGHT_FORM", d.form),
    homeAdvantage: envNum("PREDICT_WEIGHT_HOME_ADVANTAGE", d.homeAdvantage),
    awayStrength: envNum("PREDICT_WEIGHT_AWAY_STRENGTH", d.awayStrength),
    standings: envNum("PREDICT_WEIGHT_STANDINGS", d.standings),
    h2h: envNum("PREDICT_WEIGHT_H2H", d.h2h),
    referee: envNum("PREDICT_WEIGHT_REFEREE", d.referee),
    restDays: envNum("PREDICT_WEIGHT_REST_DAYS", d.restDays),
    recentMatches: envNum("PREDICT_WEIGHT_RECENT_MATCHES", d.recentMatches),
    injuries: envNum("PREDICT_WEIGHT_INJURIES", d.injuries),
    lineup: envNum("PREDICT_WEIGHT_LINEUP", d.lineup),
    odds: envNum("PREDICT_WEIGHT_ODDS", d.odds),
    motivation: envNum("PREDICT_WEIGHT_MOTIVATION", d.motivation),
    weather: envNum("PREDICT_WEIGHT_WEATHER", d.weather),
    expectedGoals: envNum("PREDICT_WEIGHT_EXPECTED_GOALS", d.expectedGoals),
    poissonCorrelation: envNum("PREDICT_WEIGHT_POISSON_CORRELATION", d.poissonCorrelation),
    modularBlend: envNum("PREDICT_WEIGHT_MODULAR_BLEND", d.modularBlend)
  };
  return mergeWithAutoOverlay(manual, getRuntimeOverlay("prediction"), getPredictionManualLocks());
}
