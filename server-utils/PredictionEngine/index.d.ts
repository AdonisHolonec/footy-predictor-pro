/**
 * Typed entry for PredictionEngine.
 * Runtime orchestration: ./index.js
 */

export declare function build(...args: unknown[]): unknown;
export declare function summarizeModuleScores(...args: unknown[]): unknown;
export declare const PredictionEngine: unknown;
export declare const MODULES: unknown;
export declare function getPredictionWeights(...args: unknown[]): unknown;
export declare const DEFAULT_PREDICTION_WEIGHTS: unknown;

export type {
  ModuleResult,
  ModuleScore,
  PredictionContext,
  PredictionEngineResult,
  PredictionWeights,
  EngineModule
} from "./types.js";
