/**
 * Ops health snapshot (S3).
 *
 * The expensive half of the health dashboard: averages and distributions over
 * predictions_history, plus business and cron rollups. Computing these on every
 * dashboard open would scan thousands of rows and make the status page the slowest
 * endpoint in the product, so the daily cron computes them once and writes one row to
 * `ops_health_snapshots`; the dashboard reads that row.
 *
 * The heavy aggregation itself lives in SQL (migration 041) rather than here — pulling
 * rows into JS to average them would defeat the point. This module orchestrates and
 * persists; it does not compute.
 *
 * Live probes (KV, Supabase, quota, route latency) stay real-time in healthBundle.js.
 * Only what is expensive and slow-moving belongs in a snapshot.
 */

import { getSupabaseAdmin } from "../supabaseAdmin.js";
import { logWarn } from "./logger.js";

const SNAPSHOT_TABLE = "ops_health_snapshots";
const DEFAULT_WINDOW_DAYS = 7;
const STALE_JOB_MINUTES = 1440;

function clampDays(days) {
  return Math.max(1, Math.min(Number(days) || DEFAULT_WINDOW_DAYS, 120));
}

function minutesSince(iso) {
  const t = new Date(iso || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60_000));
}

/** Call an aggregate RPC, degrading to null rather than failing the whole snapshot. */
async function callAggregate(supabase, fn, windowDays) {
  const { data, error } = await supabase.rpc(fn, { p_days: windowDays });
  if (error) {
    logWarn("ops.snapshot.aggregate_failed", { fn, error: error.message });
    return null;
  }
  return data ?? null;
}

/**
 * Notification health from the dispatch log. Small table, cheap to group in JS —
 * it does not justify an RPC of its own.
 */
export async function buildNotificationHealth(supabase, windowDays) {
  const safeDays = clampDays(windowDays);
  const since = new Date(Date.now() - safeDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("notification_dispatch_log")
    .select("status, notification_type, created_at")
    .gte("created_at", since)
    .limit(20_000);
  if (error) {
    logWarn("ops.snapshot.notifications_failed", { error: error.message });
    return { ok: false, error: error.message };
  }

  const rows = data || [];
  const byStatus = {};
  const byType = {};
  for (const r of rows) {
    const s = String(r.status || "unknown");
    const t = String(r.notification_type || "unknown");
    byStatus[s] = (byStatus[s] || 0) + 1;
    byType[t] = (byType[t] || 0) + 1;
  }
  const sent = byStatus.sent || 0;
  const errors = byStatus.error || 0;
  const total = rows.length;

  return {
    ok: true,
    windowDays: safeDays,
    total,
    byStatus,
    byType,
    errorPct: total > 0 ? Number(((errors / total) * 100).toFixed(1)) : null,
    successPct: total > 0 ? Number(((sent / total) * 100).toFixed(1)) : null,
    lastDispatchAt: rows.reduce(
      (max, r) => (!max || String(r.created_at) > max ? String(r.created_at) : max),
      null
    )
  };
}

/**
 * Cron health — the replacement for the "Queue Health" card in the original brief.
 * There is no queue in this system: the crons are scheduled HTTP invocations declared
 * in vercel.json, so what is actually worth watching is whether each one last ran and
 * whether it succeeded.
 */
export async function buildCronHealth(supabase) {
  const jobs = {};

  const { data: syncStatus } = await supabase
    .from("history_sync_status")
    .select("last_ran_at, last_ok, last_scanned, last_updated, last_error")
    .eq("id", 1)
    .maybeSingle();
  if (syncStatus) {
    jobs.historySync = {
      lastRanAt: syncStatus.last_ran_at || null,
      ageMinutes: minutesSince(syncStatus.last_ran_at),
      ok: syncStatus.last_ok !== false,
      scanned: Number(syncStatus.last_scanned || 0),
      updated: Number(syncStatus.last_updated || 0),
      error: syncStatus.last_error || null
    };
  }

  const { data: metaRuns } = await supabase
    .from("meta_learning_runs")
    .select("started_at, finished_at, ok, error")
    .order("started_at", { ascending: false })
    .limit(1);
  const metaRun = Array.isArray(metaRuns) ? metaRuns[0] : null;
  if (metaRun) {
    jobs.metaLearningRefresh = {
      lastRanAt: metaRun.started_at || null,
      ageMinutes: minutesSince(metaRun.started_at),
      ok: metaRun.ok === true,
      error: metaRun.error || null
    };
  }

  return {
    ok: true,
    jobs,
    staleJobs: Object.entries(jobs)
      .filter(([, j]) => Number.isFinite(j.ageMinutes) && j.ageMinutes >= STALE_JOB_MINUTES)
      .map(([name]) => name),
    failingJobs: Object.entries(jobs)
      .filter(([, j]) => j.ok === false)
      .map(([name]) => name)
  };
}

/**
 * Compute and persist one snapshot. Never throws past the cron boundary.
 * @param {{ windowDays?: number, dryRun?: boolean }} [options]
 */
export async function captureOpsSnapshot(options = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, skipped: "no_supabase" };

  const windowDays = clampDays(options.windowDays);
  const dryRun = Boolean(options.dryRun);

  try {
    const [prediction, settlement, business, notifications, cron] = await Promise.all([
      callAggregate(supabase, "ops_prediction_aggregates", windowDays),
      callAggregate(supabase, "ops_settlement_aggregates", windowDays),
      callAggregate(supabase, "ops_business_metrics", windowDays),
      buildNotificationHealth(supabase, windowDays),
      buildCronHealth(supabase)
    ]);

    const row = {
      window_days: windowDays,
      prediction: prediction || {},
      settlement: settlement || {},
      business: business || {},
      notifications: notifications || {},
      cron: cron || {}
    };

    // A section whose RPC failed lands as {} rather than aborting the snapshot: the
    // dashboard renders "no data" for that card and every other card stays useful.
    const degraded = [
      !prediction && "prediction",
      !settlement && "settlement",
      !business && "business"
    ].filter(Boolean);

    if (dryRun) return { ok: true, dryRun: true, degraded, snapshot: row };

    const { error } = await supabase.from(SNAPSHOT_TABLE).insert(row);
    if (error) {
      logWarn("ops.snapshot.write_failed", { error: error.message });
      return { ok: false, error: error.message, degraded, snapshot: row };
    }

    return { ok: true, degraded, snapshot: row };
  } catch (err) {
    logWarn("ops.snapshot.failed", { error: err?.message || String(err) });
    return { ok: false, error: err?.message || "snapshot_failed" };
  }
}

/** Newest snapshot for the dashboard. One indexed row — cheap enough for a live read. */
export async function readLatestOpsSnapshot() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from(SNAPSHOT_TABLE)
      .select("captured_at, window_days, prediction, settlement, business, notifications, cron")
      .order("captured_at", { ascending: false })
      .limit(1);
    if (error) {
      logWarn("ops.snapshot.read_failed", { error: error.message });
      return null;
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;
    return {
      capturedAt: row.captured_at,
      ageMinutes: minutesSince(row.captured_at),
      windowDays: row.window_days,
      prediction: row.prediction || {},
      settlement: row.settlement || {},
      business: row.business || {},
      notifications: row.notifications || {},
      cron: row.cron || {}
    };
  } catch {
    return null;
  }
}

export default {
  captureOpsSnapshot,
  readLatestOpsSnapshot,
  buildNotificationHealth,
  buildCronHealth
};
