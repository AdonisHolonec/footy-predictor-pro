/**
 * RELIABILITY-001 / P1-A — provider rate-limit headers, parsed WITHOUT conflating
 * the two quotas API-Football enforces.
 *
 * `recordUsageFromHeaders` reads
 *
 *     x-ratelimit-requests-limit || x-ratelimit-limit
 *
 * and the `||` is the defect INCIDENT-002 identified: the first pair is the DAILY
 * quota, the second is the PER-MINUTE quota. API-Football always sends the daily
 * headers, so the fallback never fires and the per-minute values — the ones that
 * were actually being exceeded during the 2026-09-11 incident (71 rateLimit lines,
 * 67 of 300 calls rejected) — arrive on every response and are discarded.
 *
 * This module only READS headers. It applies no policy: no throttling, no queueing,
 * no retry, no budget. Making the numbers observable is a precondition for choosing
 * a real RPM budget later; it is not that budget.
 *
 * Header names are the two pairs already present in fetcher.js plus `x-ratelimit-reset`
 * and `retry-after`. Nothing here is guessed: an absent header yields null rather than
 * a default, so a name that never arrives simply stays null and is never persisted.
 */

/** Header names, kept as data so the test can assert the exact strings. */
export const RATE_LIMIT_HEADERS = Object.freeze({
  dailyLimit: "x-ratelimit-requests-limit",
  dailyRemaining: "x-ratelimit-requests-remaining",
  minuteLimit: "x-ratelimit-limit",
  minuteRemaining: "x-ratelimit-remaining",
  reset: "x-ratelimit-reset",
  retryAfter: "retry-after"
});

/**
 * Read one header from anything with a `.get()` (a `Headers`, or a test double).
 * A header store that throws must never break a provider response that already
 * arrived, so every read is guarded — the same principle `recordUsageTelemetry`
 * applies one level up.
 */
function readHeader(headers, name) {
  try {
    if (!headers || typeof headers.get !== "function") return null;
    const raw = headers.get(name);
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim();
    return text === "" ? null : text;
  } catch {
    return null;
  }
}

/** A header value as a finite number, or null. Never NaN, never a coerced 0. */
function numeric(headers, name) {
  const raw = readHeader(headers, name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse both quotas separately.
 *
 * @param {{ get?: (name: string) => string | null }} headers
 * @returns {{
 *   daily: { limit: number | null, remaining: number | null },
 *   minute: { limit: number | null, remaining: number | null },
 *   reset: number | null,
 *   retryAfter: number | null,
 *   hasDaily: boolean,
 *   hasMinute: boolean
 * }}
 */
export function parseRateLimitHeaders(headers) {
  const daily = {
    limit: numeric(headers, RATE_LIMIT_HEADERS.dailyLimit),
    remaining: numeric(headers, RATE_LIMIT_HEADERS.dailyRemaining)
  };
  const minute = {
    limit: numeric(headers, RATE_LIMIT_HEADERS.minuteLimit),
    remaining: numeric(headers, RATE_LIMIT_HEADERS.minuteRemaining)
  };
  return {
    daily,
    minute,
    reset: numeric(headers, RATE_LIMIT_HEADERS.reset),
    retryAfter: numeric(headers, RATE_LIMIT_HEADERS.retryAfter),
    hasDaily: daily.limit !== null || daily.remaining !== null,
    hasMinute: minute.limit !== null || minute.remaining !== null
  };
}

/**
 * The subset worth persisting alongside the existing daily usage row.
 *
 * Returns only keys whose value is actually present, so merging this into the
 * existing `usagePayload` can ADD fields but can never overwrite a known daily
 * value with a null. The daily `count` / `limit` / `baselineRemaining` arithmetic
 * in `recordUsageFromHeaders` is untouched and is NOT recomputed here.
 *
 * @returns {Record<string, number|string>} possibly empty
 */
export function rateLimitTelemetryFields(parsed) {
  const out = {};
  if (!parsed) return out;
  const put = (key, value) => {
    if (value !== null && value !== undefined) out[key] = value;
  };
  put("minuteLimit", parsed.minute?.limit);
  put("minuteRemaining", parsed.minute?.remaining);
  put("dailyLimit", parsed.daily?.limit);
  put("dailyRemaining", parsed.daily?.remaining);
  put("rateLimitReset", parsed.reset);
  put("retryAfter", parsed.retryAfter);
  if (Object.keys(out).length > 0) out.rateLimitObservedAt = new Date().toISOString();
  return out;
}

export default { RATE_LIMIT_HEADERS, parseRateLimitHeaders, rateLimitTelemetryFields };
