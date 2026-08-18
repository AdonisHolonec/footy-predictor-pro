/**
 * Invocation-scoped observation buffering (Redis P0).
 *
 * Commands are counted at the REAL client boundary: @vercel/kv talks to Upstash
 * over fetch, so stubbing fetch counts the exact Redis commands the process
 * issues. Nothing about metricsStore is mocked — the document asserted on is the
 * one the code actually wrote.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.KV_REST_API_URL = "https://kv.test.invalid";
process.env.KV_REST_API_TOKEN = "test-token";

/**
 * @vercel/kv speaks Upstash's /pipeline endpoint: the body is an ARRAY of
 * commands (`[["get","key"]]`) and the reply is an array of `{result}`. Upstash
 * bills per COMMAND, so that is what is counted here — not per HTTP request.
 */
function installKvStub() {
  const commands = [];
  let stored = null;
  globalThis.fetch = async (url, init = {}) => {
    let body = init.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        /* leave as-is */
      }
    }
    const batch = Array.isArray(body) && Array.isArray(body[0]) ? body : [body];
    const results = batch.map((cmdArr) => {
      const verb = String((cmdArr && cmdArr[0]) || "").toUpperCase();
      commands.push(verb);
      if (verb === "GET") return { result: stored };
      if (verb === "SET") {
        const value = cmdArr[2];
        stored = typeof value === "string" ? value : JSON.stringify(value);
        return { result: "OK" };
      }
      return { result: null };
    });
    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  return {
    calls: commands,
    gets: () => commands.filter((c) => c === "GET").length,
    sets: () => commands.filter((c) => c === "SET").length,
    /** Clears BOTH the command log and the stored document: tests must not
     *  inherit each other's counters. */
    reset: () => {
      commands.length = 0;
      stored = null;
    },
    doc: () => (stored ? JSON.parse(stored) : null)
  };
}

const kvStub = installKvStub();
const store = await import("../server-utils/observability/metricsStore.js");
const { recordObservation, bumpCounter, bumpFailure, withObservationScope, hasActiveObservationScope, getOpsMetrics } = store;

test("10 observations inside ONE invocation cost exactly 1 GET + 1 SET", async () => {
  kvStub.reset();
  await withObservationScope(async () => {
    for (let i = 0; i < 10; i += 1) {
      await recordObservation("cache", { durationMs: i + 1, ok: true });
    }
  });
  assert.equal(kvStub.gets(), 1, "expected exactly one metrics GET per invocation");
  assert.equal(kvStub.sets(), 1, "expected exactly one metrics SET per invocation");

  const doc = kvStub.doc();
  assert.equal(doc.routes.cache.count, 10);
  assert.equal(doc.routes.cache.sumMs, 55); // 1..10
  assert.equal(doc.routes.cache.maxMs, 10);
  assert.equal(doc.routes.cache.samples.length, 10);
});

test("the same 10 observations WITHOUT a scope still cost 10 GET + 10 SET (write-through preserved)", async () => {
  kvStub.reset();
  assert.equal(hasActiveObservationScope(), false);
  for (let i = 0; i < 10; i += 1) {
    await recordObservation("cache", { durationMs: 1, ok: true });
  }
  assert.equal(kvStub.gets(), 10, "unscoped callers must keep the original behaviour");
  assert.equal(kvStub.sets(), 10);
});

test("multiple channels, errors, counters and failures all land in one flush", async () => {
  kvStub.reset();
  await withObservationScope(async () => {
    await recordObservation("predict", { durationMs: 100, ok: true });
    await recordObservation("predict", { durationMs: 300, ok: false, failureKind: "prediction" });
    await recordObservation("fixtures", { durationMs: 50, ok: true });
    await recordObservation("api", { durationMs: 20, ok: false, failureKind: "api" });
    await bumpCounter("predict_served_cache", 2);
    await bumpFailure("cache");
  });
  assert.equal(kvStub.gets(), 1);
  assert.equal(kvStub.sets(), 1);

  const doc = kvStub.doc();
  assert.equal(doc.routes.predict.count, 2);
  assert.equal(doc.routes.predict.errors, 1);
  assert.equal(doc.routes.predict.sumMs, 400);
  assert.equal(doc.routes.predict.maxMs, 300);
  assert.equal(doc.routes.fixtures.count, 1);
  assert.equal(doc.routes.api.errors, 1);
  assert.equal(doc.failures.prediction, 1, "failureKind still folds into failures");
  assert.equal(doc.failures.api, 1);
  assert.equal(doc.failures.cache, 1, "bumpFailure still counted");
  assert.equal(doc.counters.predict_served_cache, 2, "counters unchanged");
});

test("SAMPLE_CAP behaviour is identical when buffered: newest 48 retained", async () => {
  kvStub.reset();
  await withObservationScope(async () => {
    for (let i = 1; i <= 60; i += 1) {
      await recordObservation("cache", { durationMs: i, ok: true });
    }
  });
  const doc = kvStub.doc();
  assert.equal(doc.routes.cache.count, 60, "count is not capped");
  assert.equal(doc.routes.cache.samples.length, 48, "SAMPLE_CAP unchanged");
  assert.equal(doc.routes.cache.samples[0], 13, "oldest dropped, exactly as pushSample did per-call");
  assert.equal(doc.routes.cache.samples[47], 60);
});

test("separate scopes never share a buffer, even when interleaved", async () => {
  kvStub.reset();
  let releaseA;
  const gate = new Promise((r) => {
    releaseA = r;
  });

  const a = withObservationScope(async () => {
    await recordObservation("predict", { durationMs: 1, ok: true });
    await gate; // hold A open while B runs to completion
    await recordObservation("predict", { durationMs: 1, ok: true });
  });
  const b = withObservationScope(async () => {
    await recordObservation("fixtures", { durationMs: 1, ok: true });
  });

  await b;
  const afterB = kvStub.doc();
  assert.equal(afterB.routes.fixtures.count, 1);
  assert.equal(afterB.routes.predict.count, 0, "A's buffered observations must not leak into B's flush");

  releaseA();
  await a;
  const afterA = kvStub.doc();
  assert.equal(afterA.routes.predict.count, 2, "A flushes its own two observations");
  assert.equal(afterA.routes.fixtures.count, 1, "B's earlier write is preserved");
});

test("a metrics Redis failure never propagates out of the scope", async () => {
  kvStub.reset();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("WRONGPASS invalid or missing auth token");
  };
  let productResult = null;
  await assert.doesNotReject(async () => {
    productResult = await withObservationScope(async () => {
      await recordObservation("cache", { durationMs: 5, ok: true });
      return "product-response";
    });
  });
  assert.equal(productResult, "product-response", "the handler's value must survive a metrics outage");
  globalThis.fetch = realFetch;
});

test("the scope flushes even when the handler throws", async () => {
  kvStub.reset();
  await assert.rejects(
    withObservationScope(async () => {
      await recordObservation("api", { durationMs: 7, ok: false, failureKind: "api" });
      throw new Error("handler exploded");
    }),
    /handler exploded/
  );
  assert.equal(kvStub.sets(), 1, "buffered observations are still written on the error path");
});

test("an empty scope performs no Redis commands at all", async () => {
  kvStub.reset();
  await withObservationScope(async () => "nothing observed");
  assert.equal(kvStub.calls.length, 0);
});

test("getOpsMetrics still reads the same document shape", async () => {
  kvStub.reset();
  const metrics = await getOpsMetrics();
  assert.ok(metrics.routes, "routes preserved");
  assert.ok(metrics.routes.predict, "channel names preserved");
  assert.equal(typeof metrics.date, "string");
});
