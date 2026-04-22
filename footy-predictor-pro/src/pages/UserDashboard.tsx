import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import LeaguePanel from "../components/LeaguePanel";
import MatchCard from "../components/MatchCard";
import MatchModal from "../components/MatchModal";
import PerformanceCounterModal from "../components/PerformanceCounterModal";
import SuccessRateTracker from "../components/SuccessRateTracker";
import { ELITE_LEAGUES } from "../constants/appConstants";
import { useAuth } from "../hooks/useAuth";
import { useLiveFixtureScorePoll } from "../hooks/useLiveFixtureScorePoll";
import { DayResponse, HistoryEntry, HistoryStats, League, PerformanceLeagueBreakdown, PredictionRow } from "../types";
import BrandArtboard from "../components/BrandArtboard";
import { AdminPerformanceObservatory } from "../components/admin/AdminObservatory";
import { ModelPulseStrip, ModelPulseWave } from "../components/SignalLab";
import { BRAND_IMAGES } from "../constants/brandAssets";
import { hashColor, inferSeason, isoToday, localCalendarDateKey, normalizeSelectedDates, useLocalStorageState } from "../utils/appUtils";

function historyStatsFromRows(rows: HistoryEntry[]): HistoryStats {
  const wins = rows.filter((r) => r.validation === "win").length;
  const losses = rows.filter((r) => r.validation === "loss").length;
  const settled = wins + losses;
  const winRate = settled ? (wins / settled) * 100 : 0;
  return { wins, losses, settled, winRate };
}

function hasLegacyPredictionShape(rows: PredictionRow[]): boolean {
  return rows.some((row) => {
    const probs = row?.probs;
    // Older cached rows (localStorage) can miss newer model fields used by updated cards/modals.
    const hasExactConfidence = row?.recommended?.confidence != null && Number.isFinite(Number(row?.recommended?.confidence));
    if (hasExactConfidence) {
      // Ultra/admin rows should include advanced markets; missing one indicates stale desktop cache.
      return !probs?.firstHalf || !probs?.corners || !probs?.shotsOnTarget;
    }
    return !probs?.firstHalf && !probs?.corners && !probs?.shotsOnTarget && !probs?.shotsTotal;
  });
}

function isFinalStatus(status?: string) {
  return ["FT", "AET", "PEN"].includes(String(status || "").toUpperCase());
}

function hasDerivateMarkets(row: PredictionRow) {
  return Boolean(row.probs?.corners || row.probs?.shotsOnTarget || row.probs?.shotsTotal || row.probs?.firstHalf);
}

export default function UserDashboard() {
  const {
    user,
    userTier,
    trialRemainingTime,
    predictCountToday,
    predictLimitToday,
    tierQuotaExempt,
    session,
    logout,
    activate24hTrial,
    getSession,
    refreshTierStatus,
    updateFavoriteLeagues,
    updateNotificationPreferences,
    markOnboardingComplete
  } = useAuth();
  const [date, setDate] = useLocalStorageState<string>("footy.user.date", isoToday());
  const [selectedDates, setSelectedDates] = useLocalStorageState<string[]>("footy.user.selectedDates", [isoToday()]);
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<number[]>([]);
  const [favoriteLeaguesByUser, setFavoriteLeaguesByUser] = useLocalStorageState<Record<string, number[]>>("footy.user.favoriteLeagueByUser", {});
  const [predictionsByUser, setPredictionsByUser] = useLocalStorageState<Record<string, PredictionRow[]>>("footy.user.predictionsByUser", {});
  const [searchLeague, setSearchLeague] = useState("");
  const [isLeaguesOpen, setIsLeaguesOpen] = useState(window.innerWidth >= 1024);
  const [preds, setPreds] = useState<PredictionRow[]>([]);
  useLiveFixtureScorePoll(preds, setPreds, { enabled: Boolean(user) });

  useEffect(() => {
    setSelectedMatch((cur) => {
      if (!cur) return cur;
      const next = preds.find((p) => p.id === cur.id);
      return next ?? cur;
    });
  }, [preds]);
  const [day, setDay] = useState<DayResponse | null>(null);
  const [status, setStatus] = useState("");
  const [rehydratedNotice, setRehydratedNotice] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<PredictionRow | null>(null);
  const [historyStats, setHistoryStats] = useState<HistoryStats>({ wins: 0, losses: 0, settled: 0, winRate: 0 });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isHistorySyncing, setIsHistorySyncing] = useState(false);
  const [isWinRatePulsing, setIsWinRatePulsing] = useState(false);
  const [animatedWins, setAnimatedWins] = useState(0);
  const [animatedLosses, setAnimatedLosses] = useState(0);
  const [animatedWinRate, setAnimatedWinRate] = useState(0);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifySafe, setNotifySafe] = useState<boolean>(user?.notificationPrefs?.safe ?? true);
  const [notifyValue, setNotifyValue] = useState<boolean>(user?.notificationPrefs?.value ?? true);
  const [notifyEmail, setNotifyEmail] = useState<boolean>(user?.notificationPrefs?.email ?? false);
  const [alertsPreview, setAlertsPreview] = useState<{ safe: number; value: number }>({ safe: 0, value: 0 });
  const [, setUserPredictionMap] = useLocalStorageState<Record<string, number[]>>("footy.user.predictionMap", {});
  const [dailyUsageMap, setDailyUsageMap] = useLocalStorageState<Record<string, { warm: number; predict: number }>>("footy.user.dailyUsage", {});
  const [usageServerSyncPending, setUsageServerSyncPending] = useState(false);
  const [usageServerSyncFailed, setUsageServerSyncFailed] = useState(false);
  const [usageServerSyncedAt, setUsageServerSyncedAt] = useState<number | null>(null);
  const [usageQuotaExempt, setUsageQuotaExempt] = useState(false);
  const usageFetchGen = useRef(0);
  /** Avoid re-hydrating selection from profile every time favoriteLeaguesByUser echoes from saves (caused “stuck” league list). */
  const lastSelectionHydrateUserId = useRef<string | null>(null);
  const [notifyEmailConsent, setNotifyEmailConsent] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [perfCounterModalOpen, setPerfCounterModalOpen] = useState(false);
  const [trialBusy, setTrialBusy] = useState<"premium" | "ultra" | null>(null);
  const [showSettledMarketsOnly, setShowSettledMarketsOnly] = useState(false);

  const todayKey = localCalendarDateKey();
  const trackerStats = useMemo(() => historyStats, [historyStats]);
  const pendingHistoryCount = useMemo(
    () => history.filter((item) => item.validation === "pending").length,
    [history]
  );
  const predIdSet = useMemo(() => new Set(preds.map((p) => p.id)), [preds]);
  const pendingAmongDisplayedPreds = useMemo(
    () => history.filter((h) => h.validation === "pending" && predIdSet.has(h.id)).length,
    [history, predIdSet]
  );
  const visiblePreds = useMemo(() => {
    if (!showSettledMarketsOnly) return preds;
    return preds.filter((row) => isFinalStatus(row.status) && hasDerivateMarkets(row));
  }, [preds, showSettledMarketsOnly]);
  const userPerformanceByLeague = useMemo((): PerformanceLeagueBreakdown[] => {
    const map = new Map<number, { leagueId: number; leagueName: string; wins: number; losses: number; pending: number }>();
    for (const h of history) {
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
  }, [history]);
  const prevWinRateRef = useRef(trackerStats.winRate);
  const usageKey = user?.id ? `${user.id}:${todayKey}` : "";
  const formatRemaining = (ms: number) => {
    if (!ms || ms <= 0) return "00:00:00";
    const total = Math.floor(ms / 1000);
    const h = String(Math.floor(total / 3600)).padStart(2, "0");
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const dailyUsage = usageKey ? (dailyUsageMap[usageKey] || { warm: 0, predict: 0 }) : { warm: 0, predict: 0 };
  const limitApplies = !usageQuotaExempt;

  const markUsageConfirmedFromServer = useCallback(() => {
    setUsageServerSyncedAt(Date.now());
    setUsageServerSyncFailed(false);
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const uid = user?.id;
      if (!uid) {
        setHistory([]);
        setHistoryStats({ wins: 0, losses: 0, settled: 0, winRate: 0 });
        return;
      }
      const token = session?.access_token;
      if (!token) return;
      const response = await fetch("/api/history?days=30&mine=1", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await response.json();
      if (!json?.ok) return;
      const items = (Array.isArray(json.items) ? json.items : []) as HistoryEntry[];
      setHistory(items);
      setHistoryStats(historyStatsFromRows(items));
    } catch {
      // keep existing data on failure
    }
  }, [user?.id, session?.access_token]);

  const syncHistory = useCallback(async () => {
    setIsHistorySyncing(true);
    try {
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      await fetch("/api/history?sync=1&days=30", { method: "POST", headers });
      await loadHistory();
    } catch {
      // indicator only
    } finally {
      setIsHistorySyncing(false);
    }
  }, [session?.access_token, loadHistory]);

  const fetchServerDailyUsage = useCallback(
    async (signal?: AbortSignal) => {
      if (!user?.id || !usageKey) return;
      const gen = ++usageFetchGen.current;
      setUsageServerSyncPending(true);
      try {
        let accessToken: string | null = session?.access_token ?? null;
        if (!accessToken) {
          const fresh = await getSession().catch(() => null);
          accessToken = fresh?.access_token ?? null;
        }
        if (!accessToken) {
          setUsageServerSyncFailed(true);
          return;
        }
        const qs = new URLSearchParams({
          warmPredictUsage: "1",
          usageDay: todayKey,
          date: todayKey
        });
        const res = await fetch(`/api/fixtures?${qs}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal
        });
        if (!res.ok) {
          setUsageServerSyncFailed(true);
          return;
        }
        const json = (await res.json()) as {
          warmPredictUsage?: { warm_count?: number; predict_count?: number; quota_exempt?: boolean };
        };
        const u = json?.warmPredictUsage;
        if (typeof u?.warm_count !== "number" || typeof u?.predict_count !== "number") {
          setUsageServerSyncFailed(true);
          return;
        }
        if (u.quota_exempt) {
          setUsageQuotaExempt(true);
          setDailyUsageMap((prev) => ({
            ...prev,
            [usageKey]: { warm: 0, predict: 0 }
          }));
          markUsageConfirmedFromServer();
          return;
        }
        setUsageQuotaExempt(false);
        setDailyUsageMap((prev) => ({
          ...prev,
          [usageKey]: { warm: u.warm_count, predict: u.predict_count }
        }));
        markUsageConfirmedFromServer();
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setUsageServerSyncFailed(true);
      } finally {
        if (gen === usageFetchGen.current) {
          setUsageServerSyncPending(false);
        }
      }
    },
    [user?.id, session?.access_token, usageKey, todayKey, getSession, setDailyUsageMap, markUsageConfirmedFromServer]
  );

  function setSelectedLeagueIdsLimited(nextIds: number[]) {
    const normalized = Array.from(new Set(nextIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))));
    if (normalized.length > 2) {
      setStatus("Poti selecta maximum 2 ligi favorite.");
      return;
    }
    setSelectedLeagueIds(normalized);
  }

  const leaguesSorted = useMemo(() => {
    const allowedLeagueSet = new Set(ELITE_LEAGUES.map((id) => Number(id)));
    const leagues = (day?.leagues ?? [])
      .filter((league) => allowedLeagueSet.has(Number(league.id)))
      .filter((league) => league.name.toLowerCase().includes(searchLeague.toLowerCase()) || league.country.toLowerCase().includes(searchLeague.toLowerCase()));
    const favoriteSet = new Set((user?.favoriteLeagues || []).map((id) => Number(id)));
    const favorites = leagues.filter((league) => favoriteSet.has(Number(league.id)));
    const elite = leagues
      .filter((league) => ELITE_LEAGUES.includes(Number(league.id)) && !favoriteSet.has(Number(league.id)))
      .sort((a, b) => b.matches - a.matches);
    return [...favorites, ...elite];
  }, [day, searchLeague, user?.favoriteLeagues]);

  useEffect(() => {
    if (!user) {
      lastSelectionHydrateUserId.current = null;
      return;
    }
    if (lastSelectionHydrateUserId.current === user.id) return;
    lastSelectionHydrateUserId.current = user.id;
    const localFavorites = favoriteLeaguesByUser[user.id];
    if (Array.isArray(localFavorites) && localFavorites.length > 0) {
      setSelectedLeagueIds(localFavorites);
    } else if (user.favoriteLeagues.length) {
      setSelectedLeagueIds(user.favoriteLeagues);
    } else {
      setSelectedLeagueIds([]);
    }
  }, [user, favoriteLeaguesByUser]);

  useEffect(() => {
    if (!user?.id) return;
    const localPredictions = predictionsByUser[user.id] || [];
    if (!localPredictions.length) {
      setPreds([]);
      return;
    }
    if (hasLegacyPredictionShape(localPredictions)) {
      // Force fresh server rehydrate for stale desktop cache.
      setPreds([]);
      setPredictionsByUser((prev) => ({ ...prev, [user.id]: [] }));
      setRehydratedNotice("Cache local vechi detectat pe desktop. Reîncarc predictiile cu piețele noi.");
      return;
    }

    const effectiveDates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
    const selectedDateSet = new Set(effectiveDates);
    const selectedLeagueSet = new Set(selectedLeagueIds.map((id) => Number(id)));
    const filtered = localPredictions.filter((row) => {
      if (!selectedLeagueSet.size) return false;
      const kickoffDate = String(row.kickoff || "").slice(0, 10);
      return selectedDateSet.has(kickoffDate) && selectedLeagueSet.has(Number(row.leagueId));
    });
    setPreds(filtered);
  }, [user?.id, predictionsByUser, selectedLeagueIds.join("|"), selectedDates.join("|"), date]);

  useEffect(() => {
    setNotifySafe(user?.notificationPrefs?.safe ?? true);
    setNotifyValue(user?.notificationPrefs?.value ?? true);
    setNotifyEmail(user?.notificationPrefs?.email ?? false);
  }, [user?.id, user?.notificationPrefs?.safe, user?.notificationPrefs?.value, user?.notificationPrefs?.email]);

  useEffect(() => {
    if (!user?.id) return;
    setNotifyEmailConsent(Boolean(user.emailNotificationsConsentedAt && user.notificationPrefs?.email));
  }, [user?.id, user?.emailNotificationsConsentedAt, user?.notificationPrefs?.email]);

  useEffect(() => {
    usageFetchGen.current += 1;
    setUsageServerSyncedAt(null);
    setUsageServerSyncFailed(false);
    setUsageServerSyncPending(false);
    setUsageQuotaExempt(false);
  }, [usageKey]);

  useEffect(() => {
    if (!user?.id || !session?.access_token || !usageKey) return;
    const ac = new AbortController();
    void fetchServerDailyUsage(ac.signal);
    return () => ac.abort();
  }, [user?.id, session?.access_token, usageKey, todayKey, fetchServerDailyUsage]);

  useEffect(() => {
    if (!user?.id || !session?.access_token || !usageKey) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (document.visibilityState !== "visible") return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void fetchServerDailyUsage();
      }, 400);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") scheduleRefetch();
    };
    window.addEventListener("focus", scheduleRefetch);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener("focus", scheduleRefetch);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user?.id, session?.access_token, usageKey, fetchServerDailyUsage]);

  useEffect(() => {
    if (!user) return;
    setFavoriteLeaguesByUser((prev) => ({ ...prev, [user.id]: selectedLeagueIds }));
    const timer = setTimeout(() => {
      void updateFavoriteLeagues(selectedLeagueIds).catch(() => {
        setStatus("Nu am putut salva preferintele de ligi.");
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [selectedLeagueIds, user?.id, updateFavoriteLeagues, setFavoriteLeaguesByUser]);

  useEffect(() => {
    void fetchDays(normalizeSelectedDates(selectedDates.length ? selectedDates : [date]));
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!user?.id) return;
    if (!session?.access_token) return;
    if (!selectedLeagueIds.length) return;
    // Rehydrate even when cached predictions exist if their shape is legacy (desktop stale localStorage case).
    if (preds.length > 0 && !hasLegacyPredictionShape(preds)) return;
    void rehydratePredictionsFromHistory();
  }, [user?.id, session?.access_token, preds, selectedLeagueIds.join("|"), selectedDates.join("|"), date]);

  useEffect(() => {
    if (!session?.access_token) return;
    void syncHistory();
  }, [session?.access_token, syncHistory]);

  useEffect(() => {
    if (!session?.access_token) return;
    const tm = setInterval(() => {
      void refreshTierStatus();
    }, 30000);
    return () => clearInterval(tm);
  }, [session?.access_token, refreshTierStatus]);

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
    const durationMs = window.innerWidth < 768 ? 450 : 650;
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

  useEffect(() => {
    const safeCount = preds.filter((row) => !row.insufficientData && Number(row.recommended?.confidence) >= 70).length;
    const valueCount = preds.filter((row) => row.valueBet?.detected).length;
    setAlertsPreview({ safe: safeCount, value: valueCount });
  }, [preds]);

  async function fetchDays(dates: string[]) {
    const effectiveDates = normalizeSelectedDates(dates.length ? dates : [date]);
    try {
      const responses = await Promise.all(
        effectiveDates.map(async (currentDate) => {
          const response = await fetch(`/api/fixtures?date=${currentDate}`);
          const json = await response.json();
          if (!json.ok) throw new Error(json.error || "Eroare API");
          return json as DayResponse;
        })
      );
      const leaguesMap = new Map<number, League>();
      for (const resp of responses) {
        for (const league of resp.leagues || []) {
          const existing = leaguesMap.get(league.id);
          if (existing) existing.matches += league.matches;
          else leaguesMap.set(league.id, { ...league });
        }
      }
      setDay({
        ok: true,
        date: effectiveDates.join(", "),
        totalFixtures: responses.reduce((sum, resp) => sum + (resp.totalFixtures || 0), 0),
        leagues: Array.from(leaguesMap.values()),
        usage: responses[responses.length - 1]?.usage || { date: isoToday(), count: 0, limit: 100 }
      });
    } catch (error: any) {
      setStatus(error?.message || "Nu am putut incarca ligile.");
    }
  }

  async function rehydratePredictionsFromHistory() {
    try {
      if (!user?.id || !session?.access_token) return;
      const response = await fetch("/api/history?days=14&limit=1000&mine=1", {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      const json = await response.json();
      if (!response.ok || !json?.ok || !Array.isArray(json.items)) return;
      /** Doar răspuns user-scoped (join user_prediction_fixtures); refuză istoric global dacă lipsește flag. */
      if (json.mine !== true) return;

      const effectiveDates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
      const selectedDateSet = new Set(effectiveDates);
      const selectedLeagueSet = new Set(selectedLeagueIds.map((id) => Number(id)));
      const hydrated = (json.items as PredictionRow[])
        .filter((row) => {
          const kickoffDate = String(row.kickoff || "").slice(0, 10);
          return selectedDateSet.has(kickoffDate) && selectedLeagueSet.has(Number(row.leagueId));
        })
        .slice(0, 50);

      if (!hydrated.length) return;

      setPreds(hydrated);
      if (user?.id) {
        setPredictionsByUser((prev) => ({ ...prev, [user.id]: hydrated }));
        setUserPredictionMap((prev) => {
          const existing = prev[user.id] || [];
          const merged = Array.from(new Set([...existing, ...hydrated.map((item) => Number(item.id))]));
          return { ...prev, [user.id]: merged };
        });
      }
      setStatus(`Am restaurat ${hydrated.length} predictii din istoric.`);
      setRehydratedNotice(`Date vechi actualizate: ${hydrated.length} predicții au fost reîncărcate.`);
    } catch {
      // silent fallback
    }
  }

  useEffect(() => {
    if (!rehydratedNotice) return;
    const tm = setTimeout(() => setRehydratedNotice(null), 5000);
    return () => clearTimeout(tm);
  }, [rehydratedNotice]);

  async function warm() {
    if (limitApplies && dailyUsage.warm >= 3) {
      setStatus(
        "Limită Warm (3/zi) în acest browser. Dacă ai folosit contul în altă parte, contorul se aliniază cu serverul când revii în tab sau pui din nou focus pe fereastră."
      );
      return;
    }
    if (!selectedLeagueIds.length) return setStatus("Selecteaza o liga.");
    try {
      let accessToken: string | null = session?.access_token ?? null;
      try {
        const fresh = await getSession();
        if (fresh?.access_token) accessToken = fresh.access_token;
      } catch (authErr: unknown) {
        const msg = authErr instanceof Error ? authErr.message : "Nu am putut reîncărca sesiunea.";
        setStatus(`${msg} Încearcă din nou sau autentifică-te din nou.`);
        return;
      }
      const dates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
      let serverUsageSynced = false;
      for (let i = 0; i < dates.length; i++) {
        const currentDate = dates[i];
        const qs = new URLSearchParams({
          date: currentDate,
          leagueIds: selectedLeagueIds.join(","),
          season: String(inferSeason(currentDate))
        });
        qs.set("usageDay", todayKey);
        const headers: Record<string, string> = {};
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        const response = await fetch(`/api/warm?${qs.toString()}`, { headers });
        if (response.status === 429) {
          try {
            const errBody = (await response.json()) as { error?: string; usage?: { warm_count?: number; predict_count?: number } };
            if (usageKey && errBody?.usage && typeof errBody.usage.warm_count === "number") {
              setDailyUsageMap((prev) => ({
                ...prev,
                [usageKey]: { warm: errBody.usage!.warm_count!, predict: errBody.usage!.predict_count ?? 0 }
              }));
              markUsageConfirmedFromServer();
            }
            setStatus(
              errBody?.error
                ? `${errBody.error} Contorul a fost sincronizat cu serverul.`
                : "Limită Warm (3/zi) confirmată de server. Contorul a fost sincronizat."
            );
          } catch {
            setStatus("Limită Warm (3/zi) confirmată de server. Contorul a fost sincronizat.");
          }
          return;
        }
        if (!response.ok) {
          let backendMessage = "";
          try {
            const errJson = await response.json();
            if (typeof errJson?.error === "string") backendMessage = errJson.error;
          } catch {
            backendMessage = "";
          }
          setStatus(
            backendMessage
              ? `Warm a eșuat (HTTP ${response.status}) · ${backendMessage}`
              : `Warm a eșuat (HTTP ${response.status}). Limita nu e neapărat atinsă; încearcă din nou sau verifică rețeaua.`
          );
          return;
        }
        const json = (await response.json()) as { usage?: { warm_count: number; predict_count: number } };
        if (json?.usage && usageKey) {
          setDailyUsageMap((prev) => ({
            ...prev,
            [usageKey]: { warm: json.usage.warm_count, predict: json.usage.predict_count }
          }));
          markUsageConfirmedFromServer();
          serverUsageSynced = true;
        }
      }
      setStatus("Warm finalizat pentru ligile favorite.");
      if (usageKey && !serverUsageSynced && limitApplies) {
        setDailyUsageMap((prev) => ({
          ...prev,
          [usageKey]: {
            warm: (prev[usageKey]?.warm || 0) + 1,
            predict: prev[usageKey]?.predict || 0
          }
        }));
      }
    } catch (error: any) {
      setStatus(error?.message || "Warm a esuat.");
    }
  }

  async function predict() {
    if (limitApplies && dailyUsage.predict >= 3) {
      setStatus(
        "Limită Predict (3/zi) în acest browser. Dacă ai folosit contul în altă parte, contorul se aliniază cu serverul când revii în tab sau pui din nou focus pe fereastră."
      );
      return;
    }
    if (!selectedLeagueIds.length) return setStatus("Selecteaza o liga.");
    try {
      let accessToken: string | null = session?.access_token ?? null;
      try {
        const fresh = await getSession();
        if (fresh?.access_token) accessToken = fresh.access_token;
      } catch (authErr: unknown) {
        const msg = authErr instanceof Error ? authErr.message : "Nu am putut reîncărca sesiunea.";
        setStatus(`${msg} Încearcă din nou sau autentifică-te din nou.`);
        return;
      }
      const dates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
      const batches: PredictionRow[] = [];
      let serverUsageSynced = false;
      for (let i = 0; i < dates.length; i++) {
        const currentDate = dates[i];
        const qs = new URLSearchParams({
          date: currentDate,
          leagueIds: selectedLeagueIds.join(","),
          season: String(inferSeason(currentDate)),
          limit: "15"
        });
        qs.set("usageDay", todayKey);
        const headers: Record<string, string> = {};
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        const response = await fetch(`/api/predict?${qs.toString()}`, { headers });
        if (response.status === 429) {
          try {
            const errBody = (await response.json()) as { error?: string; usage?: { warm_count?: number; predict_count?: number } };
            if (usageKey && errBody?.usage && typeof errBody.usage.predict_count === "number") {
              setDailyUsageMap((prev) => ({
                ...prev,
                [usageKey]: { warm: errBody.usage!.warm_count ?? 0, predict: errBody.usage!.predict_count! }
              }));
              markUsageConfirmedFromServer();
            }
            setStatus(
              errBody?.error
                ? `${errBody.error} Contorul a fost sincronizat cu serverul.`
                : "Limită Predict (3/zi) confirmată de server. Contorul a fost sincronizat."
            );
          } catch {
            setStatus("Limită Predict (3/zi) confirmată de server. Contorul a fost sincronizat.");
          }
          return;
        }
        if (!response.ok) {
          let backendMessage = "";
          try {
            const errJson = await response.json();
            if (typeof errJson?.error === "string") backendMessage = errJson.error;
          } catch {
            backendMessage = "";
          }
          setStatus(
            backendMessage
              ? `Predict a eșuat (HTTP ${response.status}) · ${backendMessage}`
              : `Predict a eșuat (HTTP ${response.status}). Limita nu e neapărat atinsă; încearcă din nou sau verifică rețeaua.`
          );
          return;
        }
        const json = await response.json();
        if (Array.isArray(json)) batches.push(...json);
        if (i === 0 && usageKey) {
          const w = response.headers.get("X-Usage-Warm");
          const p = response.headers.get("X-Usage-Predict");
          if (w != null && w !== "" && p != null && p !== "") {
            setDailyUsageMap((prev) => ({
              ...prev,
              [usageKey]: { warm: Number(w), predict: Number(p) }
            }));
            markUsageConfirmedFromServer();
            serverUsageSynced = true;
          }
        }
      }
      const deduped = Array.from(new Map(batches.map((row) => [row.id, row])).values());
      setPreds(deduped);
      if (user?.id) {
        setPredictionsByUser((prev) => ({ ...prev, [user.id]: deduped }));
      }
      if (user?.id) {
        setUserPredictionMap((prev) => {
          const existing = prev[user.id] || [];
          const merged = Array.from(new Set([...existing, ...deduped.map((item) => Number(item.id))]));
          return { ...prev, [user.id]: merged };
        });
      }
      setStatus(`Au fost generate ${batches.length} predictii.`);
      if (usageKey && !serverUsageSynced && limitApplies) {
        setDailyUsageMap((prev) => ({
          ...prev,
          [usageKey]: {
            warm: prev[usageKey]?.warm || 0,
            predict: (prev[usageKey]?.predict || 0) + 1
          }
        }));
      }
      const syncHeaders: Record<string, string> = {};
      if (accessToken) syncHeaders.Authorization = `Bearer ${accessToken}`;
      await fetch("/api/history?sync=1&days=30", { method: "POST", headers: syncHeaders }).catch(() => null);
      await loadHistory();
    } catch (error: any) {
      setStatus(error?.message || "Predict a esuat.");
    }
  }

  async function completeOnboarding() {
    if (!selectedLeagueIds.length) {
      setStatus("Selecteaza cel putin o liga favorita pentru onboarding.");
      return;
    }
    try {
      await updateFavoriteLeagues(selectedLeagueIds);
      await markOnboardingComplete();
      setStatus("Onboarding finalizat. Preferintele tale au fost salvate.");
    } catch (error: any) {
      setStatus(error?.message || "Nu am putut finaliza onboarding-ul.");
    }
  }

  async function saveNotificationPrefs() {
    if (notifyEmail && !notifyEmailConsent) {
      setStatus("Pentru e-mail trebuie sa bifezi confirmarea din politica de confidentialitate.");
      return;
    }
    try {
      await updateNotificationPreferences({
        safe: notifySafe,
        value: notifyValue,
        email: notifyEmail,
        emailConsentAcknowledged: notifyEmail ? true : undefined
      });
      setStatus("Preferintele de notificare au fost salvate.");
    } catch (error: any) {
      setStatus(error?.message || "Nu am putut salva preferintele de notificare.");
    }
  }

  async function downloadPersonalDataExport() {
    if (!session?.access_token) {
      setStatus("Export indisponibil: nu exista sesiune activa.");
      return;
    }
    setExportBusy(true);
    try {
      const res = await fetch(`/api/fixtures?gdprExport=1`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(typeof json?.error === "string" ? json.error : "Export esuat.");
      }
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `footy-date-personale-${user?.id?.slice(0, 8) ?? "user"}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("Am descarcat exportul JSON cu datele disponibile pe server.");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Export esuat.");
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="lab-page relative min-h-screen font-sans">
      <div className="lab-bg" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-cover bg-center opacity-[0.04]"
        style={{ backgroundImage: `url(${BRAND_IMAGES.refDashboard})` }}
        aria-hidden
      />
      <div className="relative z-10 mx-auto max-w-[1500px] px-4 py-8 lg:px-6">
        <AdminPerformanceObservatory className="mt-0">
          <SuccessRateTracker
            stats={trackerStats}
            animatedWins={animatedWins}
            animatedLosses={animatedLosses}
            animatedWinRate={animatedWinRate}
            isWinRatePulsing={isWinRatePulsing}
            isHistorySyncing={isHistorySyncing}
            pendingHistoryCount={pendingHistoryCount}
            displayedPredsCount={visiblePreds.length}
            pendingAmongDisplayedPreds={pendingAmongDisplayedPreds}
            onBreakdownClick={() => setPerfCounterModalOpen(true)}
          />
          <div className="mt-4 grid max-w-full grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-signal-line/40 bg-signal-panel/45 px-3 py-2 shadow-inner">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-signal-inkMuted">Win rate</div>
              <div className="font-mono text-sm font-semibold tabular-nums text-signal-petrolMuted">
                {trackerStats.settled > 0 ? `${animatedWinRate.toFixed(1)}%` : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-signal-line/40 bg-signal-panel/45 px-3 py-2 shadow-inner">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-signal-inkMuted">W / L</div>
              <div className="font-mono text-sm font-semibold tabular-nums text-signal-petrol">
                {animatedWins} <span className="text-signal-inkMuted">/</span> {animatedLosses}
              </div>
            </div>
            <div className="rounded-xl border border-signal-line/40 bg-signal-panel/45 px-3 py-2 shadow-inner">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-signal-inkMuted">Pending</div>
              <div className="font-mono text-sm font-semibold tabular-nums text-signal-amber">{pendingHistoryCount}</div>
            </div>
            <div className="rounded-xl border border-signal-line/40 bg-signal-panel/45 px-3 py-2 shadow-inner">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-signal-inkMuted">Settled</div>
              <div className="font-mono text-sm font-semibold tabular-nums text-signal-sage">{trackerStats.settled}</div>
            </div>
          </div>
        </AdminPerformanceObservatory>

        <header className="mb-8 mt-8 flex flex-col gap-6 border-b border-white/[0.06] pb-8 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal-petrol/85">Footy predictor · user lab</p>
                <p className="font-mono text-[10px] text-signal-inkMuted">
                  {localCalendarDateKey()} · S{inferSeason(date)}
                </p>
                <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight text-signal-ink sm:text-4xl">
                  Your <span className="text-signal-petrol">observatory</span>
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-signal-inkMuted">
                  Feed curat: pick, încredere și semnal. Detaliile complete sunt în fișa meciului.
                </p>
              </div>
              <div className="hidden rounded-2xl border border-white/[0.08] bg-signal-void/40 px-4 py-3 text-right font-mono text-[10px] text-signal-inkMuted sm:block">
                <div className="text-signal-sage">● Calibrated</div>
                <div className="mt-1 text-signal-silver">{user?.email}</div>
                <Link to="/privacy" className="mt-2 inline-block text-signal-petrol hover:underline">
                  Confidențialitate
                </Link>
              </div>
            </div>
            <ModelPulseWave status="OPTIMAL CALIBRATION" className="max-w-3xl" />
            <ModelPulseStrip status="Sincronizat cu istoricul contului" tone="healthy" />
            <p className="text-xs text-signal-inkMuted sm:hidden">
              {user?.email} ·{" "}
              <Link to="/privacy" className="font-medium text-signal-petrol underline-offset-2 hover:underline">
                Confidențialitate
              </Link>
            </p>
          </div>
          <div className="flex w-full flex-col gap-4 xl:w-auto xl:max-w-[280px] xl:shrink-0">
            <BrandArtboard
              src={BRAND_IMAGES.refDossier}
              alt="Referință vizuală — prediction dossier și instrumente analitice"
              frameClassName="max-h-[200px] w-full xl:max-h-[240px]"
              className="hidden xl:block"
            />
            <button
              type="button"
              onClick={() => void logout()}
              className="touch-manipulation w-full rounded-xl border border-white/10 bg-signal-panel/55 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-signal-petrol transition hover:bg-signal-fog xl:w-auto"
            >
              Logout
            </button>
          </div>
        </header>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(event) => {
              const next = event.target.value;
              setDate(next);
              setSelectedDates(normalizeSelectedDates([next]));
              void fetchDays([next]);
            }}
            className="rounded-xl border glass-input px-4 py-2.5 text-sm text-signal-ink outline-none focus:ring-2 focus:ring-signal-petrol/30"
          />
          <button
            type="button"
            onClick={warm}
            disabled={limitApplies && dailyUsage.warm >= 3}
            className="touch-manipulation rounded-xl border border-white/10 bg-signal-panel/60 px-4 py-2.5 text-sm font-semibold text-signal-ink hover:bg-signal-panel disabled:cursor-not-allowed disabled:opacity-50"
          >
            Warm
          </button>
          <button
            type="button"
            onClick={predict}
            disabled={limitApplies && dailyUsage.predict >= 3}
            className="touch-manipulation rounded-xl bg-signal-petrol px-4 py-2.5 text-sm font-semibold text-signal-mist hover:bg-signal-petrolMuted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Predict
          </button>
          <div className="rounded-lg border border-white/5 bg-signal-panel/45 px-2 py-1.5 text-[11px] font-medium text-signal-inkMuted shadow-inner">
            <span className="text-signal-petrol">
              Warm {usageQuotaExempt ? "—" : dailyUsage.warm}/3 · Predict {usageQuotaExempt ? "—" : dailyUsage.predict}/3
            </span>
            {session?.access_token && usageKey ? (
              <span className="mt-1 block text-[10px] font-normal leading-snug text-signal-inkMuted">
                {usageQuotaExempt ? (
                  <span>Administrator: limită zilnică dezactivată pe server.</span>
                ) : usageServerSyncPending ? (
                  <>Se actualizează contorul de pe server…</>
                ) : usageServerSyncFailed && !usageServerSyncedAt ? (
                  <span className="text-signal-amber">Nu am putut încărca contorul de pe server.</span>
                ) : usageServerSyncedAt ? (
                  <>
                    Sincronizat cu serverul (
                    {new Date(usageServerSyncedAt).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}).
                    {usageServerSyncFailed ? <span className="text-signal-amber"> Ultima reîmprospătare automată a eșuat.</span> : null}
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
          <div className="rounded-lg border border-signal-petrol/25 bg-signal-petrol/10 px-2 py-1.5 text-[11px] text-signal-ink shadow-inner">
            <span className="font-semibold text-signal-petrol">Tier:</span> {userTier.toUpperCase()}
            <span className="mx-1 text-signal-inkMuted">·</span>
            <span className="font-mono tabular-nums">
              Predict today {predictCountToday}
              {predictLimitToday != null ? `/${predictLimitToday}` : "/∞"}
            </span>
          </div>
          {tierQuotaExempt && (
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] font-semibold text-emerald-300 shadow-inner">
              Admin · Unlimited
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowSettledMarketsOnly((prev) => !prev)}
            className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold shadow-inner transition ${
              showSettledMarketsOnly
                ? "border-signal-sage/35 bg-signal-sage/10 text-signal-mint"
                : "border-white/10 bg-signal-panel/45 text-signal-inkMuted hover:text-signal-ink"
            }`}
            title="Afișează doar meciurile finalizate unde piețele derivate pot primi badge WIN/LOSE"
          >
            {showSettledMarketsOnly ? "Settled markets: ON" : "Settled markets: OFF"}
          </button>
        </div>

        {!tierQuotaExempt && (
          <section className="mt-4 rounded-2xl border border-signal-petrol/25 bg-signal-panel/35 p-4 shadow-inner">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold tracking-wide text-signal-ink">24h Trial Control</h2>
                <p className="mt-1 text-[11px] text-signal-inkMuted">
                  Activează la cerere upgrade temporar pentru Premium (cornere) sau Ultra (inteligență completă).
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={trialBusy !== null || !!user?.premium_trial_activated_at}
                  onClick={async () => {
                    setTrialBusy("premium");
                    try {
                      await activate24hTrial("premium");
                      setStatus("Trial Premium activat pentru 24h.");
                    } catch (e: unknown) {
                      setStatus(e instanceof Error ? e.message : "Nu am putut activa trial Premium.");
                    } finally {
                      setTrialBusy(null);
                    }
                  }}
                  className="rounded-lg border border-signal-petrol/30 bg-signal-petrol/10 px-3 py-1.5 text-[11px] font-semibold text-signal-petrol disabled:opacity-50"
                >
                  {user?.premium_trial_activated_at ? "Premium trial used" : trialBusy === "premium" ? "Activating..." : "Activate Premium 24h"}
                </button>
                <button
                  type="button"
                  disabled={trialBusy !== null || !!user?.ultra_trial_activated_at}
                  onClick={async () => {
                    setTrialBusy("ultra");
                    try {
                      await activate24hTrial("ultra");
                      setStatus("Trial Ultra activat pentru 24h.");
                    } catch (e: unknown) {
                      setStatus(e instanceof Error ? e.message : "Nu am putut activa trial Ultra.");
                    } finally {
                      setTrialBusy(null);
                    }
                  }}
                  className="rounded-lg border border-signal-amber/30 bg-signal-amber/10 px-3 py-1.5 text-[11px] font-semibold text-signal-amber disabled:opacity-50"
                >
                  {user?.ultra_trial_activated_at ? "Ultra trial used" : trialBusy === "ultra" ? "Activating..." : "Activate Ultra 24h"}
                </button>
              </div>
            </div>
            {(trialRemainingTime.premiumMs > 0 || trialRemainingTime.ultraMs > 0) && (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                {trialRemainingTime.premiumMs > 0 && (
                  <span className="rounded-md border border-signal-petrol/25 bg-signal-petrol/10 px-2 py-1 font-mono text-signal-petrol">
                    Trial Premium activ: {formatRemaining(trialRemainingTime.premiumMs)}
                  </span>
                )}
                {trialRemainingTime.ultraMs > 0 && (
                  <span className="rounded-md border border-signal-amber/25 bg-signal-amber/10 px-2 py-1 font-mono text-signal-amber">
                    Trial Ultra activ: {formatRemaining(trialRemainingTime.ultraMs)}
                  </span>
                )}
              </div>
            )}
          </section>
        )}

        {status && (
          <div className="mt-4 rounded-xl border border-signal-sage/20 bg-signal-panel/45 px-3 py-2 font-mono text-xs text-signal-petrol/90 shadow-inner">{status}</div>
        )}
        {rehydratedNotice && (
          <div className="mt-3 rounded-xl border border-signal-petrol/30 bg-signal-petrol/10 px-3 py-2 text-xs text-signal-ink shadow-inner">
            <span className="font-semibold text-signal-petrol">Date vechi actualizate.</span>{" "}
            <span className="text-signal-inkMuted">{rehydratedNotice}</span>
          </div>
        )}

        {!user?.onboardingCompleted && (
          <section className="mt-4 rounded-2xl border border-signal-sage/30 bg-signal-mintSoft/20 p-4 shadow-inner">
            <button
              type="button"
              onClick={() => setIsOnboardingOpen((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-xl px-1 py-1 text-left"
            >
              <span className="text-sm font-semibold tracking-wide text-signal-ink">Onboarding</span>
              <span className="font-mono text-[11px] text-signal-petrol">{selectedLeagueIds.length}/2 ligi</span>
            </button>
            {isOnboardingOpen && (
              <div className="mt-3">
                <p className="text-xs text-signal-inkMuted">Alege ligi în panoul din stânga, apoi confirmă.</p>
                <button
                  type="button"
                  onClick={() => void completeOnboarding()}
                  className="mt-3 rounded-lg bg-signal-petrol px-3 py-2 text-xs font-semibold uppercase tracking-wide text-signal-mist hover:bg-signal-petrolMuted"
                >
                  Finalizează onboarding
                </button>
              </div>
            )}
          </section>
        )}

        <section className="mt-4 rounded-2xl border border-white/[0.07] bg-signal-panel/30 p-1 shadow-inner backdrop-blur-md">
          <button
            type="button"
            onClick={() => setIsNotificationsOpen((prev) => !prev)}
            className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition hover:bg-signal-void/30"
          >
            <span className="text-sm font-semibold tracking-wide text-signal-ink">Notificări</span>
            <span className="font-mono text-[11px] text-signal-petrol">
              {alertsPreview.safe} safe · {alertsPreview.value} value
            </span>
          </button>
          {isNotificationsOpen && (
            <div className="border-t border-white/[0.06] px-4 pb-4 pt-2">
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-signal-panel/55 px-3 py-2 text-xs font-semibold text-signal-petrol">
                  <input type="checkbox" checked={notifySafe} onChange={(event) => setNotifySafe(event.target.checked)} />
                  Safe alerts
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-signal-panel/55 px-3 py-2 text-xs font-semibold text-signal-petrol">
                  <input type="checkbox" checked={notifyValue} onChange={(event) => setNotifyValue(event.target.checked)} />
                  Value alerts
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-signal-panel/55 px-3 py-2 text-xs font-semibold text-signal-petrol">
                  <input
                    type="checkbox"
                    checked={notifyEmail}
                    onChange={(event) => {
                      const next = event.target.checked;
                      setNotifyEmail(next);
                      if (!next) setNotifyEmailConsent(false);
                    }}
                  />
                  Email (beta)
                </label>
              </div>
              {notifyEmail && (
                <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-xl border border-signal-line/80 bg-signal-fog/50 px-3 py-2 text-[11px] text-signal-inkMuted">
                  <input
                    type="checkbox"
                    checked={notifyEmailConsent}
                    onChange={(event) => setNotifyEmailConsent(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Confirm că am citit secțiunea despre e-mail din{" "}
                    <Link to="/privacy" className="font-semibold text-signal-petrolMuted underline-offset-2 hover:underline">
                      politica de confidențialitate
                    </Link>{" "}
                    și sunt de acord cu alertele pe adresa contului.
                  </span>
                </label>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void saveNotificationPrefs()}
                  className="rounded-lg border border-signal-petrol/25 bg-signal-petrol/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-signal-petrol hover:bg-signal-petrol/15"
                >
                  Salvează preferințe
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="mt-3 rounded-2xl border border-white/[0.07] bg-signal-panel/25 p-4 shadow-inner backdrop-blur-sm">
          <h2 className="text-sm font-semibold tracking-wide text-signal-ink">Date personale (GDPR)</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-signal-inkMuted">
            Export JSON — vezi{" "}
            <Link to="/privacy" className="font-medium text-signal-petrol underline-offset-2 hover:underline">
              politica
            </Link>
            .
          </p>
          <button
            type="button"
            disabled={exportBusy}
            onClick={() => void downloadPersonalDataExport()}
            className="mt-3 rounded-lg border border-white/10 bg-signal-fog px-3 py-2 text-[11px] font-semibold text-signal-petrol transition hover:bg-signal-panel disabled:opacity-50"
          >
            {exportBusy ? "Se genereaza..." : "Descarcă export JSON"}
          </button>
        </section>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-4 xl:col-span-3">
            <LeaguePanel
              leaguesSorted={leaguesSorted}
              selectedSet={new Set(selectedLeagueIds)}
              selectedLeagueIds={selectedLeagueIds}
              isLeaguesOpen={isLeaguesOpen}
              searchLeague={searchLeague}
              eliteLeagues={ELITE_LEAGUES}
              setIsLeaguesOpen={setIsLeaguesOpen}
              setSearchLeague={setSearchLeague}
              setSelectedLeagueIds={setSelectedLeagueIdsLimited}
              selectEliteLeagues={() => setSelectedLeagueIdsLimited(leaguesSorted.slice(0, 2).map((league) => Number(league.id)))}
              clearLeagueSelection={() => setSelectedLeagueIdsLimited([])}
            />
          </div>
          <div className="lg:col-span-8 xl:col-span-9">
            {!visiblePreds.length ? (
              <div className="grid h-[340px] place-items-center rounded-[2rem] border border-dashed border-signal-line/30 bg-signal-void/35 text-center text-signal-inkMuted">
                {showSettledMarketsOnly ? "Nu există încă meciuri finalizate cu piețe derivate în selecția curentă." : "Selectează ligi și apasă Predict."}
              </div>
            ) : (
              <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 2xl:grid-cols-3">
                {visiblePreds.map((match) => (
                  <MatchCard
                    key={match.id}
                    row={match}
                    logoColors={{}}
                    hashColor={hashColor}
                    onClick={() => setSelectedMatch(match)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <PerformanceCounterModal
        open={perfCounterModalOpen}
        onClose={() => setPerfCounterModalOpen(false)}
        days={30}
        globalByLeague={userPerformanceByLeague}
        accessToken={session?.access_token ?? null}
        isAdmin={user?.role === "admin"}
        leagueTableHeading="Predicțiile tale · pe ligă (ultimele 30 zile)"
      />
      {selectedMatch && (
        <MatchModal
          match={selectedMatch}
          logoColors={{}}
          hashColor={hashColor}
          onClose={() => setSelectedMatch(null)}
        />
      )}
    </div>
  );
}
