import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Provider error telemetry.
 *
 * API-Football answers some failures with HTTP 200 and a populated `errors`
 * object — a plan restriction, a per-minute limit and a bad parameter all
 * arrive as 200. `getWithCache` already treated that as a failure, but the
 * `api.upstream_failed` log line carried only endpoint/status/duration, so the
 * reason was unrecoverable afterwards (production audit, 2026-08-31: 6 such
 * failures in 437 calls, cause unknowable from the logs).
 *
 * These tests drive the REAL getWithCache against a scripted KV and a scripted
 * fetch — the same pattern as fetcherUsageTelemetry.test.js — so the log line
 * and the RETURN VALUE are both observed. The return-value assertions are what
 * prove this change is telemetry-only.
 *
 * Runs with --experimental-test-module-mocks: @vercel/kv is replaced before the
 * fetcher module loads, because the client is created at module scope.
 */

const kvState = { store: new Map() };
const fakeKv = {
  async get(key) {
    return kvState.store.has(key) ? kvState.store.get(key) : null;
  },
  async set(key, value) {
    kvState.store.set(key, value);
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
process.env.KV_REST_API_URL = "https://kvhost.upstash.io";
process.env.KV_REST_API_TOKEN = "test-kv-token";

const { getWithCache, sanitizeProviderErrors } = await import("../server-utils/fetcher.js");

function fakeResponse({ ok = true, status = 200, json, headers = {} }) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok,
    status,
    headers: { get: (name) => h.get(String(name).toLowerCase()) ?? null },
    json: async () => json
  };
}

let fixtureSeq = 700000;
let errorLines;

beforeEach(() => {
  kvState.store.clear();
  fixtureSeq += 1;
  errorLines = [];
  mock.method(console, "error", (line) => errorLines.push(String(line)));
  mock.method(console, "warn", () => {});
  mock.method(console, "log", () => {});
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

/** The single api.upstream_failed line, parsed. */
function upstreamFailure() {
  const line = errorLines.find((l) => l.includes("api.upstream_failed"));
  return line ? JSON.parse(line) : null;
}

// ---------------------------------------------------------------------------
// 1. HTTP 200 + empty errors -> success, no failure telemetry
// ---------------------------------------------------------------------------
test("HTTP 200 with empty errors succeeds and logs no failure", async () => {
  const payload = { get: "fixtures", errors: [], results: 1, response: [{ fixture: { id: 1 } }] };
  const calls = scriptFetch(() => fakeResponse({ json: payload }));

  const result = await getWithCache("/fixtures", { fixture: fixtureSeq }, 300);

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, payload);
  assert.equal(calls.length, 1);
  assert.equal(upstreamFailure(), null, "a healthy response must not log api.upstream_failed");
});

// ---------------------------------------------------------------------------
// 2. HTTP 200 + provider errors -> failure telemetry carries the reason
// ---------------------------------------------------------------------------
test("HTTP 200 with provider errors logs the sanitized reason and preserves the return shape", async () => {
  const payload = {
    get: "fixtures/lineups",
    errors: { requests: "You have reached the request limit for the day" },
    response: []
  };
  scriptFetch(() => fakeResponse({ json: payload, status: 200, ok: true }));

  const result = await getWithCache("/fixtures/lineups", { fixture: fixtureSeq }, 300);

  // Behaviour preserved: still a failure, still the same fields.
  assert.equal(result.ok, false);
  assert.equal(result.status, 200);
  assert.equal(result.fromCache, false);
  assert.equal(result.provider, "apisports");

  const log = upstreamFailure();
  assert.ok(log, "a 200-with-errors must log api.upstream_failed");
  assert.equal(log.endpoint, "/fixtures/lineups");
  assert.equal(log.status, 200);
  assert.equal(log.httpOk, true, "httpOk distinguishes a body-signalled failure from an HTTP failure");
  assert.equal(log.providerErrorCount, 1);
  assert.deepEqual(log.errorKeys, ["requests"]);
  assert.deepEqual(log.errorMessages, ["You have reached the request limit for the day"]);
});

// ---------------------------------------------------------------------------
// 3 & 4. transport failures keep their status
// ---------------------------------------------------------------------------
test("HTTP 429 preserves the status in telemetry and in the return value", async () => {
  scriptFetch(() => fakeResponse({ ok: false, status: 429, json: { message: "Too Many Requests" } }));

  const result = await getWithCache("/fixtures", { fixture: fixtureSeq }, 300);

  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  const log = upstreamFailure();
  assert.equal(log.status, 429);
  assert.equal(log.httpOk, false);
  assert.equal(log.providerMessage, "Too Many Requests");
});

test("HTTP 500 preserves the status in telemetry", async () => {
  scriptFetch(() => fakeResponse({ ok: false, status: 500, json: {} }));

  const result = await getWithCache("/fixtures", { fixture: fixtureSeq }, 300);

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  const log = upstreamFailure();
  assert.equal(log.status, 500);
  assert.equal(log.providerErrorCount, 0);
});

// ---------------------------------------------------------------------------
// 5 & 6. bounded and redacted
// ---------------------------------------------------------------------------
test("a long provider message is truncated in the log line", async () => {
  const prose = "the provider rejected this request because the parameter set is invalid ".repeat(8);
  scriptFetch(() => fakeResponse({ json: { errors: { detail: prose } } }));

  await getWithCache("/fixtures", { fixture: fixtureSeq }, 300);

  const log = upstreamFailure();
  assert.ok(prose.length > 400, "the fixture really is long");
  assert.ok(log.errorMessages[0].length <= 210, `bounded, got ${log.errorMessages[0].length}`);
  assert.ok(log.errorMessages[0].endsWith("..."), "truncation is marked");
});

test("token-shaped material never reaches the log line", async () => {
  const KEY = "abcdef0123456789abcdef0123456789abcdef01";
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJlLXg";
  scriptFetch(() =>
    fakeResponse({
      json: { errors: { token: KEY, auth: `bearer ${JWT} rejected`, plan: "bad api_key=SUPERSECRETVALUE123" } }
    })
  );

  await getWithCache("/fixtures", { fixture: fixtureSeq }, 300);

  const raw = errorLines.find((l) => l.includes("api.upstream_failed"));
  assert.ok(!raw.includes(KEY), "an API-key-shaped value must not be logged");
  assert.ok(!raw.includes(JWT), "a JWT must not be logged");
  assert.ok(!raw.includes("SUPERSECRETVALUE123"), "a key=value secret must not be logged");
  assert.ok(raw.includes("[REDACTED]"), "redaction is visible rather than silent");
  // The diagnostic keys survive — that is the whole point of the change.
  const log = JSON.parse(raw);
  assert.deepEqual(log.errorKeys, ["token", "auth", "plan"]);
});

test("the provider key never appears in a log line even though it is sent as a header", async () => {
  scriptFetch(() => fakeResponse({ json: { errors: { plan: "not allowed" } } }));

  await getWithCache("/fixtures", { fixture: fixtureSeq }, 300);

  assert.ok(
    !errorLines.some((l) => l.includes("test-provider-key")),
    "the credential is a request header and must never be logged"
  );
});

// ---------------------------------------------------------------------------
// 7. no behaviour change on the healthy path
// ---------------------------------------------------------------------------
test("a successful response is cached and served from cache exactly as before", async () => {
  const payload = { get: "fixtures", errors: [], results: 1, response: [{ fixture: { id: 2 } }] };
  const calls = scriptFetch(() => fakeResponse({ json: payload }));

  const first = await getWithCache("/fixtures", { fixture: fixtureSeq }, 300);
  const second = await getWithCache("/fixtures", { fixture: fixtureSeq }, 300);

  assert.equal(first.ok, true);
  assert.equal(first.fromCache, false);
  assert.equal(second.ok, true);
  assert.equal(second.fromCache, true, "second call is served from KV, so the cache path is unchanged");
  assert.equal(calls.length, 1, "the provider is called exactly once");
  assert.equal(upstreamFailure(), null);
});

test("a failed response is NOT cached — the failure path still short-circuits before kv.set", async () => {
  const calls = scriptFetch(() => fakeResponse({ json: { errors: { plan: "not allowed" } } }));

  await getWithCache("/fixtures", { fixture: fixtureSeq }, 300);
  await getWithCache("/fixtures", { fixture: fixtureSeq }, 300);

  assert.equal(calls.length, 2, "a failure must not be cached");
});

// ---------------------------------------------------------------------------
// 8. endpoint attribution
// ---------------------------------------------------------------------------
test("the endpoint label is the stable normalized path, never the credentialed URL", async () => {
  scriptFetch(() => fakeResponse({ json: { errors: { plan: "not allowed" } } }));

  await getWithCache("/fixtures/statistics", { fixture: fixtureSeq }, 300);

  const log = upstreamFailure();
  assert.equal(log.endpoint, "/fixtures/statistics");
  assert.ok(!log.endpoint.includes("?"), "no query string, so no parameters can leak through it");
  assert.ok(!log.endpoint.startsWith("http"), "not the full request URL");
  assert.equal(log.provider, "apisports");
});

// ---------------------------------------------------------------------------
// sanitizeProviderErrors as a unit — shapes getWithCache cannot easily produce
// ---------------------------------------------------------------------------
test("sanitizeProviderErrors handles every provider payload shape safely", () => {
  assert.deepEqual(sanitizeProviderErrors([]), {
    providerErrorCount: 0,
    errorKeys: [],
    errorMessages: [],
    errorsTruncated: false
  });
  assert.equal(sanitizeProviderErrors(null).providerErrorCount, 0);
  assert.deepEqual(sanitizeProviderErrors("single failure").errorMessages, ["single failure"]);
  assert.deepEqual(sanitizeProviderErrors(["a", "b"]).errorMessages, ["a", "b"]);

  // Objects contribute a known string field only — never a serialization.
  const nested = sanitizeProviderErrors([{ message: "m" }, { reason: "r" }, { unknown: 1 }]);
  assert.deepEqual(nested.errorMessages, ["m", "r", "[object]"]);

  // Entry cap, with the real total still reported.
  const many = sanitizeProviderErrors({ a: "1", b: "2", c: "3", d: "4", e: "5", f: "6" });
  assert.equal(many.providerErrorCount, 6);
  assert.equal(many.errorMessages.length, 5);
  assert.equal(many.errorsTruncated, true);
});

test("sanitizeProviderErrors never emits a serialized object", () => {
  const r = sanitizeProviderErrors([{ nested: { deep: { secret: "value" } } }]);
  assert.deepEqual(r.errorMessages, ["[object]"]);
  assert.ok(!JSON.stringify(r).includes("deep"), "no nested structure is serialized");
});
