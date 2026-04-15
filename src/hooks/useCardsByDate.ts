import { useEffect, useState } from "react";

export function useCardsByDate(fetchUrl: string, dateISO: string) {
  const [data, setData] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${fetchUrl}?date=${encodeURIComponent(dateISO)}&ts=${Date.now()}`, {
          headers: { Accept: "application/json" }, cache: "no-store"
        });
        const txt = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${txt.slice(0,180)}`);
        const json = txt ? JSON.parse(txt) : [];
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e));
      }
    })();
    return () => { cancelled = true; };
  }, [fetchUrl, dateISO]);

  return { data, error };
}
