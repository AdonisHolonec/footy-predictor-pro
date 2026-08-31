import { createClient } from "@vercel/kv";
import { logError, logWarn } from "./observability/logger.js";
import { bumpCacheStat, bumpCounter, cacheStatsKey, recordObservation } from "./observability/metricsStore.js";
export { recordObservation };

const kv = createClient({
  url: process.env.KV_REST_API_URL || process.env.Database_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.Database_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
});
/** Shared KV client — other server-utils modules (e.g. momentum narration caching) reuse this single connection instead of opening their own. */
export { kv };

/** In-process dedupe: concurrent identical upstream requests share one fetch. */
const inflight = new Map();

/** Process-local counters (reset on cold start — still useful for request diagnostics). */
const localCacheStats = { hits: 0, misses: 0, inflightJoins: 0, upstream: 0 };

/**
 * Per-upstream-call timings, so a slow Predict can say WHICH call was slow.
 *
 * A monotonic sequence rather than a diff of running totals: a caller records
 * the cursor before its work and asks for the samples added since, which keeps
 * max/p95 meaningful instead of unrecoverable from two snapshots.
 *
 * Bounded ring — a warm lambda serves many requests and this must never grow.
 * MEASUREMENT ONLY: nothing here alters the fetch, its headers, its cache key,
 * its TTL or its error handling.
 *
 * Known limitation, deliberately accepted rather than papered over: this is
 * module scope, so if two requests run concurrently in the same instance their
 * samples interleave. `localCacheStats` already has exactly this property and
 * Stage12 already reports it. Predict runs are rare enough that the attribution
 * is still worth having; anything finer needs AsyncLocalStorage plumbing that
 * this phase is not authorised to add.
 */
const UPSTREAM_SAMPLE_CAP = 300;
const upstreamSamples = [];
let upstreamSeq = 0;

/** @returns {number} Opaque cursor to pass to upstreamSamplesSince(). */
export function upstreamCursor() {
  return upstreamSeq;
}

/**
 * @param {number} cursor
 * @returns {Array<{seq:number, endpoint:string, ms:number, ok:boolean}>}
 */
export function upstreamSamplesSince(cursor) {
  const from = Number(cursor);
  if (!Number.isFinite(from)) return [];
  return upstreamSamples.filter((s) => s.seq > from);
}

/*
  Provider error telemetry.

  API-Football answers some failures with HTTP 200 and a populated `errors`
  object rather than an error status — a plan restriction, a per-minute limit
  and a bad parameter all arrive as 200. `getWithCache` already treats that as a
  failure (see hasErrors below), but the log line carried only endpoint/status/
  duration, so a 200-with-errors was indistinguishable from any other failure
  and the actual reason was unrecoverable after the fact.

  These helpers put the reason in the log and nothing else: bounded, string-only,
  with token-shaped material removed. The provider response body, the request
  URL and the credential headers are never touched.
*/
const PROVIDER_ERROR_MAX_ENTRIES = 5;
const PROVIDER_ERROR_MAX_LENGTH = 200;

/** Token-shaped material that must never reach a log line. */
const SECRET_PATTERNS = [
  // JWTs.
  { re: /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, to: "[REDACTED]" },
  // Long opaque runs: provider keys are 32+ chars of hex or base64url.
  { re: /[A-Za-z0-9_-]{32,}/g, to: "[REDACTED]" },
  // key/token/secret followed by its value, in any common separator style.
  { re: /((?:api[-_ ]?key|apikey|token|secret|password|authorization)\s*[:=]\s*)(\S+)/gi, to: "$1[REDACTED]" }
];

function redactSecrets(text) {
  let out = text;
  for (const { re, to } of SECRET_PATTERNS) out = out.replace(re, to);
  return out;
}

function clipText(value) {
  const text = redactSecrets(String(value == null ? "" : value)).trim();
  return text.length > PROVIDER_ERROR_MAX_LENGTH ? `${text.slice(0, PROVIDER_ERROR_MAX_LENGTH)}...` : text;
}

/**
 * A provider `errors` payload reduced to safe, bounded log fields.
 *
 * Never serialises the object itself: a non-string entry contributes only its
 * own `message`/`reason`/`error` string, or the placeholder "[object]".
 *
 * @param {unknown} errors provider `errors` (array, object map, or string)
 * @returns {{providerErrorCount:number, errorKeys:string[], errorMessages:string[], errorsTruncated:boolean}}
 */
export function sanitizeProviderErrors(errors) {
  let entries = [];
  if (Array.isArray(errors)) entries = errors.map((v) => ["", v]);
  else if (errors && typeof errors === "object") entries = Object.entries(errors);
  else if (typeof errors === "string" && errors.trim()) entries = [["", errors]];

  const kept = entries.slice(0, PROVIDER_ERROR_MAX_ENTRIES);
  const errorKeys = [];
  const errorMessages = [];
  for (const [key, value] of kept) {
    if (key) errorKeys.push(clipText(key));
    const text =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : String(value?.message ?? value?.reason ?? value?.error ?? "[object]");
    errorMessages.push(clipText(text));
  }
  return {
    providerErrorCount: entries.length,
    errorKeys,
    errorMessages,
    errorsTruncated: entries.length > kept.length
  };
}

function recordUpstreamTiming(endpoint, ms, ok) {
  const duration = Number(ms);
  if (!Number.isFinite(duration) || duration < 0) return;
  upstreamSeq += 1;
  upstreamSamples.push({ seq: upstreamSeq, endpoint: String(endpoint || "?"), ms: duration, ok: ok !== false });
  if (upstreamSamples.length > UPSTREAM_SAMPLE_CAP) upstreamSamples.shift();
}

/**
 * Dual-provider auto-detect:
 * - APISPORTS_KEY prezent → foloseşte api-sports.io direct (v3.football.api-sports.io)
 * - altfel → fallback RapidAPI (api-football-v1.p.rapidapi.com/v3)
 */
function resolveUpstream() {
  const explicit = process.env.UPSTREAM_BASE_URL;
  const apiSportsKey = process.env.APISPORTS_KEY;
  const rapidKey = process.env.X_RAPIDAPI_KEY || process.env.APIFOOTBALL_KEY;

  if (apiSportsKey) {
    return {
      provider: "apisports",
      baseUrl: explicit || "https://v3.football.api-sports.io",
      headers: {
        "x-apisports-key": apiSportsKey
      },
      key: apiSportsKey
    };
  }

  if (rapidKey) {
    return {
      provider: "rapidapi",
      baseUrl: explicit || "https://api-football-v1.p.rapidapi.com/v3",
      headers: {
        "X-RapidAPI-Key": rapidKey,
        "X-RapidAPI-Host": process.env.X_RAPIDAPI_HOST || "api-football-v1.p.rapidapi.com"
      },
      key: rapidKey
    };
  }

  return {
    provider: "none",
    baseUrl: explicit || "https://v3.football.api-sports.io",
    headers: {},
    key: null
  };
}

export function getUpstreamProvider() {
  return resolveUpstream().provider;
}

function resolveFallbackUpstream(primaryProvider) {
  const explicit = process.env.UPSTREAM_BASE_URL;
  const apiSportsKey = process.env.APISPORTS_KEY;
  const rapidKey = process.env.X_RAPIDAPI_KEY || process.env.APIFOOTBALL_KEY;
  if (primaryProvider === "apisports" && rapidKey) {
    return {
      provider: "rapidapi",
      baseUrl: explicit || "https://api-football-v1.p.rapidapi.com/v3",
      headers: {
        "X-RapidAPI-Key": rapidKey,
        "X-RapidAPI-Host": process.env.X_RAPIDAPI_HOST || "api-football-v1.p.rapidapi.com"
      },
      key: rapidKey
    };
  }
  if (primaryProvider === "rapidapi" && apiSportsKey) {
    return {
      provider: "apisports",
      baseUrl: explicit || "https://v3.football.api-sports.io",
      headers: {
        "x-apisports-key": apiSportsKey
      },
      key: apiSportsKey
    };
  }
  return null;
}

function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getDateISOWithOffset(daysOffset = 0) {
  const now = new Date();
  const shifted = new Date(now.getTime() + daysOffset * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}


/**
 * Provider-agnostic cache key so api-sports and RapidAPI share the same entries.
 * Params are sorted for stable keys regardless of object key order.
 */
export function buildCacheKey(endpoint, paramsObj = {}) {
  const ep = String(endpoint || "").startsWith("/") ? String(endpoint) : `/${endpoint}`;
  const entries = Object.entries(paramsObj || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [String(k), String(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return qs ? `req:v2:${ep}?${qs}` : `req:v2:${ep}`;
}

function buildFetchUrl(baseUrl, endpoint, paramsObj = {}) {
  const u = new URL(baseUrl + endpoint);
  Object.entries(paramsObj || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  return u.toString();
}

async function recordUsageFromHeaders(res, provider) {
  const hLimit = res.headers.get("x-ratelimit-requests-limit") || res.headers.get("x-ratelimit-limit");
  const hRemain = res.headers.get("x-ratelimit-requests-remaining") || res.headers.get("x-ratelimit-remaining");
  if (!(hLimit && hRemain)) return;
  const limit = Number(hLimit);
  const remainingNow = Number(hRemain);
  if (!(Number.isFinite(limit) && Number.isFinite(remainingNow))) return;

  const today = getTodayISO();
  const key = `footy_api_usage:${today}`;
  const existing = await kv.get(key);
  const baselineRemaining = Number(existing?.baselineRemaining);
  const resolvedBaseline = Number.isFinite(baselineRemaining) ? baselineRemaining : remainingNow;
  const count = Math.max(0, resolvedBaseline - remainingNow);
  const usagePayload = {
    count,
    limit,
    baselineRemaining: resolvedBaseline,
    currentRemaining: remainingNow,
    updatedAt: new Date().toISOString(),
    provider
  };
  // Single durable key per day (date is already in the key) — no midnight TTL,
  // no separate history copy needed.
  await kv.set(key, usagePayload);
}

/**
 * recordUsageFromHeaders behind a boundary that cannot throw.
 *
 * Same shape as the cache.read_failed / cache.write_failed guards in
 * getWithCache: the failure is observed (counter + structured warn), the
 * provider result is untouched. Only the event name and the error message go to
 * the log — never the KV URL, token or the provider payload.
 *
 * @returns {Promise<boolean>} true when telemetry was recorded, false when it
 *   failed — diagnostic only; getWithCache does not branch on it.
 */
async function recordUsageTelemetry(res, provider, endpoint) {
  try {
    await recordUsageFromHeaders(res, provider);
    return true;
  } catch (err) {
    void recordObservation("cache", { durationMs: 0, ok: false, failureKind: "cache" });
    logWarn("api.usage_telemetry_failed", { endpoint, provider, error: err?.message || "kv_usage_write" });
    return false;
  }
}

async function bumpDailyCacheStats({ hit, miss, inflightJoin }) {
  const field = hit ? "hits" : miss ? "misses" : inflightJoin ? "inflightJoins" : null;
  if (!field) return;
  // Buffered per invocation and summed at the boundary (see bumpCacheStat).
  // It was already a single atomic HINCRBY, but one per cache lookup: the cost
  // was the call COUNT, not the command shape.
  await bumpCacheStat(field);
}

export function getLocalCacheStats() {
  const total = localCacheStats.hits + localCacheStats.misses;
  return {
    ...localCacheStats,
    hitRatio: total > 0 ? Number((localCacheStats.hits / total).toFixed(4)) : null
  };
}

export async function getDailyCacheStats(dateISO = getTodayISO()) {
  try {
    const row = (await kv.hgetall(cacheStatsKey(dateISO))) || {};
    const hits = Number(row.hits || 0);
    const misses = Number(row.misses || 0);
    const total = hits + misses;
    return {
      date: dateISO,
      hits,
      misses,
      inflightJoins: Number(row.inflightJoins || 0),
      hitRatio: total > 0 ? Number((hits / total).toFixed(4)) : null,
      // Per-field HINCRBY has no single "last write" timestamp; not tracked.
      updatedAt: null
    };
  } catch {
    return { date: dateISO, hits: 0, misses: 0, inflightJoins: 0, hitRatio: null, updatedAt: null };
  }
}

export async function getWithCache(endpoint, paramsObj, ttlSeconds, options = {}) {
  const primary = resolveUpstream();
  if (!primary.key) {
    return { ok: false, error: "Cheia API nu este configurată (setează APISPORTS_KEY sau X_RAPIDAPI_KEY)." };
  }

  const cacheKey = buildCacheKey(endpoint, paramsObj);
  const fetchUrl = buildFetchUrl(primary.baseUrl, endpoint, paramsObj);
  const shouldCacheFn = typeof options?.shouldCache === "function" ? options.shouldCache : null;

  try {
    const cacheStarted = Date.now();
    const cached = await kv.get(cacheKey);
    const cacheMs = Date.now() - cacheStarted;
    if (cached) {
      localCacheStats.hits += 1;
      void bumpDailyCacheStats({ hit: true });
      void recordObservation("cache", { durationMs: cacheMs, ok: true });
      return { ok: true, fromCache: true, data: cached, cacheKey, cacheMs };
    }
    void recordObservation("cache", { durationMs: cacheMs, ok: true });
  } catch (err) {
    void recordObservation("cache", { durationMs: 0, ok: false, failureKind: "cache" });
    logWarn("cache.read_failed", { endpoint, error: err?.message || "kv_read" });
    // KV read failure → proceed to network
  }

  // C10 global hard stop: serve cache only; never burn remaining upstream quota.
  try {
    const { classifyApiBudget } = await import("./apiBudgetCircuit.js");
    const budget = classifyApiBudget(await getApiUsage());
    if (budget.hardStop) {
      logWarn("api.budget_hard_stop", {
        endpoint,
        pct: budget.pct,
        remaining: budget.remaining,
        limit: budget.limit
      });
      return {
        ok: false,
        error: "Circuit breaker: bugetul zilnic API-Football este epuizat. Folosim doar cache/DB.",
        reason: "api_budget_hard_stop",
        fromCache: false,
        circuit: budget
      };
    }
  } catch {
    // fail-open on classifier/KV errors so predict can still run
  }

  if (inflight.has(cacheKey)) {
    localCacheStats.inflightJoins += 1;
    void bumpDailyCacheStats({ inflightJoin: true });
    return inflight.get(cacheKey);
  }

  const promise = (async () => {
    localCacheStats.misses += 1;
    localCacheStats.upstream += 1;
    void bumpDailyCacheStats({ miss: true });
    const apiStarted = Date.now();

    try {
      const fetchWith = async (upstreamCfg) => {
        const url =
          upstreamCfg.provider === primary.provider
            ? fetchUrl
            : buildFetchUrl(upstreamCfg.baseUrl, endpoint, paramsObj);
        const res = await fetch(url, { headers: upstreamCfg.headers });
        const json = await res.json().catch(() => ({}));
        return { res, json, upstreamCfg };
      };

      let attempt = await fetchWith(primary);

      const messageRaw = String(attempt.json?.message || "").toLowerCase();
      const errorsRaw = String(
        typeof attempt.json?.errors === "string" ? attempt.json.errors : JSON.stringify(attempt.json?.errors || {})
      ).toLowerCase();
      const notSubscribed = messageRaw.includes("not subscribed") || errorsRaw.includes("not subscribed");
      if ((!attempt.res.ok || notSubscribed) && notSubscribed) {
        const fallback = resolveFallbackUpstream(primary.provider);
        if (fallback?.key) {
          // S2: the one retry path this client has. Counting it makes "retry count"
          // observable; the retry behaviour itself is unchanged.
          void bumpCounter("api_upstream_fallback");
          attempt = await fetchWith(fallback);
        }
      }

      // Usage telemetry is bookkeeping about the response, never a verdict on it.
      // It runs in its own boundary because a KV failure here (the 2026-08-18
      // Upstash request cap: "ERR max requests limit exceeded") used to surface
      // through the catch below and turn an already-successful provider response
      // into ok:false — which is how /fixtures/statistics stopped hydrating
      // marketResults and Corners/Shots ticket legs stayed pending.
      await recordUsageTelemetry(attempt.res, attempt.upstreamCfg.provider, endpoint);

      const json = attempt.json;
      const hasErrors =
        json.errors &&
        ((Array.isArray(json.errors) && json.errors.length > 0) ||
          (!Array.isArray(json.errors) && Object.keys(json.errors).length > 0));
      const apiMs = Date.now() - apiStarted;
      if (!attempt.res.ok || hasErrors) {
        void recordObservation("api", { durationMs: apiMs, ok: false, failureKind: "api" });
        recordUpstreamTiming(endpoint, apiMs, false);
        const providerErrors = sanitizeProviderErrors(json.errors);
        logError("api.upstream_failed", {
          endpoint,
          status: attempt.res.status,
          provider: attempt.upstreamCfg.provider,
          durationMs: apiMs,
          // A 200 here means the provider signalled the failure in the body.
          httpOk: attempt.res.ok,
          providerMessage: typeof json.message === "string" && json.message ? clipText(json.message) : undefined,
          ...providerErrors
        });
        return {
          ok: false,
          error: json.message || json.errors || `Eroare API ${attempt.res.status}`,
          status: attempt.res.status,
          provider: attempt.upstreamCfg.provider,
          fromCache: false,
          apiMs
        };
      }

      const ttl = Math.max(30, Number(ttlSeconds) || 300);
      const allowCache = shouldCacheFn ? Boolean(shouldCacheFn(json)) : true;
      if (allowCache) {
        try {
          const writeStarted = Date.now();
          await kv.set(cacheKey, json, { ex: ttl });
          void recordObservation("cache", { durationMs: Date.now() - writeStarted, ok: true });
        } catch (writeErr) {
          void recordObservation("cache", { durationMs: 0, ok: false, failureKind: "cache" });
          logWarn("cache.write_failed", { endpoint, error: writeErr?.message || "kv_write" });
        }
      }

      void recordObservation("api", { durationMs: apiMs, ok: true });
      recordUpstreamTiming(endpoint, apiMs, true);
      return {
        ok: true,
        fromCache: false,
        data: json,
        cacheKey,
        provider: attempt.upstreamCfg.provider,
        apiMs,
        cached: allowCache
      };
    } catch (err) {
      const apiMs = Date.now() - apiStarted;
      void recordObservation("api", { durationMs: apiMs, ok: false, failureKind: "api" });
      recordUpstreamTiming(endpoint, apiMs, false);
      logError("api.upstream_exception", { endpoint, error: err.message, durationMs: apiMs });
      return { ok: false, error: err.message, fromCache: false, apiMs };
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

export async function getApiUsage(dateISO = getTodayISO()) {
  try {
    const usage = await kv.get(`footy_api_usage:${dateISO}`);
    if (!usage) return { date: dateISO, count: 0, limit: 100, updatedAt: null };
    return {
      date: dateISO,
      count: Number(usage.count) || 0,
      limit: Number(usage.limit) || 100,
      updatedAt: usage.updatedAt || null,
      provider: usage.provider || null
    };
  } catch {
    return { date: dateISO, count: 0, limit: 100, updatedAt: null };
  }
}

export async function getApiUsageHistory(days = 7) {
  const safeDays = Math.max(1, Math.min(Number(days) || 7, 60));
  const rows = [];
  for (let i = 0; i < safeDays; i++) {
    const dateISO = getDateISOWithOffset(-i);
    const usage = await getApiUsage(dateISO);
    rows.push(usage);
  }
  return rows;
}
