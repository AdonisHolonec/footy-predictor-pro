// src/lib/api.ts
const API_BASE = import.meta.env.VITE_API_BASE || "/api";

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${path} :: ${text}`);
  }
  return r.json();
}

export function apiHello() {
  return getJson<{ ok: boolean }>(`/hello`);
}

export function apiEnvOk() {
  return getJson<any>(`/env-ok`);
}

export function apiUsage() {
  return getJson<{ ok: boolean; usage: { date: string; count: number; limit: number } }>(`/cache/usage`);
}

export function apiWarm(date: string, leagueIds: number[]) {
  const qs = new URLSearchParams({
    date,
    leagueIds: leagueIds.join(","),
  });
  return getJson<any>(`/warm?${qs.toString()}`);
}

export function apiPredict(date: string, leagueIds: number[], limit = 20) {
  const qs = new URLSearchParams({
    date,
    leagueIds: leagueIds.join(","),
    limit: String(limit),
  });
  return getJson<any>(`/predict?${qs.toString()}`);
}
