/**
 * Retention and backward compatibility for the sync telemetry stream.
 *
 * The stream became the run journal, so two properties now matter that did not
 * before. First, retention: 14 days answered the 7-day Tier 3 question but could
 * not answer a 30-day reliability one — the RELIABILITY-007 audit had to
 * reconstruct missing cron slots from Supabase edge logs, which keep only 24h.
 * Second, compatibility: days already written carry no `runId` and no `status`,
 * and must keep parsing rather than being read as corrupt.
 *
 * `@vercel/kv` is mocked, so nothing here reaches Upstash.
 */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** Every key written, with the options it was written under. */
const writes = [];
/** Every key read, in order. */
const reads = [];
/** Contents the fake store returns, keyed exactly as production would key them. */
const store = new Map();

mock.module("@vercel/kv", {
  namedExports: {
    createClient: () => ({
      get: async (key) => {
        reads.push(key);
        return store.get(key) ?? null;
      },
      set: async (key, value, options) => {
        writes.push({ key, value, options });
        store.set(key, value);
        return "OK";
      }
    })
  }
});

const { recordSyncRun, readSyncRuns, getSettlementHealth, SYNC_KINDS } = await import(
  "../server-utils/observability/syncTelemetry.js"
);

const DAY_SECONDS = 24 * 60 * 60;

/** A record in the shape this stream carried BEFORE the run journal existed. */
const LEGACY_RUN = Object.freeze({
  at: "2026-09-14T21:23:01.200Z",
  finishedScanned: 940,
  recommendedPendingBefore: 62,
  recommendedSettledNow: 0,
  recommendedStillPending: 62,
  missingTotals: 51,
  syncSkippedBudget: 58,
  recommendedStatsCalls: 62,
  recommendedStatsCap: 250,
  statsFetchCalls: 80,
  statsFetchCap: 80,
  universalEnabled: true,
  universalStatsCap: 25,
  universalEligible: 0,
  universalStatsCalls: 0,
  universalSkippedBudget: 0,
  universalEmptyResponses: 0,
  universalCacheHits: 0,
  durationMs: 46286
});

test.beforeEach(() => {
  writes.length = 0;
  reads.length = 0;
  store.clear();
});

// ── G. retention ───────────────────────────────────────────────────────────

test("[R1] a recorded run is kept for 30 days", async () => {
  await recordSyncRun(SYNC_KINDS.SETTLEMENT, { status: "COMPLETED", runId: "r1" });

  assert.equal(writes.length, 1);
  assert.equal(
    writes[0].options.ex,
    30 * DAY_SECONDS,
    "TTL must be 30 days so a month of reliability history survives"
  );
  assert.match(writes[0].key, /^footy_ops_sync:settlement:\d{4}-\d{2}-\d{2}$/, "the key format must not change");
});

test("[R2] the reader horizon reaches 30 days and clamps there", async () => {
  await readSyncRuns(SYNC_KINDS.SETTLEMENT, 30);
  assert.equal(reads.length, 30, "asking for 30 days must read 30 daily buckets");

  reads.length = 0;
  await readSyncRuns(SYNC_KINDS.SETTLEMENT, 90);
  assert.equal(reads.length, 30, "the horizon must clamp to 30, not silently read further");

  // Every key is a distinct calendar day in the documented format.
  assert.equal(new Set(reads).size, 30, "each bucket must be a distinct day");
  for (const key of reads) assert.match(key, /^footy_ops_sync:settlement:\d{4}-\d{2}-\d{2}$/);
});

test("[R3] the default horizon is unchanged for existing callers", async () => {
  await readSyncRuns(SYNC_KINDS.SETTLEMENT);
  assert.equal(reads.length, 7, "the 7-day default is what the ops surfaces already ask for");
});

// ── F. backward compatibility ──────────────────────────────────────────────

test("[R4] records written before the run journal still parse", async () => {
  const today = new Date().toISOString().slice(0, 10);
  store.set(`footy_ops_sync:settlement:${today}`, { date: today, runs: [LEGACY_RUN] });

  const runs = await readSyncRuns(SYNC_KINDS.SETTLEMENT, 1);
  assert.equal(runs.length, 1, "a legacy record must survive the read path");
  assert.equal(runs[0].at, LEGACY_RUN.at);
  assert.equal(runs[0].runId, undefined, "absent is absent — it must not be invented");
  assert.equal(runs[0].status, undefined);
});

test("[R5] legacy and journal records coexist in one day, newest first", async () => {
  const today = new Date().toISOString().slice(0, 10);
  store.set(`footy_ops_sync:settlement:${today}`, {
    date: today,
    runs: [LEGACY_RUN, { at: "2026-09-16T05:50:45.138Z", runId: "r2", status: "COMPLETED", durationMs: 53992 }]
  });

  const runs = await readSyncRuns(SYNC_KINDS.SETTLEMENT, 1);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].runId, "r2", "ordering is newest-first and must not depend on the new fields");
  assert.equal(runs[1].at, LEGACY_RUN.at);
});

// ── H. existing telemetry ──────────────────────────────────────────────────

test("[R6] every Tier 1/2/3 counter survives a write/read round trip", async () => {
  await recordSyncRun(SYNC_KINDS.SETTLEMENT, {
    runId: "r3",
    status: "COMPLETED",
    startedAt: "2026-09-16T05:49:51.000Z",
    source: "vercel_cron",
    scanned: 105,
    updated: 243,
    estimatedCalls: 86,
    upsertBatches: 47,
    ...LEGACY_RUN
  });

  const runs = await readSyncRuns(SYNC_KINDS.SETTLEMENT, 1);
  assert.equal(runs.length, 1);
  const run = runs[0];

  // Tier 1 (recommended), Tier 2 (general stats budget), Tier 3 (universal).
  const preserved = [
    "finishedScanned",
    "recommendedPendingBefore",
    "recommendedSettledNow",
    "recommendedStillPending",
    "missingTotals",
    "syncSkippedBudget",
    "recommendedStatsCalls",
    "recommendedStatsCap",
    "statsFetchCalls",
    "statsFetchCap",
    "universalEnabled",
    "universalStatsCap",
    "universalEligible",
    "universalStatsCalls",
    "universalSkippedBudget",
    "universalEmptyResponses",
    "universalCacheHits"
  ];
  for (const field of preserved) {
    assert.equal(run[field], LEGACY_RUN[field], `${field} must not be dropped by the journal fields`);
  }

  // And the chunk-experiment evidence the journal adds.
  assert.equal(run.scanned, 105);
  assert.equal(run.updated, 243);
  assert.equal(run.estimatedCalls, 86);
  assert.equal(run.upsertBatches, 47);
});

test("[R7] settlement health still reads a legacy-only stream", async () => {
  const today = new Date().toISOString().slice(0, 10);
  store.set(`footy_ops_sync:settlement:${today}`, { date: today, runs: [LEGACY_RUN] });

  const health = await getSettlementHealth(1);
  assert.equal(health.ok, true, "the existing ops surface must not regress on old data");
  assert.equal(health.recommendedStillPending, 62);
  assert.equal(health.totals.finishedScanned, 940);
});
