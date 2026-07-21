import { assertSupabaseConfigured, getSupabaseAdmin } from "../supabaseAdmin.js";
import { getApiUsage, getDailyCacheStats, getLocalCacheStats } from "../fetcher.js";
import {
  getDailyReport,
  getOpsMetrics,
  getOpsMetricsHistory,
  listDailyReports,
  saveDailyReport
} from "./metricsStore.js";
import { processResourceSnapshot } from "./requestMonitor.js";
import { logInfo, logWarn } from "./logger.js";

function levelFrom(ok, degraded) {
  if (!ok) return "critical";
  if (degraded) return "degraded";
  return "healthy";
}

/**
 * Build ops alerts from live metrics + usage/cache.
 */
export function buildOpsAlerts({ metrics, usage, cache, checks }) {
  const alerts = [];
  const predict = metrics?.routes?.predict;
  const api = metrics?.routes?.api;
  const cacheRoute = metrics?.routes?.cache;
  const failures = metrics?.failures || {};

  if ((failures.prediction || 0) >= 3) {
    alerts.push({
      id: "prediction_failures",
      level: failures.prediction >= 10 ? "high" : "medium",
      message: `Prediction failures today: ${failures.prediction}`,
      value: failures.prediction
    });
  }
  if ((failures.api || 0) >= 5) {
    alerts.push({
      id: "api_failures",
      level: failures.api >= 20 ? "high" : "medium",
      message: `Upstream API failures today: ${failures.api}`,
      value: failures.api
    });
  }
  if ((failures.cache || 0) >= 3) {
    alerts.push({
      id: "cache_failures",
      level: failures.cache >= 10 ? "high" : "medium",
      message: `Cache failures today: ${failures.cache}`,
      value: failures.cache
    });
  }

  if (predict?.errorRate >= 0.15 && predict.count >= 5) {
    alerts.push({
      id: "predict_error_rate",
      level: predict.errorRate >= 0.35 ? "high" : "medium",
      message: `Predict error rate ${(predict.errorRate * 100).toFixed(0)}% (n=${predict.count})`,
      value: predict.errorRate
    });
  }
  if ((predict?.p95Ms || 0) >= 20000) {
    alerts.push({
      id: "predict_latency",
      level: "medium",
      message: `Predict p95 latency ${Math.round(predict.p95Ms)}ms`,
      value: predict.p95Ms
    });
  }
  if ((api?.p95Ms || 0) >= 5000) {
    alerts.push({
      id: "api_latency",
      level: "medium",
      message: `Upstream API p95 ${Math.round(api.p95Ms)}ms`,
      value: api.p95Ms
    });
  }

  // C10: soft alert ≥80%, hard ≥95% (aligned with apiBudgetCircuit defaults).
  const usagePct = usage?.limit ? (usage.count / usage.limit) * 100 : 0;
  const softPct = Math.max(50, Math.min(Number(process.env.API_BUDGET_SOFT_PCT || 80), 99));
  const hardPct = Math.max(softPct, Math.min(Number(process.env.API_BUDGET_HARD_PCT || 95), 100));
  if (usagePct >= softPct) {
    alerts.push({
      id: "api_quota",
      level: usagePct >= hardPct ? "high" : "medium",
      message: `API quota ${usagePct.toFixed(0)}% (${usage.count}/${usage.limit}) — circuit ${
        usagePct >= hardPct ? "HARD" : "SOFT"
      }`,
      value: usagePct
    });
  }

  const hitRatio = cache?.hitRatio;
  if (hitRatio != null && hitRatio < 0.15 && (cache.hits || 0) + (cache.misses || 0) >= 20) {
    alerts.push({
      id: "cache_hit_ratio",
      level: "medium",
      message: `Cache hit ratio ${(hitRatio * 100).toFixed(0)}%`,
      value: hitRatio
    });
  }

  if (checks?.kv?.ok === false) {
    alerts.push({ id: "kv_down", level: "high", message: "KV health check failed", value: 1 });
  }
  if (checks?.supabase?.ok === false) {
    alerts.push({ id: "supabase_down", level: "high", message: "Supabase health check failed", value: 1 });
  }

  const severity = alerts.some((a) => a.level === "high")
    ? "high"
    : alerts.some((a) => a.level === "medium")
      ? "medium"
      : "none";

  return { alerts, severity };
}

async function checkKv() {
  const started = Date.now();
  try {
    const { createClient } = await import("@vercel/kv");
    const kv = createClient({
      url: process.env.KV_REST_API_URL || process.env.Database_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.KV_REST_API_TOKEN || process.env.Database_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    });
    const probeKey = "footy_health_probe";
    await kv.set(probeKey, { t: Date.now() }, { ex: 60 });
    await kv.get(probeKey);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: err?.message || "kv_error" };
  }
}

async function checkSupabase() {
  const started = Date.now();
  const cfg = assertSupabaseConfigured();
  if (!cfg.ok) return { ok: false, latencyMs: Date.now() - started, error: cfg.error };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, latencyMs: Date.now() - started, error: "no_client" };
  try {
    const { error } = await sb.from("profiles").select("user_id").limit(1);
    if (error) return { ok: false, latencyMs: Date.now() - started, error: error.message };
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: err?.message || "supabase_error" };
  }
}

/**
 * Full health + monitoring bundle for the Health Dashboard.
 */
export async function buildHealthBundle({ historyDays = 7 } = {}) {
  const [kvCheck, sbCheck, usage, cache, metrics, history, latestReport, reports] = await Promise.all([
    checkKv(),
    checkSupabase(),
    getApiUsage(),
    getDailyCacheStats(),
    getOpsMetrics(),
    getOpsMetricsHistory(historyDays),
    getDailyReport(),
    listDailyReports(Math.min(historyDays, 7))
  ]);

  const processSnapshot = processResourceSnapshot();
  const localCache = getLocalCacheStats();
  const checks = {
    kv: kvCheck,
    supabase: sbCheck,
    upstreamConfigured: Boolean(process.env.APISPORTS_KEY || process.env.X_RAPIDAPI_KEY || process.env.APIFOOTBALL_KEY)
  };

  const { alerts, severity } = buildOpsAlerts({ metrics, usage, cache, checks });

  const anyCritical = !kvCheck.ok || !sbCheck.ok;
  const anyDegraded = severity === "medium" || severity === "high" || !checks.upstreamConfigured;
  const status = levelFrom(!anyCritical, anyDegraded && !anyCritical);

  return {
    ok: !anyCritical,
    status,
    severity,
    generatedAt: new Date().toISOString(),
    checks,
    process: processSnapshot,
    usage: {
      count: usage.count,
      limit: usage.limit,
      remaining: Math.max(0, (usage.limit || 0) - (usage.count || 0)),
      pct: usage.limit ? Number(((usage.count / usage.limit) * 100).toFixed(1)) : 0,
      updatedAt: usage.updatedAt
    },
    cache: {
      ...cache,
      processHitRatio: localCache.hitRatio
    },
    performance: {
      predictionLatency: metrics.routes.predict,
      apiLatency: metrics.routes.api,
      cacheLatency: metrics.routes.cache,
      fixturesLatency: metrics.routes.fixtures
    },
    failures: metrics.failures,
    alerts,
    history,
    dailyReport: latestReport,
    recentReports: reports,
    metrics
  };
}

/**
 * Aggregate and persist a daily ops report.
 */
export async function generateDailyReport(dateISO) {
  const day = dateISO || new Date().toISOString().slice(0, 10);
  const bundle = await buildHealthBundle({ historyDays: 1 });
  const report = {
    date: day,
    status: bundle.status,
    severity: bundle.severity,
    usage: bundle.usage,
    cache: {
      hits: bundle.cache.hits,
      misses: bundle.cache.misses,
      hitRatio: bundle.cache.hitRatio
    },
    performance: {
      predictionP95: bundle.performance.predictionLatency.p95Ms,
      apiP95: bundle.performance.apiLatency.p95Ms,
      cacheP95: bundle.performance.cacheLatency.p95Ms,
      predictionAvg: bundle.performance.predictionLatency.avgMs,
      apiAvg: bundle.performance.apiLatency.avgMs
    },
    failures: bundle.failures,
    alertCount: bundle.alerts.length,
    alerts: bundle.alerts.map((a) => ({ id: a.id, level: a.level, message: a.message })),
    memoryMb: bundle.process.memory.heapUsedMb,
    generatedAt: new Date().toISOString()
  };

  const saved = await saveDailyReport(report);
  if (bundle.severity === "high") logWarn("ops.daily_report.alert", { date: day, severity: bundle.severity });
  else logInfo("ops.daily_report", { date: day, status: report.status, alertCount: report.alertCount });
  return saved || report;
}
