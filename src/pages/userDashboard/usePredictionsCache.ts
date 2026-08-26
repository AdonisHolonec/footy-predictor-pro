import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useLocale } from "../../context/LocaleContext";
import type { AuthStatus, useAuth } from "../../hooks/useAuth";
import type { HistoryEntry, PredictionRow } from "../../types";
import {
  isoToday,
  kickoffLocalDateKey,
  mergePredictionRows,
  mergePredsWithHistory,
  normalizeSelectedDates,
  useLocalStorageState
} from "../../utils/appUtils";
import { applyLiveStateCarryForward, demoteStaleLiveStatus } from "../../utils/liveState";
import { projectPredictionsByUserForStorage } from "../../utils/predictionListProjection";
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
  setStatus,
  authStatus,
  entitlementResolved
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
  /**
   * useAuth publishes the user twice on login: first with `profile = null`
   * (tier defaults to "free", status "profile-pending"), then with the real
   * profile. Without this the tier-promotion effect below read that second
   * publish as free → paid on every paid login: it deleted the cached
   * predictions, emptied the list and announced "Plan upgraded" (UX-H).
   * Optional so existing callers/tests that never see a pending profile are
   * unchanged.
   */
  authStatus?: AuthStatus;
  /**
   * PR2b: `userTier` is now the SERVER's effective tier, and it reads "free"
   * until /api/fixtures?tierStatus=1 answers. `authStatus` no longer covers
   * that window — a profile can resolve while entitlement is still in flight —
   * so the promotion effect needs its own gate or it fires free → ultra on
   * every paid page load. Optional so callers/tests that never observe the
   * pending window are unchanged.
   */
  entitlementResolved?: boolean;
}) {
  const { t } = useLocale();
  const isProfileResolved = authStatus === undefined || (authStatus !== "profile-pending" && authStatus !== "unresolved");
  const isTierResolved = entitlementResolved === undefined || entitlementResolved;
  /*
    State stays FULL; only the serialized copy is narrowed. Every reader in this
    hook — the date/league filter, the live-poll carry-forward, the history merge
    — keeps seeing whole rows, and so does `preds` and everything downstream of
    it. What changes is the ~245 KB/row that used to be written for every
    prediction, which is what silently overflowed the key and froze it.
  */
  const [predictionsByUser, setPredictionsByUser] = useLocalStorageState<Record<string, PredictionRow[]>>(
    "footy.user.predictionsByUser",
    {},
    projectPredictionsByUserForStorage
  );
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
    // predictionsByUser never receives live poll data (score/momentum/liveEvents/
    // liveAdjustment) — it lives only in-memory on `preds`. Re-filtering from the
    // cache on every predictionsByUser change (history sync, xg hydrate, tier
    // promotion, etc.) would otherwise silently discard it mid-match. The rule now
    // lives in one place and is shared with the history rehydration below, which
    // was missing it entirely.
    // Same freshness boundary for the locally cached rows: a status cached as 1H in
    // an earlier session is a historical observation by now.
    setPreds((prevPreds) => applyLiveStateCarryForward(prevPreds, filtered.map((row) => demoteStaleLiveStatus(row))));
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

  /**
   * @param silent Startup / effect-driven hydration is a restoration, not an
   *   event: nothing is announced. User-initiated hydration (Refresh) keeps
   *   its messages.
   */
  async function runHydration(silent: boolean): Promise<PredictionRow[]> {
    try {
      if (!user?.id || !accessToken) return [];
      /*
        days=3, not 14: every row outside `selectedDates` is discarded a few
        lines below, and selectedDates is clamped to today..today+2. The RPC
        window has no upper bound, so 3 days of history already covers every
        future kickoff. Measured on one real user: 184 rows returned, of which
        35 were usable. The window is what reduces how many documents Postgres
        detoasts; the projection below reduces what crosses the wire.

        view=prediction-list is opt-in for a reason — historyService.loadHistory
        reads the FULL `mine=1` shape for the guest and admin surfaces, so the
        default must stay full and only this caller may ask for the narrow one.
      */
      const response = await fetch("/api/history?days=3&limit=300&mine=1&view=prediction-list", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const json = await response.json();
      if (!response.ok || !json?.ok || !Array.isArray(json.items)) return [];
      /** Doar răspuns user-scoped (join user_prediction_fixtures); refuză istoric global dacă lipsește flag. */
      if (json.mine !== true) return [];

      const effectiveDates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
      const selectedDateSet = new Set(effectiveDates);
      const selectedLeagueSet = new Set(selectedLeagueIds.map((id) => Number(id)));
      // Freshness normalization BEFORE carry-forward: a stale persisted 1H must not
      // become current LIVE on first paint (no previous state to carry forward).
      const hydrated = (json.items as PredictionRow[])
        .map((row) => demoteStaleLiveStatus(row))
        .filter((row) => {
          const kickoffDate = kickoffLocalDateKey(row.kickoff);
          if (!selectedDateSet.has(kickoffDate)) return false;
          if (!selectedLeagueSet.size) return true;
          return selectedLeagueSet.has(Number(row.leagueId));
        })
        .slice(0, 80);

      if (!hydrated.length) return [];

      // History describes the match as STORED — it carries no momentum, no live
      // events and no minute for a match still in play. It also answers seconds
      // after `/api/fixtures?view=live`, so a wholesale assignment here lands last
      // and erases the live poll's work: momentum vanished and the widget fell back
      // to "Momentum unavailable" a couple of seconds after opening a live match.
      setPreds((prevPreds) => applyLiveStateCarryForward(prevPreds, hydrated));
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
      if (!silent) {
        setStatus(t("dash.restoredHistory", { n: hydrated.length }));
        setRehydratedNotice(t("dash.restoredNotice", { n: hydrated.length }));
      }
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
  function rehydratePredictionsFromHistory({ silent = false }: { silent?: boolean } = {}): Promise<PredictionRow[]> {
    const pending = inFlightHydrationRef.current;
    if (pending) return pending;

    const started = runHydration(silent);
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
    void rehydratePredictionsFromHistory({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- verbatim din UserDashboard
  }, [user?.id, accessToken, preds, userTier, selectedLeagueIds.join("|"), selectedDates.join("|"), date]);

  // Drop free-masked localStorage rows when the user is promoted (tierStatus / admin grant).
  const prevEffectiveTierRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!user?.id) return;
    // A tier read before the profile resolved is the "free" placeholder, not a
    // plan. It is neither remembered nor compared: the first tier this effect
    // records is the first one that came from a loaded profile.
    if (!isProfileResolved || !isTierResolved) return;
    // EFFECTIVE tier on purpose: this drops rows the server masked for a lower
    // tier, and the server masks by effective tier — bonus included.
    const nextTier = String(userTier || "free").toLowerCase();
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
    setStatus(t("dash.planUpgraded"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- verbatim din UserDashboard
  }, [user?.id, userTier, isProfileResolved, isTierResolved, setPredictionsByUser]);

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
