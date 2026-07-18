/**
 * Backwards-compatible façade.
 * Canonical implementation: server-utils/PredictionEngine/
 * api/predict.js keeps importing this path — contract unchanged.
 */

export {
  build,
  summarizeModuleScores,
  PredictionEngine,
  MODULES,
  getPredictionWeights,
  DEFAULT_PREDICTION_WEIGHTS
} from "../PredictionEngine/index.js";

export { PredictionEngine as default } from "../PredictionEngine/index.js";
