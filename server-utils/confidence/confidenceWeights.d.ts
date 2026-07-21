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

export declare function getConfidenceWeights(...args: any[]): any;
export declare function normalizeConfidenceWeights(...args: any[]): any;
export declare function confidenceCategory(...args: any[]): any;
export declare const CONFIDENCE_DIMENSION_KEYS: readonly string[];
