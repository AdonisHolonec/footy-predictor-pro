// src/lib/fetchJSON.ts
export async function fetchJSON<T = unknown>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` — ${text.slice(0,180)}` : ""}`);
  if (!text) return null as unknown as T;
  try { return JSON.parse(text) as T; } catch { throw new Error("Invalid JSON in response"); }
}
