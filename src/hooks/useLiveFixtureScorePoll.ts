import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import type { PredictionRow } from "../types";
import { isFixtureInPlay } from "../utils/appUtils";
import { fetchWithAuth } from "../utils/apiAuth";

/** Interval between live score polls — keep ≥ server LIVE_SCORES_CACHE_TTL_SEC for cache hits. */
export const LIVE_SCORE_POLL_MS = 75_000;

function isTerminalOrAbandonedStatus(status?: string): boolean {
  const s = String(status ?? "")
    .trim()
    .toUpperCase();
  return ["FT", "AET", "PEN", "CANC", "PST", "ABD", "AWD", "WO"].includes(s);
}

/**
 * Include meciuri în desfășurare și meciuri „NS” încă neactualizate după start (predict vechi),
 * ca `/api/fixtures?view=live` să poată aduce status + goluri.
 */
export function shouldPollFixtureScore(p: PredictionRow): boolean {
  if (p.insufficientData) return false;
  if (isFixtureInPlay(p.status)) return true;
  if (isTerminalOrAbandonedStatus(p.status)) return false;
  const ko = new Date(p.kickoff).getTime();
  if (!Number.isFinite(ko)) return false;
  const now = Date.now();
  const startWindowMs = 10 * 60 * 1000;
  const endWindowMs = 4 * 60 * 60 * 1000;
  if (now < ko - startWindowMs) return false;
  if (now > ko + endWindowMs) return false;
  return true;
}

/** Capped, additive-only live confidence nudge (Sprint 2) — never touches recommended.pick/confidence. */
const MAX_LIVE_CONFIDENCE_DELTA = 5;

type LiveAdjustment = NonNullable<NonNullable<PredictionRow["confidenceEngine"]>["liveAdjustment"]>;

/**
 * Only "1"/"2" picks have a clean home/away momentum mapping — draw/O-U/GG picks
 * are skipped rather than guessed at. Scaled by momentum.confidence so thin live
 * data produces a smaller nudge.
 */
function deriveLiveConfidenceAdjustment(
  pick: string | undefined,
  momentum: PredictionRow["momentum"]
): LiveAdjustment | null {
  if (!momentum) return null;
  const normalizedPick = String(pick || "").trim().toLowerCase();
  if (normalizedPick !== "1" && normalizedPick !== "2") return null;
  const momentumDiff = momentum.homeMomentum - momentum.awayMomentum;
  const alignment = normalizedPick === "1" ? momentumDiff : -momentumDiff;
  const raw = (alignment / 100) * MAX_LIVE_CONFIDENCE_DELTA * (momentum.confidence / 100);
  const delta = Math.max(-MAX_LIVE_CONFIDENCE_DELTA, Math.min(MAX_LIVE_CONFIDENCE_DELTA, Math.round(raw)));
  const reason: LiveAdjustment["reason"] = delta > 1 ? "aligned" : delta < -1 ? "contradicted" : "neutral";
  return { delta, reason };
}

type SetPreds = Dispatch<SetStateAction<PredictionRow[]>>;

type Options = {
  /** When false, no polling (e.g. logged out). Default true. */
  enabled?: boolean;
  /** Override poll interval in ms. */
  intervalMs?: number;
};

/**
 * Periodically merges `status` + `score` (+ referee when available) from `/api/fixtures?view=live`
 * for rows currently in play. Does not re-run the full model — only fixture state from upstream.
 */
export function useLiveFixtureScorePoll(preds: PredictionRow[], setPreds: SetPreds, options?: Options) {
  const enabled = options?.enabled !== false;
  const intervalMs = options?.intervalMs ?? LIVE_SCORE_POLL_MS;
  const liveIdsKey = useMemo(
    () =>
      preds
        .filter((p) => shouldPollFixtureScore(p))
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
        const res = await fetchWithAuth(`/api/fixtures?view=live&ids=${encodeURIComponent(liveIdsKey)}`);
        const json = (await res.json()) as {
          ok?: boolean;
          fixtures?: Array<{
            id: number;
            status: string;
            referee?: string | null;
            firstHalfGoals?: number | null;
            elapsed?: number | null;
            momentum?: {
              homeMomentum: number;
              awayMomentum: number;
              dominantTeam: "home" | "away" | "balanced";
              trend: "up" | "down" | "stable";
              confidence: number;
            } | null;
            score: {
              home: number | null;
              away: number | null;
              halftime?: { home: number; away: number } | null;
            };
          }>;
        };
        if (!json?.ok || !Array.isArray(json.fixtures)) return;
        const map = new Map(json.fixtures.map((f) => [Number(f.id), f]));
        if (!map.size) return;
        setPredsRef.current((prev) =>
          prev.map((p) => {
            const u = map.get(Number(p.id));
            if (!u) return p;
            const nextReferee = String(u.referee || "").trim();
            const ht = u.score?.halftime;
            const htGoals =
              u.firstHalfGoals != null && Number.isFinite(Number(u.firstHalfGoals))
                ? Number(u.firstHalfGoals)
                : ht && Number.isFinite(Number(ht.home)) && Number.isFinite(Number(ht.away))
                  ? Number(ht.home) + Number(ht.away)
                  : null;
            // Engine is stateless per-request; derive a real up/down/stable trend here
            // by diffing against the previous in-memory momentum (no history stored).
            const momentum = u.momentum
              ? p.momentum
                ? (() => {
                    const prevDiff = p.momentum!.homeMomentum - p.momentum!.awayMomentum;
                    const nextDiff = u.momentum!.homeMomentum - u.momentum!.awayMomentum;
                    const delta = nextDiff - prevDiff;
                    const trend: "up" | "down" | "stable" = delta > 3 ? "up" : delta < -3 ? "down" : "stable";
                    return { ...u.momentum!, trend };
                  })()
                : u.momentum
              : null;
            const liveAdjustment = deriveLiveConfidenceAdjustment(p.recommended?.pick, momentum);
            return {
              ...p,
              status: u.status || p.status,
              // Prefer fresh referee once API-Football publishes it (often empty at predict time).
              referee: nextReferee || p.referee,
              score: {
                home: u.score?.home ?? p.score?.home ?? null,
                away: u.score?.away ?? p.score?.away ?? null,
                ...(ht ? { halftime: ht } : p.score?.halftime ? { halftime: p.score.halftime } : {}),
                ...(Number.isFinite(Number(u.elapsed)) ? { minute: Number(u.elapsed) } : p.score?.minute ? { minute: p.score.minute } : {})
              },
              momentum,
              // Additive-only: base confidence/overall/scores are untouched, this only adds liveAdjustment.
              confidenceEngine: p.confidenceEngine ? { ...p.confidenceEngine, liveAdjustment } : p.confidenceEngine,
              marketResults:
                htGoals != null
                  ? {
                      ...(p.marketResults || {}),
                      firstHalfGoals: htGoals
                    }
                  : p.marketResults
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
