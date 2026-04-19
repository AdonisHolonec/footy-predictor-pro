import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import LeaguePanel from "./components/LeaguePanel";
import MatchCard from "./components/MatchCard";
import MatchModal from "./components/MatchModal";
import PerformanceCounterModal from "./components/PerformanceCounterModal";
import SuccessRateTracker from "./components/SuccessRateTracker";
import { ModelPulseStrip } from "./components/SignalLab";
import Auth from "./components/Auth";
import {
  BacktestKpi,
  DayResponse,
  HistoryEntry,
  HistoryStats,
  League,
  PerformanceLeagueBreakdown,
  PerformanceUserBreakdown,
  PerformanceUserLeagueBreakdown,
  PredictionRow,
  RiskAlert
} from "./types";
import { ELITE_LEAGUES, FilterMode, SortBy } from "./constants/appConstants";
import { useAuth } from "./hooks/useAuth";
import {
  dominantColorFromImage,
  hashColor,
  inferSeason,
  isoToday,
  localCalendarDateKey,
  normalizeSelectedDates,
  useLocalStorageState
} from "./utils/appUtils";

// --- APP COMPONENT ---
export default function App() {
  const [date, setDate] = useLocalStorageState<string>("footy.date", isoToday());
  const [selectedDates, setSelectedDates] = useLocalStorageState<string[]>("footy.selectedDates", [isoToday()]);
  const [selectedLeagueIds, setSelectedLeagueIds] = useLocalStorageState<number[]>("footy.selectedLeagueIds", []);
  const [day, setDay] = useState<DayResponse | null>(null);
  const [preds, setPreds] = useLocalStorageState<PredictionRow[]>("footy.lastPreds", []);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyStats, setHistoryStats] = useState<HistoryStats>({ wins: 0, losses: 0, settled: 0, winRate: 0 });
  const [status, setStatus] = useState<string>("");
  const [kpi, setKpi] = useState<BacktestKpi | null>(null);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [riskAlerts, setRiskAlerts] = useState<RiskAlert[]>([]);
  const [alertsSeverity, setAlertsSeverity] = useState<"none" | "medium" | "high">("none");
  const [alertDrawdownThreshold, setAlertDrawdownThreshold] = useLocalStorageState<number>("footy.alert.drawdown", 3);
  const [alertDriftThreshold, setAlertDriftThreshold] = useLocalStorageState<number>("footy.alert.drift", 24);
  const [alertLowDataThreshold, setAlertLowDataThreshold] = useLocalStorageState<number>("footy.alert.lowDataShare", 0.35);
  const [draftDrawdownThreshold, setDraftDrawdownThreshold] = useState<number>(alertDrawdownThreshold);
  const [draftDriftThreshold, setDraftDriftThreshold] = useState<number>(alertDriftThreshold);
  const [draftLowDataThreshold, setDraftLowDataThreshold] = useState<number>(alertLowDataThreshold);
  const [thresholdsSaved, setThresholdsSaved] = useState<"idle" | "saved" | "reset">("idle");
  const [isHistorySyncing, setIsHistorySyncing] = useState(false);
  const [isWinRatePulsing, setIsWinRatePulsing] = useState(false);
  const [animatedWins, setAnimatedWins] = useState(0);
  const [animatedLosses, setAnimatedLosses] = useState(0);
  const [animatedWinRate, setAnimatedWinRate] = useState(0);
  const [logoColors, setLogoColors] = useLocalStorageState<Record<string, string>>("footy.logoColors", {});
  const [searchLeague, setSearchLeague] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("ALL");
  const [sortBy, setSortBy] = useState<SortBy>("TIME");
  const [selectedMatch, setSelectedMatch] = useState<PredictionRow | null>(null);
  const [isLeaguesOpen, setIsLeaguesOpen] = useState(window.innerWidth >= 1024);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isAdminWorking, setIsAdminWorking] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageSnapshot, setUsageSnapshot] = useState<{
    today: { date?: string; count: number; limit: number; updatedAt?: string | null };
    yesterday: { date?: string; count: number; limit: number; updatedAt?: string | null };
    history: Array<{ date?: string; count: number; limit: number; updatedAt?: string | null }>;
  } | null>(null);
  const [perfCounterModalOpen, setPerfCounterModalOpen] = useState(false);
  const [perfAdminSnapshot, setPerfAdminSnapshot] = useState<{
    byUser: PerformanceUserBreakdown[];
    byUserLeague: PerformanceUserLeagueBreakdown[];
  } | null>(null);
  const [perfAdminLoading, setPerfAdminLoading] = useState(false);
  const {
    user,
    session,
    loading: authLoading,
    error: authError,
    lastAuthEvent,
    managedProfiles,
    login,
    signup,
    sendPasswordResetEmail,
    updatePassword,
    logout,
    updateFavoriteLeagues,
    refreshManagedProfiles,
    updateProfileRole,
    toggleProfileBlock
  } = useAuth();

  const loadPerfAdmin = useCallback(async () => {
    if (!session?.access_token || user?.role !== "admin") return;
    setPerfAdminLoading(true);
    try {
      const res = await fetch("/api/history?performance=1&days=30", {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      const json = (await res.json()) as {
        ok?: boolean;
        byUser?: PerformanceUserBreakdown[];
        byUserLeague?: PerformanceUserLeagueBreakdown[];
      };
      if (json?.ok) {
        setPerfAdminSnapshot({
          byUser: Array.isArray(json.byUser) ? json.byUser : [],
          byUserLeague: Array.isArray(json.byUserLeague) ? json.byUserLeague : []
        });
      }
    } catch {
      // keep previous snapshot
    } finally {
      setPerfAdminLoading(false);
    }
  }, [session?.access_token, user?.role]);

  useEffect(() => {
    if (user?.role !== "admin") {
      setPerfAdminSnapshot(null);
      return;
    }
    void loadPerfAdmin();
  }, [user?.role, loadPerfAdmin]);

  function requireAuth(message = "Autentifica-te pentru functiile personalizate.") {
    if (user) return true;
    setStatus(message);
    setIsAuthOpen(true);
    return false;
  }

  const leaguesSorted = useMemo(() => {
    const leagues = day?.leagues ?? [];
    const filtered = leagues.filter(l => l.name.toLowerCase().includes(searchLeague.toLowerCase()) || l.country.toLowerCase().includes(searchLeague.toLowerCase()));
    const elite = filtered.filter(l => ELITE_LEAGUES.includes(Number(l.id)));
    const rest = filtered.filter(l => !ELITE_LEAGUES.includes(Number(l.id))).sort((a, b) => b.matches - a.matches);
    return [...elite, ...rest];
  }, [day, searchLeague]);

  const displayedMatches = useMemo(() => {
    let list = [...preds];
    if (filterMode === "VALUE") list = list.filter(m => m.valueBet?.detected);
    if (filterMode === "SAFE") list = list.filter((m) => !m.insufficientData && m.recommended.confidence >= 70);
    list.sort((a, b) => {
      if (sortBy === "TIME") return new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime();
      if (sortBy === "CONFIDENCE") return b.recommended.confidence - a.recommended.confidence;
      if (sortBy === "VALUE") return (b.valueBet?.ev || 0) - (a.valueBet?.ev || 0);
      return 0;
    });
    return list;
  }, [preds, filterMode, sortBy]);

  const trackerStats = useMemo(() => {
    return historyStats;
  }, [historyStats]);
  const pendingHistoryCount = useMemo(
    () => history.filter((item) => item.validation === "pending").length,
    [history]
  );
  const predIdSet = useMemo(() => new Set(preds.map((p) => p.id)), [preds]);
  /** Pending rows in history that match the currently displayed prediction list (correlates with „Toate”). */
  const pendingAmongDisplayedPreds = useMemo(
    () => history.filter((h) => h.validation === "pending" && predIdSet.has(h.id)).length,
    [history, predIdSet]
  );
  const globalPerformanceByLeague = useMemo((): PerformanceLeagueBreakdown[] => {
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
  const prevWinRateRef = useRef<number>(trackerStats.winRate);

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

  async function fetchDays(dates: string[]) {
    const effectiveDates = normalizeSelectedDates(dates.length ? dates : [date]);
    setStatus("Încarc ligile...");
    try {
      const responses = await Promise.all(
        effectiveDates.map(async (d) => {
          const r = await fetch(`/api/fixtures/day?date=${d}`);
          const j = await r.json();
          if (!j.ok) throw new Error(j.error || "Eroare API");
          return j as DayResponse;
        })
      );

      const leaguesMap = new Map<number, League>();
      for (const resp of responses) {
        for (const lg of resp.leagues || []) {
          const existing = leaguesMap.get(lg.id);
          if (existing) {
            existing.matches += lg.matches;
            if (!existing.logo && lg.logo) existing.logo = lg.logo;
          } else {
            leaguesMap.set(lg.id, { ...lg });
          }
        }
      }

      const aggregated: DayResponse = {
        ok: true,
        date: effectiveDates.join(", "),
        totalFixtures: responses.reduce((sum, resp) => sum + (resp.totalFixtures || 0), 0),
        leagues: Array.from(leaguesMap.values()),
        usage: responses[responses.length - 1]?.usage || { date: isoToday(), count: 0, limit: 100 }
      };

      setDay(aggregated);
      setStatus(aggregated.totalFixtures ? `OK: ${aggregated.totalFixtures} meciuri pentru ${effectiveDates.length} zi(le).` : "Lipsă meciuri.");
    } catch (e: any) { setStatus(`Eroare: ${e.message}`); }
  }

  async function warm() {
    if (!requireAuth()) return;
    if (!selectedLeagueIds.length) return setStatus("Selectează o ligă.");
    setStatus("Se procesează datele (Warm)...");
    try {
      const dates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
      const usageDay = localCalendarDateKey();
      const results = [];
      for (let i = 0; i < dates.length; i++) {
        const currentDate = dates[i];
        const qs = new URLSearchParams({ date: currentDate, leagueIds: selectedLeagueIds.join(","), season: String(inferSeason(currentDate)) });
        if (i === 0) qs.set("usageDay", usageDay);
        const headers: Record<string, string> = {};
        if (i === 0 && session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        const r = await fetch(`/api/warm?${qs}`, { headers });
        if (r.status === 429) {
          try {
            const err = await r.json();
            setStatus(typeof err?.error === "string" ? err.error : "Limită zilnică Warm atinsă.");
          } catch {
            setStatus("Limită zilnică Warm atinsă.");
          }
          return;
        }
        if (!r.ok) {
          setStatus(`Warm a eșuat (HTTP ${r.status}).`);
          return;
        }
        const j = await r.json();
        results.push({ date: currentDate, ok: !!j.ok });
      }
      const okCount = results.filter(r => r.ok).length;
      setStatus(okCount === results.length ? `Date pregătite cu succes pentru ${results.length} zi(le).` : `Warm finalizat parțial (${okCount}/${results.length}).`);
    } catch (e: any) { setStatus(`Error: ${e.message}`); }
  }

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

  function selectEliteLeagues() {
    if (!requireAuth()) return;
    const eliteIds = (day?.leagues ?? [])
      .filter(lg => ELITE_LEAGUES.includes(Number(lg.id)))
      .map(lg => Number(lg.id));
    setSelectedLeagueIds(eliteIds);
    setStatus(eliteIds.length ? `Selectate ${eliteIds.length} ligi elite.` : "Nu există ligi elite disponibile.");
  }

  function clearLeagueSelection() {
    if (!requireAuth()) return;
    setSelectedLeagueIds([]);
    setStatus("Selecția ligilor a fost resetată.");
  }

  async function predict() {
    if (!requireAuth()) return;
    if (!selectedLeagueIds.length) return setStatus("Selectează o ligă.");
    setStatus("Generez predicțiile Premium...");
    try {
      const dates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
      const usageDay = localCalendarDateKey();
      const batches: PredictionRow[] = [];
      for (let i = 0; i < dates.length; i++) {
        const currentDate = dates[i];
        const qs = new URLSearchParams({ date: currentDate, leagueIds: selectedLeagueIds.join(","), season: String(inferSeason(currentDate)), limit: "50" });
        if (i === 0) qs.set("usageDay", usageDay);
        const headers: Record<string, string> = {};
        if (i === 0 && session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        const r = await fetch(`/api/predict?${qs}`, { headers });
        if (r.status === 429) {
          try {
            const err = await r.json();
            setStatus(typeof err?.error === "string" ? err.error : "Limită zilnică Predict atinsă.");
          } catch {
            setStatus("Limită zilnică Predict atinsă.");
          }
          return;
        }
        if (!r.ok) {
          setStatus(`Predict a eșuat (HTTP ${r.status}).`);
          return;
        }
        const j = await r.json();
        if (Array.isArray(j)) batches.push(...j);
      }
      const deduped = Array.from(new Map(batches.map((row) => [row.id, row])).values());
      setPreds(deduped);
      const syncHeaders: Record<string, string> = {};
      if (session?.access_token) syncHeaders.Authorization = `Bearer ${session.access_token}`;
      await fetch("/api/history?sync=1&days=30", { method: "POST", headers: syncHeaders }).catch(() => null);
      await loadHistory(30);
      await loadKpi(45);
      await loadAlerts(7);
      setStatus(`Gata! ${deduped.length} predicții generate pentru ${dates.length} zi(le).`);
      void prefetchColors(deduped);
      if (window.innerWidth < 1024) setIsLeaguesOpen(false);
      if (user?.role === "admin") void loadPerfAdmin();
    } catch (e: any) { setStatus(`Error: ${e.message}`); }
  }

  async function loadHistory(days = 30) {
    try {
      const qs = new URLSearchParams({ days: String(days) });
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        qs.set("mine", "1");
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      const res = await fetch(`/api/history?${qs.toString()}`, { headers });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Nu am putut încărca istoricul.");
      setHistory(Array.isArray(json.items) ? json.items : []);
      setHistoryStats(json.stats || { wins: 0, losses: 0, settled: 0, winRate: 0 });
    } catch (error: any) {
      setHistory([]);
      setHistoryStats({ wins: 0, losses: 0, settled: 0, winRate: 0 });
      setStatus((prev) => prev || `Istoric indisponibil: ${error?.message || "eroare necunoscută"}`);
    }
  }

  async function syncHistory(days = 30) {
    setIsHistorySyncing(true);
    try {
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      await fetch(`/api/history?sync=1&days=${days}`, { method: "POST", headers });
      await loadHistory(days);
    } catch {
      // silent: indicator is enough
    } finally {
      setIsHistorySyncing(false);
    }
  }

  async function loadKpi(days = 45) {
    setKpiLoading(true);
    try {
      const res = await fetch(`/api/backtest?view=kpi&days=${days}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Nu am putut încărca KPI.");
      setKpi(json.latest || null);
    } catch {
      setKpi(null);
    } finally {
      setKpiLoading(false);
    }
  }

  async function loadAlerts(
    days = 7,
    overrides?: { drawdown?: number; drift?: number; lowDataShare?: number }
  ) {
    try {
      const drawdown = overrides?.drawdown ?? alertDrawdownThreshold;
      const drift = overrides?.drift ?? alertDriftThreshold;
      const lowDataShare = overrides?.lowDataShare ?? alertLowDataThreshold;
      const qs = new URLSearchParams({
        days: String(days),
        drawdown: String(drawdown),
        drift: String(drift),
        lowDataShare: String(lowDataShare)
      });
      const res = await fetch(`/api/alerts?${qs.toString()}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Nu am putut încărca alertele.");
      setRiskAlerts(Array.isArray(json.alerts) ? json.alerts : []);
      setAlertsSeverity(json.severity === "high" || json.severity === "medium" ? json.severity : "none");
    } catch {
      setRiskAlerts([]);
      setAlertsSeverity("none");
    }
  }

  useEffect(() => {
    const normalized = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
    if (normalized.length === 0) return;
    if (normalized.join("|") !== (selectedDates || []).join("|")) {
      setSelectedDates(normalized);
      return;
    }
    void fetchDays(normalized);
  }, [date, selectedDates]);
  useEffect(() => {
    void loadHistory(30);
    void loadKpi(45);
    void loadAlerts(7);
  }, []);
  useEffect(() => {
    if (!session?.access_token) return;
    void syncHistory(30);
  }, [session?.access_token]);
  useEffect(() => {
    setDraftDrawdownThreshold(alertDrawdownThreshold);
    setDraftDriftThreshold(alertDriftThreshold);
    setDraftLowDataThreshold(alertLowDataThreshold);
  }, [alertDrawdownThreshold, alertDriftThreshold, alertLowDataThreshold]);
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

  const selectedSet = new Set(selectedLeagueIds);
  const usageCount = day?.usage?.count || 0;
  const usageLimit = day?.usage?.limit || 100;
  const usagePct = (usageCount / usageLimit) * 100;
  const hasThresholdDraftChanges =
    Math.abs(draftDrawdownThreshold - alertDrawdownThreshold) > 0.0001
    || Math.abs(draftDriftThreshold - alertDriftThreshold) > 0.0001
    || Math.abs(draftLowDataThreshold - alertLowDataThreshold) > 0.0001;

  function normalizeThresholds(drawdown: number, drift: number, lowDataShare: number) {
    return {
      drawdown: Math.max(0.5, Math.min(Number(drawdown) || 3, 20)),
      drift: Math.max(5, Math.min(Number(drift) || 24, 100)),
      lowDataShare: Math.max(0.05, Math.min(Number(lowDataShare) || 0.35, 0.95))
    };
  }

  async function applyAlertThresholds() {
    if (!requireAuth()) return;
    const normalized = normalizeThresholds(draftDrawdownThreshold, draftDriftThreshold, draftLowDataThreshold);
    setAlertDrawdownThreshold(normalized.drawdown);
    setAlertDriftThreshold(normalized.drift);
    setAlertLowDataThreshold(normalized.lowDataShare);
    await loadAlerts(7, normalized);
    setThresholdsSaved("saved");
  }

  async function resetAlertThresholds() {
    if (!requireAuth()) return;
    const defaults = { drawdown: 3, drift: 24, lowDataShare: 0.35 };
    setDraftDrawdownThreshold(defaults.drawdown);
    setDraftDriftThreshold(defaults.drift);
    setDraftLowDataThreshold(defaults.lowDataShare);
    setAlertDrawdownThreshold(defaults.drawdown);
    setAlertDriftThreshold(defaults.drift);
    setAlertLowDataThreshold(defaults.lowDataShare);
    await loadAlerts(7, defaults);
    setThresholdsSaved("reset");
  }

  useEffect(() => {
    if (thresholdsSaved === "idle") return;
    const timer = setTimeout(() => setThresholdsSaved("idle"), 1400);
    return () => clearTimeout(timer);
  }, [thresholdsSaved]);

  useEffect(() => {
    if (!user) return;
    const savedFavorites = Array.isArray(user.favoriteLeagues) ? user.favoriteLeagues : [];
    if (!savedFavorites.length) return;
    const current = Array.from(new Set(selectedLeagueIds));
    const target = Array.from(new Set(savedFavorites));
    if (current.join(",") !== target.join(",")) {
      setSelectedLeagueIds(target);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    const saveTimer = setTimeout(() => {
      void updateFavoriteLeagues(selectedLeagueIds).catch(() => {
        setStatus("Nu am putut salva preferintele utilizatorului.");
      });
    }, 450);
    return () => clearTimeout(saveTimer);
  }, [user?.id, selectedLeagueIds, updateFavoriteLeagues]);

  useEffect(() => {
    if (!lastAuthEvent) return;
    if (lastAuthEvent === "PASSWORD_RECOVERY") {
      setIsAuthOpen(true);
      setStatus("Link-ul de reset este valid. Seteaza parola noua.");
      return;
    }
    if (lastAuthEvent === "SIGNED_IN") {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      if (hashParams.get("type") === "signup") {
        setStatus("Email confirmat cu succes. Bine ai revenit!");
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      }
    }
  }, [lastAuthEvent]);

  useEffect(() => {
    if (user?.role !== "admin") return;
    void refreshManagedProfiles().catch(() => {
      setStatus("Nu am putut incarca lista utilizatorilor.");
    });
  }, [user?.id, user?.role, refreshManagedProfiles]);

  async function handleLogin(email: string, password: string) {
    setIsAuthSubmitting(true);
    try {
      await login(email, password);
      setStatus("Autentificat cu succes.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Autentificarea a esuat.";
      setStatus(message);
      throw error;
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleSignup(email: string, password: string) {
    setIsAuthSubmitting(true);
    try {
      await signup(email, password);
      setStatus("Cont creat. Verifica email-ul pentru confirmare daca este necesar.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Inregistrarea a esuat.";
      setStatus(message);
      throw error;
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
      setStatus("Deconectat.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Logout esuat.";
      setStatus(message);
    }
  }

  async function handleForgotPassword(email: string) {
    setIsAuthSubmitting(true);
    try {
      await sendPasswordResetEmail(email);
      setStatus("Email-ul pentru reset parola a fost trimis.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Nu am putut trimite link-ul de reset.";
      setStatus(message);
      throw error;
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleUpdatePassword(newPassword: string) {
    setIsAuthSubmitting(true);
    try {
      await updatePassword(newPassword);
      setStatus("Parola a fost actualizata cu succes.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Nu am putut actualiza parola.";
      setStatus(message);
      throw error;
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleAdminRoleChange(targetUserId: string, role: "user" | "admin") {
    setIsAdminWorking(true);
    try {
      await updateProfileRole(targetUserId, role);
      setStatus(`Rol actualizat la ${role} pentru ${targetUserId.slice(0, 8)}...`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Nu am putut actualiza rolul.";
      setStatus(message);
    } finally {
      setIsAdminWorking(false);
    }
  }

  async function handleAdminToggleBlock(targetUserId: string, isBlocked: boolean) {
    setIsAdminWorking(true);
    try {
      await toggleProfileBlock(targetUserId, isBlocked);
      setStatus(`${isBlocked ? "Blocat" : "Deblocat"} utilizator ${targetUserId.slice(0, 8)}...`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Nu am putut actualiza statusul utilizatorului.";
      setStatus(message);
    } finally {
      setIsAdminWorking(false);
    }
  }

  async function loadUsageSnapshot() {
    setUsageLoading(true);
    try {
      const response = await fetch("/api/fixtures/day?usageOnly=1&usageDays=7");
      const json = await response.json();
      if (!json?.ok) throw new Error(json?.error || "Nu am putut incarca usage.");
      setUsageSnapshot({
        today: json.usage || { count: 0, limit: 100, updatedAt: null },
        yesterday: json.yesterday || { count: 0, limit: 100, updatedAt: null },
        history: Array.isArray(json.history) ? json.history : []
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nu am putut incarca usage.";
      setStatus(message);
    } finally {
      setUsageLoading(false);
    }
  }

  const modelPulse = useMemo(() => {
    const cal = localCalendarDateKey();
    const season = inferSeason(date);
    if (kpiLoading) return { tone: "watch" as const, status: `Încărcare KPI · ${cal}` };
    const hit = (kpi?.hitRate ?? 0).toFixed(1);
    const roi = (kpi?.roi ?? 0).toFixed(2);
    if (alertsSeverity === "high") return { tone: "alert" as const, status: `Risk · ROI ${roi}% · S${season} · ${cal}` };
    if (alertsSeverity === "medium") return { tone: "watch" as const, status: `Atenție · Hit ${hit}% · ${cal}` };
    return { tone: "healthy" as const, status: `Calibrat · Hit ${hit}% · ROI ${roi}% · ${cal}` };
  }, [kpiLoading, kpi?.hitRate, kpi?.roi, alertsSeverity, date]);

  return (
    <div className="atelier-page relative min-h-screen font-sans">
      <div className="atelier-bg" aria-hidden />
      <div className="relative z-10 mx-auto max-w-[1600px] px-4 py-8 lg:px-6">
        {/* HEADER */}
        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-sage">
                {localCalendarDateKey()} · S{inferSeason(date)}
              </p>
              <h1 className="font-display text-3xl font-semibold tracking-tight text-signal-petrol md:text-4xl lg:text-5xl">Footy Predictor</h1>
              <p className="mt-1 max-w-xl text-sm text-signal-inkMuted">Lab predicții · semnale, calibrare și inteligență tactică.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ModelPulseStrip status={modelPulse.status} tone={modelPulse.tone} />
              </div>
              <SuccessRateTracker
                stats={trackerStats}
                animatedWins={animatedWins}
                animatedLosses={animatedLosses}
                animatedWinRate={animatedWinRate}
                isWinRatePulsing={isWinRatePulsing}
                isHistorySyncing={isHistorySyncing}
                pendingHistoryCount={pendingHistoryCount}
                displayedPredsCount={preds.length}
                pendingAmongDisplayedPreds={pendingAmongDisplayedPreds}
                onBreakdownClick={() => setPerfCounterModalOpen(true)}
              />
              <div className="mt-3 grid max-w-[760px] grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl border border-signal-line/80 bg-white/60 px-3 py-2 shadow-inner">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-signal-inkMuted">KPI ROI</div>
                  <div className={`font-mono text-sm font-semibold tabular-nums ${((kpi?.roi || 0) >= 0) ? "text-signal-petrolMuted" : "text-signal-rose"}`}>
                    {kpiLoading ? "..." : `${(kpi?.roi || 0).toFixed(2)}%`}
                  </div>
                </div>
                <div className="rounded-xl border border-signal-line/80 bg-white/60 px-3 py-2 shadow-inner">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-signal-inkMuted">KPI Hit Rate</div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-signal-petrolMuted">
                    {kpiLoading ? "..." : `${(kpi?.hitRate || 0).toFixed(2)}%`}
                  </div>
                </div>
                <div className="rounded-xl border border-signal-line/80 bg-white/60 px-3 py-2 shadow-inner">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-signal-inkMuted">KPI Drawdown</div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-signal-amber">
                    {kpiLoading ? "..." : `${(kpi?.drawdown || 0).toFixed(2)}u`}
                  </div>
                </div>
                <div className="rounded-xl border border-signal-line/80 bg-white/60 px-3 py-2 shadow-inner">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-signal-inkMuted">KPI Settled</div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-signal-petrol">
                    {kpiLoading ? "..." : `${kpi?.settled || 0}`}
                  </div>
                </div>
              </div>
              <div className={`mt-2 max-w-[760px] rounded-xl border px-3 py-2 ${
                alertsSeverity === "high"
                  ? "border-signal-rose/40 bg-signal-rose/10"
                  : alertsSeverity === "medium"
                  ? "border-signal-amber/45 bg-signal-amber/10"
                  : "border-signal-sage/35 bg-signal-mintSoft/30"
              }`}>
                <div className="text-[9px] font-semibold uppercase tracking-widest text-signal-inkMuted">Auto alerting</div>
                <div className="mt-1 text-xs font-medium text-signal-petrol">
                  {riskAlerts.length
                    ? riskAlerts.map((a) => a.message).join(" • ")
                    : "No active risk alerts"}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="flex items-center gap-2 text-[10px] font-semibold text-signal-inkMuted">
                    DD
                    <input
                      type="number"
                      min={0.5}
                      max={20}
                      step={0.1}
                      value={draftDrawdownThreshold}
                      onChange={(e) => setDraftDrawdownThreshold(Number(e.target.value))}
                      className="w-full rounded-md border border-signal-line bg-white px-2 py-1 font-mono text-[10px] text-signal-petrol"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-[10px] font-semibold text-signal-inkMuted">
                    Drift
                    <input
                      type="number"
                      min={5}
                      max={100}
                      step={1}
                      value={draftDriftThreshold}
                      onChange={(e) => setDraftDriftThreshold(Number(e.target.value))}
                      className="w-full rounded-md border border-signal-line bg-white px-2 py-1 font-mono text-[10px] text-signal-petrol"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-[10px] font-semibold text-signal-inkMuted">
                    LowData
                    <input
                      type="number"
                      min={0.05}
                      max={0.95}
                      step={0.01}
                      value={draftLowDataThreshold}
                      onChange={(e) => setDraftLowDataThreshold(Number(e.target.value))}
                      className="w-full rounded-md border border-signal-line bg-white px-2 py-1 font-mono text-[10px] text-signal-petrol"
                    />
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => void applyAlertThresholds()}
                    disabled={!hasThresholdDraftChanges}
                    className="rounded-md bg-signal-petrol px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-signal-petrolMuted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Apply thresholds
                  </button>
                  <button
                    onClick={() => void resetAlertThresholds()}
                    className="rounded-md border border-signal-line bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-signal-petrol hover:bg-signal-fog"
                  >
                    Reset defaults
                  </button>
                  {thresholdsSaved !== "idle" && (
                    <span className="rounded-md border border-signal-sage/35 bg-signal-mintSoft/50 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-signal-petrol">
                      {thresholdsSaved === "saved" ? "Saved" : "Defaults restored"}
                    </span>
                  )}
                </div>
                <div className="mt-2 font-mono text-[9px] font-medium uppercase tracking-wide text-signal-inkMuted">
                  Active thresholds: DD {alertDrawdownThreshold.toFixed(2)} | Drift {alertDriftThreshold.toFixed(0)} | LowData {(alertLowDataThreshold * 100).toFixed(0)}%
                </div>
              </div>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
            <div className="flex w-full max-w-[200px] flex-col items-start lg:min-w-[220px] lg:items-end">
              <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">
                API ·{" "}
                <span className={usagePct > 80 ? "text-signal-rose" : "text-signal-sage"}>
                  {usageCount} / {usageLimit}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full border border-signal-line/60 bg-signal-fog">
                <div style={{ width: `${usagePct}%` }} className={`h-full rounded-full ${usagePct > 80 ? "bg-signal-rose" : "bg-gradient-to-r from-signal-petrol to-signal-sage"}`} />
              </div>
            </div>
            <div className="flex flex-col items-stretch gap-2 lg:gap-3">
              <div className="flex justify-end">
                {authLoading ? (
                  <div className="rounded-xl border border-signal-line bg-white/70 px-3 py-2 text-xs font-semibold text-signal-inkMuted shadow-inner">
                    Checking session...
                  </div>
                ) : user ? (
                  <div className="flex items-center gap-2 rounded-xl border border-signal-sage/35 bg-signal-mintSoft/40 px-3 py-2 shadow-inner">
                    <span className="max-w-[180px] truncate text-xs font-semibold text-signal-petrol">{user.email}</span>
                    <button
                      onClick={() => void handleLogout()}
                      className="rounded-md border border-signal-line bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-signal-petrol hover:bg-signal-fog"
                    >
                      Logout
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsAuthOpen(true)}
                    className="rounded-xl border border-signal-petrol/25 bg-signal-petrol/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-signal-petrol hover:bg-signal-petrol/15"
                  >
                    Login / Signup
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap lg:flex-nowrap lg:gap-3">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    const next = e.target.value;
                    setDate(next);
                    setSelectedDates((prev) => {
                      const filtered = prev.filter((d) => d !== date);
                      return normalizeSelectedDates([next, ...filtered]);
                    });
                  }}
                  className="col-span-2 w-full rounded-xl border border-signal-line/80 bg-white/80 px-4 py-2.5 text-sm text-signal-petrol outline-none focus:ring-2 focus:ring-signal-sage/35 sm:col-span-1"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDates((prev) => {
                      const normalized = normalizeSelectedDates(prev.length ? prev : [date]);
                      if (normalized.length >= 3) {
                        setStatus("Poți selecta maximum 3 zile.");
                        return normalized;
                      }
                      const base = normalized[normalized.length - 1] || isoToday();
                      const nextDate = new Date(base);
                      nextDate.setDate(nextDate.getDate() + 1);
                      return normalizeSelectedDates([...normalized, nextDate.toISOString().slice(0, 10)]);
                    });
                  }}
                  className="touch-manipulation rounded-xl border border-signal-line bg-white/80 px-4 py-2.5 text-sm font-semibold text-signal-petrol transition-all hover:bg-signal-fog active:bg-white"
                >
                  + Zi
                </button>
                <button
                  type="button"
                  onClick={warm}
                  disabled={!user}
                  className="touch-manipulation rounded-xl border border-signal-line bg-white/80 px-4 py-2.5 text-sm font-semibold text-signal-petrol transition-all hover:bg-signal-fog disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Warm
                </button>
                <button
                  type="button"
                  onClick={predict}
                  disabled={!user}
                  className="touch-manipulation col-span-2 w-full rounded-xl bg-signal-petrol px-6 py-2.5 text-sm font-semibold text-white shadow-atelier transition-all hover:bg-signal-petrolMuted active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1 sm:w-auto"
                >
                  Predict
                </button>
              </div>
              <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                {normalizeSelectedDates(selectedDates.length ? selectedDates : [date]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setSelectedDates((prev) => {
                        const next = prev.filter((item) => item !== d);
                        const normalized = normalizeSelectedDates(next.length ? next : [date]);
                        setDate(normalized[0] || isoToday());
                        return normalized;
                      });
                    }}
                    className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold ${
                      d === date ? "border-signal-sage/45 bg-signal-mintSoft/50 text-signal-petrol" : "border-signal-line bg-white/60 text-signal-inkMuted"
                    }`}
                    title="Elimină ziua"
                  >
                    {d} {normalizeSelectedDates(selectedDates.length ? selectedDates : [date]).length > 1 ? "✕" : ""}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {status && (
          <div className="mb-6 rounded-xl border border-signal-sage/30 bg-white/70 p-3 font-mono text-xs text-signal-petrolMuted shadow-inner">
            {"> "}
            {status}
          </div>
        )}

        {user?.role === "admin" && (
          <section className="mb-6 rounded-2xl border border-signal-line/80 bg-white/55 p-4 shadow-atelier backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-signal-petrol">Admin · utilizatori</h2>
                <p className="text-xs text-signal-inkMuted">Roluri, blocare și preferințe.</p>
                <p className="mt-1 text-[10px] text-signal-inkMuted">
                  Warm/Predict (calendar local): <span className="font-mono text-signal-petrol">{localCalendarDateKey()}</span>
                  {" · "}
                  <Link to="/privacy" className="font-medium text-signal-petrolMuted underline-offset-2 hover:underline">
                    GDPR
                  </Link>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshManagedProfiles()}
                disabled={isAdminWorking}
                className="rounded-lg border border-signal-line bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-signal-petrol hover:bg-signal-fog disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
            <div className="mt-3 rounded-xl border border-signal-line/60 bg-signal-fog/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-signal-petrol">API usage snapshot</p>
                <button
                  type="button"
                  onClick={() => void loadUsageSnapshot()}
                  disabled={usageLoading}
                  className="rounded-md border border-signal-sage/35 bg-signal-mintSoft/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-signal-petrol disabled:opacity-50"
                >
                  {usageLoading ? "Loading..." : "Load usage"}
                </button>
              </div>
              {usageSnapshot && (
                <div className="mt-2 text-[11px] text-signal-inkMuted">
                  <p>
                    Today: <span className="font-mono font-semibold text-signal-petrol">{usageSnapshot.today.count}/{usageSnapshot.today.limit}</span> | Yesterday:{" "}
                    <span className="font-mono font-semibold text-signal-petrolMuted">{usageSnapshot.yesterday.count}/{usageSnapshot.yesterday.limit}</span>
                  </p>
                  <p className="mt-1 text-[10px]">
                    Last 7 days: {usageSnapshot.history.map((row) => `${row.date ?? "-"}=${row.count}`).join(" · ") || "-"}
                  </p>
                </div>
              )}
            </div>
            <div className="mt-4 rounded-xl border border-signal-sage/25 bg-white/50 p-3 shadow-inner">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-signal-petrol">Performance counter · 30 zile (server)</p>
                <button
                  type="button"
                  onClick={() => void loadPerfAdmin()}
                  disabled={perfAdminLoading}
                  className="touch-manipulation rounded-md border border-signal-petrol/20 bg-signal-petrol/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-signal-petrol disabled:opacity-50"
                >
                  {perfAdminLoading ? "Se încarcă…" : "Reîncarcă"}
                </button>
              </div>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">Pe utilizator</p>
                  <div className="max-h-48 overflow-auto rounded-lg border border-signal-line/60 bg-white/60">
                    <table className="min-w-full text-left font-mono text-[10px] text-signal-petrol">
                      <thead className="sticky top-0 bg-signal-fog/95 text-[9px] uppercase text-signal-inkMuted">
                        <tr>
                          <th className="px-2 py-1.5">Email</th>
                          <th className="px-2 py-1.5 text-right">W</th>
                          <th className="px-2 py-1.5 text-right">L</th>
                          <th className="px-2 py-1.5 text-right">Pend</th>
                          <th className="px-2 py-1.5 text-right">Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(perfAdminSnapshot?.byUser || []).map((row) => (
                          <tr key={row.userId} className="border-t border-signal-line/40">
                            <td className="max-w-[160px] truncate px-2 py-1 text-[9px]" title={row.email ? `${row.email} · ${row.userId}` : row.userId}>
                              {row.email || "—"}
                            </td>
                            <td className="px-2 py-1 text-right text-signal-petrolMuted">{row.wins}</td>
                            <td className="px-2 py-1 text-right text-signal-rose">{row.losses}</td>
                            <td className="px-2 py-1 text-right text-signal-amber">{row.pending}</td>
                            <td className="px-2 py-1 text-right text-signal-sage">{row.settled > 0 ? ((row.wins / row.settled) * 100).toFixed(1) : "0.0"}%</td>
                          </tr>
                        ))}
                        {!perfAdminSnapshot?.byUser?.length && !perfAdminLoading && (
                          <tr>
                            <td colSpan={5} className="px-2 py-3 text-center text-signal-inkMuted">
                              Fără date (utilizatorii trebuie să ruleze Predict autentificat).
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">Utilizator + ligă</p>
                  <div className="max-h-48 overflow-auto rounded-lg border border-signal-line/60 bg-white/60">
                    <table className="min-w-full text-left font-mono text-[10px] text-signal-petrol">
                      <thead className="sticky top-0 bg-signal-fog/95 text-[9px] uppercase text-signal-inkMuted">
                        <tr>
                          <th className="px-2 py-1.5">Email</th>
                          <th className="px-2 py-1.5">Ligă</th>
                          <th className="px-2 py-1.5 text-right">W</th>
                          <th className="px-2 py-1.5 text-right">L</th>
                          <th className="px-2 py-1.5 text-right">Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(perfAdminSnapshot?.byUserLeague || []).map((row) => (
                          <tr key={`${row.userId}-${row.leagueId}-${row.leagueName}`} className="border-t border-signal-line/40">
                            <td className="max-w-[100px] truncate px-2 py-1 text-[8px]" title={row.email ? `${row.email} · ${row.userId}` : row.userId}>
                              {row.email ? (row.email.length > 18 ? `${row.email.slice(0, 18)}…` : row.email) : "—"}
                            </td>
                            <td className="max-w-[100px] truncate px-2 py-1" title={row.leagueName}>
                              {row.leagueName || row.leagueId}
                            </td>
                            <td className="px-2 py-1 text-right text-signal-petrolMuted">{row.wins}</td>
                            <td className="px-2 py-1 text-right text-signal-rose">{row.losses}</td>
                            <td className="px-2 py-1 text-right text-signal-sage">{row.settled > 0 ? ((row.wins / row.settled) * 100).toFixed(1) : "0.0"}%</td>
                          </tr>
                        ))}
                        {!perfAdminSnapshot?.byUserLeague?.length && !perfAdminLoading && (
                          <tr>
                            <td colSpan={5} className="px-2 py-3 text-center text-signal-inkMuted">
                              Fără date.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-signal-line/60 bg-white/50">
              <table className="min-w-full text-left text-[11px] text-signal-petrol">
                <thead className="sticky top-0 bg-signal-fog/95 text-[10px] uppercase text-signal-inkMuted">
                  <tr>
                    <th className="px-3 py-2">User ID</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Blocked</th>
                    <th className="px-3 py-2">Warm / Predict</th>
                    <th className="px-3 py-2">Favorite Leagues</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {managedProfiles.map((profile) => (
                    <tr key={profile.userId} className="border-t border-signal-line/40">
                      <td className="px-3 py-2 font-mono text-[10px]">{profile.userId}</td>
                      <td className="px-3 py-2">{profile.role}</td>
                      <td className="px-3 py-2">{profile.isBlocked ? "yes" : "no"}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-signal-inkMuted">
                        {profile.warmPredictUsage ? `${profile.warmPredictUsage.warm} / ${profile.warmPredictUsage.predict}` : "—"}
                      </td>
                      <td className="px-3 py-2">{profile.favoriteLeagues.length ? profile.favoriteLeagues.join(", ") : "-"}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleAdminRoleChange(profile.userId, profile.role === "admin" ? "user" : "admin")}
                            disabled={isAdminWorking}
                            className="rounded-md border border-signal-petrol/20 bg-signal-petrol/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-signal-petrol disabled:opacity-50"
                          >
                            Make {profile.role === "admin" ? "user" : "admin"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleAdminToggleBlock(profile.userId, !profile.isBlocked)}
                            disabled={isAdminWorking}
                            className="rounded-md border border-signal-rose/30 bg-signal-rose/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-signal-rose disabled:opacity-50"
                          >
                            {profile.isBlocked ? "Unblock" : "Block"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!managedProfiles.length && (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-signal-inkMuted">
                        Nu exista profile disponibile.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 xl:gap-10">
          {/* LIGI */}
          <div className="lg:col-span-4 xl:col-span-3 space-y-4">
            {user ? (
              <LeaguePanel
                leaguesSorted={leaguesSorted}
                selectedSet={selectedSet}
                selectedLeagueIds={selectedLeagueIds}
                isLeaguesOpen={isLeaguesOpen}
                searchLeague={searchLeague}
                eliteLeagues={ELITE_LEAGUES}
                setIsLeaguesOpen={setIsLeaguesOpen}
                setSearchLeague={setSearchLeague}
                setSelectedLeagueIds={setSelectedLeagueIds}
                selectEliteLeagues={selectEliteLeagues}
                clearLeagueSelection={clearLeagueSelection}
              />
            ) : (
              <div className="rounded-3xl border border-signal-line/80 bg-white/60 p-5 shadow-atelier backdrop-blur-sm">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-signal-petrol">Personalizare blocată</h3>
                <p className="mt-2 text-xs leading-relaxed text-signal-inkMuted">
                  Selecția ligilor și predicțiile personalizate sunt disponibile după autentificare.
                </p>
                <button
                  type="button"
                  onClick={() => setIsAuthOpen(true)}
                  className="mt-4 w-full rounded-xl bg-signal-petrol px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-signal-petrolMuted"
                >
                  Login / Signup
                </button>
              </div>
            )}
          </div>

          {/* MECIURI */}
          <div className="lg:col-span-8 xl:col-span-9">
            {preds.length > 0 && (
              <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-signal-line/70 bg-white/55 p-3 shadow-inner backdrop-blur-sm sm:gap-4 lg:p-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="custom-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto border-b border-signal-line/50 pb-2 xl:overflow-visible xl:border-b-0 xl:border-r xl:pb-0 xl:pr-4">
                  <button
                    type="button"
                    onClick={() => setFilterMode("ALL")}
                    className={`snap-start whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-semibold transition-all touch-manipulation sm:py-2 ${
                      filterMode === "ALL" ? "bg-signal-petrol text-white shadow-sm" : "bg-white/70 text-signal-inkMuted hover:bg-signal-fog"
                    }`}
                  >
                    Toate ({preds.length}
                    {pendingAmongDisplayedPreds > 0 ? ` · ${pendingAmongDisplayedPreds} nevalidate` : ""})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode("VALUE")}
                    className={`snap-start whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-semibold transition-all touch-manipulation sm:py-2 ${
                      filterMode === "VALUE" ? "border border-signal-amber/45 bg-signal-amber/15 text-signal-amber shadow-sm" : "bg-white/70 text-signal-inkMuted hover:bg-signal-fog"
                    }`}
                  >
                    Value bets
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode("SAFE")}
                    className={`snap-start whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-semibold transition-all touch-manipulation sm:py-2 ${
                      filterMode === "SAFE" ? "border border-signal-sage/40 bg-signal-mintSoft/50 text-signal-petrol shadow-sm" : "bg-white/70 text-signal-inkMuted hover:bg-signal-fog"
                    }`}
                  >
                    +70% siguranță
                  </button>
                </div>
                <div className="custom-scrollbar flex snap-x snap-mandatory items-center gap-2 overflow-x-auto xl:overflow-visible">
                  <span className="shrink-0 px-1 text-[9px] font-semibold uppercase tracking-wide text-signal-inkMuted">Sortare</span>
                  <button
                    type="button"
                    onClick={() => setSortBy("TIME")}
                    className={`snap-start whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-all touch-manipulation sm:py-1.5 ${
                      sortBy === "TIME" ? "bg-signal-petrol/10 text-signal-petrol" : "bg-white/60 text-signal-inkMuted hover:bg-signal-fog"
                    }`}
                  >
                    Ora
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortBy("CONFIDENCE")}
                    className={`snap-start whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-all touch-manipulation sm:py-1.5 ${
                      sortBy === "CONFIDENCE" ? "bg-signal-petrol/10 text-signal-petrol" : "bg-white/60 text-signal-inkMuted hover:bg-signal-fog"
                    }`}
                  >
                    Încredere
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortBy("VALUE")}
                    className={`snap-start whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-all touch-manipulation sm:py-1.5 ${
                      sortBy === "VALUE" ? "bg-signal-petrol/10 text-signal-petrol" : "bg-white/60 text-signal-inkMuted hover:bg-signal-fog"
                    }`}
                  >
                    EV
                  </button>
                </div>
              </div>
            )}
            {!user ? (
              <div className="grid h-[400px] place-items-center rounded-[2rem] border-2 border-dashed border-signal-line/60 bg-white/40 px-6 text-center">
                <div>
                  <p className="font-medium text-signal-petrol">Autentifică-te pentru predicții personalizate.</p>
                  <button
                    type="button"
                    onClick={() => setIsAuthOpen(true)}
                    className="mt-4 rounded-xl bg-signal-petrol px-4 py-2 text-sm font-semibold text-white hover:bg-signal-petrolMuted"
                  >
                    Deschide autentificarea
                  </button>
                </div>
              </div>
            ) : !preds.length ? (
              <div className="grid h-[400px] place-items-center rounded-[2rem] border-2 border-dashed border-signal-line/40 bg-white/30 text-center text-signal-inkMuted">
                <p className="font-medium italic">Selectează ligile, apoi apasă Predict.</p>
              </div>
            ) : (
              <div className="space-y-8">
                {groupedDisplayedMatches.map((group) => (
                  <section key={group.dateKey} className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-signal-petrolMuted">
                        {group.dateKey === "Fără dată"
                          ? group.dateKey
                          : new Date(group.dateKey).toLocaleDateString([], {
                              weekday: "short",
                              day: "2-digit",
                              month: "2-digit"
                            })}
                      </div>
                      <div className="h-px flex-1 bg-gradient-to-r from-signal-sage/35 to-transparent" />
                      <div className="font-mono text-[10px] tabular-nums text-signal-inkMuted">{group.matches.length} meciuri</div>
                    </div>
                    <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 2xl:grid-cols-3">
                      {group.matches.map((m, idx) => (
                        <MatchCard
                          key={m.id}
                          row={m}
                          logoColors={logoColors}
                          hashColor={hashColor}
                          animationDelayMs={idx * 45}
                          onClick={() => setSelectedMatch(m)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-signal-mist via-signal-mist/95 to-transparent p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
        <div className="pointer-events-auto mx-auto max-w-7xl">
          <button
            type="button"
            onClick={predict}
            className="touch-manipulation w-full rounded-2xl bg-signal-petrol px-6 py-3.5 text-sm font-semibold text-white shadow-atelier transition-all hover:bg-signal-petrolMuted active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!user || !selectedLeagueIds.length}
          >
            Predict {selectedLeagueIds.length ? `(${selectedLeagueIds.length} ligi)` : ""}
          </button>
        </div>
      </div>
      {selectedMatch && <MatchModal match={selectedMatch} logoColors={logoColors} hashColor={hashColor} onClose={() => setSelectedMatch(null)} />}
      <PerformanceCounterModal
        open={perfCounterModalOpen}
        onClose={() => setPerfCounterModalOpen(false)}
        days={30}
        globalByLeague={globalPerformanceByLeague}
        accessToken={session?.access_token ?? null}
        isAdmin={user?.role === "admin"}
      />
      <Auth
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onLogin={handleLogin}
        onSignup={handleSignup}
        onForgotPassword={handleForgotPassword}
        onUpdatePassword={handleUpdatePassword}
        isSubmitting={isAuthSubmitting}
        authError={authError}
      />
    </div>
  );
}