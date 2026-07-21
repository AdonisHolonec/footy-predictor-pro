import type { PredictionWeights } from "./types.js";

/** Mirror of runtime defaults in weights.js — keep in sync. */
export const DEFAULT_PREDICTION_WEIGHTS: PredictionWeights = {
  attack: 1.0,
  defense: 1.0,
  form: 1.0,
  homeAdvantage: 1.0,
  awayStrength: 0.02,
  standings: 0.15,
  h2h: 0.1,
  referee: 0.05,
  restDays: 0.08,
  recentMatches: 0.12,
  injuries: 0.1,
  lineup: 0.08,
  odds: 0.05,
  motivation: 0.05,
  weather: 0.05,
  expectedGoals: 0.2,
  poissonCorrelation: 0,
  modularBlend: 1
};

export { getPredictionWeights } from "./weights.js";
