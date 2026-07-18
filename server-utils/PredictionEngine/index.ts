/**
 * Typed entry for PredictionEngine.
 * Runtime orchestration: ./index.js
 */

export {
  build,
  summarizeModuleScores,
  PredictionEngine,
  MODULES,
  getPredictionWeights,
  DEFAULT_PREDICTION_WEIGHTS
} from "./index.js";

export type {
  ModuleResult,
  ModuleScore,
  PredictionContext,
  PredictionEngineResult,
  PredictionWeights,
  EngineModule
} from "./types.js";
