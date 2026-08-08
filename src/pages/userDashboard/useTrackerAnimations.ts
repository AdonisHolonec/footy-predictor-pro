import { useEffect, useRef, useState } from "react";
import { isCompactViewport } from "../../hooks/useLeaguePanelState";
import type { HistoryStats } from "../../types";

/**
 * Animările tracker-ului de performanță, mutate verbatim din UserDashboard:
 * pulsul la schimbarea win-rate-ului și tranziția RAF a contorilor.
 */
export function useTrackerAnimations(trackerStats: HistoryStats) {
  const [isWinRatePulsing, setIsWinRatePulsing] = useState(false);
  const [animatedWins, setAnimatedWins] = useState(0);
  const [animatedLosses, setAnimatedLosses] = useState(0);
  const [animatedWinRate, setAnimatedWinRate] = useState(0);
  const prevWinRateRef = useRef(trackerStats.winRate);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- verbatim din UserDashboard: pornește doar când țintele se schimbă
  }, [trackerStats.wins, trackerStats.losses, trackerStats.winRate]);

  return { isWinRatePulsing, animatedWins, animatedLosses, animatedWinRate };
}
