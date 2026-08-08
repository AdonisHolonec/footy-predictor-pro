import type { PredictionWeights } from "./types.js";

/** Mirror of runtime defaults in weights.js — keep in sync. */
export declare const DEFAULT_PREDICTION_WEIGHTS: PredictionWeights;

export declare function getPredictionWeights(...args: unknown[]): unknown;
