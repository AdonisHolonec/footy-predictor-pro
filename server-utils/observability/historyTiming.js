import { SLOW_REQUEST_MS } from "./requestMonitor.js";
import { logWarn } from "./logger.js";

/**
 * Per-request timing attribution for /api/history.
 *
 * A production prediction-list hydration took 23,176 ms against a ~2,200 ms
 * norm, and nothing could say where it went: `requestMonitor` instruments only
 * `predict` and `fixtures`, so this route — which reads the largest documents in
 * the system — had no server-side timing at all. The audit could bound the total
 * from the browser and no further.
 *
 * The shape of the read is what makes the split worth having: `view=list`
 * projects at PostgREST, while `mine=1` and `view=prediction-list` pull FULL
 * rows (raw_payload included) into the function and project in Node. So "the
 * response was small" says nothing about what the database and the wire between
 * them actually did, and only `dbReadMs` vs `responseMs` can separate them.
 *
 * MEASUREMENT ONLY. No query, projection, auth or response semantics change
 * here, and nothing is emitted unless a request is already slow or already
 * failed.
 *
 * SAFE BY CONSTRUCTION. The accumulator holds primitives — counts, durations
 * and query facets — so a prediction row, a raw_payload or an Authorization
 * header cannot reach a log line even by accident.
 */

export const HISTORY_TIMING_EVENT = "history.timing";
export const HISTORY_ROUTE = "/api/history";

/** Stage names this module will accept. Anything else is ignored. */
/*
  `rateLimitMs` exists because production showed every /api/history 500 and the
  slow anonymous 200 landing on the anonymous branch with 100% of the time
  unattributed — and that branch's first await is a rate-limit check against
  Redis, not the database. Without its own stage a stalled limiter is
  indistinguishable from a stalled query.
*/
/*
  `supabaseClientMs` and `supabaseRequestMs` split what `dbReadMs` already
  measures. D2b removed raw_payload from the anonymous aggregate and production
  dbReadMs did NOT move (8,963-39,368ms), while the identical query run directly
  against PostgREST answered in 0.33-0.63s at the same moment. So the cost is not
  the query. These two spans say whether it is the client acquisition or the HTTP
  request - and they are strictly nested inside dbReadMs, never added to it.

  Named `supabaseClientMs`, not `connectionMs`: getSupabaseAdmin() constructs a
  cached client object and opens no socket, so this measures construction, not
  connection establishment.
*/
const STAGES = [
  "authMs",
  "rateLimitMs",
  "dbReadMs",
  "supabaseClientMs",
  "supabaseRequestMs",
  "aggregateMs",
  "mappingMs",
  "responseMs"
];
const STAGE_SET = new Set(STAGES);

function flagOf(query, name) {
  const raw = String(query?.[name] ?? "").toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Which branch of the handler served the request.
 *
 * Resolution order mirrors handlerImpl exactly — special-bets, then sync, then
 * closing, then performance, then detail, then the read views — because a label
 * that disagreed with the branch that actually ran would be worse than no label.
 */
export function classifyHistoryMode(query = {}) {
  if (String(query?.view || "") === "special-bets") return "special-bets";
  if (flagOf(query, "sync")) return "sync";
  if (flagOf(query, "closing")) return "closing";
  if (flagOf(query, "performance")) return "performance";
  const fixtureId = query?.fixtureId;
  if (fixtureId !== undefined && fixtureId !== null && String(fixtureId).trim() !== "") return "detail";
  const view = String(query?.view || "");
  if (view === "prediction-list") return "prediction-list";
  if (view === "list") return "list";
  return flagOf(query, "mine") ? "mine" : "anonymous";
}

function safeInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * @returns {object} A fresh accumulator. One per invocation.
 */
export function createHistoryTiming(query = {}, method = "GET") {
  return {
    mode: classifyHistoryMode(query),
    method: String(method || "GET"),
    // Query FACETS only — never the raw query object, which could carry
    // anything a caller appended to the URL.
    mine: flagOf(query, "mine"),
    view: String(query?.view || "") || null,
    days: safeInt(query?.days),
    limit: safeInt(query?.limit),
    hasFixtureId: Boolean(query?.fixtureId !== undefined && String(query?.fixtureId ?? "").trim() !== ""),
    stages: Object.create(null),
    rows: null,
    finalBytes: null,
    errorKind: null
  };
}

function usable(timing) {
  return Boolean(timing && typeof timing === "object" && !Array.isArray(timing) && timing.stages);
}

/**
 * Record one stage duration. Absent is not zero: a missing measurement must not
 * be reported as an instantaneous stage.
 */
export function markStage(timing, stage, ms) {
  if (!usable(timing) || !STAGE_SET.has(stage)) return;
  if (ms === null || ms === undefined || ms === "") return;
  const duration = Number(ms);
  if (!Number.isFinite(duration) || duration < 0) return;
  timing.stages[stage] = (timing.stages[stage] || 0) + duration;
}

/** Times `fn`, attributes it to `stage`, and returns whatever `fn` returned. */
export async function timeStage(timing, stage, fn) {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    markStage(timing, stage, Date.now() - startedAt);
  }
}

export function recordRows(timing, rows) {
  if (!usable(timing)) return;
  const n = safeInt(rows);
  if (n === null || n < 0) return;
  timing.rows = n;
}

export function recordFinalBytes(timing, bytes) {
  if (!usable(timing)) return;
  const n = safeInt(bytes);
  if (n === null || n < 0) return;
  timing.finalBytes = n;
}

/**
 * A safe, coarse label for what went wrong — never the message, which can carry
 * connection strings, row content or identifiers.
 */
export function classifyHistoryError(error, stage = null) {
  if (!error) return null;
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  // Postgres 57014 = query_canceled, which is what a statement timeout raises.
  if (code === "57014" || message.includes("statement timeout") || message.includes("canceling statement")) {
    return "db_timeout";
  }
  if (message.includes("neautorizat") || message.includes("unauthorized") || message.includes("jwt")) {
    return "auth_error";
  }
  if (stage === "authMs") return "auth_error";
  if (stage === "dbReadMs") return "rpc_error";
  if (stage === "responseMs") return "response_error";
  if (stage === "mappingMs") return "mapping_error";
  return "unknown_error";
}

export function recordError(timing, error, stage = null) {
  if (!usable(timing)) return;
  timing.errorKind = classifyHistoryError(error, stage);
}

/**
 * The structured object a slow request logs. Only measured fields appear — an
 * absent stage is omitted rather than reported as zero.
 */
export function summarizeHistoryTiming(timing, { status, durationMs } = {}) {
  const base = {
    route: HISTORY_ROUTE,
    durationMs: safeInt(durationMs) ?? 0,
    status: safeInt(status) ?? 0
  };
  if (!usable(timing)) return base;

  const out = {
    ...base,
    mode: timing.mode,
    method: timing.method,
    mine: timing.mine,
    view: timing.view,
    days: timing.days,
    limit: timing.limit,
    hasFixtureId: timing.hasFixtureId
  };
  for (const stage of STAGES) {
    if (timing.stages[stage] !== undefined) out[stage] = timing.stages[stage];
  }
  if (timing.rows !== null) out.rows = timing.rows;
  if (timing.finalBytes !== null) out.finalBytes = timing.finalBytes;
  if (timing.errorKind) out.errorKind = timing.errorKind;

  // What the measured stages did not explain — work happening between them
  // rather than inside one. If this dominates, the split is in the wrong place.
  /*
    Only the top-level spans. supabaseClientMs and supabaseRequestMs are nested
    INSIDE dbReadMs, so counting them here would subtract the same milliseconds
    twice and report a false negative gap.
  */
  const TOP_LEVEL = ["authMs", "rateLimitMs", "dbReadMs", "aggregateMs", "mappingMs", "responseMs"];
  const staged = TOP_LEVEL.reduce((sum, s) => sum + (timing.stages[s] || 0), 0);
  out.unattributedMs = Math.max(0, out.durationMs - staged);
  return out;
}

/**
 * Emit once, and only for a request that is already slow or already failed.
 * The threshold is the one requestMonitor uses, so the two always agree about
 * which requests are interesting.
 *
 * @returns {object|null} the emitted summary, or null when nothing was emitted.
 */
export function emitHistoryTiming(timing, { status, durationMs } = {}) {
  const total = Number(durationMs);
  const code = Number(status);
  const slow = Number.isFinite(total) && total >= SLOW_REQUEST_MS;
  const failed = Number.isFinite(code) && code >= 500;
  if (!slow && !failed) return null;
  const summary = summarizeHistoryTiming(timing, { status, durationMs });
  logWarn(HISTORY_TIMING_EVENT, summary);
  return summary;
}

export default {
  HISTORY_TIMING_EVENT,
  HISTORY_ROUTE,
  classifyHistoryMode,
  createHistoryTiming,
  markStage,
  timeStage,
  recordRows,
  recordFinalBytes,
  classifyHistoryError,
  recordError,
  summarizeHistoryTiming,
  emitHistoryTiming
};
