/**
 * api/predict.js — thin HTTP adapter (Predictor V3 Foundation).
 * Prediction logic lives under server-utils/pipeline/ (moved, not rewritten).
 */
import { PredictorV3 } from "../server-utils/pipeline/PredictorV3.js";

export default async function handler(req, res) {
  return PredictorV3.handle(req, res);
}
