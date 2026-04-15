import { useEffect, useState } from "react";
import { getPredictions } from "../lib/api";

export function usePredictionsForFixture(fixtureId: string) {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await getPredictions();
        const one = all.find((x: any) => x.id === fixtureId) ?? null;
        if (!cancelled) setData(one);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e));
      }
    })();
    return () => { cancelled = true; };
  }, [fixtureId]);

  return { data, error };
}
