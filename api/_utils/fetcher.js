// api/_utils/fetcher.js
import { createClient } from "@vercel/kv";

const kv = createClient({
  url: process.env.KV_REST_API_URL || process.env.Database_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.Database_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const BASE = process.env.UPSTREAM_BASE_URL || "https://api-football-v1.p.rapidapi.com/v3";
const KEY = process.env.X_RAPIDAPI_KEY;
const HOST = process.env.X_RAPIDAPI_HOST || "api-football-v1.p.rapidapi.com";

export async function getWithCache(endpoint, paramsObj, ttlSeconds) {
  const u = new URL(BASE + endpoint);
  Object.entries(paramsObj || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const fullUrl = u.toString();
  
  const cacheKey = `req:${fullUrl}`;

  const cached = await kv.get(cacheKey);
  if (cached) {
    return { ok: true, fromCache: true, data: cached };
  }

  try {
    const res = await fetch(fullUrl, {
      headers: { "X-RapidAPI-Key": KEY, "X-RapidAPI-Host": HOST }
    });
    
    // --- 🥷 SUPER NINJA TRICK ---
    // Prindem absolut orice variantă de header pe care ne-o poate trimite RapidAPI
    const hLimit = res.headers.get('x-ratelimit-requests-limit') || res.headers.get('x-ratelimit-limit');
    const hRemain = res.headers.get('x-ratelimit-requests-remaining') || res.headers.get('x-ratelimit-remaining');
    
    console.log(`[RapidAPI Headers] Endpoint: ${endpoint} | Limit: ${hLimit} | Remain: ${hRemain}`);

    // Dacă am găsit headerele, calculăm consumul și-l ascundem în baza de date!
    if (hLimit && hRemain) {
        const limit = Number(hLimit);
        const count = limit - Number(hRemain);
        await kv.set('footy_api_usage', { count, limit });
        console.log(`[Usage Salvat] Consumat: ${count} din ${limit}`);
    }

    const json = await res.json();
    const hasErrors = json.errors && ((Array.isArray(json.errors) && json.errors.length > 0) || (!Array.isArray(json.errors) && Object.keys(json.errors).length > 0));

    if (!res.ok || hasErrors) {
      return { ok: false, error: json.message || json.errors || "API Error" };
    }

    await kv.set(cacheKey, json, { ex: ttlSeconds });
    return { ok: true, fromCache: false, data: json };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Funcție pe care o vom chema liniștiți să ne dea ultimul consum știut
export async function getApiUsage() {
    try {
        const usage = await kv.get('footy_api_usage');
        return usage || { count: 0, limit: 100 };
    } catch {
        return { count: 0, limit: 100 };
    }
}