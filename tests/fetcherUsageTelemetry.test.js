import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * T1 — usage telemetry must never veto a provider response.
 *
 * Since 2026-08-18 the production Upstash KV answers every command with
 * "ERR max requests limit exceeded" (500000 / 500000). `recordUsageFromHeaders`
 * used to run bare inside the upstream try/catch, so that KV throw surfaced as
 * `api.upstream_exception` and getWithCache returned ok:false for a response the
 * provider had already delivered. /fixtures/statistics therefore never hydrated
 * marketResults and Corners/Shots ticket legs stayed pending.
 *
 * These tests drive the REAL getWithCache against a scripted KV and a scripted
 * fetch, so the boundary is exercised, not described.
 *
 * Runs with --experimental-test-module-mocks: @vercel/kv is replaced before the
 * fetcher module is loaded, because the client is created at module scope.
 */

const KV_LIMIT_ERROR = "ERR max requests limit exceeded. Limit: 500000, Usage: 500000";
const FAKE_TOKEN = "AXbzSECRET-kv-token-DO-NOT-LOG";
const FAKE_KV_URL = "https://secret-host.upstash.io";

/** Scripted KV: every command succeeds, or every command throws `failure`. */
const kvState = { failure: null, store: new Map(), calls: [] };
const fakeKv = {
  async get(key) {
    kvState.calls.push(["get", key]);
    if (kvState.failure) throw kvState.failure;
    return kvState.store.has(key) ? kvState.store.get(key) : null;
  },
  async set(key, value) {
    kvState.calls.push(["set", key]);
    if (kvState.failure) throw kvState.failure;
    kvState.store.set(key, value);
    return "OK";
  },
  async hincrby(key) {
    kvState.calls.push(["hincrby", key]);
    if (kvState.failure) throw kvState.failure;
    return 1;
  },
  async hgetall(key) {
    kvState.calls.push(["hgetall", key]);
    if (kvState.failure) throw kvState.failure;
    return {};
  },
  async incr() {
    if (kvState.failure) throw kvState.failure;
    return 1;
  },
  async expire() {
    return 1;
  }
};

mock.module("@vercel/kv", { namedExports: { createClient: () => fakeKv } });

process.env.APISPORTS_KEY = "test-provider-key";
process.env.KV_REST_API_URL = FAKE_KV_URL;
process.env.KV_REST_API_TOKEN = FAKE_TOKEN;

const { getWithCache, buildCacheKey } = await import("../server-utils/fetcher.js");

/** A provider payload with the statistics shape fetchFixtureMarketTotals reads. */
function providerJson(fixtureId) {
  return {
    get: "fixtures/statistics",
    parameters: { fixture: String(fixtureId) },
    errors: [],
    results: 2,
    response: [
      { team: { id: 1 }, statistics: [{ type: "Corner Kicks", value: 6 }, { type: "Shots on Goal", value: 4 }] },
      { team: { id: 2 }, statistics: [{ type: "Corner Kicks", value: 5 }, { type: "Shots on Goal", value: 3 }] }
    ]
  };
}

function fakeResponse({ ok = true, status = 200, json, headers = {} }) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok,
    status,
    headers: { get: (name) => h.get(String(name).toLowerCase()) ?? null },
    json: async () => json
  };
}

/** Provider rate-limit headers: these are what trigger recordUsageFromHeaders. */
const USAGE_HEADERS = { "x-ratelimit-requests-limit": "7500", "x-ratelimit-requests-remaining": "7273" };

let fixtureSeq = 900000;
let warnLines;
let errorLines;

beforeEach(() => {
  kvState.failure = null;
  kvState.store.clear();
  kvState.calls.length = 0;
  fixtureSeq += 1;
  warnLines = [];
  errorLines = [];
  mock.method(console, "warn", (line) => warnLines.push(String(line)));
  mock.method(console, "error", (line) => errorLines.push(String(line)));
});

afterEach(() => {
  mock.restoreAll();
});

function scriptFetch(responder) {
  const calls = [];
  mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    return responder(String(url), init);
  });
  return calls;
}

// ---------------------------------------------------------------------------
// 1. provider success + KV success → ok:true + provider data
// ---------------------------------------------------------------------------
test("provider success + KV success → ok:true with the provider payload and a usage record", async () => {
  const fixture = fixtureSeq;
  const payload = providerJson(fixture);
  const fetchCalls = scriptFetch(() => fakeResponse({ json: payload, headers: USAGE_HEADERS }));

  const result = await getWithCache("/fixtures/statistics", { fixture }, 900);

  assert.equal(result.ok, true);
  assert.equal(result.fromCache, false);
  assert.deepEqual(result.data, payload);
  assert.equal(fetchCalls.length, 1);
  const usageKey = [...kvState.store.keys()].find((k) => k.startsWith("footy_api_usage:"));
  assert.ok(usageKey, "usage telemetry recorded on the healthy path");
  assert.equal(kvState.store.get(usageKey).currentRemaining, 7273);
  assert.equal(warnLines.some((l) => l.includes("api.usage_telemetry_failed")), false);
});

// ---------------------------------------------------------------------------
// 2/3/6. provider success + KV throws (generic, and the production limit error)
//        → ok:true, payload intact. THE test this phase exists for.
// ---------------------------------------------------------------------------
for (const [label, failure] of [
  ["a generic KV exception", new Error("ECONNRESET")],
  ["the Upstash request-limit error", new Error(KV_LIMIT_ERROR)]
]) {
  test(`provider success + ${label} → caller still receives the successful provider response`, async () => {
    const fixture = fixtureSeq;
    const payload = providerJson(fixture);
    const fetchCalls = scriptFetch(() => fakeResponse({ json: payload, headers: USAGE_HEADERS }));
    kvState.failure = failure;

    const result = await getWithCache("/fixtures/statistics", { fixture }, 900);

    assert.equal(result.ok, true, "KV failure must not flip ok");
    assert.equal(result.fromCache, false);
    assert.deepEqual(result.data, payload, "provider payload preserved byte-for-byte");
    assert.equal(result.error, undefined, "no error field on a successful response");
    assert.equal(fetchCalls.length, 1, "exactly one upstream call — no retry, no extra provider cost");
    // KV was asked to record usage and refused; that refusal is observed, not propagated.
    assert.ok(kvState.calls.some(([cmd, key]) => cmd === "get" && key.startsWith("footy_api_usage:")));
    assert.equal(warnLines.filter((l) => l.includes("api.usage_telemetry_failed")).length, 1);
    assert.equal(errorLines.some((l) => l.includes("api.upstream_exception")), false, "not an upstream failure");
  });
}

// ---------------------------------------------------------------------------
// 4/5. provider failure → existing failure result, whether or not KV works
// ---------------------------------------------------------------------------
for (const [label, failure] of [
  ["KV healthy", null],
  ["KV throwing", new Error(KV_LIMIT_ERROR)]
]) {
  test(`provider HTTP failure with ${label} → existing provider-failure result (not swallowed)`, async () => {
    const fixture = fixtureSeq;
    scriptFetch(() =>
      fakeResponse({ ok: false, status: 503, json: { message: "upstream unavailable" }, headers: USAGE_HEADERS })
    );
    kvState.failure = failure;

    const result = await getWithCache("/fixtures/statistics", { fixture }, 900);

    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.error, "upstream unavailable");
    assert.equal(result.fromCache, false);
    assert.equal(errorLines.filter((l) => l.includes("api.upstream_failed")).length, 1);
  });

  test(`provider 'errors' body with ${label} → existing provider-failure result`, async () => {
    const fixture = fixtureSeq;
    scriptFetch(() =>
      fakeResponse({ json: { errors: { requests: "You have reached the request limit" }, response: [] }, headers: USAGE_HEADERS })
    );
    kvState.failure = failure;

    const result = await getWithCache("/fixtures/statistics", { fixture }, 900);

    assert.equal(result.ok, false);
    assert.deepEqual(result.error, { requests: "You have reached the request limit" });
  });
}

// ---------------------------------------------------------------------------
// 10. network exception from the provider → existing upstream_exception path
// ---------------------------------------------------------------------------
test("provider network exception → ok:false with the provider error, regardless of KV", async () => {
  const fixture = fixtureSeq;
  scriptFetch(async () => {
    throw new Error("fetch failed: ETIMEDOUT");
  });
  kvState.failure = new Error(KV_LIMIT_ERROR);

  const result = await getWithCache("/fixtures/statistics", { fixture }, 900);

  assert.equal(result.ok, false);
  assert.equal(result.error, "fetch failed: ETIMEDOUT");
  assert.equal(result.fromCache, false);
  assert.equal(errorLines.filter((l) => l.includes("api.upstream_exception")).length, 1);
});

// ---------------------------------------------------------------------------
// 7. no secret leakage from the telemetry failure
// ---------------------------------------------------------------------------
test("telemetry failure log carries the event and message only — no KV URL, token, or provider payload", async () => {
  const fixture = fixtureSeq;
  const payload = providerJson(fixture);
  scriptFetch(() => fakeResponse({ json: payload, headers: USAGE_HEADERS }));
  kvState.failure = new Error(KV_LIMIT_ERROR);

  await getWithCache("/fixtures/statistics", { fixture }, 900);

  const line = warnLines.find((l) => l.includes("api.usage_telemetry_failed"));
  assert.ok(line, "guard emitted its warning");
  const parsed = JSON.parse(line);
  assert.equal(parsed.level, "warn");
  assert.equal(parsed.endpoint, "/fixtures/statistics");
  assert.equal(parsed.provider, "apisports");
  assert.equal(parsed.error, KV_LIMIT_ERROR);
  for (const forbidden of [FAKE_TOKEN, FAKE_KV_URL, "test-provider-key", "Corner Kicks"]) {
    assert.equal(line.includes(forbidden), false, `log must not contain ${forbidden}`);
  }
  for (const l of [...warnLines, ...errorLines]) {
    assert.equal(l.includes(FAKE_TOKEN), false);
    assert.equal(l.includes(FAKE_KV_URL), false);
  }
});

// ---------------------------------------------------------------------------
// 8. cache-hit path unchanged: no provider call, no usage telemetry
// ---------------------------------------------------------------------------
test("cache hit → served from KV, provider never called, usage telemetry never attempted", async () => {
  const fixture = fixtureSeq;
  const cached = providerJson(fixture);
  kvState.store.set(buildCacheKey("/fixtures/statistics", { fixture }), cached);
  const fetchCalls = scriptFetch(() => fakeResponse({ json: { should: "not be used" } }));

  const result = await getWithCache("/fixtures/statistics", { fixture }, 900);

  assert.equal(result.ok, true);
  assert.equal(result.fromCache, true);
  assert.deepEqual(result.data, cached);
  assert.equal(fetchCalls.length, 0);
  assert.equal(kvState.calls.some(([cmd, key]) => cmd === "set" && key.startsWith("footy_api_usage:")), false);
});

// ---------------------------------------------------------------------------
// 9. cache-miss path unchanged: one provider call, response written to KV at TTL
// ---------------------------------------------------------------------------
test("cache miss → one provider call, payload cached under the canonical key, result marked cached", async () => {
  const fixture = fixtureSeq;
  const payload = providerJson(fixture);
  const fetchCalls = scriptFetch(() => fakeResponse({ json: payload, headers: USAGE_HEADERS }));

  const result = await getWithCache("/fixtures/statistics", { fixture }, 900);

  assert.equal(fetchCalls.length, 1);
  assert.equal(result.cached, true);
  assert.equal(result.cacheKey, buildCacheKey("/fixtures/statistics", { fixture }));
  assert.deepEqual(kvState.store.get(result.cacheKey), payload);
});

test("cache miss with KV down → provider payload still returned; cache write failure is a warning, not a veto", async () => {
  const fixture = fixtureSeq;
  const payload = providerJson(fixture);
  scriptFetch(() => fakeResponse({ json: payload, headers: USAGE_HEADERS }));
  kvState.failure = new Error(KV_LIMIT_ERROR);

  const result = await getWithCache("/fixtures/statistics", { fixture }, 900);

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, payload);
  assert.equal(kvState.store.size, 0, "nothing could be written");
  assert.ok(warnLines.some((l) => l.includes("cache.read_failed")));
  assert.ok(warnLines.some((l) => l.includes("cache.write_failed")));
});

// ---------------------------------------------------------------------------
// Responses without rate-limit headers skip usage telemetry entirely (unchanged)
// ---------------------------------------------------------------------------
test("provider response without rate-limit headers → no usage record, still ok:true", async () => {
  const fixture = fixtureSeq;
  const payload = providerJson(fixture);
  scriptFetch(() => fakeResponse({ json: payload }));

  const result = await getWithCache("/fixtures/statistics", { fixture }, 900);

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, payload);
  // The budget circuit READS the usage key before every upstream call (unchanged);
  // without rate-limit headers there is nothing to WRITE.
  assert.equal(kvState.calls.some(([cmd, key]) => cmd === "set" && key.startsWith("footy_api_usage:")), false);
});
