import { createClient } from "@vercel/kv";

const kv = createClient({
  url: process.env.KV_REST_API_URL || process.env.Database_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.Database_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const BASE = process.env.UPSTREAM_BASE_URL || "https://api-football-v1.p.rapidapi.com/v3";
const KEY = process.env.X_RAPIDAPI_KEY;
const HOST = process.env.X_RAPIDAPI_HOST || "api-football-v1.p.rapidapi.com";

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
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0
  ));
  const seconds = Math.floor((end.getTime() - now.getTime()) / 1000);
  return Math.max(60, seconds);
}

export async function getWithCache(endpoint, paramsObj, ttlSeconds) {
  const u = new URL(BASE + endpoint);
  Object.entries(paramsObj || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const fullUrl = u.toString();
  const cacheKey = `req:${fullUrl}`;

  const cached = await kv.get(cacheKey);
  if (cached) return { ok: true, fromCache: true, data: cached };

  try {
    const res = await fetch(fullUrl, {
      headers: { "X-RapidAPI-Key": KEY, "X-RapidAPI-Host": HOST }
    });

    const hLimit = res.headers.get("x-ratelimit-requests-limit") || res.headers.get("x-ratelimit-limit");
    const hRemain = res.headers.get("x-ratelimit-requests-remaining") || res.headers.get("x-ratelimit-remaining");

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
          updatedAt: new Date().toISOString()
        };
        await kv.set(key, usagePayload, { ex: secondsUntilUtcMidnight() });
        await kv.set(`footy_api_usage_history:${today}`, usagePayload);
      }
    }

    const json = await res.json();
    const hasErrors = json.errors && ((Array.isArray(json.errors) && json.errors.length > 0) || (!Array.isArray(json.errors) && Object.keys(json.errors).length > 0));
    if (!res.ok || hasErrors) return { ok: false, error: json.message || json.errors || "API Error" };

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
      updatedAt: usage.updatedAt || null
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
