import test from "node:test";
import assert from "node:assert/strict";
import { summarizeChannel } from "../server-utils/observability/metricsStore.js";
import { buildOpsAlerts } from "../server-utils/observability/healthBundle.js";
import { logInfo } from "../server-utils/observability/logger.js";
import { processResourceSnapshot } from "../server-utils/observability/requestMonitor.js";

test("summarizeChannel computes avg errorRate and percentiles", () => {
  const s = summarizeChannel({
    count: 10,
    errors: 2,
    sumMs: 1000,
    maxMs: 200,
    samples: [10, 20, 30, 40, 50, 60, 70, 80, 90, 200]
  });
  assert.equal(s.count, 10);
  assert.equal(s.errors, 2);
  assert.equal(s.errorRate, 0.2);
  assert.equal(s.avgMs, 100);
  assert.equal(s.maxMs, 200);
  assert.ok(s.p50Ms != null);
  assert.ok(s.p95Ms != null);
  assert.ok(s.p95Ms >= s.p50Ms);
});

test("buildOpsAlerts fires on prediction API cache failures", () => {
  const { alerts, severity } = buildOpsAlerts({
    metrics: {
      routes: {
        predict: { count: 20, errors: 4, errorRate: 0.2, avgMs: 100, maxMs: 500, p50Ms: 80, p95Ms: 25000 },
        api: { count: 50, errors: 1, errorRate: 0.02, avgMs: 200, maxMs: 900, p50Ms: 150, p95Ms: 6000 },
        cache: { count: 100, errors: 0, errorRate: 0, avgMs: 5, maxMs: 20, p50Ms: 4, p95Ms: 12 },
        fixtures: { count: 10, errors: 0, errorRate: 0, avgMs: 50, maxMs: 100, p50Ms: 40, p95Ms: 90 }
      },
      failures: { prediction: 5, api: 8, cache: 4 }
    },
    usage: { count: 95, limit: 100 },
    cache: { hits: 2, misses: 40, hitRatio: 0.05 },
    checks: { kv: { ok: true }, supabase: { ok: true } }
  });
  const ids = new Set(alerts.map((a) => a.id));
  assert.ok(ids.has("prediction_failures"));
  assert.ok(ids.has("api_failures"));
  assert.ok(ids.has("cache_failures"));
  assert.ok(ids.has("api_quota"));
  assert.ok(severity === "high" || severity === "medium");
});

test("structured logger emits JSON-safe line", () => {
  const line = logInfo("test.event", { n: 1, err: new Error("x") });
  assert.equal(line.event, "test.event");
  assert.equal(line.level, "info");
  assert.equal(line.n, 1);
  assert.equal(line.err.message, "x");
});

test("processResourceSnapshot exposes memory", () => {
  const snap = processResourceSnapshot();
  assert.ok(snap.memory.heapUsedMb >= 0);
  assert.ok(snap.uptimeSec >= 0);
});
