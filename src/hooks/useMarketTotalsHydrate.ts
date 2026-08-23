import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { PredictionRow } from "../types";
import { isFinalMatchStatus, resolveCardMarketOutcome } from "../utils/cardMarketOutcome";
import { fetchWithAuth } from "../utils/apiAuth";

type SetPreds = Dispatch<SetStateAction<PredictionRow[]>>;

function needsHtGoals(row: PredictionRow): boolean {
  if (!row.probs?.firstHalf) return false;
  if (row.marketResults?.firstHalfGoals != null && Number.isFinite(Number(row.marketResults.firstHalfGoals))) {
    return false;
  }
  const ht = row.score?.halftime;
  if (ht && Number.isFinite(Number(ht.home)) && Number.isFinite(Number(ht.away))) return false;
  return true;
}

function needsMarketTotals(row: PredictionRow): boolean {
  if (!isFinalMatchStatus(row.status)) return false;
  if (row.insufficientData) return false;
  const hasCorners = Boolean(row.probs?.corners);
  const hasShots = Boolean(row.probs?.shotsOnTarget);
  const hasCards = Boolean(row.probs?.cards);
  const cornersOut = resolveCardMarketOutcome("corners", row);
  const shotsOut = resolveCardMarketOutcome("shots", row);
  const cardsOut = resolveCardMarketOutcome("cards", row);
  const cornersPending = hasCorners && cornersOut !== "win" && cornersOut !== "loss";
  const shotsPending = hasShots && shotsOut !== "win" && shotsOut !== "loss";
  // C3: a Cards panel needs cardsTotal exactly like corners needs cornersTotal — same
  // /fixtures?view=xg response, no extra request; nothing is fetched for rows without it.
  const cardsPending = hasCards && cardsOut !== "win" && cardsOut !== "loss";
  const htPending = needsHtGoals(row);
  if (!cornersPending && !shotsPending && !cardsPending && !htPending) return false;
  const missing =
    (cornersPending && row.marketResults?.cornersTotal == null) ||
    (shotsPending && row.marketResults?.shotsOnTargetTotal == null) ||
    (cardsPending && row.marketResults?.cardsTotal == null) ||
    htPending;
  return missing;
}

/**
 * For finished fixtures still pending corners/shots/HT, fetch /fixtures?view=xg
 * and merge marketResults so cards can settle immediately (without waiting for cron).
 */
export function useMarketTotalsHydrate(
  preds: PredictionRow[],
  setPreds: SetPreds,
  options?: {
    enabled?: boolean;
    setPredictionsByUser?: Dispatch<SetStateAction<Record<string, PredictionRow[]>>>;
    userId?: string | null;
  }
) {
  const enabled = options?.enabled !== false;
  const setPredsRef = useRef(setPreds);
  setPredsRef.current = setPreds;
  const setByUserRef = useRef(options?.setPredictionsByUser);
  setByUserRef.current = options?.setPredictionsByUser;
  const userId = options?.userId;
  const inFlight = useRef(new Set<number>());

  useEffect(() => {
    if (!enabled) return;
    const targets = preds.filter(needsMarketTotals).slice(0, 8);
    if (!targets.length) return;

    let cancelled = false;
    const run = async () => {
      for (const row of targets) {
        const id = Number(row.id);
        if (!Number.isFinite(id) || inFlight.current.has(id)) continue;
        inFlight.current.add(id);
        try {
          const res = await fetchWithAuth(`/api/fixtures?view=xg&fixtureId=${id}`);
          const json = (await res.json()) as {
            marketResults?: PredictionRow["marketResults"];
          };
          if (cancelled || !json?.marketResults) continue;
          const mr = json.marketResults;
          const patch = (p: PredictionRow): PredictionRow => {
            if (Number(p.id) !== id) return p;
            return {
              ...p,
              marketResults: {
                ...(p.marketResults || {}),
                ...mr
              }
            };
          };
          setPredsRef.current((prev) => prev.map(patch));
          if (userId && setByUserRef.current) {
            setByUserRef.current((prev) => {
              const list = prev[userId];
              if (!list?.length) return prev;
              return { ...prev, [userId]: list.map(patch) };
            });
          }
        } catch {
          // ignore
        } finally {
          inFlight.current.delete(id);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [enabled, preds, userId]);
}
