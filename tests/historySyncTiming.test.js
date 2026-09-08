import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HISTORY_TIMING_EVENT,
  createHistoryTiming,
  emitHistoryTiming,
  markStage,
  recordFailure,
  recordSyncCounters,
  summarizeHistoryTiming,
  timeSyncPhase
} from "../server-utils/observability/historyTiming.js";
import { createTransportCollector, summarizeTransport } from "../server-utils/observability/transportTiming.js";

/**
 * Sync observability for /api/history.
 *
 * A production sync reported durationMs 100,014 with unattributedMs 100,011 and
 * rows 0, and none of it was a mystery: `mode=sync` had no stage of its own, so
 * the arithmetic put its whole duration in the gap, and `rows` is read from a
 * response body that a thrown sync never produces. These tests pin the two
 * fixes — stages that attribute, and counters that survive a failure — plus the
 * transport aggregate, because `fetchTotalMs` is the SLOWEST request and was
 * being read as the sum.
 *
 * NO DURATION IS FABRICATED HERE. Where a magnitude matters the test drives it
 * through `markStage`, the same entry point the production clock feeds; where
 * elapsed time matters the test asserts an invariant (non-negative, bounded)
 * rather than an invented millisecond count.
 */

const syncQuery = { sync: "1", days: "45" };
const newTiming = () => createHistoryTiming(syncQuery, "GET");

/** Every stage the sync path can report, in handler order. */
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

// ── the schema ─────────────────────────────────────────────────────────────

test("[H1] a successful sync can record every stage, and all of them survive", () => {
  const timing = newTiming();
  for (const [i, stage] of SYNC_STAGES.entries()) markStage(timing, stage, (i + 1) * 10);
  const out = summarizeHistoryTiming(timing, { status: 200, durationMs: 100000 });
  for (const [i, stage] of SYNC_STAGES.entries()) {
    assert.equal(out[stage], (i + 1) * 10, `${stage} must be reported`);
  }
  assert.equal(out.mode, "sync");
  assert.equal(out.days, 45);
  assert.equal(out.status, 200);
});

test("[H2] sync stages subtract from unattributedMs instead of inflating it", () => {
  /*
    THE REGRESSION. Before the sync stages were listed as top-level spans, every
    millisecond a sync spent was unattributed by construction — production
    reported 100,011 of 100,014.
  */
  const timing = newTiming();
  markStage(timing, "scan1Ms", 20000);
  markStage(timing, "statsMs", 50000);
  markStage(timing, "scan3Ms", 25000);
  const out = summarizeHistoryTiming(timing, { status: 200, durationMs: 100000 });
  assert.equal(out.unattributedMs, 5000, "95s of 100s is now attributed");
});

test("[H3] an unmeasured stage is absent, never a fabricated zero", () => {
  const timing = newTiming();
  markStage(timing, "scan1Ms", 12);
  const out = summarizeHistoryTiming(timing, { status: 200, durationMs: 12 });
  assert.equal(out.scan1Ms, 12);
  for (const stage of SYNC_STAGES.filter((s) => s !== "scan1Ms")) {
    assert.equal(out[stage], undefined, `${stage} was not measured, so it must not appear`);
  }
});

test("[H4] no stage can be negative, and unattributedMs has a floor of zero", () => {
  const timing = newTiming();
  markStage(timing, "scan1Ms", -5);
  assert.equal(timing.stages.scan1Ms, undefined, "a negative duration is rejected outright");
  markStage(timing, "statsMs", 900);
  const out = summarizeHistoryTiming(timing, { status: 200, durationMs: 100 });
  assert.ok(out.unattributedMs >= 0, "staged time exceeding duration must not go negative");
});

// ── counters ───────────────────────────────────────────────────────────────

test("[H5] counters are reported under `sync`", () => {
  const timing = newTiming();
  recordSyncCounters(timing, { scanned: 94, updated: 94, finishedScanned: 815, statsFetchCalls: 80 });
  const out = summarizeHistoryTiming(timing, { status: 200, durationMs: 141000 });
  assert.deepEqual(out.sync, { scanned: 94, updated: 94, finishedScanned: 815, statsFetchCalls: 80 });
});

test("[H6] counters MERGE across phases rather than replacing", () => {
  const timing = newTiming();
  recordSyncCounters(timing, { scanned: 94 });
  recordSyncCounters(timing, { finishedScanned: 815 });
  recordSyncCounters(timing, { statsFetchCalls: 80, statsSkippedBudget: 64 });
  const out = summarizeHistoryTiming(timing, { status: 200, durationMs: 1 });
  assert.deepEqual(out.sync, {
    scanned: 94,
    finishedScanned: 815,
    statsFetchCalls: 80,
    statsSkippedBudget: 64
  });
});

test("[H7] unknown keys and non-numbers never reach the log", () => {
  const timing = newTiming();
  recordSyncCounters(timing, {
    scanned: 5,
    fixtureId: 1635609,
    rawPayload: { secret: "x" },
    userId: "u_123",
    updated: "not-a-number",
    resettled: -1
  });
  const out = summarizeHistoryTiming(timing, { status: 200, durationMs: 1 });
  assert.deepEqual(out.sync, { scanned: 5 });
  const serialized = JSON.stringify(out);
  for (const leak of ["1635609", "secret", "u_123"]) {
    assert.ok(!serialized.includes(leak), `${leak} must not appear in telemetry`);
  }
});

test("[H8] a mode that records no counters grows no field", () => {
  const readTiming = createHistoryTiming({ view: "list" }, "GET");
  const out = summarizeHistoryTiming(readTiming, { status: 200, durationMs: 10 });
  assert.equal(out.sync, undefined);
  assert.equal(out.failedStage, undefined);
});

// ── failure attribution ────────────────────────────────────────────────────

test("[H9] a failed scan records its stage and operation and rethrows untouched", async () => {
  const timing = newTiming();
  const original = Object.assign(new Error("boom"), { code: "57014" });
  await assert.rejects(
    () =>
      timeSyncPhase(timing, "scan3Ms", "scan_finished", async () => {
        throw original;
      }),
    (thrown) => {
      assert.equal(thrown, original, "the ORIGINAL error object must propagate");
      return true;
    }
  );
  const out = summarizeHistoryTiming(timing, { status: 500, durationMs: 100014 });
  assert.equal(out.failedStage, "scan3Ms");
  assert.equal(out.failedOperation, "scan_finished");
  assert.equal(out.errorCode, "57014");
  assert.equal(out.errorKind, "db_timeout");
});

test("[H10] a failed upsert records the upsert stage", async () => {
  const timing = newTiming();
  await assert.rejects(() =>
    timeSyncPhase(timing, "upsert3Ms", "upsert_card_markets", async () => {
      throw new Error("upsert failed");
    })
  );
  const out = summarizeHistoryTiming(timing, { status: 500, durationMs: 1 });
  assert.equal(out.failedStage, "upsert3Ms");
  assert.equal(out.failedOperation, "upsert_card_markets");
});

test("[H11] a provider failure records the provider stage", async () => {
  const timing = newTiming();
  await assert.rejects(() =>
    timeSyncPhase(timing, "providerFixtureMs", "provider_fixtures", async () => {
      throw new Error("api-football unreachable");
    })
  );
  assert.equal(summarizeHistoryTiming(timing, { status: 500, durationMs: 1 }).failedStage, "providerFixtureMs");
});

test("[H12] the FIRST failure wins — it is the cause, not the last symptom", () => {
  const timing = newTiming();
  recordFailure(timing, { stage: "scan1Ms", operation: "scan_pending", error: new Error("first") });
  recordFailure(timing, { stage: "upsert3Ms", operation: "upsert_card_markets", error: new Error("second") });
  const out = summarizeHistoryTiming(timing, { status: 500, durationMs: 1 });
  assert.equal(out.failedStage, "scan1Ms");
  assert.equal(out.failedOperation, "scan_pending");
});

test("[H13] partial counters and timings SURVIVE a failure", async () => {
  /*
    THE HEADLINE FIX. The 15:19Z 500 reported rows=0 and nothing else, so nobody
    could tell whether it had settled 800 rows or none before it died.
  */
  const timing = newTiming();
  recordSyncCounters(timing, { scanned: 94, updated: 94 });
  markStage(timing, "scan1Ms", 3000);
  await assert.rejects(() =>
    timeSyncPhase(timing, "scan3Ms", "scan_finished", async () => {
      throw new Error("upstream 500");
    })
  );
  recordSyncCounters(timing, { finishedScanned: 400 });
  const out = summarizeHistoryTiming(timing, { status: 500, durationMs: 100014 });
  assert.deepEqual(out.sync, { scanned: 94, updated: 94, finishedScanned: 400 });
  assert.equal(out.scan1Ms, 3000);
  assert.equal(out.failedStage, "scan3Ms");
  assert.equal(out.status, 500);
});

test("[H14] a phase that succeeds records a non-negative duration and no failure", async () => {
  const timing = newTiming();
  const result = await timeSyncPhase(timing, "scan1Ms", "scan_pending", async () => "ok");
  assert.equal(result, "ok", "the phase returns whatever it wrapped");
  assert.ok(timing.stages.scan1Ms >= 0, "a monotonic clock cannot produce a negative elapsed time");
  assert.equal(timing.failedStage, null);
});

// ── transport aggregate ────────────────────────────────────────────────────

const record = (over = {}) => ({
  fetchTotalMs: 100,
  requestTotalMs: 100,
  httpStatus: 200,
  ttfbMs: 90,
  connection: "new",
  ...over
});

test("[T1] fetchTotalMs stays the SLOWEST request — it is not the sum", () => {
  const collector = createTransportCollector("/api/history");
  collector.records.push(record({ fetchTotalMs: 3000, ttfbMs: 2900 }));
  collector.records.push(record({ fetchTotalMs: 15033, ttfbMs: 15031, httpStatus: 500, connection: "reused" }));
  collector.records.push(record({ fetchTotalMs: 7075, ttfbMs: 7030 }));
  const out = summarizeTransport(collector);
  assert.equal(out.fetchTotalMs, 15033, "unchanged meaning: the worst single request");
  assert.notEqual(out.fetchTotalMs, out.supabaseTotalMs, "the sum is a DIFFERENT field");
});

test("[T2] the aggregate reports both total and max", () => {
  const collector = createTransportCollector("/api/history");
  collector.records.push(record({ fetchTotalMs: 3000, ttfbMs: 2900 }));
  collector.records.push(record({ fetchTotalMs: 15033, ttfbMs: 15031, httpStatus: 500, connection: "reused" }));
  collector.records.push(record({ fetchTotalMs: 7075, ttfbMs: 7030 }));
  const out = summarizeTransport(collector);
  assert.equal(out.supabaseCount, 3);
  assert.equal(out.supabaseTotalMs, 25108);
  assert.equal(out.supabaseMaxMs, 15033);
  assert.equal(out.supabaseMaxTtfbMs, 15031);
});

test("[T3] errors, slow requests and connection reuse are counted", () => {
  const collector = createTransportCollector("/api/history");
  collector.records.push(record({ fetchTotalMs: 100, connection: "new" }));
  collector.records.push(record({ fetchTotalMs: 15033, httpStatus: 500, connection: "reused" }));
  collector.records.push(record({ fetchTotalMs: 3000, connection: "reused" }));
  collector.records.push(record({ fetchTotalMs: 50, transportError: true, httpStatus: undefined }));
  const out = summarizeTransport(collector);
  assert.equal(out.supabaseErrors, 2, "one HTTP 500 and one transport error");
  assert.equal(out.supabaseSlow, 2, "two requests at or above the 2000ms bar");
  assert.equal(out.supabaseReused, 2);
  assert.equal(out.supabaseNew, 2);
});

test("[T4] the pre-existing transport shape is preserved for existing consumers", () => {
  const collector = createTransportCollector("/api/history");
  collector.records.push(record({ fetchTotalMs: 120, connection: "reused", ttfbMs: 110 }));
  collector.records.push(record({ fetchTotalMs: 340, connection: "new", ttfbMs: 300 }));
  const out = summarizeTransport(collector);
  assert.equal(out.fetchTotalMs, 340);
  assert.equal(out.requestTotalMs, 100);
  assert.equal(out.httpStatus, 200);
  assert.equal(out.connection, "new", "still the slowest record's connection");
  assert.equal(out.supabaseRequests, 2, "still set only when more than one request ran");
  assert.equal(summarizeTransport(createTransportCollector("/x")), null, "empty stays null");
  assert.equal(summarizeTransport(null), null);
});

test("[T5] a single request reports an aggregate equal to itself", () => {
  const collector = createTransportCollector("/api/history");
  collector.records.push(record({ fetchTotalMs: 250, ttfbMs: 240 }));
  const out = summarizeTransport(collector);
  assert.equal(out.supabaseRequests, undefined, "unchanged: absent for a single request");
  assert.equal(out.supabaseCount, 1);
  assert.equal(out.supabaseTotalMs, 250);
  assert.equal(out.supabaseMaxMs, 250);
});

// ── emission ───────────────────────────────────────────────────────────────

test("[E1] ONE event per sync, on the existing event name", () => {
  const lines = [];
  const originalWarn = console.warn;
  console.warn = (text) => lines.push(text);
  try {
    const timing = newTiming();
    recordSyncCounters(timing, { scanned: 94 });
    markStage(timing, "scan1Ms", 3000);
    emitHistoryTiming(timing, { status: 500, durationMs: 100014 });
  } finally {
    console.warn = originalWarn;
  }
  const events = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((e) => e && e.event === HISTORY_TIMING_EVENT);
  assert.equal(events.length, 1, "one aggregate event, never one per request");
  assert.equal(events[0].event, "history.timing", "the existing name — dashboards keep resolving");
  assert.equal(events[0].mode, "sync");
  assert.equal(events[0].sync.scanned, 94);
});

test("[E2] a fast, successful sync still emits nothing — the threshold is unchanged", () => {
  const lines = [];
  const originalWarn = console.warn;
  console.warn = (text) => lines.push(text);
  try {
    emitHistoryTiming(newTiming(), { status: 200, durationMs: 25 });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(lines.length, 0);
});

test("[E3] no fixture id, payload, token or URL can reach the event", () => {
  const timing = newTiming();
  recordSyncCounters(timing, { scanned: 3 });
  recordFailure(timing, {
    stage: "scan3Ms",
    operation: "scan_finished",
    // A realistic PostgREST error: the message carries the statement itself.
    error: Object.assign(
      new Error(
        "canceling statement due to statement timeout: SELECT raw_payload FROM predictions_history WHERE fixture_id = 1635609"
      ),
      { code: "57014" }
    )
  });
  const serialized = JSON.stringify(summarizeHistoryTiming(timing, { status: 500, durationMs: 1 }));
  for (const leak of ["1635609", "raw_payload", "SELECT", "predictions_history", "apikey", "Bearer", "https://"]) {
    assert.ok(!serialized.includes(leak), `${leak} must never appear`);
  }
  assert.ok(serialized.includes("57014"), "the code is kept — it is the diagnosis, and it is safe");
});
