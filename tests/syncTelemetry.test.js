/**
 * S1 observability: the settlement/benchmark alert rules that turn persisted sync runs
 * into a signal. `buildOpsAlerts` is pure, so it is tested directly with synthetic
 * health objects — no KV, no database.
 *
 * The behaviour that matters: a finished match whose recommended pick is still ungraded
 * must raise an alert. That signal not existing is why the P0 settlement inconsistency
 * ran unnoticed until a user reported it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildOpsAlerts } from "../server-utils/observability/healthBundle.js";

/** Minimal shapes buildOpsAlerts needs so no unrelated rule fires. */
const QUIET = {
  metrics: { routes: {}, failures: { prediction: 0, api: 0, cache: 0 } },
  usage: { count: 0, limit: 100 },
  cache: { hitRatio: 0.9, hits: 100, misses: 10 },
  checks: { kv: { ok: true }, supabase: { ok: true } }
};

function alertIds(result) {
  return result.alerts.map((a) => a.id);
}

test("no settlement/benchmark data yields no settlement/benchmark alerts", () => {
  const result = buildOpsAlerts({ ...QUIET });
  assert.equal(alertIds(result).some((id) => id.startsWith("settlement_")), false);
  assert.equal(alertIds(result).includes("benchmark_backlog"), false);
  assert.equal(result.severity, "none");
});

test("ungraded recommended picks raise an alert once past the warn threshold", () => {
  const below = buildOpsAlerts({ ...QUIET, settlement: { ok: true, recommendedStillPending: 1 } });
  assert.equal(alertIds(below).includes("settlement_pending"), false);

  const warn = buildOpsAlerts({ ...QUIET, settlement: { ok: true, recommendedStillPending: 7 } });
  const pendingWarn = warn.alerts.find((a) => a.id === "settlement_pending");
  assert.ok(pendingWarn, "expected a settlement_pending alert");
  assert.equal(pendingWarn.level, "medium");
  assert.equal(pendingWarn.value, 7);

  const crit = buildOpsAlerts({ ...QUIET, settlement: { ok: true, recommendedStillPending: 40 } });
  assert.equal(crit.alerts.find((a) => a.id === "settlement_pending").level, "high");
  assert.equal(crit.severity, "high");
});

test("a settlement sync that stopped running is flagged separately from a backlog", () => {
  // Zero pending but stale: the sync is not running at all, which no pending count reveals.
  const stale = buildOpsAlerts({
    ...QUIET,
    settlement: { ok: true, recommendedStillPending: 0, ageMinutes: 3000 }
  });
  const ids = alertIds(stale);
  assert.equal(ids.includes("settlement_stale"), true);
  assert.equal(ids.includes("settlement_pending"), false);

  const fresh = buildOpsAlerts({
    ...QUIET,
    settlement: { ok: true, recommendedStillPending: 0, ageMinutes: 30 }
  });
  assert.equal(alertIds(fresh).includes("settlement_stale"), false);
});

test("a sync that has never run does not report itself as stale", () => {
  // ok:false means no recorded run — absence of data is not evidence of staleness.
  const never = buildOpsAlerts({
    ...QUIET,
    settlement: { ok: false, recommendedStillPending: 0, ageMinutes: null }
  });
  assert.equal(alertIds(never).includes("settlement_stale"), false);
});

test("benchmark backlog escalates with size and stays out of the way at zero", () => {
  const none = buildOpsAlerts({ ...QUIET, benchmark: { ok: true, backlog: 0 } });
  assert.equal(alertIds(none).includes("benchmark_backlog"), false);

  const small = buildOpsAlerts({ ...QUIET, benchmark: { ok: true, backlog: 12 } });
  assert.equal(small.alerts.find((a) => a.id === "benchmark_backlog").level, "low");

  const large = buildOpsAlerts({ ...QUIET, benchmark: { ok: true, backlog: 500 } });
  assert.equal(large.alerts.find((a) => a.id === "benchmark_backlog").level, "medium");
});

test("existing alert rules are unaffected by the new optional inputs", () => {
  // Additive guarantee: the pre-S1 call shape must behave exactly as before.
  const withFailures = {
    ...QUIET,
    metrics: { routes: {}, failures: { prediction: 12, api: 0, cache: 0 } }
  };
  const before = buildOpsAlerts(withFailures);
  const after = buildOpsAlerts({ ...withFailures, settlement: undefined, benchmark: undefined });
  assert.deepEqual(alertIds(before), alertIds(after));
  assert.equal(before.alerts.find((a) => a.id === "prediction_failures").level, "high");
});
