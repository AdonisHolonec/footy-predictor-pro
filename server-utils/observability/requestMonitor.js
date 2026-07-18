import { logError, logInfo, logWarn } from "./logger.js";
import { recordObservation } from "./metricsStore.js";

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

    const meta = {
      route,
      method: req.method,
      status: statusCode,
      durationMs,
      path: String(req.url || "").split("?")[0] || ""
    };

    if (!ok) logError("http.request.failed", meta);
    else if (durationMs >= 8000) logWarn("http.request.slow", meta);
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
