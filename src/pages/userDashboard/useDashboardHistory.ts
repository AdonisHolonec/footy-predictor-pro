import { useCallback, useEffect, useMemo, useState } from "react";
import { useHistorySync } from "../../hooks/useHistorySync";
import type { HistoryEntry, HistoryStats, PerformanceLeagueBreakdown } from "../../types";
import { isFinalMatchStatus } from "../../utils/cardMarketOutcome";
import { historyStatsFromRows, tallyEntryCardMarkets } from "../../utils/historyStats";
import { demoteStaleLiveStatuses } from "../../utils/liveState";

/**
 * Istoricul predicțiilor + statisticile derivate, mutate verbatim din
 * UserDashboard: încărcarea (/api/history), sincronizarea (inițială, la
 * revenirea în tab, periodică atât timp cât există intrări pending) și
 * memo-urile de agregare.
 */
export function useDashboardHistory({
  userId,
  accessToken
}: {
  userId: string | undefined;
  accessToken: string | undefined;
}) {
  const [historyStats, setHistoryStats] = useState<HistoryStats>({ wins: 0, losses: 0, settled: 0, winRate: 0, pushes: 0, halfWins: 0, halfLosses: 0 });
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      if (!userId) {
        setHistory([]);
        setHistoryStats({ wins: 0, losses: 0, settled: 0, winRate: 0, pushes: 0, halfWins: 0, halfLosses: 0 });
        return;
      }
      if (!accessToken) return;
      const response = await fetch("/api/history?days=30&limit=2000&mine=1&view=list", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const json = await response.json();
      if (!json?.ok) return;
      // Read boundary: a persisted in-play status older than MAX_LIVE_AGE_MS is a
      // historical observation, not current live state (Results must not show LIVE
      // for a match the cron last saw at 35'). Stats keep the server's numbers.
      const items = demoteStaleLiveStatuses((Array.isArray(json.items) ? json.items : []) as HistoryEntry[]);
      setHistory(items);
      setHistoryStats(json.stats || historyStatsFromRows(items));
    } catch {
      // keep existing data on failure
    }
  }, [userId, accessToken]);

  const { isHistorySyncing, syncHistory } = useHistorySync({
    accessToken,
    defaultDays: 7,
    cooldownMs: 10 * 60_000,
    onAfterSync: loadHistory
  });

  const marketValidationsByFixtureId = useMemo(() => {
    const map = new Map<number, NonNullable<HistoryEntry["cardMarketValidations"]>>();
    for (const h of history) {
      if (h.cardMarketValidations) map.set(Number(h.id), h.cardMarketValidations);
    }
    return map;
  }, [history]);
  const pendingHistoryCount = useMemo(() => {
    /*
      Which markets exist on a row.

      The light `?view=list` shape is column-based and no longer ships `probs`
      — shipping a large analytical object to answer a yes/no is what the read
      cutover exists to stop. It sets hasCornersMarket / hasShotsMarket from
      card_markets instead, which answers exactly the same question: measured
      across all 810 production rows, `probs.corners` present equals
      `cardMarkets.corners` present on 748/748, and `probs.shotsOnTarget`
      equals `cardMarkets.shots` on 748/748, with zero rows differing.

      The `probs` branch stays for the FULL shape (hydration, by-fixture
      detail), which still carries it.
    */
    const hasMarket = (item: HistoryEntry, market: "corners" | "shots") => {
      const flag = market === "corners" ? item.hasCornersMarket : item.hasShotsMarket;
      if (flag !== undefined) return flag;
      return Boolean(item.probs?.[market === "shots" ? "shotsOnTarget" : "corners"]);
    };
    return history.filter((item) => {
      if (item.validation === "pending") return true;
      if (!isFinalMatchStatus(item.status)) return false;
      const v = item.cardMarketValidations;
      if (!v) return hasMarket(item, "corners") || hasMarket(item, "shots");
      return (["corners", "shots"] as const).some((k) => {
        if (!hasMarket(item, k)) return false;
        return v[k] !== "win" && v[k] !== "loss";
      });
    }).length;
  }, [history]);
  const userPerformanceByLeague = useMemo((): PerformanceLeagueBreakdown[] => {
    const map = new Map<number, { leagueId: number; leagueName: string; wins: number; losses: number; pending: number }>();
    for (const h of history) {
      const lid = Number(h.leagueId);
      if (!Number.isFinite(lid)) continue;
      const name = h.league || String(lid);
      if (!map.has(lid)) map.set(lid, { leagueId: lid, leagueName: name, wins: 0, losses: 0, pending: 0 });
      const o = map.get(lid)!;
      const t = tallyEntryCardMarkets(h);
      o.wins += t.wins;
      o.losses += t.losses;
      o.pending += t.pending;
    }
    return Array.from(map.values())
      .map((o) => {
        const settled = o.wins + o.losses;
        return { ...o, settled, winRate: settled > 0 ? (o.wins / settled) * 100 : 0 };
      })
      .sort((a, b) => b.settled - a.settled);
  }, [history]);
  const historySearchLabels = useMemo(
    () =>
      history
        .slice(0, 40)
        .map((h) => `${h.teams?.home || "?"} vs ${h.teams?.away || "?"} · ${h.league || ""}`.trim()),
    [history]
  );

  useEffect(() => {
    if (!accessToken) return;
    void syncHistory();
  }, [accessToken, syncHistory]);

  useEffect(() => {
    if (!accessToken) return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void syncHistory();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [accessToken, syncHistory]);

  useEffect(() => {
    if (!accessToken) return;
    if (pendingHistoryCount <= 0) return;
    const tm = setInterval(() => {
      if (isHistorySyncing) return;
      void syncHistory(7);
    }, 15 * 60_000);
    return () => clearInterval(tm);
  }, [accessToken, pendingHistoryCount, isHistorySyncing, syncHistory]);

  return {
    history,
    historyStats,
    loadHistory,
    syncHistory,
    isHistorySyncing,
    pendingHistoryCount,
    marketValidationsByFixtureId,
    userPerformanceByLeague,
    historySearchLabels
  };
}
