/**
 * Invocation-scoped cache-stat buffering.
 *
 * `getWithCache` bumps a daily hit/miss counter on EVERY lookup, and one warm
 * invocation makes ~75 lookups. Writing straight through cost one HINCRBY per
 * cache read: 3,867 commands on the day it was measured, 38.6% of all Redis
 * traffic, for a counter no product path reads.
 *
 * Commands are counted at the REAL client boundary — @vercel/kv talks to
 * Upstash over fetch, so stubbing fetch counts exactly what the process issues.
 * Nothing in metricsStore is mocked.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.KV_REST_API_URL = "https://kv.test.invalid";
process.env.KV_REST_API_TOKEN = "test-token";

/** Upstash /pipeline: body is an array of commands, reply an array of {result}. */
function installKvStub() {
  const commands = [];
  const hash = new Map();
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
      commands.push({ verb, args: cmdArr });
      if (verb === "GET") return { result: stored };
      if (verb === "SET") {
        const value = cmdArr[2];
        stored = typeof value === "string" ? value : JSON.stringify(value);
        return { result: "OK" };
      }
      if (verb === "HINCRBY") {
        const field = String(cmdArr[2]);
        const delta = Number(cmdArr[3]) || 0;
        const next = (hash.get(field) || 0) + delta;
        hash.set(field, next);
        return { result: next };
      }
      return { result: null };
    });
    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  return {
    hincrbys: () => commands.filter((c) => c.verb === "HINCRBY"),
    field: (name) => hash.get(name) || 0,
    reset: () => {
      commands.length = 0;
      hash.clear();
      stored = null;
    }
  };
}

const kvStub = installKvStub();
const store = await import("../server-utils/observability/metricsStore.js");
const { bumpCacheStat, recordObservation, withObservationScope, getOpsMetrics } = store;

test("10 cache observations inside ONE invocation cost exactly 1 HINCRBY", async () => {
  kvStub.reset();
  await withObservationScope(async () => {
    for (let i = 0; i < 10; i += 1) await bumpCacheStat("hits");
  });
  // The regression: this used to be one command per cache lookup.
  assert.equal(kvStub.hincrbys().length, 1);
  assert.equal(kvStub.field("hits"), 10, "the aggregated total must equal the observations");
});

test("mixed fields aggregate per field, and the totals are exact", async () => {
  kvStub.reset();
  await withObservationScope(async () => {
    for (let i = 0; i < 10; i += 1) await bumpCacheStat("hits");
    for (let i = 0; i < 3; i += 1) await bumpCacheStat("misses");
  });
  // HINCRBY takes a single field, so two fields cost two commands — not 13.
  assert.equal(kvStub.hincrbys().length, 2);
  assert.equal(kvStub.field("hits"), 10);
  assert.equal(kvStub.field("misses"), 3);
});

test("an invocation that observed nothing writes nothing", async () => {
  kvStub.reset();
  await withObservationScope(async () => "no cache lookups here");
  assert.equal(kvStub.hincrbys().length, 0);
});

test("cache counters alone do not drag in the ops-document read/write", async () => {
  kvStub.reset();
  await withObservationScope(async () => {
    await bumpCacheStat("hits");
  });
  assert.equal(kvStub.hincrbys().length, 1);
  assert.equal(kvStub.field("hits"), 1);
});

test("invocations stay isolated — one flush does not absorb another's counts", async () => {
  kvStub.reset();
  const a = withObservationScope(async () => {
    await bumpCacheStat("hits");
    await new Promise((r) => setTimeout(r, 10));
    await bumpCacheStat("hits");
  });
  const b = withObservationScope(async () => {
    await bumpCacheStat("misses");
  });
  await Promise.all([a, b]);
  assert.equal(kvStub.field("hits"), 2);
  assert.equal(kvStub.field("misses"), 1);
});

test("outside a scope it still writes immediately, so unwrapped callers keep counting", async () => {
  kvStub.reset();
  await bumpCacheStat("hits");
  assert.equal(kvStub.hincrbys().length, 1);
  assert.equal(kvStub.field("hits"), 1);
});

test("observation metrics still flush alongside cache counters", async () => {
  kvStub.reset();
  await withObservationScope(async () => {
    await bumpCacheStat("hits");
    await recordObservation("cache", { durationMs: 5, ok: true });
  });
  assert.equal(kvStub.field("hits"), 1);
  const ops = await getOpsMetrics();
  assert.ok(ops.routes.cache.count >= 1, "the observation must still reach the ops document");
});
