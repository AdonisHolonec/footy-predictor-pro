/**
 * Compact audit trace for the λ-generation pipeline, attached to
 * modelMeta.pipeline in the prediction response.
 *
 * `PIPELINE_TRACE_VERSION` is a stable output-contract value read by
 * stored prediction history — keep the string itself ("predictor-v2.1")
 * unchanged even if this module is renamed or moved again.
 */

export const PIPELINE_TRACE_VERSION = "predictor-v2.1";

export const LAMBDA_TRACE_STAGE_IDS = Object.freeze([
  "fetch",
  "cache",
  "features",
  "predictionEngine",
  "poisson",
  "elo",
  "xg",
  "injuries",
  "weather",
  "referee",
  "lineups",
  "restDays",
  "motivation",
  "calibration",
  "confidence",
  "recommendation",
  "featureImportance",
  "prediction"
]);

/**
 * Compact audit trace attached to modelMeta.pipeline.
 */
export function buildPipelineTrace(flags = {}) {
  const stages = {};
  for (const id of LAMBDA_TRACE_STAGE_IDS) {
    const f = flags[id];
    stages[id] = {
      status: f?.status || (f?.ok === false ? "skipped" : f?.ok ? "ok" : "pending"),
      detail: f?.detail || null
    };
  }
  return {
    version: PIPELINE_TRACE_VERSION,
    stages,
    summary: LAMBDA_TRACE_STAGE_IDS.map((id) => `${id}:${stages[id].status}`).join(" → ")
  };
}
