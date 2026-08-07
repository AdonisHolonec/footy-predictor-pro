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
import { getBenchmarkHealth, getSettlementHealth } from "./syncTelemetry.js";
import { readLatestOpsSnapshot } from "./opsSnapshot.js";
import { logInfo, logWarn } from "./logger.js";

function levelFrom(ok, degraded) {
  if (!ok) return "critical";
  if (degraded) return "degraded";
  return "healthy";
}

/**
 * Build ops alerts from live metrics + usage/cache.
 */
/**
 * Prediction health (S2), derived from the split channels and counters requestMonitor
 * records off response headers. No pipeline instrumentation: PredictorV3 is untouched.
 */
export function buildPredictionHealth(metrics) {
  const counters = metrics?.counters || {};
  const live = Number(counters.predict_served_live || 0);
  const cached = Number(counters.predict_served_cache || 0);
  const total = live + cached;
  const liveCh = metrics?.routes?.predictLive || null;
  const cachedCh = metrics?.routes?.predictCached || null;

  return {
    generatedToday: total,
    servedLive: live,
    servedFromCache: cached,
    cacheServedPct: total > 0 ? Number(((cached / total) * 100).toFixed(1)) : null,
    /** Live requests run the fixture loop, so this is generation time. */
    avgGenerationMs: liveCh?.avgMs ?? null,
    p95GenerationMs: liveCh?.p95Ms ?? null,
    /** All predict requests, cached and live — the latency a user actually experiences. */
    avgLatencyMs: metrics?.routes?.predict?.avgMs ?? null,
    p95LatencyMs: metrics?.routes?.predict?.p95Ms ?? null,
    avgCachedLatencyMs: cachedCh?.avgMs ?? null,
    failures: Number(metrics?.failures?.prediction || 0),
    persistFailures: {
      history: Number(counters.persist_history_failed || 0),
      ownership: Number(counters.persist_ownership_failed || 0)
    },
    upstreamFallbacks: Number(counters.api_upstream_fallback || 0)
  };
}

export function buildOpsAlerts({ metrics, usage, cache, checks, settlement, benchmark, snapshot }) {
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

  // Settlement: finished matches whose recommended pick no surface can render as win/loss.
  // This is the signal that was missing when a settled Corners pick showed "no result".
  const stillPending = Number(settlement?.recommendedStillPending ?? 0);
  const pendingWarn = Math.max(1, Number(process.env.SETTLEMENT_PENDING_WARN || 5));
  const pendingCrit = Math.max(pendingWarn, Number(process.env.SETTLEMENT_PENDING_CRITICAL || 20));
  if (stillPending >= pendingWarn) {
    alerts.push({
      id: "settlement_pending",
      level: stillPending >= pendingCrit ? "high" : "medium",
      message: `Finished fixtures with an ungraded recommended pick: ${stillPending}`,
      value: stillPending
    });
  }
  // A settlement sync that stopped running is worse than one reporting a backlog.
  const settlementAge = Number(settlement?.ageMinutes);
  const staleAfterMin = Math.max(60, Number(process.env.SETTLEMENT_STALE_MINUTES || 1440));
  if (settlement?.ok && Number.isFinite(settlementAge) && settlementAge >= staleAfterMin) {
    alerts.push({
      id: "settlement_stale",
      level: "high",
      message: `Settlement sync last ran ${Math.round(settlementAge / 60)}h ago`,
      value: settlementAge
    });
  }

  // Benchmark sweep: a growing backlog means accrual is budget-bound, not that it stopped.
  const benchmarkBacklog = Number(benchmark?.backlog ?? 0);
  if (benchmarkBacklog > 0) {
    alerts.push({
      id: "benchmark_backlog",
      level: benchmarkBacklog >= 200 ? "medium" : "low",
      message: `Benchmark sweep backlog: ${benchmarkBacklog} unbenchmarked fixtures in window`,
      value: benchmarkBacklog
    });
  }

  // Persistence warnings were header-only until S2. A prediction the user was shown but
  // that never reached the database is the ownership/settlement class of bug, so any
  // occurrence is worth surfacing rather than waiting for a threshold.
  const counters = metrics?.counters || {};
  const persistHistory = Number(counters.persist_history_failed || 0);
  const persistOwnership = Number(counters.persist_ownership_failed || 0);
  if (persistHistory + persistOwnership > 0) {
    alerts.push({
      id: "persist_failures",
      level: persistHistory + persistOwnership >= 5 ? "high" : "medium",
      message: `Persist warnings today — history: ${persistHistory}, ownership: ${persistOwnership}`,
      value: persistHistory + persistOwnership
    });
  }

  // A stale snapshot means the dashboard's slow-moving numbers are lying about "today".
  const snapshotAge = Number(snapshot?.ageMinutes);
  if (Number.isFinite(snapshotAge) && snapshotAge >= 2880) {
    alerts.push({
      id: "ops_snapshot_stale",
      level: "medium",
      message: `Health snapshot is ${Math.round(snapshotAge / 60)}h old`,
      value: snapshotAge
    });
  }
  // Cron Health, the replacement for the brief's Queue Health: this system has no queue,
  // so what matters is whether each scheduled job still runs and still succeeds.
  const failingJobs = snapshot?.cron?.failingJobs || [];
  const staleJobs = snapshot?.cron?.staleJobs || [];
  if (failingJobs.length > 0) {
    alerts.push({
      id: "cron_failing",
      level: "high",
      message: `Cron jobs reporting failure: ${failingJobs.join(", ")}`,
      value: failingJobs.length
    });
  }
  if (staleJobs.length > 0) {
    alerts.push({
      id: "cron_stale",
      level: "medium",
      message: `Cron jobs not run in over 24h: ${staleJobs.join(", ")}`,
      value: staleJobs.length
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
  const [
    kvCheck,
    sbCheck,
    usage,
    cache,
    metrics,
    history,
    latestReport,
    reports,
    settlementHealth,
    benchmarkHealth,
    snapshot
  ] = await Promise.all([
    checkKv(),
    checkSupabase(),
    getApiUsage(),
    getDailyCacheStats(),
    getOpsMetrics(),
    getOpsMetricsHistory(historyDays),
    getDailyReport(),
    listDailyReports(Math.min(historyDays, 7)),
    // Both read the KV streams written by the settlement sync and the benchmark sweep —
    // no SQL, no upstream calls, so they add no meaningful cost to this bundle.
    getSettlementHealth(historyDays),
    getBenchmarkHealth(historyDays),
    // One indexed row written by the daily cron — the expensive aggregates are NOT
    // recomputed here, which is what keeps this bundle fast.
    readLatestOpsSnapshot()
  ]);

  const processSnapshot = processResourceSnapshot();
  const localCache = getLocalCacheStats();
  const checks = {
    kv: kvCheck,
    supabase: sbCheck,
    upstreamConfigured: Boolean(process.env.APISPORTS_KEY || process.env.X_RAPIDAPI_KEY || process.env.APIFOOTBALL_KEY)
  };

  const { alerts, severity } = buildOpsAlerts({
    metrics,
    usage,
    cache,
    checks,
    settlement: settlementHealth,
    benchmark: benchmarkHealth,
    snapshot
  });

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
    predictionHealth: buildPredictionHealth(metrics),
    settlementHealth,
    benchmarkHealth,
    /** Slow-moving aggregates from the daily cron; null until the first snapshot runs. */
    snapshot,
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
