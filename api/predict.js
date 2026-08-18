/**
 * api/predict.js — thin HTTP adapter (Predictor V3 Foundation).
 * Prediction logic lives under server-utils/pipeline/ (moved, not rewritten).
 */
import { PredictorV3 } from "../server-utils/pipeline/PredictorV3.js";
import { withObservationScope } from "../server-utils/observability/metricsStore.js";

async function handlerImpl(req, res) {
  return PredictorV3.handle(req, res);
}

/**
 * One buffered metrics document per invocation: every recordObservation /
 * bumpCounter inside this handler is applied to a single read and written back
 * once, instead of a GET+SET each. Wrapping is required HERE because this is
 * the invocation boundary — requestMonitor only covers predict and fixtures,
 * and the warm/cron paths that issue the most cache telemetry never reach it.
 */
export default async function handler(req, res) {
  return withObservationScope(() => handlerImpl(req, res));
}
