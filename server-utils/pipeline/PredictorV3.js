/**
 * Predictor V3 orchestrator — stages never call each other.
 * Request stages: Stage00 → Stage01 → (fixture loop Stage02…09) → Stage10 → Stage11 → Stage12.
 *
 * Behavior: same algorithms as legacy api/predict.js (moved, not rewritten).
 */

import { createPipelineContext } from "./PipelineContext.js";
import { logError } from "../observability/logger.js";
import { decrementPredictCountBy } from "../accessTier.js";
import * as Stage00Ingress from "./stages/Stage00Ingress.js";
import * as Stage01DataCollection from "./stages/Stage01DataCollection.js";
import { runFixtureStageLoop } from "./stages/runFixtureStageLoop.js";
import * as Stage10Persistence from "./stages/Stage10Persistence.js";
import * as Stage11Masking from "./stages/Stage11Masking.js";
import * as Stage12Response from "./stages/Stage12Response.js";
import * as Stage02FeatureCollection from "./stages/Stage02FeatureCollection.js";
import * as Stage03LambdaGeneration from "./stages/Stage03LambdaGeneration.js";
import * as Stage04ProbabilityGeneration from "./stages/Stage04ProbabilityGeneration.js";
import * as Stage05Simulation from "./stages/Stage05Simulation.js";
import * as Stage06Calibration from "./stages/Stage06Calibration.js";
import * as Stage07ModelFusion from "./stages/Stage07ModelFusion.js";
import * as Stage08Decision from "./stages/Stage08Decision.js";
import * as Stage09Explainability from "./stages/Stage09Explainability.js";

export const PREDICTOR_V3_VERSION = "predictor-v3.1-shared-pmf";

/** Full stage graph (fixture stages run inside runFixtureStageLoop). */
export const STAGE_ORDER = [
  Stage00Ingress,
  Stage01DataCollection,
  Stage02FeatureCollection,
  Stage03LambdaGeneration,
  Stage04ProbabilityGeneration,
  Stage05Simulation,
  Stage06Calibration,
  Stage07ModelFusion,
  Stage08Decision,
  Stage09Explainability,
  Stage10Persistence,
  Stage11Masking,
  Stage12Response
];

export const REQUEST_STAGES_BEFORE_FIXTURES = [Stage00Ingress, Stage01DataCollection];
export const REQUEST_STAGES_AFTER_FIXTURES = [Stage10Persistence, Stage11Masking, Stage12Response];

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export async function handle(req, res) {
  const context = createPipelineContext(req, res);
  context.predictorVersion = PREDICTOR_V3_VERSION;

  try {
    for (const stage of REQUEST_STAGES_BEFORE_FIXTURES) {
      await stage.run(context);
      if (context.halted) {
        await Stage12Response.run(context);
        return;
      }
    }

    await runFixtureStageLoop(context);
    if (context.halted) {
      await Stage12Response.run(context);
      return;
    }

    for (const stage of REQUEST_STAGES_AFTER_FIXTURES) {
      await stage.run(context);
    }
  } catch (error) {
    logError("predict.handler_failed", { error: error?.message || String(error) });
    const reserved = context.reservedTierUsage || 0;
    if (reserved > 0 && context.usageCtx?.userId) {
      await decrementPredictCountBy(context.usageCtx.userId, context.usageCtx.usageDay, reserved);
    }
    if (!context.responseSent) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  }
}

export const PredictorV3 = {
  version: PREDICTOR_V3_VERSION,
  stages: STAGE_ORDER,
  handle
};

export default PredictorV3;
