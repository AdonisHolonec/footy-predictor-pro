import { useEffect, useState } from "react";
import type { MatchVenue } from "../types";

export type KickoffWeather = {
  tempC: number;
  /** WMO weathercode — map to i18n in UI */
  code: number;
};

/** Map WMO code → i18n key suffix under `card.wx.*` */
export function weatherCodeKey(code: number): string {
  if (code === 0) return "card.wxClear";
  if (code <= 3) return "card.wxPartlyCloudy";
  if (code <= 48) return "card.wxFog";
  if (code <= 57) return "card.wxDrizzle";
  if (code <= 67) return "card.wxRain";
  if (code <= 77) return "card.wxSnow";
  if (code <= 82) return "card.wxShowers";
  if (code <= 86) return "card.wxSnowShowers";
  if (code <= 99) return "card.wxThunder";
  return "card.wxMixed";
}

type CacheEntry = { at: number; data: KickoffWeather | null };
const memoryCache = new Map<string, CacheEntry>();
const geoCache = new Map<string, { lat: number; lon: number } | null>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function cacheKey(lat: number, lon: number, kickoffIso: string): string {
  const hour = new Date(kickoffIso).toISOString().slice(0, 13);
  return `${lat.toFixed(2)},${lon.toFixed(2)}@${hour}`;
}

function pickClosestHour(
  times: string[],
  temps: number[],
  codes: number[],
  kickoffIso: string
): KickoffWeather | null {
  if (!times.length || !temps.length) return null;
  const targetMs = new Date(kickoffIso).getTime();
  if (!Number.isFinite(targetMs)) return null;
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(new Date(times[i]).getTime() - targetMs);
    if (d < bestDiff) {
      bestDiff = d;
      bestIdx = i;
    }
  }
  // Reject if closest hour is > 3h away (bad match / out of range).
  if (bestDiff > 3 * 60 * 60 * 1000) return null;
  const tempC = Number(temps[bestIdx]);
  if (!Number.isFinite(tempC)) return null;
  const code = Number(codes[bestIdx]);
  return {
    tempC: Math.round(tempC),
    code: Number.isFinite(code) ? code : 0
  };
}

async function geocodeQuery(query: string): Promise<{ lat: number; lon: number } | null> {
  const q = query.trim();
  if (!q) return null;
  if (geoCache.has(q)) return geoCache.get(q) || null;
  try {
    const url =
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}` +
      `&count=1&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) {
      geoCache.set(q, null);
      return null;
    }
    const json = (await res.json()) as { results?: Array<{ latitude: number; longitude: number }> };
    const hit = json.results?.[0];
    if (!hit || !Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) {
      geoCache.set(q, null);
      return null;
    }
    const coords = { lat: hit.latitude, lon: hit.longitude };
    geoCache.set(q, coords);
    return coords;
  } catch {
    geoCache.set(q, null);
    return null;
  }
}

async function resolveCoords(venue: MatchVenue | undefined): Promise<{ lat: number; lon: number } | null> {
  const lat = Number(venue?.lat);
  const lon = Number(venue?.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };

  const city = venue?.city?.trim() || "";
  const country = venue?.country?.trim() || "";
  const name = venue?.name?.trim() || "";

  const queries = [
    city && country ? `${city}, ${country}` : "",
    city,
    name && country ? `${name}, ${country}` : "",
    name,
    name && city ? `${name}, ${city}` : ""
  ].filter(Boolean);

  for (const q of queries) {
    const geo = await geocodeQuery(q);
    if (geo) return geo;
  }
  return null;
}

async function fetchHourlyTemp(
  lat: number,
  lon: number,
  kickoffIso: string
): Promise<KickoffWeather | null> {
  const kick = new Date(kickoffIso);
  if (!Number.isFinite(kick.getTime())) return null;
  const now = Date.now();
  const msAhead = kick.getTime() - now;
  const daysAhead = msAhead / (24 * 60 * 60 * 1000);

  const parsePayload = async (url: string): Promise<KickoffWeather | null> => {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      hourly?: { time?: string[]; temperature_2m?: number[]; weathercode?: number[] };
    };
    return pickClosestHour(
      json.hourly?.time || [],
      json.hourly?.temperature_2m || [],
      json.hourly?.weathercode || [],
      kickoffIso
    );
  };

  // Past kickoffs → archive API; upcoming → 16-day forecast (covers +2 days selection).
  if (daysAhead < -1) {
    const day = kick.toISOString().slice(0, 10);
    const archiveUrl =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,weathercode&start_date=${day}&end_date=${day}&timezone=auto`;
    return parsePayload(archiveUrl);
  }

  if (daysAhead > 16) return null;

  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,weathercode&forecast_days=16&timezone=auto`;
  const fromForecast = await parsePayload(forecastUrl);
  if (fromForecast) return fromForecast;

  // Fallback: explicit UTC window window (older clients / edge cases).
  const start = kick.toISOString().slice(0, 10);
  const endDate = new Date(kick.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rangedUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,weathercode&start_date=${start}&end_date=${endDate}&timezone=UTC`;
  return parsePayload(rangedUrl);
}

async function resolveWeather(
  venue: MatchVenue | undefined,
  kickoffIso: string
): Promise<KickoffWeather | null> {
  if (!kickoffIso) return null;
  const coords = await resolveCoords(venue);
  if (!coords) return null;

  const key = cacheKey(coords.lat, coords.lon, kickoffIso);
  const cached = memoryCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  try {
    const data = await fetchHourlyTemp(coords.lat, coords.lon, kickoffIso);
    memoryCache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    memoryCache.set(key, { at: Date.now(), data: null });
    return null;
  }
}

/**
 * Kickoff-hour weather via Open-Meteo (no API key).
 * Uses venue lat/lon, or geocodes city / stadium name (+ country).
 */
export function useKickoffWeather(
  venue: MatchVenue | undefined,
  kickoffIso: string | undefined
): { weather: KickoffWeather | null; loading: boolean } {
  const [weather, setWeather] = useState<KickoffWeather | null>(null);
  const [loading, setLoading] = useState(false);

  const lat = venue?.lat;
  const lon = venue?.lon;
  const city = venue?.city;
  const country = venue?.country;
  const name = venue?.name;
  const ko = kickoffIso || "";

  useEffect(() => {
    let cancelled = false;
    const hasPlace =
      (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) ||
      Boolean(city?.trim()) ||
      Boolean(name?.trim());
    if (!ko || !hasPlace) {
      setWeather(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    void resolveWeather(venue, ko).then((data) => {
      if (!cancelled) {
        setWeather(data);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional deps on primitives
  }, [lat, lon, city, country, name, ko]);

  return { weather, loading };
}
