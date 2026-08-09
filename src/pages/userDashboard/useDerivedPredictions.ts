import { useMemo } from "react";
import type { AppNavView } from "../../components/ux/appNav";
import type { MatchesSubFilterPref, UiPrefsV3 } from "../../hooks/useUiPrefs";
import type { HistoryEntry, PredictionRow } from "../../types";
import { deriveNotifications } from "../../utils/deriveNotifications";
import { isFixtureInPlay } from "../../utils/appUtils";
import { hasDerivateMarkets, isFinalStatus, matchesPreferredMarkets } from "./helpers";

type MatchesSubFilter = MatchesSubFilterPref;

/**
 * Listele derivate din predicții (filtrare, sortare, notificări), mutate
 * verbatim din UserDashboard. Nu deține state — doar memo-uri peste inputuri.
 */
export function useDerivedPredictions({
  preds,
  history,
  prefs,
  navView,
  matchesFilter,
  matchSearch,
  showSettledMarketsOnly
}: {
  preds: PredictionRow[];
  history: HistoryEntry[];
  prefs: UiPrefsV3;
  navView: AppNavView;
  matchesFilter: MatchesSubFilterPref;
  matchSearch: string;
  showSettledMarketsOnly: boolean;
}) {
  const predIdSet = useMemo(() => new Set(preds.map((p) => p.id)), [preds]);
  const pendingAmongDisplayedPreds = useMemo(
    () => history.filter((h) => h.validation === "pending" && predIdSet.has(h.id)).length,
    [history, predIdSet]
  );
  const visiblePreds = useMemo(() => {
    let rows = [...preds].sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
    const listFilter: MatchesSubFilter | "predictions" =
      navView === "live"
        ? "live"
        : navView === "predictions"
          ? "predictions"
          : matchesFilter === "favorites" || matchesFilter === "live"
            ? matchesFilter
            : "all";
    if (listFilter === "live") {
      rows = rows.filter((row) => isFixtureInPlay(row.status));
    } else if (listFilter === "favorites") {
      const ids = new Set(prefs.watchlistFixtureIds);
      rows = rows.filter((row) => ids.has(Number(row.id)));
    } else if (listFilter === "predictions") {
      rows = rows
        .filter((row) => !row.insufficientData && Boolean(row.recommended?.pick))
        .slice()
        .sort((a, b) => Number(b.recommended?.confidence || 0) - Number(a.recommended?.confidence || 0));
    }
    if (showSettledMarketsOnly) {
      rows = rows.filter((row) => isFinalStatus(row.status) && hasDerivateMarkets(row));
    }
    const q = matchSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => {
        const hay = `${row.teams.home} ${row.teams.away} ${row.league} ${row.recommended?.pick || ""}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (prefs.minConfidence > 0) {
      rows = rows.filter((row) => {
        const c = Number(row.recommended?.confidence);
        return Number.isFinite(c) && c >= prefs.minConfidence;
      });
    }
    if (prefs.minEv > 0) {
      rows = rows.filter((row) => {
        const e = Number(row.valueBet?.ev ?? row.valueEngine?.expectedValue);
        return Number.isFinite(e) && e >= prefs.minEv;
      });
    }
    if (prefs.valueOnly) {
      rows = rows.filter(
        (row) => Boolean(row.valueBet?.detected) || Number(row.valueBet?.ev ?? row.valueEngine?.expectedValue) > 0
      );
    }
    if (prefs.preferredMarkets.length) {
      rows = rows.filter((row) => matchesPreferredMarkets(row, prefs.preferredMarkets));
    }
    return rows;
  }, [
    preds,
    showSettledMarketsOnly,
    navView,
    matchesFilter,
    prefs.watchlistFixtureIds,
    prefs.minConfidence,
    prefs.minEv,
    prefs.valueOnly,
    prefs.preferredMarkets,
    matchSearch
  ]);
  const homePreds = useMemo(() => {
    let rows = [...preds].sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
    if (showSettledMarketsOnly) {
      rows = rows.filter((row) => isFinalStatus(row.status) && hasDerivateMarkets(row));
    }
    const q = matchSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => {
        const hay = `${row.teams.home} ${row.teams.away} ${row.league} ${row.recommended?.pick || ""}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (prefs.minConfidence > 0) {
      rows = rows.filter((row) => {
        const c = Number(row.recommended?.confidence);
        return Number.isFinite(c) && c >= prefs.minConfidence;
      });
    }
    if (prefs.valueOnly) {
      rows = rows.filter(
        (row) => Boolean(row.valueBet?.detected) || Number(row.valueBet?.ev ?? row.valueEngine?.expectedValue) > 0
      );
    }
    if (prefs.preferredMarkets.length) {
      rows = rows.filter((row) => matchesPreferredMarkets(row, prefs.preferredMarkets));
    }
    return rows;
  }, [preds, showSettledMarketsOnly, prefs.minConfidence, prefs.valueOnly, prefs.preferredMarkets, matchSearch]);
  const homeLiveCount = useMemo(() => preds.filter((row) => isFixtureInPlay(row.status)).length, [preds]);
  const notificationItems = useMemo(
    () =>
      deriveNotifications({
        predictions: preds,
        history,
        watchlistFixtureIds: prefs.watchlistFixtureIds,
        includeLiveSwing: prefs.notifyLiveSwing
      }),
    [preds, history, prefs.watchlistFixtureIds, prefs.notifyLiveSwing]
  );
  const continueMatch = useMemo(() => {
    const recent = prefs.recentFixtureIds[0];
    if (!recent) return null;
    return preds.find((p) => Number(p.id) === recent) || null;
  }, [prefs.recentFixtureIds, preds]);
  const analysisMatch = useMemo(() => {
    const playable = preds.filter((p) => !p.insufficientData);
    return (
      [...playable].sort(
        (a, b) => Number(b.recommended?.confidence || 0) - Number(a.recommended?.confidence || 0)
      )[0] || preds[0] || null
    );
  }, [preds]);

  return {
    predIdSet,
    pendingAmongDisplayedPreds,
    visiblePreds,
    homePreds,
    homeLiveCount,
    notificationItems,
    continueMatch,
    analysisMatch
  };
}
