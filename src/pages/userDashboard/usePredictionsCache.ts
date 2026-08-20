import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useLocale } from "../../context/LocaleContext";
import type { useAuth } from "../../hooks/useAuth";
import type { HistoryEntry, PredictionRow } from "../../types";
import {
  isoToday,
  kickoffLocalDateKey,
  mergePredictionRows,
  mergePredsWithHistory,
  normalizeSelectedDates,
  useLocalStorageState
} from "../../utils/appUtils";
import { isFinalMatchStatus } from "../../utils/cardMarketOutcome";
import { hasLegacyPredictionShape } from "./helpers";

type AuthUser = ReturnType<typeof useAuth>["user"];

/**
 * Cache-ul de predicții per user + rehidratarea lui, mutate verbatim din
 * UserDashboard: persistența localStorage, curățarea la schimbarea contului,
 * filtrarea pe date/ligi cu carry-forward pentru datele live, merge-ul cu
 * istoricul, rehidratarea la schimbarea de tier și golirea la promovare.
 */
export function usePredictionsCache({
  user,
  userTier,
  accessToken,
  date,
  selectedDates,
  setSelectedDates,
  selectedLeagueIds,
  history,
  setStatus
}: {
  user: AuthUser;
  userTier: string;
  accessToken: string | undefined;
  date: string;
  selectedDates: string[];
  setSelectedDates: Dispatch<SetStateAction<string[]>>;
  selectedLeagueIds: number[];
  history: HistoryEntry[];
  setStatus: (message: string) => void;
}) {
  const { t } = useLocale();
  const [predictionsByUser, setPredictionsByUser] = useLocalStorageState<Record<string, PredictionRow[]>>("footy.user.predictionsByUser", {});
  const [, setUserPredictionMap] = useLocalStorageState<Record<string, number[]>>("footy.user.predictionMap", {});
  const [preds, setPreds] = useState<PredictionRow[]>([]);
  const [rehydratedNotice, setRehydratedNotice] = useState<string | null>(null);
  /** Distinguishes a genuine account switch (clear cached predictions) from a same-user refresh/session-restore (keep them). */
  const previousUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    const isDifferentUser = previousUserIdRef.current !== null && previousUserIdRef.current !== user.id;
    previousUserIdRef.current = user.id;
    if (!isDifferentUser) return;
    setPredictionsByUser((prev) => {
      const next = { ...prev };
      delete next[user.id];
      return next;
    });
    setSelectedDates([isoToday()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- verbatim din UserDashboard
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const localPredictions = predictionsByUser[user.id] || [];
    if (!localPredictions.length) {
      setPreds([]);
      return;
    }

    const effectiveDates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
    const selectedDateSet = new Set(effectiveDates);
    const selectedLeagueSet = new Set(selectedLeagueIds.map((id) => Number(id)));
    const filtered = localPredictions.filter((row) => {
      const kickoffDate = kickoffLocalDateKey(row.kickoff);
      if (!selectedDateSet.has(kickoffDate)) return false;
      /* Until favorite leagues hydrate, keep date-matched rows visible. */
      if (!selectedLeagueSet.size) return true;
      return selectedLeagueSet.has(Number(row.leagueId));
    });
    // predictionsByUser never receives live poll data (score/momentum/liveAdjustment)
    // — it lives only in-memory on `preds`. Re-filtering from the cache on every
    // predictionsByUser change (history sync, xg hydrate, tier promotion, etc.)
    // would otherwise silently discard it mid-match. Carry it forward unless the
    // cache shows the match freshly settled (then trust the settled snapshot).
    setPreds((prevPreds) => {
      const prevById = new Map(prevPreds.map((p) => [Number(p.id), p]));
      return filtered.map((row) => {
        const prev = prevById.get(Number(row.id));
        if (!prev) return row;
        if (isFinalMatchStatus(row.status) && !isFinalMatchStatus(prev.status)) return row;
        return {
          ...row,
          status: prev.status || row.status,
          score: prev.score ?? row.score,
          momentum: prev.momentum ?? row.momentum,
          confidenceEngine: row.confidenceEngine
            ? { ...row.confidenceEngine, liveAdjustment: prev.confidenceEngine?.liveAdjustment ?? row.confidenceEngine?.liveAdjustment }
            : row.confidenceEngine
        };
      });
    });
    if (hasLegacyPredictionShape(localPredictions, userTier) && filtered.length) {
      setRehydratedNotice(t("dash.legacyNotice"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- verbatim din UserDashboard
  }, [user?.id, userTier, predictionsByUser, selectedLeagueIds.join("|"), selectedDates.join("|"), date]);

  useEffect(() => {
    if (!user?.id || !history.length) return;
    setPredictionsByUser((prev) => {
      const rows = prev[user.id];
      if (!rows?.length) return prev;
      const merged = mergePredsWithHistory(rows, history);
      if (merged === rows) return prev;
      return { ...prev, [user.id]: merged };
    });
  }, [history, user?.id, setPredictionsByUser]);

  async function runHydration(): Promise<PredictionRow[]> {
    try {
      if (!user?.id || !accessToken) return [];
      const response = await fetch("/api/history?days=14&limit=1000&mine=1", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const json = await response.json();
      if (!response.ok || !json?.ok || !Array.isArray(json.items)) return [];
      /** Doar răspuns user-scoped (join user_prediction_fixtures); refuză istoric global dacă lipsește flag. */
      if (json.mine !== true) return [];

      const effectiveDates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
      const selectedDateSet = new Set(effectiveDates);
      const selectedLeagueSet = new Set(selectedLeagueIds.map((id) => Number(id)));
      const hydrated = (json.items as PredictionRow[])
        .filter((row) => {
          const kickoffDate = kickoffLocalDateKey(row.kickoff);
          if (!selectedDateSet.has(kickoffDate)) return false;
          if (!selectedLeagueSet.size) return true;
          return selectedLeagueSet.has(Number(row.leagueId));
        })
        .slice(0, 80);

      if (!hydrated.length) return [];

      setPreds(hydrated);
      if (user?.id) {
        setPredictionsByUser((prev) => ({
          ...prev,
          [user.id]: mergePredictionRows(prev[user.id] || [], hydrated)
        }));
        setUserPredictionMap((prev) => {
          const existing = prev[user.id] || [];
          const merged = Array.from(new Set([...existing, ...hydrated.map((item) => Number(item.id))]));
          return { ...prev, [user.id]: merged };
        });
      }
      setStatus(t("dash.restoredHistory", { n: hydrated.length }));
      setRehydratedNotice(t("dash.restoredNotice", { n: hydrated.length }));
      return hydrated;
    } catch {
      return [];
    }
  }

  /**
   * The hydration request in flight, or null.
   *
   * Both de-dup guards in the effect below are conditioned on `preds.length > 0`,
   * so the empty-cache case — the one that actually needs hydrating — reached
   * `runHydration()` with nothing stopping a second call. Measured in production:
   * two identical 45,074,431-byte requests starting 11 ms apart on one cold start,
   * 90 MB for a response the second copy then overwrote with the same rows.
   *
   * A ref, not state: this must be readable and writable synchronously inside the
   * same commit that already started a request, which a state update cannot do.
   */
  const inFlightHydrationRef = useRef<Promise<PredictionRow[]> | null>(null);

  /**
   * Callers share one request while it is in flight; the next call after it
   * settles starts a fresh one. Cleared on BOTH outcomes, so a failure never
   * latches hydration off — `runHydration` resolves to [] rather than rejecting,
   * and an empty result is deliberately not remembered as a successful hydration.
   */
  function rehydratePredictionsFromHistory(): Promise<PredictionRow[]> {
    const pending = inFlightHydrationRef.current;
    if (pending) return pending;

    const started = runHydration();
    inFlightHydrationRef.current = started;
    // Attached directly to `started`, not through a .catch().finally() chain:
    // handlers run in attachment order, so registering here — before the caller
    // awaits the promise we hand back — guarantees the ref is already clear by
    // the time that caller resumes and may legitimately hydrate again.
    // Identity check: never clear a newer request started after this one settled.
    const release = () => {
      if (inFlightHydrationRef.current === started) inFlightHydrationRef.current = null;
    };
    void started.then(release, release);
    return started;
  }

  const tierShapeRehydrateKeyRef = useRef("");
  useEffect(() => {
    if (!user?.id) return;
    if (!accessToken) return;
    if (!selectedLeagueIds.length) return;
    // Rehydrate when cache is empty or under-masked for the current effective tier (mobile free→ultra case).
    if (preds.length > 0 && !hasLegacyPredictionShape(preds, userTier)) return;
    const shapeKey = `${user.id}|${userTier}|${normalizeSelectedDates(selectedDates.length ? selectedDates : [date]).join(",")}|${selectedLeagueIds.join(",")}`;
    if (preds.length > 0 && hasLegacyPredictionShape(preds, userTier)) {
      if (tierShapeRehydrateKeyRef.current === shapeKey) return;
      tierShapeRehydrateKeyRef.current = shapeKey;
    }
    void rehydratePredictionsFromHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- verbatim din UserDashboard
  }, [user?.id, accessToken, preds, userTier, selectedLeagueIds.join("|"), selectedDates.join("|"), date]);

  // Drop free-masked localStorage rows when the user is promoted (tierStatus / admin grant).
  const prevEffectiveTierRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!user?.id) return;
    const nextTier = String(userTier || user.tier || "free").toLowerCase();
    const prevTier = prevEffectiveTierRef.current;
    prevEffectiveTierRef.current = nextTier;
    if (!prevTier || prevTier === nextTier) return;
    const rank: Record<string, number> = { free: 0, premium: 1, ultra: 2 };
    if ((rank[nextTier] ?? 0) <= (rank[prevTier] ?? 0)) return;
    setPredictionsByUser((prev) => {
      if (!prev[user.id]?.length) return prev;
      const copy = { ...prev };
      delete copy[user.id];
      return copy;
    });
    setPreds((prev) => (prev.length ? [] : prev));
    setStatus("Plan upgraded — run Predict again for full markets.");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- verbatim din UserDashboard
  }, [user?.id, userTier, user?.tier, setPredictionsByUser]);

  useEffect(() => {
    if (!rehydratedNotice) return;
    const tm = setTimeout(() => setRehydratedNotice(null), 5000);
    return () => clearTimeout(tm);
  }, [rehydratedNotice]);

  return {
    preds,
    setPreds,
    predictionsByUser,
    setPredictionsByUser,
    setUserPredictionMap,
    rehydratedNotice,
    rehydratePredictionsFromHistory
  };
}
