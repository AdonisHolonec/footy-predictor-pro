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
const CACHE_TTL_MS = 30 * 60 * 1000;

function cacheKey(lat: number, lon: number, kickoffIso: string): string {
  const hour = new Date(kickoffIso).toISOString().slice(0, 13);
  return `${lat.toFixed(2)},${lon.toFixed(2)}@${hour}`;
}

async function geocodeCity(city: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { results?: Array<{ latitude: number; longitude: number }> };
  const hit = json.results?.[0];
  if (!hit || !Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) return null;
  return { lat: hit.latitude, lon: hit.longitude };
}

async function fetchHourlyTemp(
  lat: number,
  lon: number,
  kickoffIso: string
): Promise<KickoffWeather | null> {
  const kick = new Date(kickoffIso);
  if (!Number.isFinite(kick.getTime())) return null;
  const start = kick.toISOString().slice(0, 10);
  const endDate = new Date(kick.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,weathercode&start_date=${start}&end_date=${endDate}&timezone=UTC`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    hourly?: { time?: string[]; temperature_2m?: number[]; weathercode?: number[] };
  };
  const times = json.hourly?.time || [];
  const temps = json.hourly?.temperature_2m || [];
  const codes = json.hourly?.weathercode || [];
  if (!times.length || !temps.length) return null;

  const targetMs = kick.getTime();
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(new Date(times[i]).getTime() - targetMs);
    if (d < bestDiff) {
      bestDiff = d;
      bestIdx = i;
    }
  }
  const tempC = Number(temps[bestIdx]);
  if (!Number.isFinite(tempC)) return null;
  const code = Number(codes[bestIdx]);
  return {
    tempC: Math.round(tempC),
    code: Number.isFinite(code) ? code : 0
  };
}

async function resolveWeather(
  venue: MatchVenue | undefined,
  kickoffIso: string
): Promise<KickoffWeather | null> {
  if (!kickoffIso) return null;
  let lat = Number(venue?.lat);
  let lon = Number(venue?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const city = venue?.city?.trim();
    if (!city) return null;
    const geo = await geocodeCity(city);
    if (!geo) return null;
    lat = geo.lat;
    lon = geo.lon;
  }

  const key = cacheKey(lat, lon, kickoffIso);
  const cached = memoryCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  try {
    const data = await fetchHourlyTemp(lat, lon, kickoffIso);
    memoryCache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    memoryCache.set(key, { at: Date.now(), data: null });
    return null;
  }
}

/**
 * Kickoff-hour weather via Open-Meteo (no API key).
 * Uses venue lat/lon, or geocodes venue.city when coords are missing.
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
  const ko = kickoffIso || "";

  useEffect(() => {
    let cancelled = false;
    if (!ko || (!Number.isFinite(Number(lat)) && !Number.isFinite(Number(lon)) && !city?.trim())) {
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
  }, [lat, lon, city, ko]);

  return { weather, loading };
}
