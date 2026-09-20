import { useMemo } from "react";
import type { MatchesSubFilterPref, UiPrefsV3 } from "../../hooks/useUiPrefs";
import type { HistoryEntry, PredictionRow } from "../../types";
import { deriveNotifications } from "../../utils/deriveNotifications";
import { isFixtureInPlay } from "../../utils/appUtils";
import { isHighConfidenceRow, isValueRow } from "../../utils/predictionSignals";
import { rankByMarketProbability, type MarketFilter } from "../../utils/marketProbabilityFilter";
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
  matchesFilter,
  matchSearch,
  showSettledMarketsOnly,
  marketFilter = "all"
}: {
  preds: PredictionRow[];
  history: HistoryEntry[];
  prefs: UiPrefsV3;
  matchesFilter: MatchesSubFilterPref;
  matchSearch: string;
  showSettledMarketsOnly: boolean;
  /** Rank the Matches list by one market's probability. Session-local, like the segment. */
  marketFilter?: MarketFilter;
}) {
  const predIdSet = useMemo(() => new Set(preds.map((p) => p.id)), [preds]);
  const pendingAmongDisplayedPreds = useMemo(
    () => history.filter((h) => h.validation === "pending" && predIdSet.has(h.id)).length,
    [history, predIdSet]
  );
  const filteredPreds = useMemo(() => {
    let rows = [...preds].sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
    /*
      "picks" reached this list through `navView === "predictions"`, a
      destination neither the tab bar nor the desktop rail ever linked to —
      only ⌘K did, so no mobile user could open it at all. It is a way of
      looking at the slate rather than a place, so it is a Matches filter now,
      beside all/favorites.
    */
    // Live is a segment of this list (UX-B), no longer a view of its own.
    const listFilter: MatchesSubFilter = matchesFilter;
    if (listFilter === "live") {
      rows = rows.filter((row) => isFixtureInPlay(row.status));
    } else if (listFilter === "favorites") {
      const ids = new Set(prefs.watchlistFixtureIds);
      rows = rows.filter((row) => ids.has(Number(row.id)));
    } else if (listFilter === "picks") {
      // A pick you cannot act on is not a pick: rows with no recommendation, or
      // without the data to make one, are not ranked low — they are dropped.
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
    /*
      The Value / High-confidence chips are gone, and they were the only way to
      set `prefs.valueOnly` / `prefs.minConfidence`. Those two saved filters are
      therefore no longer applied: a user who left one on must not keep a filter
      they can no longer see. The pref fields and Settings' display/Reset stay.
    */
    if (prefs.minEv > 0) {
      rows = rows.filter((row) => {
        const e = Number(row.valueBet?.ev ?? row.valueEngine?.expectedValue);
        return Number.isFinite(e) && e >= prefs.minEv;
      });
    }
    if (prefs.preferredMarkets.length) {
      rows = rows.filter((row) => matchesPreferredMarkets(row, prefs.preferredMarkets));
    }
    return rows;
  }, [
    preds,
    showSettledMarketsOnly,
    matchesFilter,
    prefs.watchlistFixtureIds,
    prefs.minEv,
    prefs.preferredMarkets,
    matchSearch
  ]);
  /*
    The market ranking is its own memo on top of the filters above rather than
    one more branch inside them: it is orthogonal to the segment (Live + GG is a
    sensible thing to ask for), it must run LAST so it outranks the "picks"
    confidence sort, and it re-sorts only when the filtered set or the market
    actually changes. "all" hands back `filteredPreds` itself — same array, same
    order — so the unfiltered list is untouched by this feature.
  */
  const visiblePreds = useMemo(
    () => rankByMarketProbability(filteredPreds, marketFilter),
    [filteredPreds, marketFilter]
  );
  /** Everything Home shows; `homeCounts` below is computed over the same set. */
  const homeBasePreds = useMemo(() => {
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
    if (prefs.preferredMarkets.length) {
      rows = rows.filter((row) => matchesPreferredMarkets(row, prefs.preferredMarkets));
    }
    return rows;
  }, [preds, showSettledMarketsOnly, prefs.preferredMarkets, matchSearch]);
  // No chip filters any more (see visiblePreds): Home shows its base set.
  const homePreds = homeBasePreds;
  const homeCounts = useMemo(
    () => ({
      total: homeBasePreds.length,
      value: homeBasePreds.filter(isValueRow).length,
      highConfidence: homeBasePreds.filter(isHighConfidenceRow).length
    }),
    [homeBasePreds]
  );
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
  const analysisMatch = useMemo(() => {
    const playable = preds.filter((p) => !p.insufficientData);
    // The featured "verdict of the day" is a pre-kickoff call — in-play rows
    // already own the Home "Live now" section, so prefer upcoming ones and only
    // fall back to any playable row when everything is live.
    const upcoming = playable.filter((p) => !isFixtureInPlay(p.status));
    const pool = upcoming.length ? upcoming : playable;
    return (
      [...pool].sort(
        (a, b) => Number(b.recommended?.confidence || 0) - Number(a.recommended?.confidence || 0)
      )[0] || preds[0] || null
    );
  }, [preds]);

  return {
    predIdSet,
    pendingAmongDisplayedPreds,
    visiblePreds,
    /** Rows the market filter started from — tells "no such market here" apart from "no rows at all". */
    marketBaseCount: filteredPreds.length,
    homePreds,
    homeCounts,
    homeLiveCount,
    notificationItems,
    analysisMatch
  };
}
