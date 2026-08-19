import { useCallback, useEffect, useMemo, useState } from "react";
import { useHistorySync } from "../../hooks/useHistorySync";
import type { HistoryEntry, HistoryStats, PerformanceLeagueBreakdown } from "../../types";
import { isFinalMatchStatus } from "../../utils/cardMarketOutcome";
import { historyStatsFromRows, tallyEntryCardMarkets } from "../../utils/historyStats";

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
      const items = (Array.isArray(json.items) ? json.items : []) as HistoryEntry[];
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
    return history.filter((item) => {
      if (item.validation === "pending") return true;
      if (!isFinalMatchStatus(item.status)) return false;
      const v = item.cardMarketValidations;
      if (!v) return Boolean(item.probs?.corners || item.probs?.shotsOnTarget);
      return (["corners", "shots"] as const).some((k) => {
        if (!item.probs?.[k === "shots" ? "shotsOnTarget" : k]) return false;
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
