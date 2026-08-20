import { useEffect, useMemo, useState } from "react";
import { addCalendarDayIso, type KickoffScope } from "../components/admin/AdminObservatory";
import { FilterMode, SortBy } from "../constants/appConstants";
import { HistoryEntry, PredictionRow } from "../types";
import {
  dominantColorFromImage,
  hashColor,
  isoToday,
  mergePredsWithHistory,
  useLocalStorageState
} from "../utils/appUtils";
import { projectPredictionRowsForStorage } from "../utils/predictionListProjection";
import { useLiveFixtureScorePoll } from "./useLiveFixtureScorePoll";

function hasTierMaskedPredictionShape(rows: PredictionRow[]): boolean {
  return rows.some((row) => {
    if (row?.insufficientData) return false;
    const probs = row?.probs;
    return !probs?.corners && !probs?.shotsOnTarget && !probs?.shotsTotal && !probs?.firstHalf;
  });
}

export type UsePredictionsOptions = {
  history: HistoryEntry[];
  userRole?: string | null;
  userEnabledLivePoll?: boolean;
  setStatus: (message: string) => void;
};

export function usePredictions({
  history,
  userRole,
  userEnabledLivePoll,
  setStatus
}: UsePredictionsOptions) {
  // Same defect as the signed-in cache, same fix: state full, disk narrowed.
  // Measured at 882,308 B — the second-largest key on the origin, competing for
  // the same budget as footy.user.predictionsByUser.
  const [preds, setPreds] = useLocalStorageState<PredictionRow[]>(
    "footy.lastPreds",
    [],
    projectPredictionRowsForStorage
  );
  const [logoColors, setLogoColors] = useLocalStorageState<Record<string, string>>("footy.logoColors", {});
  const [filterMode, setFilterMode] = useState<FilterMode>("ALL");
  const [kickoffScope, setKickoffScope] = useState<KickoffScope>("ALL");
  const [minXgSpread, setMinXgSpread] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>("TIME");
  const [selectedMatch, setSelectedMatch] = useState<PredictionRow | null>(null);

  const displayedMatches = useMemo(() => {
    let list = [...preds];
    if (filterMode === "VALUE") list = list.filter((m) => m.valueBet?.detected);
    if (filterMode === "SAFE") list = list.filter((m) => !m.insufficientData && Number(m.recommended.confidence) >= 70);
    if (filterMode === "LOW") list = list.filter((m) => !m.insufficientData && Number(m.recommended.confidence) < 55);
    if (kickoffScope === "TODAY") {
      const t = isoToday();
      list = list.filter((m) => m.kickoff?.slice(0, 10) === t);
    } else if (kickoffScope === "TOMORROW") {
      const t = addCalendarDayIso(isoToday(), 1);
      list = list.filter((m) => m.kickoff?.slice(0, 10) === t);
    }
    if (minXgSpread > 0) {
      list = list.filter((m) => {
        const xs = m.luckStats;
        if (!xs) return false;
        return Math.abs((xs.hXG ?? 0) - (xs.aXG ?? 0)) >= minXgSpread;
      });
    }
    list.sort((a, b) => {
      if (sortBy === "TIME") return new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime();
      if (sortBy === "CONFIDENCE") return Number(b.recommended.confidence) - Number(a.recommended.confidence);
      if (sortBy === "VALUE") return (b.valueBet?.ev || 0) - (a.valueBet?.ev || 0);
      return 0;
    });
    return list;
  }, [preds, filterMode, sortBy, kickoffScope, minXgSpread]);

  const groupedDisplayedMatches = useMemo(() => {
    const groups = new Map<string, PredictionRow[]>();
    for (const match of displayedMatches) {
      const key = match.kickoff?.slice(0, 10) || "Fără dată";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(match);
    }
    return Array.from(groups.entries()).map(([dateKey, matches]) => ({
      dateKey,
      matches
    }));
  }, [displayedMatches]);

  const insightSample = useMemo(() => displayedMatches[0] ?? preds[0] ?? null, [displayedMatches, preds]);

  useLiveFixtureScorePoll(preds, setPreds, { enabled: Boolean(userEnabledLivePoll) });

  useEffect(() => {
    setSelectedMatch((cur) => {
      if (!cur) return cur;
      const next = preds.find((p) => p.id === cur.id);
      return next ?? cur;
    });
  }, [preds]);

  useEffect(() => {
    if (!history.length) return;
    setPreds((prev) => mergePredsWithHistory(prev, history));
  }, [history, setPreds]);

  useEffect(() => {
    if (userRole !== "admin") return;
    if (!preds.length) return;
    if (!hasTierMaskedPredictionShape(preds)) return;
    setPreds([]);
    setStatus("Cache local vechi resetat pentru admin. Rulează Predict pentru cardurile complete.");
  }, [userRole, preds, setPreds, setStatus]);

  async function prefetchColors(rows: PredictionRow[]) {
    const next = { ...logoColors };
    let changed = false;
    for (const row of rows) {
      for (const logo of [row.logos?.home, row.logos?.away]) {
        if (logo && !next[logo]) {
          const c = await dominantColorFromImage(logo);
          next[logo] = c || hashColor(logo);
          changed = true;
        }
      }
    }
    if (changed) setLogoColors(next);
  }

  return {
    preds,
    setPreds,
    logoColors,
    filterMode,
    setFilterMode,
    kickoffScope,
    setKickoffScope,
    minXgSpread,
    setMinXgSpread,
    sortBy,
    setSortBy,
    selectedMatch,
    setSelectedMatch,
    displayedMatches,
    groupedDisplayedMatches,
    insightSample,
    prefetchColors
  };
}
