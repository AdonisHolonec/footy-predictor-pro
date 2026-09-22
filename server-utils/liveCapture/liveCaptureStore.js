/**
 * Live Predictor Lab — Phase 1: the KV writer behind the existing live poll.
 *
 * DOWNSTREAM ONLY. This module never calls the provider and never calls
 * getWithCache: it receives what handleLive already fetched. It therefore cannot
 * spend provider budget, and it has nothing to retry when the budget circuit denies
 * a poll — that poll simply produces no observation.
 *
 * DARK BY DEFAULT. Nothing is written unless LIVE_CAPTURE_ENABLED=1 (the
 * PREDICTION_BENCHMARK_ENABLED precedent). With the flag unset this module issues
 * zero KV commands, and a test holds it to that.
 *
 * THE SCARCE RESOURCE IS KV COMMANDS, not provider calls. The production Upstash
 * store has already exhausted its monthly command cap once (2026-08-18, 500,000 /
 * 500,000) and the live poll is the highest-frequency path in the app. So:
 *
 *   · one pipelined request per poll, however many fixtures it carries
 *   · no read before a write — a snapshot's FIELD NAME decides whether it is new
 *     (liveCaptureSnapshot.resolveSnapshotSlots) and HSETNX does the rest
 *   · an in-process memo skips fields this instance already wrote, so a duplicate
 *     normally costs zero commands
 *   · counters accumulate in process and ride on a pipeline that was going out
 *     anyway, at most once per COUNTER_FLUSH_INTERVAL_MS
 *
 * Counters deliberately do NOT use metricsStore.bumpCounter: readDay() there does
 * not restore `counters` from the stored row, so every later flush silently drops
 * them.
 *
 * A DAILY COMMAND SELF-CAP, PER INSTANCE. LIVE_CAPTURE_DAILY_COMMAND_CAP bounds how
 * many KV commands THIS PROCESS may issue for capture in one UTC day. Every command
 * the store puts on a pipeline is counted — snapshot HSETNXs, EXPIREs, day-index
 * SADDs and counter HINCRBYs alike — and counted when it is SENT, before KV has
 * answered, so a timed-out pipeline still spends its budget. A poll that would push
 * the day past the cap is not sent, not partially, not later: capture goes dark on
 * this instance until the next UTC day and says so once in the log. The count lives
 * in process memory only; no KV command is spent to keep it.
 *
 *   THIS IS NOT A GUARD ON THE UPSTASH MONTHLY QUOTA. Serverless means several
 *   instances can be warm at once, each with its own count, and a cold start begins
 *   at zero. The cap bounds one instance; the platform ceiling is
 *     cap × (max concurrent instances) × (days in month)
 *   and choosing the cap for production is a separate decision that must start from
 *   the instance count actually expected. With the flag on and no valid cap the
 *   store fails CLOSED and captures nothing.
 *
 * NEVER THROWS. A capture failure must not change what the live poll returns — a
 * bare KV call inside a product path has already turned delivered provider
 * responses into failures here once (tests/fetcherUsageTelemetry.test.js).
 *
 * STORAGE — all under one prefix, nothing shared with prediction keys:
 *   footy_live_capture:v1:fx:<fixtureId>        hash, one field per slot / events
 *                                               state, ≤ maxFieldsPerFixture() fields
 *   footy_live_capture:v1:day:<YYYY-MM-DD>      set of fixtures observed live that UTC day
 *   footy_live_capture:v1:counters:<YYYY-MM-DD> hash of telemetry counters
 * Every key carries a TTL. Nothing here touches predictions_history,
 * prediction_snapshots or any other Postgres table.
 */
import { logWarn } from "../observability/logger.js";
import {
  FINAL_STATUSES,
  buildLiveCaptureSnapshot,
  clampMinuteStep,
  coverageWindowForMinute,
  resolveSnapshotSlots
} from "./liveCaptureSnapshot.js";

export const LIVE_CAPTURE_KEY_PREFIX = "footy_live_capture:v1";

const DAY_SECONDS = 24 * 60 * 60;
/** The sync run journal's horizon (syncTelemetry TTL_SECONDS). The data must be exported before it lapses. */
export const DEFAULT_TTL_DAYS = 30;
export const MIN_TTL_DAYS = 7;
export const MAX_TTL_DAYS = 90;
/** The live poll answers a user every 75 s — a slow KV must not be allowed to stall it. */
export const WRITE_TIMEOUT_MS = 1500;
/** Telemetry is sampled, not streamed: a handful of HINCRBYs per instance per ten minutes. */
export const COUNTER_FLUSH_INTERVAL_MS = 10 * 60 * 1000;
/** Fixtures remembered per warm instance. Far above a matchday; it bounds the memo, not the data. */
const MEMO_MAX_FIXTURES = 500;

export const LIVE_CAPTURE_COUNTERS = Object.freeze([
  "attempted",
  "stored",
  "deduplicated",
  "skipped",
  "budget_denied",
  "poll_failed",
  "malformed",
  "storage_failed",
  "milestone",
  /*
    Polls this instance refused because its daily command cap was reached. It can only
    reach KV on the first pipeline after the cap resets, i.e. it lands on the NEXT UTC
    day's counters — the log line (once per instance per day) is the timely signal.
  */
  "command_capped"
]);

const FINAL = new Set(FINAL_STATUSES);

export function liveCaptureFixtureKey(fixtureId) {
  return `${LIVE_CAPTURE_KEY_PREFIX}:fx:${fixtureId}`;
}

export function liveCaptureDayKey(dateISO) {
  return `${LIVE_CAPTURE_KEY_PREFIX}:day:${dateISO}`;
}

export function liveCaptureCountersKey(dateISO) {
  return `${LIVE_CAPTURE_KEY_PREFIX}:counters:${dateISO}`;
}

/**
 * LIVE_CAPTURE_DAILY_COMMAND_CAP as a positive integer, or null when it is missing or
 * not one. There is no default on purpose: the value must be chosen for the instance
 * count expected in production, and an unset or mistyped value must not silently
 * become "unbounded".
 */
export function parseDailyCommandCap(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function readLiveCaptureConfig(env = process.env) {
  const rawDays = Math.round(Number(env?.LIVE_CAPTURE_TTL_DAYS));
  const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : DEFAULT_TTL_DAYS;
  const flagOn = String(env?.LIVE_CAPTURE_ENABLED || "0") === "1";
  const dailyCommandCap = parseDailyCommandCap(env?.LIVE_CAPTURE_DAILY_COMMAND_CAP);
  return {
    // Fail closed: the flag alone is not enough — a valid per-instance cap is required.
    enabled: flagOn && dailyCommandCap !== null,
    disabledReason: !flagOn ? "flag_off" : dailyCommandCap === null ? "invalid_command_cap" : null,
    dailyCommandCap,
    minuteStep: clampMinuteStep(env?.LIVE_CAPTURE_MINUTE_STEP),
    ttlSeconds: Math.max(MIN_TTL_DAYS, Math.min(days, MAX_TTL_DAYS)) * DAY_SECONDS,
    writeTimeoutMs: WRITE_TIMEOUT_MS,
    counterFlushIntervalMs: COUNTER_FLUSH_INTERVAL_MS
  };
}

/**
 * What one warm instance remembers between polls. It is an optimisation only: a cold
 * start costs a few no-op writes, never a wrong or duplicated snapshot.
 */
export function createLiveCaptureState() {
  return {
    memo: new Map(),
    pending: {},
    lastCounterFlushMs: 0,
    countersExpiryDay: null,
    // The per-instance daily command ledger (see the header). All three roll over
    // together on the first poll of a new UTC day.
    commandDay: null,
    commandsIssued: 0,
    capExhausted: false
  };
}

/**
 * Roll the command ledger FORWARD to `dayISO` when the UTC day has changed, and return
 * the day the ledger is on. In-process only. It never rolls backwards: a poll stamped
 * just before midnight but handled just after one stamped just past it is charged to
 * the day the ledger already reached, and obeys that day's exhaustion — otherwise the
 * late poll would zero the new day's count and clear a reached cap.
 */
function rollCommandDay(state, dayISO) {
  if (state.commandDay === dayISO) return dayISO;
  if (state.commandDay !== null && dayISO < state.commandDay) return state.commandDay;
  state.commandDay = dayISO;
  state.commandsIssued = 0;
  state.capExhausted = false;
  return dayISO;
}

const sharedState = createLiveCaptureState();

function memoEntry(memo, fixtureId) {
  const existing = memo.get(fixtureId);
  if (existing) return existing;
  if (memo.size >= MEMO_MAX_FIXTURES) memo.delete(memo.keys().next().value);
  const created = { fields: new Set(), indexedDays: new Set(), expirySet: false };
  memo.set(fixtureId, created);
  return created;
}

function addPending(state, name, by) {
  if (by > 0) state.pending[name] = (state.pending[name] || 0) + by;
}

async function resolveKv(deps) {
  if (deps.kv) return deps.kv;
  const { kv } = await import("../fetcher.js");
  return kv;
}

function withTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`live capture write exceeded ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function emptySummary(extra = {}) {
  return {
    ok: true,
    enabled: true,
    attempted: 0,
    stored: 0,
    deduplicated: 0,
    skipped: 0,
    malformed: 0,
    storageFailed: 0,
    milestones: 0,
    commands: 0,
    /** True when this poll was refused by the per-instance daily command cap. */
    capped: false,
    skipReasons: {},
    ...extra
  };
}

function countReason(summary, reason) {
  summary.skipReasons[reason] = (summary.skipReasons[reason] || 0) + 1;
}

/** Plan the fields one fixture wants to write. It reads the memo and nothing else. */
function planRow(row, { scoresFromCache, nowMs, minuteStep, memo, summary }) {
  summary.attempted += 1;
  const built = buildLiveCaptureSnapshot({ ...row, scoreSource: scoresFromCache ? "cache" : "fresh" }, nowMs);
  if (!built.ok) {
    summary.malformed += 1;
    countReason(summary, built.reason);
    return null;
  }
  const { snapshot, events } = built;
  const slotting = resolveSnapshotSlots(snapshot, minuteStep);
  if (!slotting.ok) {
    summary.skipped += 1;
    countReason(summary, slotting.reason);
    return null;
  }

  const entry = memoEntry(memo, snapshot.fixtureId);
  const plan = { snapshot, entry, slotting, writes: [] };

  /*
    An in-play observation must rest on a FRESH score read. A cache hit replays a
    payload whose age nobody recorded — up to the TTL of whichever writer filled the
    key — and stamping it with "now" would put a false time on the match clock. The
    fixture is still marked as observed, so the ledger can tell "seen but not
    captured" from "never seen". A terminal state is a settled fact, so its marker may
    come from cache; scoreSource says so.
  */
  if (slotting.kind !== "terminal" && scoresFromCache) {
    summary.skipped += 1;
    countReason(summary, "stale_scores");
    return plan;
  }

  for (const slot of slotting.slots) {
    if (entry.fields.has(slot)) {
      summary.deduplicated += 1;
      continue;
    }
    plan.writes.push({ field: slot, value: { ...snapshot, slot }, kind: slotting.kind });
  }
  if (snapshot.eventsRef && !entry.fields.has(snapshot.eventsRef)) {
    plan.writes.push({
      field: snapshot.eventsRef,
      value: {
        v: snapshot.v,
        fixtureId: snapshot.fixtureId,
        capturedAt: snapshot.capturedAt,
        capturedAtMs: snapshot.capturedAtMs,
        source: snapshot.eventsSource,
        events
      },
      kind: "events"
    });
  }
  return plan;
}

/**
 * A stored snapshot that lands on a research window (or is the FT observation). The
 * window test uses the provider minute alone, exactly as the ledger does — stoppage
 * time in the first half must never count towards the 60 minute window.
 */
function isMilestone(write) {
  if (write.kind === "terminal") return FINAL.has(write.value.status);
  if (write.kind !== "time" || !write.field.startsWith("M:")) return false;
  return coverageWindowForMinute(write.value.elapsedMinute) !== null;
}

/**
 * Record what one live poll observed. Called by handleLive AFTER the provider
 * results are in hand, with those results — it fetches nothing.
 *
 * @param {{ rows: object[], scoresFromCache: boolean, nowMs?: number }} poll
 * @param {{ kv?: object, config?: object, state?: object, logWarn?: Function, now?: () => number }} [deps]
 */
export async function captureLivePoll(poll, deps = {}) {
  const summary = emptySummary();
  try {
    const config = deps.config || readLiveCaptureConfig();
    if (!config.enabled) return emptySummary({ enabled: false, disabledReason: config.disabledReason || "flag_off" });
    // Belt and braces for a hand-built config: no valid cap, no capture.
    const dailyCommandCap = parseDailyCommandCap(config.dailyCommandCap);
    if (dailyCommandCap === null) return emptySummary({ enabled: false, disabledReason: "invalid_command_cap" });

    const rows = Array.isArray(poll?.rows) ? poll.rows : [];
    if (!rows.length) return summary;

    const state = deps.state || sharedState;
    const nowMs = Number.isFinite(Number(poll?.nowMs)) ? Number(poll.nowMs) : (deps.now || Date.now)();
    const dayISO = new Date(nowMs).toISOString().slice(0, 10);

    // Dark for the rest of this UTC day on this instance: nothing is planned, nothing
    // is sent, nothing is retried. The poll itself is unaffected.
    const ledgerDay = rollCommandDay(state, dayISO);
    if (state.capExhausted) {
      addPending(state, "command_capped", 1);
      return { ...summary, capped: true, skipReasons: { command_cap: rows.length } };
    }

    const plans = rows
      .map((row) =>
        planRow(row, {
          scoresFromCache: poll?.scoresFromCache === true,
          nowMs,
          minuteStep: config.minuteStep,
          memo: state.memo,
          summary
        })
      )
      .filter(Boolean);

    // The single pipeline. `steps` mirrors the command order so each result can be
    // attributed after exec().
    const steps = [];
    for (const plan of plans) {
      const { snapshot, entry } = plan;
      const key = liveCaptureFixtureKey(snapshot.fixtureId);
      for (const write of plan.writes) steps.push({ op: "hsetnx", key, plan, write });
      if (plan.writes.length && !entry.expirySet) steps.push({ op: "expire", key, plan, fixtureExpiry: true });
      if (!entry.indexedDays.has(dayISO)) {
        steps.push({ op: "sadd", key: liveCaptureDayKey(dayISO), member: snapshot.fixtureId, plan });
        steps.push({ op: "expire", key: liveCaptureDayKey(dayISO) });
      }
    }

    // What this poll did NOT need KV for is already known; what it stored is only
    // known after exec() and joins the next flush.
    addPending(state, "attempted", summary.attempted);
    addPending(state, "skipped", summary.skipped);
    addPending(state, "malformed", summary.malformed);
    addPending(state, "deduplicated", summary.deduplicated);

    if (!steps.length) return summary;

    const flushedCounters = {};
    if (nowMs - state.lastCounterFlushMs >= config.counterFlushIntervalMs) {
      const countersKey = liveCaptureCountersKey(dayISO);
      for (const name of LIVE_CAPTURE_COUNTERS) {
        const by = state.pending[name] || 0;
        if (by <= 0) continue;
        flushedCounters[name] = by;
        steps.push({ op: "hincrby", key: countersKey, field: name, by });
      }
      if (Object.keys(flushedCounters).length && state.countersExpiryDay !== dayISO) {
        steps.push({ op: "expire", key: countersKey, countersExpiry: true });
      }
    }

    /*
      The per-instance cap. `steps` is the exact command list about to go on the
      pipeline — snapshots, expirations, day index and the counters just appended — so
      its length is the exact number of KV commands this poll would spend. A poll that
      does not fit is refused whole; nothing is retried, and `capExhausted` keeps every
      later poll of this UTC day dark before it plans anything.
    */
    if (state.commandsIssued + steps.length > dailyCommandCap) {
      state.capExhausted = true;
      summary.capped = true;
      addPending(state, "command_capped", 1);
      // Bounded by construction — once per instance per UTC day: from now until the
      // day rolls, `capExhausted` returns every poll above, before it can get here.
      (deps.logWarn || logWarn)("live_capture.command_cap_reached", {
        day: ledgerDay,
        dailyCommandCap,
        commandsIssued: state.commandsIssued,
        refusedCommands: steps.length,
        scope: "per_instance"
      });
      return summary;
    }
    // Counted when SENT: a timed-out or failed exec has still spent the budget.
    state.commandsIssued += steps.length;

    const kv = await resolveKv(deps);
    const pipeline = kv.pipeline();
    for (const step of steps) {
      if (step.op === "hsetnx") pipeline.hsetnx(step.key, step.write.field, step.write.value);
      else if (step.op === "sadd") pipeline.sadd(step.key, step.member);
      else if (step.op === "hincrby") pipeline.hincrby(step.key, step.field, step.by);
      else pipeline.expire(step.key, config.ttlSeconds);
    }
    summary.commands = steps.length;

    let results;
    try {
      results = await withTimeout(pipeline.exec(), config.writeTimeoutMs);
    } catch (error) {
      summary.ok = false;
      summary.storageFailed = steps.filter((step) => step.op === "hsetnx").length;
      addPending(state, "storage_failed", summary.storageFailed);
      (deps.logWarn || logWarn)("live_capture.store_failed", {
        error: error?.message || "kv_write",
        commands: steps.length
      });
      return summary;
    }

    // The memo is only updated once KV has answered: a failed write must be retried
    // by the next poll, not remembered as done.
    let deduplicatedInKv = 0;
    steps.forEach((step, index) => {
      if (step.op === "hsetnx") {
        const created = Number(Array.isArray(results) ? results[index] : 0) === 1;
        step.plan.entry.fields.add(step.write.field);
        if (created) {
          summary.stored += 1;
          if (isMilestone(step.write)) summary.milestones += 1;
        } else {
          deduplicatedInKv += 1;
        }
      } else if (step.op === "sadd") {
        step.plan.entry.indexedDays.add(dayISO);
      } else if (step.fixtureExpiry) {
        step.plan.entry.expirySet = true;
      } else if (step.countersExpiry) {
        state.countersExpiryDay = dayISO;
      }
    });
    summary.deduplicated += deduplicatedInKv;

    if (Object.keys(flushedCounters).length) {
      for (const [name, by] of Object.entries(flushedCounters)) {
        state.pending[name] = Math.max(0, (state.pending[name] || 0) - by);
      }
      state.lastCounterFlushMs = nowMs;
    }
    addPending(state, "stored", summary.stored);
    addPending(state, "milestone", summary.milestones);
    addPending(state, "deduplicated", deduplicatedInKv);

    return summary;
  } catch (error) {
    // Belt and braces: nothing above should throw, and nothing here may escape.
    try {
      (deps.logWarn || logWarn)("live_capture.unexpected_error", { error: error?.message || "unknown" });
    } catch {
      /* logging must not throw either */
    }
    return { ...summary, ok: false };
  }
}

/**
 * The live poll itself was refused or failed upstream, so there is nothing to
 * capture — and capture does NOT go and fetch it. This only remembers the miss (no
 * KV command of its own), so the ledger can later say why a window is empty.
 */
export function noteLivePollDenied(reason, deps = {}) {
  try {
    const config = deps.config || readLiveCaptureConfig();
    if (!config.enabled) return;
    const budget = reason === "api_budget_hard_stop" || reason === "api_local_rate_limit";
    addPending(deps.state || sharedState, budget ? "budget_denied" : "poll_failed", 1);
  } catch {
    /* remembering a miss must never fail the poll */
  }
}
