/**
 * S2 observability: prediction health derived from response headers.
 *
 * The design constraint that shaped this: PredictorV3 is off-limits, so the cache-vs-live
 * split and the persistence-failure counters cannot be instrumented inside Stage01 or
 * Stage10. Both signals already exist as response headers (X-Data-Source,
 * X-Persist-Warning), so requestMonitor reads them at finish time. These tests pin that
 * contract — if the header names or prefixes drift, the counters silently go to zero,
 * which is the failure mode worth catching.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildOpsAlerts, buildPredictionHealth } from "../server-utils/observability/healthBundle.js";
import { classifyPredictSource } from "../server-utils/observability/requestMonitor.js";

/** Minimal res double exposing only getHeader, as the classifier requires. */
function resWith(headers = {}) {
  return { getHeader: (name) => headers[name] ?? undefined };
}

const QUIET = {
  metrics: { routes: {}, failures: { prediction: 0, api: 0, cache: 0 } },
  usage: { count: 0, limit: 100 },
  cache: { hitRatio: 0.9, hits: 100, misses: 10 },
  checks: { kv: { ok: true }, supabase: { ok: true } }
};

test("a predict with no X-Data-Source counts as live", () => {
  const c = classifyPredictSource(resWith({}));
  assert.equal(c.channel, "predictLive");
  assert.equal(c.counter, "predict_served_live");
});

test("every db_only_* short-circuit counts as cache-served", () => {
  // The five reasons Stage01 stamps today. New ones must keep the db_only prefix.
  for (const source of [
    "db_only_free",
    "db_only_paid_cache",
    "db_only_paid_no_fixtures",
    "db_only_budget_soft_stop",
    "db_only_budget_hard_stop"
  ]) {
    const c = classifyPredictSource(resWith({ "X-Data-Source": source }));
    assert.equal(c.channel, "predictCached", `${source} should classify as cached`);
    assert.equal(c.counter, "predict_served_cache");
    assert.equal(c.source, source);
  }
});

test("an unrecognised data source is treated as live rather than silently dropped", () => {
  const c = classifyPredictSource(resWith({ "X-Data-Source": "something_new" }));
  assert.equal(c.channel, "predictLive");
});

test("a res without getHeader does not throw", () => {
  assert.doesNotThrow(() => classifyPredictSource({}));
  assert.equal(classifyPredictSource({}).channel, "predictLive");
});

test("prediction health separates generation time from experienced latency", () => {
  const health = buildPredictionHealth({
    counters: { predict_served_live: 10, predict_served_cache: 30 },
    failures: { prediction: 2 },
    routes: {
      predict: { avgMs: 900, p95Ms: 4000 },
      predictLive: { avgMs: 3200, p95Ms: 8000 },
      predictCached: { avgMs: 140 }
    }
  });

  assert.equal(health.generatedToday, 40);
  assert.equal(health.servedLive, 10);
  assert.equal(health.servedFromCache, 30);
  assert.equal(health.cacheServedPct, 75);
  // Generation time is the live figure, not the blended one — averaging them together
  // would report 900ms for work that actually takes 3200ms.
  assert.equal(health.avgGenerationMs, 3200);
  assert.equal(health.avgLatencyMs, 900);
  assert.equal(health.avgCachedLatencyMs, 140);
  assert.equal(health.failures, 2);
});

test("prediction health is well-formed with no traffic at all", () => {
  const health = buildPredictionHealth({});
  assert.equal(health.generatedToday, 0);
  assert.equal(health.cacheServedPct, null);
  assert.equal(health.avgGenerationMs, null);
  assert.deepEqual(health.persistFailures, { history: 0, ownership: 0 });
});

test("any persistence warning raises an alert, without waiting for a threshold", () => {
  const one = buildOpsAlerts({
    ...QUIET,
    metrics: { ...QUIET.metrics, counters: { persist_ownership_failed: 1 } }
  });
  const alert = one.alerts.find((a) => a.id === "persist_failures");
  assert.ok(alert, "a single persist warning must alert");
  assert.equal(alert.level, "medium");

  const many = buildOpsAlerts({
    ...QUIET,
    metrics: { ...QUIET.metrics, counters: { persist_history_failed: 4, persist_ownership_failed: 3 } }
  });
  assert.equal(many.alerts.find((a) => a.id === "persist_failures").level, "high");
  assert.equal(many.alerts.find((a) => a.id === "persist_failures").value, 7);
});

test("no counters means no persist alert and no change to existing rules", () => {
  const before = buildOpsAlerts({ ...QUIET });
  assert.equal(before.alerts.some((a) => a.id === "persist_failures"), false);
  assert.equal(before.severity, "none");
});
