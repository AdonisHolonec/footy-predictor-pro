/**
 * PredictExecution — compatibility façade.
 * Prefer PredictorV3.handle (api/predict.js). Kept so older imports keep working.
 */

export { handle as executePredictRequest, PredictorV3, PREDICTOR_V3_VERSION } from "../PredictorV3.js";
export { runFixtureStageLoop } from "./runFixtureStageLoop.js";
