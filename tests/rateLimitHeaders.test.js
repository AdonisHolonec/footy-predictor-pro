import test from "node:test";
import assert from "node:assert/strict";

/**
 * RELIABILITY-001 / P1-A — the two provider quotas must stay distinct.
 *
 * INCIDENT-002 traced the 2026-09-11 rate-limit incident to a single `||` in
 * `recordUsageFromHeaders`:
 *
 *     x-ratelimit-requests-limit || x-ratelimit-limit
 *
 * The first pair is the DAILY quota, the second the PER-MINUTE quota. API-Football
 * always sends the daily headers, so the fallback never fires and the per-minute
 * value — the one that was actually exhausted — is discarded on every response.
 *
 * These tests pin the parser only. They assert no throttling, no budget and no
 * request behaviour, because P1-A deliberately adds none of those.
 */

const { RATE_LIMIT_HEADERS, parseRateLimitHeaders, rateLimitTelemetryFields } = await import(
  "../server-utils/observability/rateLimitHeaders.js"
);

/** Minimal `Headers` double: case-insensitive `.get`, like the real one. */
function headers(map) {
  const lower = new Map(Object.entries(map || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    get(name) {
      const v = lower.get(String(name).toLowerCase());
      return v === undefined ? null : v;
    }
  };
}

test("header names are the documented ones and are not guessed", () => {
  assert.equal(RATE_LIMIT_HEADERS.dailyLimit, "x-ratelimit-requests-limit");
  assert.equal(RATE_LIMIT_HEADERS.dailyRemaining, "x-ratelimit-requests-remaining");
  assert.equal(RATE_LIMIT_HEADERS.minuteLimit, "x-ratelimit-limit");
  assert.equal(RATE_LIMIT_HEADERS.minuteRemaining, "x-ratelimit-remaining");
});

test("A — daily and minute headers together stay distinct", () => {
  const parsed = parseRateLimitHeaders(
    headers({
      "x-ratelimit-requests-limit": "7500",
      "x-ratelimit-requests-remaining": "6750",
      "x-ratelimit-limit": "300",
      "x-ratelimit-remaining": "12"
    })
  );
  assert.deepEqual(parsed.daily, { limit: 7500, remaining: 6750 });
  assert.deepEqual(parsed.minute, { limit: 300, remaining: 12 });
  assert.equal(parsed.hasDaily, true);
  assert.equal(parsed.hasMinute, true);
  // The whole point: the minute figures are NOT the daily ones.
  assert.notEqual(parsed.minute.limit, parsed.daily.limit);
  assert.notEqual(parsed.minute.remaining, parsed.daily.remaining);
});

test("B — only daily headers: minute stays null, never defaulted to daily", () => {
  const parsed = parseRateLimitHeaders(
    headers({ "x-ratelimit-requests-limit": "7500", "x-ratelimit-requests-remaining": "6750" })
  );
  assert.deepEqual(parsed.daily, { limit: 7500, remaining: 6750 });
  assert.deepEqual(parsed.minute, { limit: null, remaining: null });
  assert.equal(parsed.hasMinute, false);
});

test("C — only minute headers: daily stays null, never borrowed from minute", () => {
  const parsed = parseRateLimitHeaders(headers({ "x-ratelimit-limit": "300", "x-ratelimit-remaining": "299" }));
  assert.deepEqual(parsed.minute, { limit: 300, remaining: 299 });
  assert.deepEqual(parsed.daily, { limit: null, remaining: null });
  assert.equal(parsed.hasDaily, false);
});

test("D — all headers missing: nulls, no throw, nothing persisted", () => {
  const parsed = parseRateLimitHeaders(headers({}));
  assert.deepEqual(parsed.daily, { limit: null, remaining: null });
  assert.deepEqual(parsed.minute, { limit: null, remaining: null });
  assert.equal(parsed.reset, null);
  assert.equal(parsed.retryAfter, null);
  assert.deepEqual(rateLimitTelemetryFields(parsed), {});
});

test("E — rate-limit response: minute exhausted is representable as 0, not null", () => {
  const parsed = parseRateLimitHeaders(
    headers({
      "x-ratelimit-requests-limit": "7500",
      "x-ratelimit-requests-remaining": "5001",
      "x-ratelimit-limit": "300",
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": "37",
      "retry-after": "37"
    })
  );
  // 0 must survive: a falsy-but-present remaining is exactly the exhausted case.
  assert.equal(parsed.minute.remaining, 0);
  assert.equal(parsed.minute.limit, 300);
  assert.equal(parsed.reset, 37);
  assert.equal(parsed.retryAfter, 37);
  assert.equal(parsed.hasMinute, true);
  // Daily still has plenty left — which is why the daily circuit never tripped.
  assert.equal(parsed.daily.remaining, 5001);
});

test("absent values are omitted from telemetry rather than written as null", () => {
  const parsed = parseRateLimitHeaders(headers({ "x-ratelimit-limit": "300", "x-ratelimit-remaining": "7" }));
  const fields = rateLimitTelemetryFields(parsed);
  assert.equal(fields.minuteLimit, 300);
  assert.equal(fields.minuteRemaining, 7);
  assert.ok(!("dailyLimit" in fields), "absent daily limit must not be written");
  assert.ok(!("dailyRemaining" in fields), "absent daily remaining must not be written");
  assert.ok(!("retryAfter" in fields), "absent retry-after must not be written");
  assert.equal(typeof fields.rateLimitObservedAt, "string");
});

test("non-numeric, empty and whitespace header values become null, never NaN", () => {
  const parsed = parseRateLimitHeaders(
    headers({
      "x-ratelimit-requests-limit": "not-a-number",
      "x-ratelimit-requests-remaining": "",
      "x-ratelimit-limit": "   ",
      "x-ratelimit-remaining": "42"
    })
  );
  assert.equal(parsed.daily.limit, null);
  assert.equal(parsed.daily.remaining, null);
  assert.equal(parsed.minute.limit, null);
  assert.equal(parsed.minute.remaining, 42);
  for (const v of Object.values(rateLimitTelemetryFields(parsed))) {
    assert.ok(!Number.isNaN(v), "NaN must never reach telemetry");
  }
});

test("a header store that throws cannot break an already-delivered response", () => {
  const hostile = {
    get() {
      throw new Error("header store exploded");
    }
  };
  const parsed = parseRateLimitHeaders(hostile);
  assert.deepEqual(parsed.daily, { limit: null, remaining: null });
  assert.deepEqual(parsed.minute, { limit: null, remaining: null });
  assert.deepEqual(rateLimitTelemetryFields(parsed), {});
});

test("a missing or malformed headers object is tolerated", () => {
  for (const input of [null, undefined, {}, { get: null }]) {
    const parsed = parseRateLimitHeaders(input);
    assert.equal(parsed.hasDaily, false);
    assert.equal(parsed.hasMinute, false);
  }
});

test("telemetry carries no secrets and no provider response body", () => {
  const fields = rateLimitTelemetryFields(
    parseRateLimitHeaders(headers({ "x-ratelimit-limit": "300", "x-ratelimit-remaining": "0" }))
  );
  const serialized = JSON.stringify(fields);
  for (const forbidden of ["apikey", "api_key", "authorization", "bearer", "token", "x-rapidapi-key"]) {
    assert.ok(!serialized.toLowerCase().includes(forbidden), `telemetry must not carry ${forbidden}`);
  }
  // Only numbers plus the ISO observation timestamp.
  for (const [key, value] of Object.entries(fields)) {
    if (key === "rateLimitObservedAt") continue;
    assert.equal(typeof value, "number", `${key} must be numeric`);
  }
});
