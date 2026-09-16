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
/*
  Two events per run (STARTED + terminal) instead of one, so the cap now holds ~24
  runs/day rather than 48. Cron schedules five settlement runs a day and the
  observed maximum including a manual trigger is six, so 48 keeps >3x headroom and
  is deliberately left alone.
*/
const RUNS_PER_DAY_CAP = 48;
/*
  30 days, raised from 14. The 14-day window covered the 7-day Tier 3 observation
  but could not answer a 30-day reliability question — the RELIABILITY-007 cron
  audit had to reconstruct slots from Supabase edge logs (24h retention) because
  the journal itself did not reach back far enough.
*/
const TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_DAYS = 30;

/**
 * Status vocabulary for the run journal.
 *
 * STARTED is written at handler entry; exactly one of COMPLETED / FAILED /
 * DB_UNAVAILABLE is written at the end. UNKNOWN is deliberately NOT a stored
 * value — a run that dies without reaching any terminal write cannot write
 * anything by definition, so "unknown" is a read-side inference over a STARTED
 * with no partner (see `reconcileRunJournal`).
 */
export const RUN_STATUS = Object.freeze({
  STARTED: "STARTED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  DB_UNAVAILABLE: "DB_UNAVAILABLE"
});

/**
 * The `historyTiming` sync stages whose awaited work is a Supabase/PostgREST call.
 *
 * `providerFixtureMs` and `statsMs` are API-Football; `cpuPrepareMs` and
 * `resettleCpuMs` are in-process. `closingOddsMs` and `globalSettlementMs` mix
 * provider and database work, so they are deliberately EXCLUDED: a stage that can
 * fail for either reason is not evidence of a database outage.
 */
const DB_SYNC_STAGES = new Set([
  "scan1Ms",
  "upsert1Ms",
  "scan2Ms",
  "upsert2Ms",
  "scan3Ms",
  "upsert3Ms",
  "syncStatusPersistMs"
]);

/** `classifyHistoryError` kinds that mean the database refused to serve. */
const DB_UNAVAILABLE_KINDS = new Set(["db_timeout"]);

/**
 * FAILED vs DB_UNAVAILABLE, from signals `historyTiming.recordFailure` already
 * produced. No new error taxonomy: `failedStage`, `errorKind` and `errorCode` are
 * read exactly as that module wrote them, and the error MESSAGE is never consulted
 * for storage nor stored.
 *
 * The rule, and why the absent-code branch is the interesting one:
 *
 *   - `db_timeout` (SQLSTATE 57014 / "canceling statement") => DB_UNAVAILABLE.
 *     The database was reached but would not complete the work.
 *   - a DB stage WITH a code => FAILED. PostgREST answered with a structured
 *     error, so the database was alive and rejected the statement on its merits.
 *   - a DB stage WITHOUT a code => DB_UNAVAILABLE. This is the 2026-09-15 18:44
 *     signature: postgrest-js parses a non-2xx body as JSON and, when that throws
 *     (Cloudflare 521/522 and gateway 504 return HTML), falls back to
 *     `error = { message: body }` with NO `code` field. `upsertHistoryChunked`
 *     destructures only `error`, so the HTTP status never reaches the throw site.
 *     Absence of a code inside a database stage is therefore the only surviving
 *     evidence that the transport, not the query, failed.
 *   - anything else => FAILED (provider timeouts, application and validation errors).
 *
 * KNOWN LIMIT: a genuine transport fault and a PostgREST error that happens to
 * carry no code are indistinguishable here. Narrowing that would mean capturing
 * the HTTP status at the Supabase call sites, which changes sync error
 * propagation and is out of scope for observability hardening.
 *
 * @param {{failedStage?:string|null, errorKind?:string|null, errorCode?:string|null}} [failure]
 * @returns {"FAILED"|"DB_UNAVAILABLE"}
 */
export function classifyTerminalStatus({ failedStage = null, errorKind = null, errorCode = null } = {}) {
  if (errorKind && DB_UNAVAILABLE_KINDS.has(String(errorKind))) return RUN_STATUS.DB_UNAVAILABLE;
  if (!DB_SYNC_STAGES.has(String(failedStage || ""))) return RUN_STATUS.FAILED;
  const code = errorCode === null || errorCode === undefined ? "" : String(errorCode).trim();
  return code ? RUN_STATUS.FAILED : RUN_STATUS.DB_UNAVAILABLE;
}

/**
 * How long a STARTED may sit without a terminal partner before a reader may call
 * it UNKNOWN. Observed settlement durations are 37-77 s, so 10 minutes is ~8x the
 * slowest real run — long enough that a slow run is never libelled as a crash.
 */
export const RUN_JOURNAL_UNKNOWN_AFTER_MS = 10 * 60 * 1000;

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

/** Terminal statuses, i.e. everything that closes a run. */
const TERMINAL_STATUSES = new Set([RUN_STATUS.COMPLETED, RUN_STATUS.FAILED, RUN_STATUS.DB_UNAVAILABLE]);

function msOf(iso) {
  const t = new Date(iso || 0).getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
}

/**
 * Pair the KV run journal against `history_sync_log` rows.
 *
 * PURE. Takes both sides as plain data so it can be exercised without KV or
 * Postgres — which is the point: the KV-only verdict has to be reachable when
 * Postgres is the thing that is down.
 *
 * A record with no `status` is a pre-journal entry (the single terminal write
 * this stream carried before STARTED/terminal events existed) and is treated as
 * a terminal event, so historical days reconcile rather than reading as noise.
 *
 * Verdicts:
 *   HEALTHY      terminal event + a Postgres row near it
 *   KV_ONLY      terminal event, no Postgres row      -> Postgres lost the run
 *   PG_ONLY      Postgres row, no terminal event      -> KV lost the run
 *   STARTED_ONLY STARTED, no terminal, past the bound -> the run disappeared
 *   RUNNING      STARTED, no terminal, inside bound   -> not yet classifiable
 *
 * @param {{runs?:object[], postgresRunsAt?:Array<string|number>, nowMs?:number,
 *          unknownAfterMs?:number, pairToleranceMs?:number}} [input]
 */
export function reconcileRunJournal({
  runs = [],
  postgresRunsAt = [],
  nowMs = Date.now(),
  unknownAfterMs = RUN_JOURNAL_UNKNOWN_AFTER_MS,
  pairToleranceMs = 5 * 60 * 1000
} = {}) {
  const pgRows = postgresRunsAt
    .map((value) => (typeof value === "number" ? value : msOf(value)))
    .filter((t) => t !== null)
    .map((at) => ({ at, taken: false }));

  // Group by runId; legacy entries get a key of their own so they never merge.
  const groups = new Map();
  (Array.isArray(runs) ? runs : []).forEach((run, index) => {
    if (!run || typeof run !== "object") return;
    const key = run.runId ? `id:${String(run.runId)}` : `legacy:${index}:${String(run.at || "")}`;
    if (!groups.has(key)) groups.set(key, { runId: run.runId || null, started: null, terminal: null });
    const group = groups.get(key);
    if (run.status === RUN_STATUS.STARTED) group.started = run;
    else if (!run.status || TERMINAL_STATUSES.has(String(run.status))) group.terminal = run;
  });

  const claimNearest = (targetMs) => {
    if (targetMs === null) return null;
    let best = null;
    for (const row of pgRows) {
      if (row.taken) continue;
      const delta = Math.abs(row.at - targetMs);
      if (delta > pairToleranceMs) continue;
      if (!best || delta < best.delta) best = { row, delta };
    }
    if (!best) return null;
    best.row.taken = true;
    return best.row.at;
  };

  const out = [];
  for (const group of groups.values()) {
    const terminal = group.terminal;
    const started = group.started;
    if (terminal) {
      const terminalMs = msOf(terminal.at);
      const postgresAt = claimNearest(terminalMs);
      out.push({
        runId: group.runId,
        status: terminal.status || null,
        startedAt: started?.startedAt || terminal.startedAt || null,
        terminalAt: terminal.at || null,
        postgresAt: postgresAt === null ? null : new Date(postgresAt).toISOString(),
        verdict: postgresAt === null ? "KV_ONLY" : "HEALTHY"
      });
      continue;
    }
    const startedMs = msOf(started?.startedAt) ?? msOf(started?.at);
    const overdue = startedMs !== null && nowMs - startedMs > unknownAfterMs;
    out.push({
      runId: group.runId,
      status: RUN_STATUS.STARTED,
      startedAt: started?.startedAt || started?.at || null,
      terminalAt: null,
      postgresAt: null,
      verdict: overdue ? "STARTED_ONLY" : "RUNNING"
    });
  }

  for (const row of pgRows) {
    if (row.taken) continue;
    out.push({
      runId: null,
      status: null,
      startedAt: null,
      terminalAt: null,
      postgresAt: new Date(row.at).toISOString(),
      verdict: "PG_ONLY"
    });
  }

  return out.sort((a, b) =>
    String(b.terminalAt || b.startedAt || b.postgresAt || "").localeCompare(
      String(a.terminalAt || a.startedAt || a.postgresAt || "")
    )
  );
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
  RUN_STATUS,
  RUN_JOURNAL_UNKNOWN_AFTER_MS,
  recordSyncRun,
  readSyncRuns,
  classifyTerminalStatus,
  reconcileRunJournal,
  getSettlementHealth,
  getBenchmarkHealth
};
