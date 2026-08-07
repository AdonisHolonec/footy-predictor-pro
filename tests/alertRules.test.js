import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALERT_RULES,
  evaluateAlertRules,
  resolveThresholds
} from "../server-utils/observability/alertRules.js";
import { buildOpsAlerts } from "../server-utils/observability/healthBundle.js";

/**
 * These tests exist to pin an extraction, not to describe new behaviour. Every message
 * string and level below is what the inline version of buildOpsAlerts produced before the
 * thresholds moved into alertRules.js, so a drift here means the move changed something it
 * was not supposed to.
 */

/** A context in which no rule fires — the baseline each case perturbs. */
function quietContext(overrides = {}) {
  return {
    metrics: {
      routes: {
        predict: { count: 100, errors: 0, errorRate: 0, avgMs: 100, maxMs: 200, p50Ms: 90, p95Ms: 150 },
        api: { count: 100, errors: 0, errorRate: 0, avgMs: 100, maxMs: 200, p50Ms: 90, p95Ms: 150 },
        cache: { count: 100, errors: 0, errorRate: 0, avgMs: 5, maxMs: 10, p50Ms: 4, p95Ms: 8 },
        fixtures: { count: 10, errors: 0, errorRate: 0, avgMs: 50, maxMs: 60, p50Ms: 40, p95Ms: 55 }
      },
      failures: { prediction: 0, api: 0, cache: 0 },
      counters: {}
    },
    usage: { count: 10, limit: 100 },
    cache: { hits: 90, misses: 10, hitRatio: 0.9 },
    checks: { kv: { ok: true }, supabase: { ok: true } },
    settlement: { ok: true, ageMinutes: 30, recommendedStillPending: 0 },
    benchmark: { backlog: 0 },
    snapshot: { ageMinutes: 60, cron: { failingJobs: [], staleJobs: [] } },
    ...overrides
  };
}

function idsOf(result) {
  return result.alerts.map((a) => a.id);
}

function alertFor(result, id) {
  return result.alerts.find((a) => a.id === id);
}

test("a healthy context produces no alerts and no severity", () => {
  const result = evaluateAlertRules(quietContext());

  assert.deepEqual(result.alerts, []);
  assert.equal(result.severity, "none");
});

test("every subsystem reports healthy when nothing fires", () => {
  const { subsystems } = evaluateAlertRules(quietContext());

  assert.ok(Object.values(subsystems).every((s) => s === "healthy"));
  assert.equal(subsystems.prediction, "healthy");
  assert.equal(subsystems.infrastructure, "healthy");
});

test("failure counters escalate from medium to high at their documented bands", () => {
  const ctx = quietContext();
  ctx.metrics.failures = { prediction: 3, api: 5, cache: 3 };
  const low = evaluateAlertRules(ctx);

  assert.equal(alertFor(low, "prediction_failures").level, "medium");
  assert.equal(alertFor(low, "prediction_failures").message, "Prediction failures today: 3");
  assert.equal(alertFor(low, "api_failures").level, "medium");
  assert.equal(alertFor(low, "cache_failures").level, "medium");

  ctx.metrics.failures = { prediction: 10, api: 20, cache: 10 };
  const high = evaluateAlertRules(ctx);

  assert.equal(alertFor(high, "prediction_failures").level, "high");
  assert.equal(alertFor(high, "api_failures").level, "high");
  assert.equal(alertFor(high, "cache_failures").level, "high");
});

test("failure counters stay silent one below their threshold", () => {
  const ctx = quietContext();
  ctx.metrics.failures = { prediction: 2, api: 4, cache: 2 };

  assert.deepEqual(idsOf(evaluateAlertRules(ctx)), []);
});

test("predict error rate needs a sample floor before it fires", () => {
  const ctx = quietContext();
  ctx.metrics.routes.predict = { ...ctx.metrics.routes.predict, count: 4, errorRate: 1 };

  assert.ok(!idsOf(evaluateAlertRules(ctx)).includes("predict_error_rate"));

  ctx.metrics.routes.predict = { ...ctx.metrics.routes.predict, count: 5, errorRate: 0.2 };
  const result = evaluateAlertRules(ctx);

  assert.equal(alertFor(result, "predict_error_rate").level, "medium");
  assert.equal(alertFor(result, "predict_error_rate").message, "Predict error rate 20% (n=5)");
});

test("latency rules round the reported value", () => {
  const ctx = quietContext();
  ctx.metrics.routes.predict = { ...ctx.metrics.routes.predict, p95Ms: 25000.4 };
  ctx.metrics.routes.api = { ...ctx.metrics.routes.api, p95Ms: 6000.6 };
  const result = evaluateAlertRules(ctx);

  assert.equal(alertFor(result, "predict_latency").message, "Predict p95 latency 25000ms");
  assert.equal(alertFor(result, "api_latency").message, "Upstream API p95 6001ms");
});

test("api quota names the circuit state it corresponds to", () => {
  const soft = evaluateAlertRules(quietContext({ usage: { count: 85, limit: 100 } }));
  assert.equal(alertFor(soft, "api_quota").level, "medium");
  assert.equal(alertFor(soft, "api_quota").message, "API quota 85% (85/100) — circuit SOFT");

  const hard = evaluateAlertRules(quietContext({ usage: { count: 96, limit: 100 } }));
  assert.equal(alertFor(hard, "api_quota").level, "high");
  assert.equal(alertFor(hard, "api_quota").message, "API quota 96% (96/100) — circuit HARD");
});

test("api quota stays silent when no limit is known", () => {
  const result = evaluateAlertRules(quietContext({ usage: { count: 500, limit: 0 } }));

  assert.ok(!idsOf(result).includes("api_quota"));
});

test("cache hit ratio fires below its threshold, not above", () => {
  const low = evaluateAlertRules(quietContext({ cache: { hits: 2, misses: 40, hitRatio: 0.05 } }));
  assert.equal(alertFor(low, "cache_hit_ratio").message, "Cache hit ratio 5%");

  const fine = evaluateAlertRules(quietContext({ cache: { hits: 40, misses: 2, hitRatio: 0.95 } }));
  assert.ok(!idsOf(fine).includes("cache_hit_ratio"));
});

test("cache hit ratio ignores samples too small to mean anything", () => {
  const result = evaluateAlertRules(quietContext({ cache: { hits: 1, misses: 18, hitRatio: 0.05 } }));

  assert.ok(!idsOf(result).includes("cache_hit_ratio"));
});

test("settlement backlog escalates and keeps its wording", () => {
  const warn = evaluateAlertRules(
    quietContext({ settlement: { ok: true, ageMinutes: 30, recommendedStillPending: 5 } })
  );
  assert.equal(alertFor(warn, "settlement_pending").level, "medium");
  assert.equal(
    alertFor(warn, "settlement_pending").message,
    "Finished fixtures with an ungraded recommended pick: 5"
  );

  const crit = evaluateAlertRules(
    quietContext({ settlement: { ok: true, ageMinutes: 30, recommendedStillPending: 20 } })
  );
  assert.equal(alertFor(crit, "settlement_pending").level, "high");
});

test("a settlement sync that stopped running reports its age in hours", () => {
  const result = evaluateAlertRules(
    quietContext({ settlement: { ok: true, ageMinutes: 1500, recommendedStillPending: 0 } })
  );

  assert.equal(alertFor(result, "settlement_stale").level, "high");
  assert.equal(alertFor(result, "settlement_stale").message, "Settlement sync last ran 25h ago");
});

test("settlement staleness is not claimed when the sync never reported", () => {
  const result = evaluateAlertRules(
    quietContext({ settlement: { ok: false, ageMinutes: null, recommendedStillPending: 0 } })
  );

  assert.ok(!idsOf(result).includes("settlement_stale"));
});

test("benchmark backlog is informational until it grows large", () => {
  const small = evaluateAlertRules(quietContext({ benchmark: { backlog: 12 } }));
  assert.equal(alertFor(small, "benchmark_backlog").level, "low");
  assert.equal(
    alertFor(small, "benchmark_backlog").message,
    "Benchmark sweep backlog: 12 unbenchmarked fixtures in window"
  );

  const large = evaluateAlertRules(quietContext({ benchmark: { backlog: 200 } }));
  assert.equal(alertFor(large, "benchmark_backlog").level, "medium");
});

test("an informational alert alone leaves severity at none", () => {
  const result = evaluateAlertRules(quietContext({ benchmark: { backlog: 12 } }));

  assert.equal(result.severity, "none");
  assert.equal(result.subsystems.benchmark, "healthy");
});

test("any persist failure fires without waiting for a threshold", () => {
  const ctx = quietContext();
  ctx.metrics.counters = { persist_history_failed: 1, persist_ownership_failed: 0 };
  const one = evaluateAlertRules(ctx);

  assert.equal(alertFor(one, "persist_failures").level, "medium");
  assert.equal(
    alertFor(one, "persist_failures").message,
    "Persist warnings today — history: 1, ownership: 0"
  );

  ctx.metrics.counters = { persist_history_failed: 3, persist_ownership_failed: 2 };
  assert.equal(alertFor(evaluateAlertRules(ctx), "persist_failures").level, "high");
});

test("a stale snapshot reports its age in hours", () => {
  const result = evaluateAlertRules(
    quietContext({ snapshot: { ageMinutes: 3000, cron: { failingJobs: [], staleJobs: [] } } })
  );

  assert.equal(alertFor(result, "ops_snapshot_stale").message, "Health snapshot is 50h old");
});

test("snapshot staleness is skipped rather than guessed when no snapshot exists", () => {
  const result = evaluateAlertRules(quietContext({ snapshot: null }));

  assert.ok(!idsOf(result).includes("ops_snapshot_stale"));
});

test("cron rules name the jobs involved", () => {
  const result = evaluateAlertRules(
    quietContext({
      snapshot: {
        ageMinutes: 60,
        cron: { failingJobs: ["historySync"], staleJobs: ["metaLearningRefresh", "benchmarkSweep"] }
      }
    })
  );

  assert.equal(alertFor(result, "cron_failing").level, "high");
  assert.equal(alertFor(result, "cron_failing").message, "Cron jobs reporting failure: historySync");
  assert.equal(alertFor(result, "cron_stale").level, "medium");
  assert.equal(
    alertFor(result, "cron_stale").message,
    "Cron jobs not run in over 24h: metaLearningRefresh, benchmarkSweep"
  );
  assert.equal(result.subsystems.cron, "critical");
});

test("failed health probes are reported as infrastructure critical", () => {
  const result = evaluateAlertRules(
    quietContext({ checks: { kv: { ok: false }, supabase: { ok: false } } })
  );

  assert.equal(alertFor(result, "kv_down").message, "KV health check failed");
  assert.equal(alertFor(result, "supabase_down").message, "Supabase health check failed");
  assert.equal(result.subsystems.infrastructure, "critical");
});

test("a probe that simply has no result is not treated as a failure", () => {
  const result = evaluateAlertRules(quietContext({ checks: { kv: {}, supabase: {} } }));

  assert.ok(!idsOf(result).includes("kv_down"));
  assert.ok(!idsOf(result).includes("supabase_down"));
});

test("alerts keep the declared rule order so the dashboard list is stable", () => {
  const ctx = quietContext({
    usage: { count: 96, limit: 100 },
    cache: { hits: 2, misses: 40, hitRatio: 0.05 },
    checks: { kv: { ok: false }, supabase: { ok: true } }
  });
  ctx.metrics.failures = { prediction: 5, api: 8, cache: 4 };

  const ids = idsOf(evaluateAlertRules(ctx));
  const declared = ALERT_RULES.map((r) => r.id).filter((id) => ids.includes(id));

  assert.deepEqual(ids, declared);
});

test("subsystem rollup takes the worst level fired against it", () => {
  const ctx = quietContext();
  // Two prediction rules fire at different levels; the subsystem must report the worse one.
  ctx.metrics.failures = { prediction: 10, api: 0, cache: 0 };
  ctx.metrics.routes.predict = { ...ctx.metrics.routes.predict, p95Ms: 25000 };
  const { subsystems } = evaluateAlertRules(ctx);

  assert.equal(subsystems.prediction, "critical");
  assert.equal(subsystems.api, "healthy");
});

test("buildOpsAlerts still returns only alerts and severity", () => {
  const result = buildOpsAlerts(quietContext({ checks: { kv: { ok: false }, supabase: { ok: true } } }));

  assert.deepEqual(Object.keys(result).sort(), ["alerts", "severity"]);
  assert.equal(result.severity, "high");
  assert.equal(result.alerts[0].id, "kv_down");
});

test("every rule declares the fields the evaluator depends on", () => {
  for (const rule of ALERT_RULES) {
    assert.equal(typeof rule.id, "string", `${rule.id} needs an id`);
    assert.equal(typeof rule.subsystem, "string", `${rule.id} needs a subsystem`);
    assert.equal(typeof rule.value, "function", `${rule.id} needs a value selector`);
    assert.equal(typeof rule.message, "function", `${rule.id} needs a message builder`);
    const bands = typeof rule.bands === "function" ? rule.bands() : rule.bands;
    assert.ok(Array.isArray(bands) && bands.length > 0, `${rule.id} needs at least one band`);
  }
});

test("published thresholds are read back off the rules rather than restated", () => {
  const thresholds = resolveThresholds();

  assert.equal(thresholds.settlementPendingWarn, 5);
  assert.equal(thresholds.settlementPendingCritical, 20);
  assert.equal(thresholds.settlementStaleMinutes, 1440);
  assert.equal(thresholds.snapshotStaleMinutes, 2880);
  assert.equal(thresholds.benchmarkBacklogWatch, 200);
  assert.equal(thresholds.predictionFailuresWatch, 3);
});

test("an env override reaches the published thresholds", () => {
  const previous = process.env.SETTLEMENT_PENDING_WARN;
  process.env.SETTLEMENT_PENDING_WARN = "12";
  try {
    assert.equal(resolveThresholds().settlementPendingWarn, 12);
    // The rule that produced it must have moved with it, or the UI and the alert disagree.
    const fired = evaluateAlertRules(
      quietContext({ settlement: { ok: true, ageMinutes: 30, recommendedStillPending: 8 } })
    );
    assert.ok(!idsOf(fired).includes("settlement_pending"));
  } finally {
    if (previous === undefined) delete process.env.SETTLEMENT_PENDING_WARN;
    else process.env.SETTLEMENT_PENDING_WARN = previous;
  }
});

test("the evaluation carries the thresholds it applied", () => {
  const result = evaluateAlertRules(quietContext());

  assert.deepEqual(result.thresholds, resolveThresholds());
});

test("rule ids are unique", () => {
  const ids = ALERT_RULES.map((r) => r.id);

  assert.equal(new Set(ids).size, ids.length);
});
