import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LeaguePanel from "../components/LeaguePanel";
import MatchCard from "../components/MatchCard";
import MatchModal from "../components/MatchModal";
import SuccessRateTracker from "../components/SuccessRateTracker";
import { ELITE_LEAGUES } from "../constants/appConstants";
import { useAuth } from "../hooks/useAuth";
import { DayResponse, HistoryStats, League, PredictionRow } from "../types";
import { hashColor, inferSeason, isoToday, localCalendarDateKey, normalizeSelectedDates, useLocalStorageState } from "../utils/appUtils";

export default function UserDashboard() {
  const { user, session, logout, updateFavoriteLeagues, updateNotificationPreferences, markOnboardingComplete } = useAuth();
  const [date, setDate] = useLocalStorageState<string>("footy.user.date", isoToday());
  const [selectedDates, setSelectedDates] = useLocalStorageState<string[]>("footy.user.selectedDates", [isoToday()]);
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<number[]>([]);
  const [favoriteLeaguesByUser, setFavoriteLeaguesByUser] = useLocalStorageState<Record<string, number[]>>("footy.user.favoriteLeagueByUser", {});
  const [predictionsByUser, setPredictionsByUser] = useLocalStorageState<Record<string, PredictionRow[]>>("footy.user.predictionsByUser", {});
  const [searchLeague, setSearchLeague] = useState("");
  const [isLeaguesOpen, setIsLeaguesOpen] = useState(window.innerWidth >= 1024);
  const [preds, setPreds] = useState<PredictionRow[]>([]);
  const [day, setDay] = useState<DayResponse | null>(null);
  const [status, setStatus] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<PredictionRow | null>(null);
  const [historyStats, setHistoryStats] = useState<HistoryStats>({ wins: 0, losses: 0, settled: 0, winRate: 0 });
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifySafe, setNotifySafe] = useState<boolean>(user?.notificationPrefs?.safe ?? true);
  const [notifyValue, setNotifyValue] = useState<boolean>(user?.notificationPrefs?.value ?? true);
  const [notifyEmail, setNotifyEmail] = useState<boolean>(user?.notificationPrefs?.email ?? false);
  const [alertsPreview, setAlertsPreview] = useState<{ safe: number; value: number }>({ safe: 0, value: 0 });
  const [userPredictionMap, setUserPredictionMap] = useLocalStorageState<Record<string, number[]>>("footy.user.predictionMap", {});
  const [dailyUsageMap, setDailyUsageMap] = useLocalStorageState<Record<string, { warm: number; predict: number }>>("footy.user.dailyUsage", {});
  const [usageServerSyncPending, setUsageServerSyncPending] = useState(false);
  const [usageServerSyncFailed, setUsageServerSyncFailed] = useState(false);
  const [usageServerSyncedAt, setUsageServerSyncedAt] = useState<number | null>(null);
  const [usageQuotaExempt, setUsageQuotaExempt] = useState(false);
  const usageFetchGen = useRef(0);

  const todayKey = localCalendarDateKey();
  const userPredictionIds = useMemo(() => {
    if (!user) return [];
    return userPredictionMap[user.id] || [];
  }, [user?.id, userPredictionMap]);
  const usageKey = user?.id ? `${user.id}:${todayKey}` : "";
  const dailyUsage = usageKey ? (dailyUsageMap[usageKey] || { warm: 0, predict: 0 }) : { warm: 0, predict: 0 };
  const limitApplies = !usageQuotaExempt;

  const markUsageConfirmedFromServer = useCallback(() => {
    setUsageServerSyncedAt(Date.now());
    setUsageServerSyncFailed(false);
  }, []);

  const fetchServerDailyUsage = useCallback(
    async (signal?: AbortSignal) => {
      if (!user?.id || !session?.access_token || !usageKey) return;
      const gen = ++usageFetchGen.current;
      setUsageServerSyncPending(true);
      try {
        const qs = new URLSearchParams({
          warmPredictUsage: "1",
          usageDay: todayKey,
          date: todayKey
        });
        const res = await fetch(`/api/fixtures/day?${qs}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
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
    [user?.id, session?.access_token, usageKey, todayKey, setDailyUsageMap, markUsageConfirmedFromServer]
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
    if (!user) return;
    const localFavorites = favoriteLeaguesByUser[user.id] || [];
    if (localFavorites.length) {
      setSelectedLeagueIds(localFavorites);
    } else if (user.favoriteLeagues.length) {
      setSelectedLeagueIds(user.favoriteLeagues);
    } else {
      setSelectedLeagueIds([]);
    }
  }, [user?.id, favoriteLeaguesByUser]);

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
    void loadHistory();
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    if (preds.length > 0) return;
    if (!selectedLeagueIds.length) return;
    void rehydratePredictionsFromHistory();
  }, [user?.id, preds.length, selectedLeagueIds.join("|"), selectedDates.join("|"), date]);

  useEffect(() => {
    void loadHistory();
  }, [user?.id, userPredictionIds.join("|")]);

  useEffect(() => {
    const safeCount = preds.filter((row) => row.recommended?.confidence >= 70).length;
    const valueCount = preds.filter((row) => row.valueBet?.detected).length;
    setAlertsPreview({ safe: safeCount, value: valueCount });
  }, [preds]);

  async function fetchDays(dates: string[]) {
    const effectiveDates = normalizeSelectedDates(dates.length ? dates : [date]);
    try {
      const responses = await Promise.all(
        effectiveDates.map(async (currentDate) => {
          const response = await fetch(`/api/fixtures/day?date=${currentDate}`);
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

  async function loadHistory() {
    try {
      const response = await fetch("/api/history?days=30");
      const json = await response.json();
      if (!json?.ok) return;
      const items = Array.isArray(json.items) ? json.items : [];
      if (!userPredictionIds.length) {
        setHistoryStats({ wins: 0, losses: 0, settled: 0, winRate: 0 });
        return;
      }
      const idSet = new Set(userPredictionIds);
      const owned = items.filter((item: PredictionRow & { validation?: string }) => idSet.has(Number(item.id)));
      const wins = owned.filter((item: any) => item.validation === "win").length;
      const losses = owned.filter((item: any) => item.validation === "loss").length;
      const settled = wins + losses;
      const winRate = settled ? (wins / settled) * 100 : 0;
      setHistoryStats({ wins, losses, settled, winRate });
    } catch {
      // keep defaults
    }
  }

  async function rehydratePredictionsFromHistory() {
    try {
      const response = await fetch("/api/history?days=14&limit=1000");
      const json = await response.json();
      if (!json?.ok || !Array.isArray(json.items)) return;

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
    } catch {
      // silent fallback
    }
  }

  async function warm() {
    if (limitApplies && dailyUsage.warm >= 3) {
      setStatus(
        "Limită Warm (3/zi) în acest browser. Dacă ai folosit contul în altă parte, contorul se aliniază cu serverul când revii în tab sau pui din nou focus pe fereastră."
      );
      return;
    }
    if (!selectedLeagueIds.length) return setStatus("Selecteaza o liga.");
    try {
      const dates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
      let serverUsageSynced = false;
      for (let i = 0; i < dates.length; i++) {
        const currentDate = dates[i];
        const qs = new URLSearchParams({
          date: currentDate,
          leagueIds: selectedLeagueIds.join(","),
          season: String(inferSeason(currentDate))
        });
        if (i === 0) qs.set("usageDay", todayKey);
        const headers: Record<string, string> = {};
        if (i === 0 && session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
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
          setStatus(`Warm a eșuat (HTTP ${response.status}). Limita nu e neapărat atinsă; încearcă din nou sau verifică rețeaua.`);
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
      const dates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
      const batches: PredictionRow[] = [];
      let serverUsageSynced = false;
      for (let i = 0; i < dates.length; i++) {
        const currentDate = dates[i];
        const qs = new URLSearchParams({
          date: currentDate,
          leagueIds: selectedLeagueIds.join(","),
          season: String(inferSeason(currentDate)),
          limit: "50"
        });
        if (i === 0) qs.set("usageDay", todayKey);
        const headers: Record<string, string> = {};
        if (i === 0 && session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
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
          setStatus(`Predict a eșuat (HTTP ${response.status}). Limita nu e neapărat atinsă; încearcă din nou sau verifică rețeaua.`);
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
    try {
      await updateNotificationPreferences({
        safe: notifySafe,
        value: notifyValue,
        email: notifyEmail
      });
      setStatus("Preferintele de notificare au fost salvate.");
    } catch (error: any) {
      setStatus(error?.message || "Nu am putut salva preferintele de notificare.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-[1500px] px-4 py-8 lg:px-6">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-black text-white">Footy Predictor User Dashboard</h1>
            <p className="text-xs text-slate-400">Cont: {user?.email}</p>
          </div>
          <button
            onClick={() => void logout()}
            className="rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-200 hover:bg-slate-800"
          >
            Logout
          </button>
        </header>

        <SuccessRateTracker
          stats={historyStats}
          animatedWins={historyStats.wins}
          animatedLosses={historyStats.losses}
          animatedWinRate={historyStats.winRate}
          isWinRatePulsing={false}
          isHistorySyncing={false}
          pendingHistoryCount={0}
        />

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(event) => {
              const next = event.target.value;
              setDate(next);
              setSelectedDates(normalizeSelectedDates([next]));
              void fetchDays([next]);
            }}
            className="rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm"
          />
          <button
            onClick={warm}
            disabled={limitApplies && dailyUsage.warm >= 3}
            className="rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
          >
            Warm
          </button>
          <button
            onClick={predict}
            disabled={limitApplies && dailyUsage.predict >= 3}
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            Predict
          </button>
          <div className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-[11px] font-semibold text-slate-300">
            <span className="text-slate-200">
              Warm {usageQuotaExempt ? "—" : dailyUsage.warm}/3 · Predict {usageQuotaExempt ? "—" : dailyUsage.predict}/3
            </span>
            {session?.access_token && usageKey ? (
              <span className="mt-1 block text-[10px] font-normal leading-snug text-slate-500">
                {usageQuotaExempt ? (
                  <span className="text-slate-400">Administrator: limită zilnică dezactivată pe server.</span>
                ) : usageServerSyncPending ? (
                  <>Se actualizează contorul de pe server…</>
                ) : usageServerSyncFailed && !usageServerSyncedAt ? (
                  <span className="text-amber-400/90">Nu am putut încărca contorul de pe server.</span>
                ) : usageServerSyncedAt ? (
                  <>
                    Sincronizat cu serverul (
                    {new Date(usageServerSyncedAt).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}).
                    {usageServerSyncFailed ? (
                      <span className="text-amber-400/80"> Ultima reîmprospătare automată a eșuat.</span>
                    ) : null}
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>

        {status && <div className="mt-4 rounded-xl border border-emerald-500/20 bg-slate-900/50 px-3 py-2 text-xs text-emerald-300">{status}</div>}

        {!user?.onboardingCompleted && (
          <section className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-3">
            <button
              onClick={() => setIsOnboardingOpen((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-left"
            >
              <span className="text-sm font-black uppercase tracking-wide text-emerald-200">Onboarding preferinte</span>
              <span className="text-[11px] font-semibold text-slate-300">
                {selectedLeagueIds.length}/2 ligi
              </span>
            </button>
            {isOnboardingOpen && (
              <div className="mt-3">
                <p className="text-xs text-slate-200/80">
                  Selecteaza ligile favorite din panoul de ligi, apoi confirma onboarding-ul.
                </p>
                <button
                  onClick={() => void completeOnboarding()}
                  className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-emerald-500"
                >
                  Finalizeaza onboarding
                </button>
              </div>
            )}
          </section>
        )}

        <section className="mt-4 rounded-2xl border border-cyan-400/30 bg-slate-900/60 p-3">
          <button
            onClick={() => setIsNotificationsOpen((prev) => !prev)}
            className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-left"
          >
            <span className="text-sm font-black uppercase tracking-wide text-cyan-200">Notificari</span>
            <span className="text-[11px] font-semibold text-slate-300">
              {alertsPreview.safe} Safe · {alertsPreview.value} Value
            </span>
          </button>
          {isNotificationsOpen && (
            <div className="mt-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200">
                  <input type="checkbox" checked={notifySafe} onChange={(event) => setNotifySafe(event.target.checked)} />
                  Safe alerts
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200">
                  <input type="checkbox" checked={notifyValue} onChange={(event) => setNotifyValue(event.target.checked)} />
                  Value alerts
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200">
                  <input type="checkbox" checked={notifyEmail} onChange={(event) => setNotifyEmail(event.target.checked)} />
                  Email delivery (beta)
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => void saveNotificationPrefs()}
                  className="rounded-lg border border-cyan-300/40 bg-cyan-500/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-cyan-200 hover:bg-cyan-500/25"
                >
                  Salveaza preferinte
                </button>
              </div>
            </div>
          )}
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
            {!preds.length ? (
              <div className="grid h-[340px] place-items-center rounded-[2rem] border border-dashed border-white/10 text-slate-500">
                Selecteaza ligile favorite si apasa Predict.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">
                {preds.map((match) => (
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
