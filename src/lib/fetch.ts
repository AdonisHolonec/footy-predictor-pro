// src/lib/fetch.ts
export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, init);
  const txt = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}${txt ? ` — ${txt.slice(0,180)}` : ""}`);
  return txt;
}
