import { createClient } from "@vercel/kv";
import { logError, logWarn } from "./observability/logger.js";
import { recordObservation } from "./observability/metricsStore.js";
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

async function bumpDailyCacheStats({ hit, miss, inflightJoin }) {
  const field = hit ? "hits" : miss ? "misses" : inflightJoin ? "inflightJoins" : null;
  if (!field) return;
  try {
    // Atomic counter — avoids the read-modify-write GET+SET round trip.
    await kv.hincrby(`footy_cache_stats:${getTodayISO()}`, field, 1);
  } catch {
    // non-fatal
  }
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
    const row = (await kv.hgetall(`footy_cache_stats:${dateISO}`)) || {};
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
          attempt = await fetchWith(fallback);
        }
      }

      await recordUsageFromHeaders(attempt.res, attempt.upstreamCfg.provider);

      const json = attempt.json;
      const hasErrors =
        json.errors &&
        ((Array.isArray(json.errors) && json.errors.length > 0) ||
          (!Array.isArray(json.errors) && Object.keys(json.errors).length > 0));
      const apiMs = Date.now() - apiStarted;
      if (!attempt.res.ok || hasErrors) {
        void recordObservation("api", { durationMs: apiMs, ok: false, failureKind: "api" });
        logError("api.upstream_failed", {
          endpoint,
          status: attempt.res.status,
          provider: attempt.upstreamCfg.provider,
          durationMs: apiMs
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
