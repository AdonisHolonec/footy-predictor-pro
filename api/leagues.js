// api/leagues.js — list leagues via API-FOOTBALL (RapidAPI) + cache Vercel KV
import { kv } from "@vercel/kv";

const BASE = process.env.UPSTREAM_BASE_URL || "https://api-football-v1.p.rapidapi.com/v3";
const KEY  = process.env.X_RAPIDAPI_KEY;
const HOST = process.env.X_RAPIDAPI_HOST || "api-football-v1.p.rapidapi.com";
const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || "7000");

// Normalize string: lowercase, remove diacritics, trim
function norm(s = "") {
  return s.toLowerCase()
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .trim();
}

// Fetch wrapper cu timeout și try/catch
async function rapid(path) {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), TIMEOUT);

  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        "X-RapidAPI-Key": KEY,
        "X-RapidAPI-Host": HOST,
        "Accept": "application/json",
      },
      cache: "no-store",
      signal: ctl.signal,
    });

    const text = await res.text();

    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 180)}`);

    const json = JSON.parse(text);
    return json.response || [];

  } catch (err) {
    console.error("RapidAPI fetch error:", err);
    return [];
  } finally {
    clearTimeout(id);
  }
}

// Main handler
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=60"); // Edge cache 10min

  if (!KEY) {
    return res.status(200).json({ error: "API key missing", data: [] });
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const countryQ = norm(url.searchParams.get("country") || "");
    const nameQ    = norm(url.searchParams.get("name") || "");

    const cacheKey = "leagues:all";
    let rows = await kv.get(cacheKey);

    if (!rows) {
      rows = await rapid("/leagues");
      if (rows.length > 0) {
        await kv.set(cacheKey, rows, { ex: 60 * 60 * 24 }); // 24h
      }
    }

    let out = rows.map(x => ({
      league_id: String(x.league?.id || ""),
      league_name: x.league?.name || "",
      country_name: x.country?.name || "",
    }));

    if (countryQ) out = out.filter(x => norm(x.country_name).includes(countryQ));
    if (nameQ)    out = out.filter(x => norm(x.league_name).includes(nameQ));

    return res.status(200).json({ error: null, data: out });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Unexpected error", data: [] });
  }
}