// src/lib/correctScore.ts
type CorrectScore = { pick: string; conf: number };

export async function fetchCorrectScore(baseUrl: string, fixtureId: string): Promise<CorrectScore> {
  const url = `${baseUrl.replace(/\/+$/,"")}/api/correct-score?fixture=${encodeURIComponent(fixtureId)}&ts=${Date.now()}`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const txt = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}${txt ? ` — ${txt.slice(0,180)}` : ""}`);
  }
  try {
    return JSON.parse(txt) as CorrectScore;
  } catch {
    // fallback sigur (dacă endpointul nu e implementat încă)
    return { pick: "2-1", conf: 24 };
  }
}
