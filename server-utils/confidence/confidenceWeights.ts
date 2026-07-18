/** Typed mirror of confidenceWeights.js */

export const DEFAULT_CONFIDENCE_WEIGHTS = {
  attack: 0.14,
  defense: 0.14,
  form: 0.1,
  recentMatches: 0.08,
  standings: 0.1,
  referee: 0.05,
  injuries: 0.06,
  lineups: 0.05,
  restDays: 0.06,
  homeAdvantage: 0.06,
  oddsConsensus: 0.09,
  h2h: 0.07
} as const;

export type ConfidenceWeightKey = keyof typeof DEFAULT_CONFIDENCE_WEIGHTS;

export {
  getConfidenceWeights,
  normalizeConfidenceWeights,
  confidenceCategory,
  CONFIDENCE_DIMENSION_KEYS
} from "./confidenceWeights.js";
