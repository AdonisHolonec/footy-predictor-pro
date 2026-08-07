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
import { evaluateAlertRules } from "./alertRules.js";
import { logInfo, logWarn } from "./logger.js";

function levelFrom(ok, degraded) {
  if (!ok) return "critical";
  if (degraded) return "degraded";
  return "healthy";
}

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

/**
 * Ops alerts for the dashboard and the daily report.
 *
 * The thresholds themselves live in alertRules.js as a declarative table (S5) so that one
 * escalation policy serves the alert list, the subsystem rollup and the dashboard reading.
 * This stays a named export because callers and tests depend on the signature.
 */
export function buildOpsAlerts(context) {
  const { alerts, severity } = evaluateAlertRules(context);
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

  // Evaluated once: the alert list and the per-subsystem Healthy/Warning/Critical rollup
  // come from the same pass, so they can never disagree about the same reading.
  const { alerts, severity, subsystems, thresholds } = evaluateAlertRules({
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
    /** Per-subsystem Healthy/Warning/Critical rollup of the same rule evaluation (S5). */
    subsystems,
    /** Effective alert thresholds, env overrides applied, so the UI reads what alerting reads. */
    thresholds,
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
    // Stored per day so digests are comparable: "settlement went warning on the 5th" is a
    // question the alert list alone cannot answer once the alerts have cleared.
    subsystems: bundle.subsystems,
    memoryMb: bundle.process.memory.heapUsedMb,
    generatedAt: new Date().toISOString()
  };

  const saved = await saveDailyReport(report);
  if (bundle.severity === "high") logWarn("ops.daily_report.alert", { date: day, severity: bundle.severity });
  else logInfo("ops.daily_report", { date: day, status: report.status, alertCount: report.alertCount });
  return saved || report;
}
