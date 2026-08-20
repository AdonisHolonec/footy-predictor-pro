/**
 * Predictor V3 orchestrator — stages never call each other.
 * Request stages: Stage00 → Stage01 → (fixture loop Stage02…09) → Stage10 → Stage11 → Stage12.
 *
 * Behavior: same algorithms as legacy api/predict.js (moved, not rewritten).
 */

import { createPipelineContext } from "./PipelineContext.js";
import { logError, logWarn } from "../observability/logger.js";
import { createPipelineTelemetry, recordStage, summarize } from "../observability/pipelineTelemetry.js";
import { SLOW_REQUEST_MS } from "../observability/requestMonitor.js";
import { getLocalCacheStats, upstreamCursor, upstreamSamplesSince } from "../fetcher.js";
import { decrementPredictCountBy } from "../accessTier.js";
import { filterByMinDisplayOdds } from "../predictionDisplayGate.js";
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

export const PREDICTOR_V3_VERSION = "predictor-v3.1-perf-elo-batch";

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

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/**
 * Upstream and cache attribution for one request.
 *
 * Cache counters come from the diff of the process-local counters the fetcher
 * already keeps and Stage12 already reports; upstream durations come from the
 * fetcher's sample ring since a cursor taken at request start. Both are module
 * scope, so concurrent requests in one warm instance interleave — stated here
 * rather than implied, because it bounds how far these numbers can be trusted.
 */
function collectUpstream(cacheBefore, upstreamFrom) {
  const after = getLocalCacheStats();
  const samples = upstreamSamplesSince(upstreamFrom);
  const durations = samples.map((s) => s.ms).sort((a, b) => a - b);
  const slowest = samples.reduce((best, s) => (!best || s.ms > best.ms ? s : best), null);

  const byEndpoint = Object.create(null);
  for (const s of samples) {
    const e = byEndpoint[s.endpoint] || (byEndpoint[s.endpoint] = { calls: 0, totalMs: 0 });
    e.calls += 1;
    e.totalMs += s.ms;
  }
  const slowestFamilies = Object.entries(byEndpoint)
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .slice(0, 5)
    .map(([endpoint, v]) => ({ endpoint, calls: v.calls, totalMs: v.totalMs }));

  return {
    calls: samples.length,
    errors: samples.filter((s) => !s.ok).length,
    totalMs: durations.reduce((a, b) => a + b, 0),
    maxMs: durations.length ? durations[durations.length - 1] : 0,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    slowestEndpoint: slowest ? { endpoint: slowest.endpoint, ms: slowest.ms, ok: slowest.ok } : null,
    slowestFamilies,
    cacheHits: Math.max(0, (after.hits || 0) - (cacheBefore.hits || 0)),
    cacheMisses: Math.max(0, (after.misses || 0) - (cacheBefore.misses || 0)),
    inflightJoins: Math.max(0, (after.inflightJoins || 0) - (cacheBefore.inflightJoins || 0))
  };
}

/**
 * One structured line per SLOW request, and nothing at all otherwise.
 *
 * A 35-fixture Predict must not become 35 log lines, and a fast Predict must not
 * become any. The threshold is the same one requestMonitor uses to classify a
 * request slow, so the two always agree about which requests are interesting.
 */
function emitPredictTelemetry({ telemetry, startedAt, cacheBefore, upstreamFrom, context }) {
  const totalMs = Date.now() - startedAt;
  if (totalMs < SLOW_REQUEST_MS) return null;
  const summary = summarize(telemetry, {
    totalMs,
    upstream: collectUpstream(cacheBefore, upstreamFrom)
  });
  summary.halted = Boolean(context?.halted);
  summary.dataSource = context?.responseHeaders?.["X-Data-Source"] || (context?.halted ? "halted" : "live");
  logWarn("predict.timing", summary);
  return summary;
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export async function handle(req, res) {
  const context = createPipelineContext(req, res);
  context.predictorVersion = PREDICTOR_V3_VERSION;

  /*
    Timing attribution. One production Predict took 48,744 ms for 35 fixtures and
    nothing could say where it went: stageMarks is written by every stage and read
    by nobody, and stages 02-09 overwrite theirs per fixture.

    Timed HERE, in the orchestrator, rather than inside thirteen stage files —
    the stages stay untouched, and `finally` means a halting or throwing stage is
    still measured. Measurement only: no stage order, no behaviour, no output.
  */
  const startedAt = Date.now();
  const telemetry = createPipelineTelemetry();
  context.telemetry = telemetry;
  const cacheBefore = getLocalCacheStats();
  const upstreamFrom = upstreamCursor();

  const runStage = async (stage) => {
    const stageStarted = Date.now();
    try {
      await stage.run(context);
    } finally {
      recordStage(telemetry, stage.STAGE_ID || "unknown", Date.now() - stageStarted);
    }
  };

  const emit = () => {
    // Best-effort: telemetry must never affect the response.
    try {
      emitPredictTelemetry({ telemetry, startedAt, cacheBefore, upstreamFrom, context });
    } catch {
      /* observability must not break a prediction */
    }
  };

  try {
    for (const stage of REQUEST_STAGES_BEFORE_FIXTURES) {
      await runStage(stage);
      if (context.halted) {
        await runStage(Stage12Response);
        emit();
        return;
      }
    }

    await runFixtureStageLoop(context);
    if (context.halted) {
      await runStage(Stage12Response);
      emit();
      return;
    }

    // Global odds floor: drop candidates below MIN_DISPLAY_ODDS the moment odds become
    // known (end of the fixture loop) — before persistence, tier masking, or the response
    // body are built, so a filtered row never occupies a slot, gets ranked, or reaches a user.
    context.out = filterByMinDisplayOdds(context.out);

    for (const stage of REQUEST_STAGES_AFTER_FIXTURES) {
      await runStage(stage);
    }
    emit();
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
