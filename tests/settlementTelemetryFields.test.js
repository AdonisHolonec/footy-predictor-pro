/**
 * Settlement-run telemetry contract.
 *
 * The settlement sync records a rich object per run into KV (14-day retention), and that
 * object is the ONLY durable evidence about the run: Vercel keeps runtime logs for about
 * an hour, so by the time anyone asks "how long did the 11:30 cron take", the logs are
 * gone. Two numbers were missing from it, and their absence blocked a decision:
 *
 *   - `statsFetchCap` was recorded but never `statsFetchCalls`. Budget saturation could
 *     only be inferred from `syncSkippedBudget`, so "is 80 actually binding, and would
 *     150 be enough" was not answerable from the data.
 *   - Nothing anywhere recorded the run's wall-clock. `/api/history` has no maxDuration
 *     entry in vercel.json, so it runs at the platform default, and without a measured
 *     base duration there is no way to tell whether adding provider calls is safe.
 *
 * These tests pin the field set so neither number can be dropped again by a later edit.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildSettlementTelemetry } from "../api/history.js";

const CAPS = { statsFetchCap: 80, recommendedStatsCap: 250 };

/** Every key a settlement run is expected to carry into KV. */
const EXPECTED_FIELDS = [
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
  "durationMs"
];

test("statsFetchCalls is part of the recorded shape, not just its cap", () => {
  const t = buildSettlementTelemetry(CAPS);
  assert.ok("statsFetchCalls" in t, "consumption must be recorded alongside statsFetchCap");
  assert.equal(t.statsFetchCalls, 0);
});

test("durationMs is part of the recorded shape", () => {
  const t = buildSettlementTelemetry(CAPS);
  assert.ok("durationMs" in t, "run wall-clock must survive the 1h log retention");
  assert.equal(t.durationMs, 0);
});

test("the field set is exactly the contract — a dropped field fails here", () => {
  const t = buildSettlementTelemetry(CAPS);
  assert.deepEqual(Object.keys(t).sort(), [...EXPECTED_FIELDS].sort());
});

test("both caps are carried through so a run is self-describing", () => {
  const t = buildSettlementTelemetry({ statsFetchCap: 150, recommendedStatsCap: 500 });
  assert.equal(t.statsFetchCap, 150);
  assert.equal(t.recommendedStatsCap, 500);
});

test("every counter starts at zero", () => {
  const t = buildSettlementTelemetry(CAPS);
  const counters = EXPECTED_FIELDS.filter((f) => !f.endsWith("Cap"));
  for (const field of counters) assert.equal(t[field], 0, `${field} must start at 0`);
});

test("no value is undefined — KV would persist a hole the readers cannot aggregate", () => {
  /*
    readSyncRuns/getSettlementHealth sum fields with `Number(r?.[field]) || 0`, so an
    undefined survives as a silent zero rather than an error. The guard belongs here,
    at the point the object is built.
  */
  const t = buildSettlementTelemetry({});
  for (const [k, v] of Object.entries(t)) {
    assert.notEqual(v, undefined, `${k} must never be undefined`);
  }
});

test("a run is JSON-serialisable — it is written to KV and to console.info", () => {
  const t = buildSettlementTelemetry(CAPS);
  t.statsFetchCalls = 80;
  t.durationMs = 12_345;
  const round = JSON.parse(JSON.stringify(t));
  assert.equal(round.statsFetchCalls, 80);
  assert.equal(round.durationMs, 12_345);
});
