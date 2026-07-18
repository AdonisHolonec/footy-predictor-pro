import type { PredictionWeights } from "./types.js";

export const DEFAULT_PREDICTION_WEIGHTS: PredictionWeights = {
  attack: 1.0,
  defense: 1.0,
  form: 1.0,
  homeAdvantage: 1.0,
  awayStrength: 0.0,
  standings: 0.15,
  h2h: 0.1,
  referee: 0.05,
  restDays: 0.08,
  recentMatches: 0.12,
  injuries: 0.0,
  lineup: 0.0,
  odds: 0.0,
  motivation: 0.0,
  weather: 0.0,
  expectedGoals: 0.0,
  poissonCorrelation: 0.12,
  modularBlend: 0
};

export { getPredictionWeights } from "./weights.js";
