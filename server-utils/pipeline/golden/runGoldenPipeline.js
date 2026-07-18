/**
 * Run Stage03–09 (or a suffix) against a golden context.
 */

import * as Stage03LambdaGeneration from "../stages/Stage03LambdaGeneration.js";
import * as Stage04ProbabilityGeneration from "../stages/Stage04ProbabilityGeneration.js";
import * as Stage05Simulation from "../stages/Stage05Simulation.js";
import * as Stage06Calibration from "../stages/Stage06Calibration.js";
import * as Stage07ModelFusion from "../stages/Stage07ModelFusion.js";
import * as Stage08Decision from "../stages/Stage08Decision.js";
import * as Stage09Explainability from "../stages/Stage09Explainability.js";

export const GOLDEN_STAGES = [
  Stage03LambdaGeneration,
  Stage04ProbabilityGeneration,
  Stage05Simulation,
  Stage06Calibration,
  Stage07ModelFusion,
  Stage08Decision,
  Stage09Explainability
];

/**
 * @param {object} context
 * @param {{ startStage?: string }} [opts]
 */
export async function runGoldenPipeline(context, opts = {}) {
  const startStage = opts.startStage || "Stage03LambdaGeneration";
  const startIdx = GOLDEN_STAGES.findIndex((s) => s.STAGE_ID === startStage);
  if (startIdx < 0) {
    throw new Error(`Unknown golden startStage: ${startStage}`);
  }

  for (const stage of GOLDEN_STAGES.slice(startIdx)) {
    await stage.run(context);
    if (context.fixture?.aborted) break;
  }
  return context;
}

export default { runGoldenPipeline, GOLDEN_STAGES };
