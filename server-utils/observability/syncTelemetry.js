/**
 * Sync-run telemetry (S1 of the observability sprint).
 *
 * Settlement sync and the benchmark sweep both already compute a rich result object on
 * every run — how many finished fixtures were scanned, how many recommended picks are
 * still ungraded, how much of the fetch budget was consumed. Until now that object went
 * to the HTTP response and a console line and was then discarded, so nobody could see a
 * trend. `recommendedStillPending` climbing for days is exactly what produced the P0
 * where a settled Corners pick rendered as "no result".
 *
 * This module persists those runs. It adds no measurement of its own: every number here
 * is one the caller already had.
 *
 * Storage is KV, reusing the pattern in metricsStore.js — deliberately no new table, so
 * S1 ships without a migration. Retention is short by design (14 days); durable history
 * belongs to the `ops_health_snapshots` table in S3.
 */

import { createClient } from "@vercel/kv";
import { logWarn } from "./logger.js";

const kv = createClient({
  url: process.env.KV_REST_API_URL || process.env.Database_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token:
    process.env.KV_REST_API_TOKEN ||
    process.env.Database_KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN
});

/** Telemetry streams. Add a kind here rather than inventing a parallel store. */
export const SYNC_KINDS = Object.freeze({
  SETTLEMENT: "settlement",
  BENCHMARK: "benchmark"
});

const VALID_KINDS = new Set(Object.values(SYNC_KINDS));
const RUNS_PER_DAY_CAP = 48;
const TTL_SECONDS = 14 * 24 * 60 * 60;
const MAX_DAYS = 14;

function dayKey(kind, dateISO) {
  return `footy_ops_sync:${kind}:${dateISO}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Append one run to today's stream. Never throws — a lost telemetry row must never
 * fail a settlement or benchmark run.
 *
 * @param {string} kind One of SYNC_KINDS.
 * @param {object} payload The result object the caller already computed.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function recordSyncRun(kind, payload) {
  if (!VALID_KINDS.has(kind)) return { ok: false, reason: "unknown_kind" };
  if (!payload || typeof payload !== "object") return { ok: false, reason: "no_payload" };

  const at = new Date().toISOString();
  const key = dayKey(kind, todayISO());
  try {
    const existing = (await kv.get(key)) || {};
    const runs = Array.isArray(existing.runs) ? existing.runs.slice() : [];
    runs.push({ at, ...payload });
    if (runs.length > RUNS_PER_DAY_CAP) runs.splice(0, runs.length - RUNS_PER_DAY_CAP);
    await kv.set(key, { date: todayISO(), runs }, { ex: TTL_SECONDS });
    return { ok: true };
  } catch (err) {
    logWarn("ops.sync_telemetry.write_failed", { kind, error: err?.message || "kv_write" });
    return { ok: false, reason: "kv_write_failed" };
  }
}

/** Raw runs for a kind, newest first, across the last `days` daily buckets. */
export async function readSyncRuns(kind, days = 7) {
  if (!VALID_KINDS.has(kind)) return [];
  const safeDays = Math.max(1, Math.min(Number(days) || 7, MAX_DAYS));
  const keys = Array.from({ length: safeDays }, (_, i) => dayKey(kind, isoDaysAgo(i)));
  try {
    const rows = await Promise.all(keys.map((k) => kv.get(k).catch(() => null)));
    return rows
      .filter(Boolean)
      .flatMap((row) => (Array.isArray(row.runs) ? row.runs : []))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  } catch (err) {
    logWarn("ops.sync_telemetry.read_failed", { kind, error: err?.message || "kv_read" });
    return [];
  }
}

function minutesSince(iso) {
  const t = new Date(iso || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60_000));
}

function sum(runs, field) {
  return runs.reduce((acc, r) => acc + (Number(r?.[field]) || 0), 0);
}

/**
 * Settlement health, derived entirely from recorded runs.
 * `recommendedStillPending` on the newest run is the headline number: finished matches
 * whose recommended pick no surface can render as win/loss.
 */
export async function getSettlementHealth(days = 7) {
  const runs = await readSyncRuns(SYNC_KINDS.SETTLEMENT, days);
  const latest = runs[0] || null;

  return {
    ok: Boolean(latest),
    lastRunAt: latest?.at || null,
    ageMinutes: latest ? minutesSince(latest.at) : null,
    runs: runs.length,
    latest,
    totals: {
      finishedScanned: sum(runs, "finishedScanned"),
      recommendedSettled: sum(runs, "recommendedSettledNow"),
      missingTotals: sum(runs, "missingTotals"),
      skippedByBudget: sum(runs, "syncSkippedBudget")
    },
    /** Trend of the one number that matters, newest first. */
    pendingTrend: runs.slice(0, 12).map((r) => ({
      at: r.at,
      stillPending: Number(r.recommendedStillPending ?? 0)
    })),
    recommendedStillPending: Number(latest?.recommendedStillPending ?? 0)
  };
}

/** Benchmark sweep health, derived from recorded sweep results. */
export async function getBenchmarkHealth(days = 7) {
  const runs = await readSyncRuns(SYNC_KINDS.BENCHMARK, days);
  const latest = runs[0] || null;
  const scanned = Number(latest?.scanned ?? 0);
  const unbenchmarked = Number(latest?.unbenchmarked ?? 0);

  return {
    ok: Boolean(latest),
    lastRunAt: latest?.at || null,
    ageMinutes: latest ? minutesSince(latest.at) : null,
    runs: runs.length,
    latest,
    totals: {
      fetched: sum(runs, "fetched"),
      persisted: sum(runs, "persisted"),
      errors: sum(runs, "errors")
    },
    backlog: Number(latest?.backlog ?? 0),
    /** Share of the newest scan already benchmarked — the sweep's coverage of its window. */
    coveragePct: scanned > 0 ? Number((((scanned - unbenchmarked) / scanned) * 100).toFixed(1)) : null
  };
}

export default {
  SYNC_KINDS,
  recordSyncRun,
  readSyncRuns,
  getSettlementHealth,
  getBenchmarkHealth
};
