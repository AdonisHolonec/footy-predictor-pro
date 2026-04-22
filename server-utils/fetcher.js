import { createClient } from "@vercel/kv";

const kv = createClient({
  url: process.env.KV_REST_API_URL || process.env.Database_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.Database_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
});

/**
 * Dual-provider auto-detect:
 * - APISPORTS_KEY prezent → foloseşte api-sports.io direct (v3.football.api-sports.io)
 * - altfel → fallback RapidAPI (api-football-v1.p.rapidapi.com/v3)
 *
 * Providerul direct are latenţă mai mică (1 hop mai puţin) şi preţ redus
 * la api-sports.io. Pentru migrarea graduală, ambele sunt suportate.
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

  // niciun key — returnăm config gol, fetch-ul va eşua cu eroare clară
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

function secondsUntilUtcMidnight() {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  const seconds = Math.floor((end.getTime() - now.getTime()) / 1000);
  return Math.max(60, seconds);
}

export async function getWithCache(endpoint, paramsObj, ttlSeconds) {
  const primary = resolveUpstream();
  if (!primary.key) {
    return { ok: false, error: "API key not configured (set APISPORTS_KEY or X_RAPIDAPI_KEY)" };
  }

  const u = new URL(primary.baseUrl + endpoint);
  Object.entries(paramsObj || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const fullUrl = u.toString();
  const cacheKey = `req:${fullUrl}`;

  const cached = await kv.get(cacheKey);
  if (cached) return { ok: true, fromCache: true, data: cached };

  try {
    const fetchWith = async (upstreamCfg) => {
      const res = await fetch(fullUrl, { headers: upstreamCfg.headers });
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

    // Ambii provideri întorc rate-limit headers cu acelaşi nume
    const hLimit =
      attempt.res.headers.get("x-ratelimit-requests-limit") ||
      attempt.res.headers.get("x-ratelimit-limit");
    const hRemain =
      attempt.res.headers.get("x-ratelimit-requests-remaining") ||
      attempt.res.headers.get("x-ratelimit-remaining");
    if (hLimit && hRemain) {
      const limit = Number(hLimit);
      const remainingNow = Number(hRemain);
      if (Number.isFinite(limit) && Number.isFinite(remainingNow)) {
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
          provider: attempt.upstreamCfg.provider
        };
        await kv.set(key, usagePayload, { ex: secondsUntilUtcMidnight() });
        await kv.set(`footy_api_usage_history:${today}`, usagePayload);
      }
    }

    const json = attempt.json;
    const hasErrors =
      json.errors &&
      ((Array.isArray(json.errors) && json.errors.length > 0) ||
        (!Array.isArray(json.errors) && Object.keys(json.errors).length > 0));
    if (!attempt.res.ok || hasErrors) {
      return {
        ok: false,
        error: json.message || json.errors || `API Error ${attempt.res.status}`,
        status: attempt.res.status,
        provider: attempt.upstreamCfg.provider
      };
    }

    await kv.set(cacheKey, json, { ex: ttlSeconds });
    return { ok: true, fromCache: false, data: json };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function getApiUsage(dateISO = getTodayISO()) {
  try {
    const usage =
      (await kv.get(`footy_api_usage_history:${dateISO}`)) ||
      (await kv.get(`footy_api_usage:${dateISO}`));
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
