import type { PredictionWeights } from "./types.js";

export const DEFAULT_PREDICTION_WEIGHTS: PredictionWeights = {
  attack: 1.0,
  defense: 1.0,
  form: 1.0,
  homeAdvantage: 1.0,
  standings: 0.15,
  h2h: 0.1,
  referee: 0.05,
  restDays: 0.08,
  recentMatches: 0.12,
  poissonCorrelation: 0.12,
  // 0 = optional modules do not change λ (numeric parity with strength-ratings).
  // Raise via PREDICT_WEIGHT_MODULAR_BLEND when ready to blend standings/H2H/etc.
  modularBlend: 0
};

function envNum(key: string, fallback: number): number {
  const raw = typeof process !== "undefined" ? process.env?.[key] : undefined;
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Load weights with optional `PREDICT_WEIGHT_*` env overrides. */
export function getPredictionWeights(): PredictionWeights {
  const d = DEFAULT_PREDICTION_WEIGHTS;
  return {
    attack: envNum("PREDICT_WEIGHT_ATTACK", d.attack),
    defense: envNum("PREDICT_WEIGHT_DEFENSE", d.defense),
    form: envNum("PREDICT_WEIGHT_FORM", d.form),
    homeAdvantage: envNum("PREDICT_WEIGHT_HOME_ADVANTAGE", d.homeAdvantage),
    standings: envNum("PREDICT_WEIGHT_STANDINGS", d.standings),
    h2h: envNum("PREDICT_WEIGHT_H2H", d.h2h),
    referee: envNum("PREDICT_WEIGHT_REFEREE", d.referee),
    restDays: envNum("PREDICT_WEIGHT_REST_DAYS", d.restDays),
    recentMatches: envNum("PREDICT_WEIGHT_RECENT_MATCHES", d.recentMatches),
    poissonCorrelation: envNum("PREDICT_WEIGHT_POISSON_CORRELATION", d.poissonCorrelation),
    modularBlend: envNum("PREDICT_WEIGHT_MODULAR_BLEND", d.modularBlend)
  };
}
