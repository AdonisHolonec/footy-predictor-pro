import { SLOW_REQUEST_MS } from "./requestMonitor.js";
import { logWarn } from "./logger.js";
import { summarizeTransport } from "./transportTiming.js";

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
/*
  SYNC STAGES. `mode=sync` had no stage of its own, so every millisecond it spent
  landed in `unattributedMs` — a production sync reported durationMs 100,014 and
  unattributedMs 100,011, which reads like a mystery and is actually just the
  absence of instrumentation. These name the phases handleHistorySync already
  runs, in the order it runs them, so the gap becomes an attribution.

  They are TOP-LEVEL and disjoint: the three scans, the provider fan-out, the CPU
  between them, the three upserts and the two tail steps never overlap, because
  the handler awaits each in turn.
*/
const SYNC_STAGES = [
  "scan1Ms",
  "providerFixtureMs",
  "cpuPrepareMs",
  "upsert1Ms",
  "scan2Ms",
  "resettleCpuMs",
  "upsert2Ms",
  "scan3Ms",
  "statsMs",
  "upsert3Ms",
  "closingOddsMs",
  "globalSettlementMs",
  "syncStatusPersistMs"
];

const STAGES = [
  "authMs",
  "rateLimitMs",
  "dbReadMs",
  "supabaseClientMs",
  "supabaseRequestMs",
  "aggregateMs",
  "mappingMs",
  "responseMs",
  ...SYNC_STAGES
];
const STAGE_SET = new Set(STAGES);

/**
 * Counters a sync may report. A strict whitelist of NUMBERS: this accumulator's
 * safety property is that only primitives reach a log line, and a sync handles
 * fixture ids and raw payloads that must never travel with its telemetry.
 */
const SYNC_COUNTERS = new Set([
  "scanned",
  "updated",
  "resettled",
  "cardResettled",
  "finishedScanned",
  "statsFetchCalls",
  "statsSkippedBudget",
  "recommendedStatsCalls",
  "providerFixtureCalls",
  "upsertBatches"
]);

/**
 * Elapsed time must not be measured with a wall clock: these stages run for
 * seconds to minutes, and `Date.now()` can step backwards under NTP correction,
 * producing a negative or wildly wrong duration for exactly the slow sync this
 * instrumentation exists to explain. `performance.now()` is monotonic;
 * transportTiming.js already uses it for the same reason.
 */
function elapsedNow() {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

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
    // D4: the transport collector for this invocation, attached by the route so
    // the phase split travels with the timing it explains.
    transport: null,
    rows: null,
    finalBytes: null,
    errorKind: null,
    // Sync-only. Absent for every other mode, so no read event grows a field.
    counters: null,
    failedStage: null,
    failedOperation: null,
    errorCode: null
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
  const startedAt = elapsedNow();
  try {
    return await fn();
  } finally {
    markStage(timing, stage, elapsedNow() - startedAt);
  }
}

/**
 * Record sync counters. Merged, not replaced, so a phase can report what it
 * finished before a later phase throws — the whole point is that a FAILED sync
 * still says how much work it had done.
 *
 * Unknown keys and non-numbers are dropped rather than logged.
 */
export function recordSyncCounters(timing, counters) {
  if (!usable(timing) || !counters || typeof counters !== "object") return;
  for (const [key, value] of Object.entries(counters)) {
    if (!SYNC_COUNTERS.has(key)) continue;
    const n = safeInt(value);
    if (n === null || n < 0) continue;
    if (!timing.counters) timing.counters = Object.create(null);
    timing.counters[key] = n;
  }
}

/**
 * Time one sync phase and, if it throws, record WHICH phase and WHICH operation
 * before rethrowing the original error untouched.
 *
 * This lives here rather than in the route so there is one implementation of the
 * "measure, attribute, rethrow" contract, and so that contract is testable
 * without standing up a Supabase double.
 *
 * The error is rethrown, never wrapped: the caller's catch must see exactly what
 * it saw before this instrumentation existed.
 */
export async function timeSyncPhase(timing, stage, operation, fn) {
  try {
    return await timeStage(timing, stage, fn);
  } catch (error) {
    recordFailure(timing, { stage, operation, error });
    throw error;
  }
}

/**
 * Which phase failed, and on what.
 *
 * `operation` is a fixed label chosen at the call site (e.g. "scan_finished"),
 * never anything derived from data. The error MESSAGE is deliberately not
 * recorded: this module's stated safety property is that a connection string,
 * a row or an identifier cannot reach a log line, and Postgres/PostgREST
 * messages routinely carry all three. `errorKind` and `errorCode` carry the
 * diagnosis instead — a code like "57014" says statement timeout precisely,
 * without quoting the statement.
 */
export function recordFailure(timing, { stage = null, operation = null, error = null } = {}) {
  if (!usable(timing)) return;
  if (timing.failedStage) return; // first failure wins; it is the cause
  if (stage && STAGE_SET.has(stage)) timing.failedStage = stage;
  if (operation) timing.failedOperation = String(operation).slice(0, 64);
  const code = error?.code;
  if (code !== undefined && code !== null && String(code).length <= 16) timing.errorCode = String(code);
  timing.errorKind = classifyHistoryError(error, stage);
}

/** Attach the invocation's transport collector. Absent is fine — see D4. */
export function attachTransport(timing, collector) {
  if (!usable(timing)) return;
  timing.transport = collector || null;
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
  // D4: the phases INSIDE supabaseRequestMs. Nested, so they are reported
  // alongside the stages rather than folded into the unattributed arithmetic
  // below — counting them as top-level would subtract the same milliseconds
  // twice and invent time that was never lost.
  const transport = summarizeTransport(timing.transport);
  if (transport) Object.assign(out, transport);
  if (timing.rows !== null) out.rows = timing.rows;
  if (timing.finalBytes !== null) out.finalBytes = timing.finalBytes;
  if (timing.errorKind) out.errorKind = timing.errorKind;
  /*
    Counters survive failure by design. `rows` comes from the response body, so
    a sync that threw reports rows=0 and says nothing about the work it had
    already done — which is exactly what made the 15:19Z 500 unreadable.
  */
  if (timing.counters) out.sync = { ...timing.counters };
  if (timing.failedStage) out.failedStage = timing.failedStage;
  if (timing.failedOperation) out.failedOperation = timing.failedOperation;
  if (timing.errorCode) out.errorCode = timing.errorCode;

  // What the measured stages did not explain — work happening between them
  // rather than inside one. If this dominates, the split is in the wrong place.
  /*
    Only the top-level spans. supabaseClientMs and supabaseRequestMs are nested
    INSIDE dbReadMs, so counting them here would subtract the same milliseconds
    twice and report a false negative gap.
  */
  const TOP_LEVEL = [
    "authMs",
    "rateLimitMs",
    "dbReadMs",
    "aggregateMs",
    "mappingMs",
    "responseMs",
    // Disjoint and sequential, so they subtract exactly once. Before these were
    // listed, a sync's unattributedMs was its whole duration by construction.
    ...SYNC_STAGES
  ];
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
  timeSyncPhase,
  recordRows,
  recordFinalBytes,
  recordSyncCounters,
  recordFailure,
  classifyHistoryError,
  recordError,
  summarizeHistoryTiming,
  emitHistoryTiming
};
