import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import type { PredictionRow } from "../types";
import { isFixtureInPlay } from "../utils/appUtils";

/** Interval between live score polls when at least one fixture is in play (API + UX balance). */
export const LIVE_SCORE_POLL_MS = 45_000;

type SetPreds = Dispatch<SetStateAction<PredictionRow[]>>;

type Options = {
  /** When false, no polling (e.g. logged out). Default true. */
  enabled?: boolean;
  /** Override poll interval in ms. */
  intervalMs?: number;
};

/**
 * Periodically merges `status` + `score` from `/api/fixtures/live-scores` for rows currently in play.
 * Does not re-run the full model — only fixture state from the upstream API.
 */
export function useLiveFixtureScorePoll(preds: PredictionRow[], setPreds: SetPreds, options?: Options) {
  const enabled = options?.enabled !== false;
  const intervalMs = options?.intervalMs ?? LIVE_SCORE_POLL_MS;
  const liveIdsKey = useMemo(
    () =>
      preds
        .filter((p) => isFixtureInPlay(p.status))
        .map((p) => p.id)
        .filter((id) => Number.isFinite(Number(id)))
        .sort((a, b) => Number(a) - Number(b))
        .join(","),
    [preds]
  );
  const setPredsRef = useRef(setPreds);
  setPredsRef.current = setPreds;

  useEffect(() => {
    if (!enabled || !liveIdsKey) return;

    const fetchAndMerge = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/fixtures/live-scores?ids=${encodeURIComponent(liveIdsKey)}`);
        const json = (await res.json()) as {
          ok?: boolean;
          fixtures?: Array<{ id: number; status: string; score: { home: number | null; away: number | null } }>;
        };
        if (!json?.ok || !Array.isArray(json.fixtures)) return;
        const map = new Map(json.fixtures.map((f) => [Number(f.id), f]));
        if (!map.size) return;
        setPredsRef.current((prev) =>
          prev.map((p) => {
            const u = map.get(Number(p.id));
            if (!u) return p;
            return {
              ...p,
              status: u.status || p.status,
              score: {
                home: u.score?.home ?? p.score?.home ?? null,
                away: u.score?.away ?? p.score?.away ?? null
              }
            };
          })
        );
      } catch {
        // ignore transient network errors
      }
    };

    void fetchAndMerge();
    const id = window.setInterval(() => void fetchAndMerge(), intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") void fetchAndMerge();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, liveIdsKey, intervalMs]);
}
