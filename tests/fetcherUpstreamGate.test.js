import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * RELIABILITY-005 — the upstream gate as wired into the REAL getWithCache.
 *
 * Drives getWithCache against a scripted KV and a scripted fetch. Gate timings are
 * shrunk through the environment (read once, when fetcher.js is imported) so the
 * wall-clock assertions stay fast; each bound carries a small tolerance.
 *
 * Runs with --experimental-test-module-mocks: @vercel/kv is replaced before the
 * fetcher module is loaded, because the client is created at module scope.
 */

const MIN_INTERVAL_MS = 40;
const COOLDOWN_MS = 120;
const TOLERANCE_MS = 8;

const kvStore = new Map();
const fakeKv = {
  async get(key) {
    return kvStore.has(key) ? kvStore.get(key) : null;
  },
  async set(key, value) {
    kvStore.set(key, value);
    return "OK";
  },
  async hincrby() {
    return 1;
  },
  async hgetall() {
    return {};
  },
  async incr() {
    return 1;
  },
  async expire() {
    return 1;
  }
};

mock.module("@vercel/kv", { namedExports: { createClient: () => fakeKv } });

process.env.APISPORTS_KEY = "test-provider-key";
process.env.KV_REST_API_URL = "https://gate-test.upstash.io";
process.env.KV_REST_API_TOKEN = "gate-test-token";
process.env.API_UPSTREAM_MIN_INTERVAL_MS = String(MIN_INTERVAL_MS);
process.env.API_UPSTREAM_MAX_CONCURRENCY = "2";
process.env.API_UPSTREAM_RATE_LIMIT_COOLDOWN_MS = String(COOLDOWN_MS);
process.env.API_UPSTREAM_MAX_WAIT_MS = "5000";

const { getWithCache, buildCacheKey, getUpstreamGateStats } = await import("../server-utils/fetcher.js");

const RATE_LIMITED = {
  get: "fixtures/lineups",
  errors: { rateLimit: "Too many requests. You have exceeded the limit of requests per minute of your subscription." },
  response: []
};
/** What a successful response reported at the time of the 2026-09-11 rejections. */
const HEADERS_AT_REJECTION = {
  "x-ratelimit-requests-limit": "7500",
  "x-ratelimit-requests-remaining": "6767",
  "x-ratelimit-limit": "300",
  "x-ratelimit-remaining": "143"
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeResponse({ ok = true, status = 200, json, headers = {} }) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok,
    status,
    headers: { get: (name) => h.get(String(name).toLowerCase()) ?? null },
    json: async () => json
  };
}

const okPayload = (fixture) => ({ get: "fixtures", errors: [], results: 1, response: [{ fixture: { id: fixture } }] });

let fixtureSeq = 700000;
const nextFixture = () => ++fixtureSeq;
let warnLines;
let errorLines;

const warnEvents = (event) =>
  warnLines.filter((l) => l.includes(`"${event}"`)).map((l) => JSON.parse(l));

beforeEach(async () => {
  kvStore.clear();
  warnLines = [];
  errorLines = [];
  mock.method(console, "warn", (line) => warnLines.push(String(line)));
  mock.method(console, "error", (line) => errorLines.push(String(line)));
  // Let any pause opened by the previous test run out, so each test starts idle.
  await sleep(COOLDOWN_MS + MIN_INTERVAL_MS);
});

afterEach(() => {
  mock.restoreAll();
});

/** Scripted fetch: `responder(url, startIndex)`; records each call's start time. */
function scriptFetch(responder) {
  const starts = [];
  mock.method(globalThis, "fetch", async (url) => {
    starts.push({ url: String(url), at: Date.now() });
    return responder(String(url), starts.length - 1);
  });
  return starts;
}

test("provider rate limit → one pause, one retry after it, and the retried payload is returned", async () => {
  const fixture = nextFixture();
  const good = okPayload(fixture);
  const starts = scriptFetch((url, i) =>
    i === 0 ? fakeResponse({ json: RATE_LIMITED, headers: HEADERS_AT_REJECTION }) : fakeResponse({ json: good })
  );

  const result = await getWithCache("/fixtures/lineups", { fixture }, 300);

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, good);
  assert.equal(starts.length, 2, "exactly one retry — never a loop");
  const gap = starts[1].at - starts[0].at;
  assert.ok(gap >= COOLDOWN_MS - TOLERANCE_MS, `the retry waited for the pause (${gap}ms)`);
  const cooldown = warnEvents("api.rate_limit_cooldown");
  assert.equal(cooldown.length, 1);
  assert.equal(cooldown[0].endpoint, "/fixtures/lineups");
  assert.equal(cooldown[0].cooldownMs, COOLDOWN_MS);
  // Section-12 diagnostic: what the REJECTED response itself said, numbers only.
  assert.equal(cooldown[0].headerMinuteLimit, 300);
  assert.equal(cooldown[0].headerMinuteRemaining, 143);
  assert.equal(cooldown[0].headerDailyRemaining, 6767);
  assert.equal(errorLines.some((l) => l.includes("api.upstream_failed")), false, "a recovered request is not a failure");
  assert.equal(kvStore.get(buildCacheKey("/fixtures/lineups", { fixture }))?.response?.[0]?.fixture?.id, fixture);
});

test("rate limited twice → the existing failure result, after exactly two provider calls", async () => {
  const fixture = nextFixture();
  const starts = scriptFetch(() => fakeResponse({ json: RATE_LIMITED }));

  const result = await getWithCache("/fixtures", { fixture }, 300);

  assert.equal(result.ok, false);
  assert.equal(result.status, 200);
  assert.deepEqual(result.error, RATE_LIMITED.errors);
  assert.equal(starts.length, 2, "one retry, then give up");
  const failed = errorLines.filter((l) => l.includes("api.upstream_failed")).map((l) => JSON.parse(l));
  assert.equal(failed.length, 1);
  assert.deepEqual(failed[0].errorKeys, ["rateLimit"]);
  assert.equal(failed[0].retriedAfterRateLimit, true);
  assert.equal(kvStore.has(buildCacheKey("/fixtures", { fixture })), false, "a rejection is never cached");
  // A rejected headers-less response reports its absence explicitly (null), never a guess.
  const cooldown = warnEvents("api.rate_limit_cooldown");
  assert.equal(cooldown[0].headerMinuteRemaining, null);
});

test("the DAILY quota error is never retried and opens no pause", async () => {
  const fixture = nextFixture();
  const starts = scriptFetch(() =>
    fakeResponse({ json: { errors: { requests: "You have reached the request limit for the day" }, response: [] } })
  );

  const result = await getWithCache("/fixtures", { fixture }, 300);

  assert.equal(result.ok, false);
  assert.equal(starts.length, 1);
  assert.equal(warnEvents("api.rate_limit_cooldown").length, 0);
});

test("fan-out is paced and capped: never more than 2 in flight, starts at least minIntervalMs apart", async () => {
  let inFlight = 0;
  let peak = 0;
  const starts = scriptFetch(async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await sleep(30);
    inFlight -= 1;
    return fakeResponse({ json: okPayload(1) });
  });

  // The shape of moduleInputs' Promise.all: five distinct reads at once.
  const results = await Promise.all(
    Array.from({ length: 5 }, () => getWithCache("/fixtures", { fixture: nextFixture() }, 300))
  );

  assert.ok(results.every((r) => r.ok), "pacing delays requests; it does not drop them");
  assert.equal(starts.length, 5);
  assert.ok(peak <= 2, `peak in-flight was ${peak}`);
  const times = starts.map((s) => s.at).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] - times[i - 1] >= MIN_INTERVAL_MS - TOLERANCE_MS, `start ${i} came ${times[i] - times[i - 1]}ms after the previous`);
  }
});

test("a rate limit on one endpoint also holds back requests to other endpoints", async () => {
  const lineupsFixture = nextFixture();
  const otherFixture = nextFixture();
  const starts = scriptFetch((url, i) =>
    url.includes("/fixtures/lineups") && i === 0 ? fakeResponse({ json: RATE_LIMITED }) : fakeResponse({ json: okPayload(1) })
  );

  const first = getWithCache("/fixtures/lineups", { fixture: lineupsFixture }, 300);
  await sleep(5);
  const second = getWithCache("/injuries", { fixture: otherFixture }, 300);
  await Promise.all([first, second]);

  const rejectedAt = starts.find((s) => s.url.includes("/fixtures/lineups")).at;
  const injuriesAt = starts.find((s) => s.url.includes("/injuries")).at;
  assert.ok(injuriesAt - rejectedAt >= COOLDOWN_MS - TOLERANCE_MS, `the other endpoint waited ${injuriesAt - rejectedAt}ms`);
});

test("cache hits bypass the gate entirely, even during a pause", async () => {
  const cachedFixture = nextFixture();
  const cached = okPayload(cachedFixture);
  kvStore.set(buildCacheKey("/fixtures", { fixture: cachedFixture }), cached);
  scriptFetch(() => fakeResponse({ json: RATE_LIMITED }));

  const pending = getWithCache("/fixtures/lineups", { fixture: nextFixture() }, 300);
  await sleep(10);
  const started = Date.now();
  const hit = await getWithCache("/fixtures", { fixture: cachedFixture }, 300);
  const elapsed = Date.now() - started;
  await pending;

  assert.equal(hit.fromCache, true);
  assert.deepEqual(hit.data, cached);
  assert.ok(elapsed < COOLDOWN_MS / 2, `a cache hit waited ${elapsed}ms`);
});

test("identical concurrent reads still collapse to one provider call", async () => {
  const fixture = nextFixture();
  const starts = scriptFetch(async () => {
    await sleep(20);
    return fakeResponse({ json: okPayload(fixture) });
  });

  const [a, b] = await Promise.all([
    getWithCache("/fixtures", { fixture }, 300),
    getWithCache("/fixtures", { fixture }, 300)
  ]);

  assert.equal(starts.length, 1);
  assert.deepEqual(a.data, b.data);
});

test("gate statistics are exposed for diagnostics", async () => {
  const stats = getUpstreamGateStats();
  assert.equal(stats.config.minIntervalMs, MIN_INTERVAL_MS);
  assert.equal(stats.config.maxConcurrency, 2);
  assert.ok(stats.admitted > 0);
  assert.ok(stats.rateLimited >= 3);
  assert.ok(stats.rateLimitRetries >= 2);
  assert.ok(stats.rateLimitRetrySuccesses >= 1);
  assert.equal(stats.inFlight, 0);
});
