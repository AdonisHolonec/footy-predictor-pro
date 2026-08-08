/** Typed mirror of confidenceWeights.js */

export declare const DEFAULT_CONFIDENCE_WEIGHTS: {
  readonly attack: number;
  readonly defense: number;
  readonly form: number;
  readonly recentMatches: number;
  readonly standings: number;
  readonly referee: number;
  readonly injuries: number;
  readonly lineups: number;
  readonly restDays: number;
  readonly homeAdvantage: number;
  readonly oddsConsensus: number;
  readonly h2h: number;
};

export type ConfidenceWeightKey = keyof typeof DEFAULT_CONFIDENCE_WEIGHTS;

export declare function getConfidenceWeights(...args: unknown[]): unknown;
export declare function normalizeConfidenceWeights(...args: unknown[]): unknown;
export declare function confidenceCategory(...args: unknown[]): unknown;
export declare const CONFIDENCE_DIMENSION_KEYS: readonly string[];
