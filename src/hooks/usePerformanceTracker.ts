import { useEffect, useMemo, useRef, useState } from "react";
import { HistoryEntry, PerformanceLeagueBreakdown } from "../types";
import { filterHistoryByWorstLossDays } from "../utils/appUtils";
import { isCompactViewport } from "./useLeaguePanelState";

export function usePerformanceTracker(history: HistoryEntry[], predIds: Array<string | number>) {
  const [excludeWorstLossDays, setExcludeWorstLossDays] = useState<number>(1);
  const [isWinRatePulsing, setIsWinRatePulsing] = useState(false);
  const [animatedWins, setAnimatedWins] = useState(0);
  const [animatedLosses, setAnimatedLosses] = useState(0);
  const [animatedWinRate, setAnimatedWinRate] = useState(0);

  const { filtered: counterHistory, excludedDays: excludedLossDays } = useMemo(
    () => filterHistoryByWorstLossDays(history, excludeWorstLossDays),
    [history, excludeWorstLossDays]
  );

  const trackerStats = useMemo(() => {
    const wins = counterHistory.filter((item) => item.validation === "win").length;
    const losses = counterHistory.filter((item) => item.validation === "loss").length;
    const settled = wins + losses;
    return { wins, losses, settled, winRate: settled > 0 ? (wins / settled) * 100 : 0 };
  }, [counterHistory]);

  const pendingHistoryCount = useMemo(
    () => counterHistory.filter((item) => item.validation === "pending").length,
    [counterHistory]
  );

  const predIdSet = useMemo(() => new Set(predIds), [predIds]);
  const pendingAmongDisplayedPreds = useMemo(
    () => counterHistory.filter((h) => h.validation === "pending" && predIdSet.has(h.id)).length,
    [counterHistory, predIdSet]
  );

  const globalPerformanceByLeague = useMemo((): PerformanceLeagueBreakdown[] => {
    const map = new Map<number, { leagueId: number; leagueName: string; wins: number; losses: number; pending: number }>();
    for (const h of counterHistory) {
      const lid = Number(h.leagueId);
      if (!Number.isFinite(lid)) continue;
      const name = h.league || String(lid);
      if (!map.has(lid)) map.set(lid, { leagueId: lid, leagueName: name, wins: 0, losses: 0, pending: 0 });
      const o = map.get(lid)!;
      if (h.validation === "win") o.wins += 1;
      else if (h.validation === "loss") o.losses += 1;
      else if (h.validation === "pending") o.pending += 1;
    }
    return Array.from(map.values())
      .map((o) => {
        const settled = o.wins + o.losses;
        return { ...o, settled, winRate: settled > 0 ? (o.wins / settled) * 100 : 0 };
      })
      .sort((a, b) => b.settled - a.settled);
  }, [counterHistory]);

  const prevWinRateRef = useRef<number>(trackerStats.winRate);

  useEffect(() => {
    const prev = prevWinRateRef.current;
    if (Math.abs(prev - trackerStats.winRate) > 0.01) {
      setIsWinRatePulsing(true);
      const tm = setTimeout(() => setIsWinRatePulsing(false), 900);
      prevWinRateRef.current = trackerStats.winRate;
      return () => clearTimeout(tm);
    }
    prevWinRateRef.current = trackerStats.winRate;
  }, [trackerStats.winRate]);

  useEffect(() => {
    const durationMs = isCompactViewport() ? 450 : 650;
    const start = performance.now();
    const fromWins = animatedWins;
    const fromLosses = animatedLosses;
    const fromRate = animatedWinRate;
    const toWins = trackerStats.wins;
    const toLosses = trackerStats.losses;
    const toRate = trackerStats.winRate;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedWins(Math.round(fromWins + (toWins - fromWins) * eased));
      setAnimatedLosses(Math.round(fromLosses + (toLosses - fromLosses) * eased));
      setAnimatedWinRate(fromRate + (toRate - fromRate) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [trackerStats.wins, trackerStats.losses, trackerStats.winRate]);

  return {
    excludeWorstLossDays,
    setExcludeWorstLossDays,
    excludedLossDays,
    trackerStats,
    pendingHistoryCount,
    pendingAmongDisplayedPreds,
    globalPerformanceByLeague,
    isWinRatePulsing,
    animatedWins,
    animatedLosses,
    animatedWinRate
  };
}
