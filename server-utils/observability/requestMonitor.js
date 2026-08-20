import { logError, logInfo, logWarn } from "./logger.js";
import { bumpCounter, recordObservation } from "./metricsStore.js";

/** Read a response header defensively — a test double may not implement getHeader. */
function readHeader(res, name) {
  try {
    if (typeof res?.getHeader !== "function") return null;
    const v = res.getHeader(name);
    return v == null ? null : String(v);
  } catch {
    return null;
  }
}

/**
 * Classify a predict response as cache-served or live from the header Stage01 already
 * sets. Every DB-cache short-circuit stamps X-Data-Source with a `db_only_*` reason; the
 * live pipeline leaves it unset. Reading it here is what keeps this counter out of
 * PredictorV3 — the pipeline is observed, not modified.
 */
/**
 * A request at or above this is logged as slow rather than routine.
 *
 * Exported so PredictorV3 emits its stage-timing summary on exactly the same
 * requests this marks slow, instead of carrying a second copy of the number
 * that could drift away from it.
 */
export const SLOW_REQUEST_MS = 8000;

export function classifyPredictSource(res) {
  const source = readHeader(res, "X-Data-Source");
  if (!source) return { channel: "predictLive", counter: "predict_served_live", source: "live" };
  return source.startsWith("db_only")
    ? { channel: "predictCached", counter: "predict_served_cache", source }
    : { channel: "predictLive", counter: "predict_served_live", source };
}

/** Persistence warnings Stage10 already surfaces as a response header. */
export const PERSIST_WARNING_COUNTERS = Object.freeze({
  predictions_history_upsert_failed: "persist_history_failed",
  user_prediction_fixtures_link_failed: "persist_ownership_failed"
});

function stampTimingHeaders(res, durationMs) {
  try {
    if (!res.headersSent) {
      if (!res.getHeader("X-Response-Time")) {
        res.setHeader("X-Response-Time", `${durationMs}ms`);
      }
      if (!res.getHeader("Server-Timing")) {
        res.setHeader("Server-Timing", `app;dur=${durationMs}`);
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Attach finish-hook metrics + structured request log to a Node/Vercel handler.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{ route: "predict"|"fixtures"|string }} opts
 */
export function attachRequestMonitor(req, res, opts = {}) {
  const route = String(opts.route || "api");
  const started = Date.now();
  let statusCode = 200;
  let recorded = false;

  const origStatus = typeof res.status === "function" ? res.status.bind(res) : null;
  if (origStatus) {
    res.status = (code) => {
      statusCode = Number(code) || statusCode;
      return origStatus(code);
    };
  }

  const origJson = typeof res.json === "function" ? res.json.bind(res) : null;
  if (origJson) {
    res.json = (body) => {
      stampTimingHeaders(res, Date.now() - started);
      return origJson(body);
    };
  }

  const origEnd = typeof res.end === "function" ? res.end.bind(res) : null;
  if (origEnd) {
    res.end = (...args) => {
      stampTimingHeaders(res, Date.now() - started);
      return origEnd(...args);
    };
  }

  const finalize = () => {
    if (recorded) return;
    recorded = true;
    const durationMs = Date.now() - started;
    const ok = statusCode < 500;
    const failureKind = route === "predict" && !ok ? "prediction" : null;

    void recordObservation(route === "predict" || route === "fixtures" ? route : "api", {
      durationMs,
      ok,
      failureKind
    });

    let dataSource = null;
    if (route === "predict") {
      // Split predict by data source so "generation time" (live) is not averaged with
      // cache-served responses, which never enter the fixture loop.
      const { channel, counter, source } = classifyPredictSource(res);
      dataSource = source;
      void recordObservation(channel, { durationMs, ok, failureKind });
      void bumpCounter(counter);

      // Persistence warnings were previously header-only: nothing counted them, so a
      // silent persist failure was invisible. This is the ownership/history gap made
      // observable without touching Stage10.
      const warning = readHeader(res, "X-Persist-Warning");
      const counterName = warning ? PERSIST_WARNING_COUNTERS[warning] : null;
      if (counterName) {
        void bumpCounter(counterName);
        logWarn("predict.persist_warning", { warning, path: String(req.url || "").split("?")[0] });
      }
    }

    const meta = {
      ...(dataSource ? { dataSource } : {}),
      route,
      method: req.method,
      status: statusCode,
      durationMs,
      path: String(req.url || "").split("?")[0] || ""
    };

    if (!ok) logError("http.request.failed", meta);
    else if (durationMs >= SLOW_REQUEST_MS) logWarn("http.request.slow", meta);
    else logInfo("http.request", meta);
  };

  if (typeof res.once === "function") {
    res.once("finish", finalize);
    res.once("close", finalize);
  }

  return { started };
}

/** Snapshot of process memory / uptime for health checks (serverless per-invoke). */
export function processResourceSnapshot() {
  const mem = process.memoryUsage();
  const cpu = typeof process.cpuUsage === "function" ? process.cpuUsage() : null;
  return {
    uptimeSec: Number(process.uptime().toFixed(1)),
    memory: {
      rssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
      heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
      heapTotalMb: Number((mem.heapTotal / 1024 / 1024).toFixed(1)),
      externalMb: Number((mem.external / 1024 / 1024).toFixed(1))
    },
    cpu: cpu
      ? {
          userUs: cpu.user,
          systemUs: cpu.system
        }
      : null,
    node: process.version,
    pid: process.pid
  };
}
