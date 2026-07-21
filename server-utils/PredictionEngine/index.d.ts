/**
 * Typed entry for PredictionEngine.
 * Runtime orchestration: ./index.js
 */

export declare function build(...args: any[]): any;
export declare function summarizeModuleScores(...args: any[]): any;
export declare const PredictionEngine: any;
export declare const MODULES: any;
export declare function getPredictionWeights(...args: any[]): any;
export declare const DEFAULT_PREDICTION_WEIGHTS: any;

export type {
  ModuleResult,
  ModuleScore,
  PredictionContext,
  PredictionEngineResult,
  PredictionWeights,
  EngineModule
} from "./types.js";
