import { useCallback, useEffect, useMemo, useState } from "react";
import { ELITE_LEAGUES } from "../constants/appConstants";
import { useAppAuthActions } from "./useAppAuthActions";
import { useAuth } from "./useAuth";
import { clearAuthHashFromUrl, consumeSignupConfirmation } from "../utils/supabaseAuthHash";
import { useLocale } from "../context/LocaleContext";
import { useBacktest } from "./useBacktest";
import { useCallsCounter } from "./useCallsCounter";
import { useDateRollover } from "./useDateRollover";
import { useHistorySync } from "./useHistorySync";
import { isDesktopViewport, useLeaguePanelState } from "./useLeaguePanelState";
import { useLeagues } from "./useLeagues";
import { usePerformanceTracker } from "./usePerformanceTracker";
import { usePredictions } from "./usePredictions";
import { useWarm } from "./useWarm";
import { loadHistory as fetchHistory } from "../services/historyService";
import { loadPerfAdmin as fetchPerfAdmin } from "../services/performanceService";
import { HistoryEntry, HistoryStats, UserTier } from "../types";
import type { PerfAdminSnapshot } from "../types/index";
import {
  hashColor,
  inferSeason,
  localCalendarDateKey,
  normalizeSelectedDates,
  useLocalStorageState
} from "../utils/appUtils";
import { isoToday } from "../utils/appUtils";

/** Orchestrates admin dashboard state/hooks without changing business behavior. */
export function useAppController() {
  // Status copy below is legacy Romanian-only; the signup-confirmed line is the
  // one string here a user can reach from an email, so it goes through i18n.
  const { t } = useLocale();
  const [date, setDate] = useLocalStorageState<string>("footy.date", isoToday());
  const [selectedDates, setSelectedDates] = useLocalStorageState<string[]>("footy.selectedDates", [isoToday()]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [, setHistoryStats] = useState<HistoryStats>({ wins: 0, losses: 0, settled: 0, winRate: 0, pushes: 0, halfWins: 0, halfLosses: 0 });
  const [status, setStatus] = useState<string>("");
  // Admin docks LeaguePanel in the sidebar column, where this flag is
  // DISCLOSURE state, not a modal: expanded where there is room. Passed
  // explicitly so the consumer workspace can start closed without
  // changing what admin has always done.
  const { isLeaguesOpen, setIsLeaguesOpen } = useLeaguePanelState({ initialOpen: isDesktopViewport() });
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [perfCounterModalOpen, setPerfCounterModalOpen] = useState(false);
  const [perfAdminSnapshot, setPerfAdminSnapshot] = useState<PerfAdminSnapshot | null>(null);
  const [perfAdminLoading, setPerfAdminLoading] = useState(false);
  const [adminTierDraftByUser, setAdminTierDraftByUser] = useState<Record<string, UserTier>>({});
  const [adminExpiryDraftByUser, setAdminExpiryDraftByUser] = useState<Record<string, string>>({});

  const auth = useAuth();
  const {
    user,
    /**
     * EFFECTIVE access tier from the server. Distinct from `user.tier`, which
     * is the requested/paid plan — an admin on a free plan is served ULTRA, so
     * anything that gates or masks must read this, never `user.tier`.
     */
    userTier,
    session,
    loading: authLoading,
    error: authError,
    lastAuthEvent,
    managedProfiles,
    getSession,
    updateFavoriteLeagues,
    refreshManagedProfiles
  } = auth;

  const actions = useAppAuthActions(
    {
      login: auth.login,
      signup: auth.signup,
      logout: auth.logout,
      sendPasswordResetEmail: auth.sendPasswordResetEmail,
      updatePassword: auth.updatePassword,
      updateProfileRole: auth.updateProfileRole,
      toggleProfileBlock: auth.toggleProfileBlock,
      updateProfileMonetization: auth.updateProfileMonetization
    },
    setStatus,
    adminTierDraftByUser,
    adminExpiryDraftByUser
  );

  function requireAuth(message = "Autentifica-te pentru functiile personalizate.") {
    if (user) return true;
    setStatus(message);
    setIsAuthOpen(true);
    return false;
  }

  const backtest = useBacktest({ requireAuth });
  const predictions = usePredictions({
    history,
    userRole: user?.role,
    userEnabledLivePoll: Boolean(user),
    setStatus
  });
  const leagues = useLeagues({
    date,
    selectedDates,
    setSelectedDates,
    user: user ? { id: user.id, favoriteLeagues: user.favoriteLeagues } : null,
    updateFavoriteLeagues,
    requireAuth,
    setStatus
  });
  const calls = useCallsCounter({ day: leagues.day, setStatus });
  const predIds = useMemo(() => predictions.preds.map((p) => p.id), [predictions.preds]);
  const tracker = usePerformanceTracker(history, predIds);

  const loadPerfAdmin = useCallback(async () => {
    if (!session?.access_token || user?.role !== "admin") return;
    setPerfAdminLoading(true);
    try {
      setPerfAdminSnapshot(await fetchPerfAdmin(session.access_token));
    } catch {
      // keep previous snapshot
    } finally {
      setPerfAdminLoading(false);
    }
  }, [session?.access_token, user?.role]);

  useEffect(() => {
    if (user?.role !== "admin") setPerfAdminSnapshot(null);
  }, [user?.role]);

  const loadHistory = useCallback(
    async (days = 30) => {
      try {
        const result = await fetchHistory(days, {
          accessToken: session?.access_token,
          isAdmin: user?.role === "admin"
        });
        setHistory(result.items);
        setHistoryStats(result.stats);
      } catch (error) {
        setHistory([]);
        setHistoryStats({ wins: 0, losses: 0, settled: 0, winRate: 0, pushes: 0, halfWins: 0, halfLosses: 0 });
        setStatus((prev) => prev || `Istoric indisponibil: ${(error as { message?: string })?.message || "eroare necunoscută"}`);
      }
    },
    [session?.access_token, user?.role]
  );

  const { isHistorySyncing, syncHistory } = useHistorySync({
    accessToken: session?.access_token,
    defaultDays: 7,
    // Avoid overlapping cron (3×/day) and multi-tab spam.
    cooldownMs: 10 * 60_000,
    onAfterSync: async (days) => {
      await loadHistory(days);
      if (user?.role === "admin") await loadPerfAdmin();
    }
  });

  const { warm, predict } = useWarm({
    accessToken: session?.access_token,
    getSession,
    selectedLeagueIds: leagues.selectedLeagueIds,
    selectedDates,
    date,
    requireAuth,
    setStatus,
    setPreds: predictions.setPreds,
    setIsLeaguesOpen,
    loadHistory,
    loadKpi: backtest.loadKpi,
    loadAlerts: backtest.loadAlerts,
    prefetchColors: predictions.prefetchColors,
    onAdminPredictCompleted: () => {
      if (user?.role === "admin") void loadPerfAdmin();
    }
  });

  const rollToDate = useCallback(
    (nextDate: string) => {
      setDate(nextDate);
      setSelectedDates((prev) => {
        const rest = (prev || []).filter((d) => d !== date);
        return normalizeSelectedDates([nextDate, ...rest]);
      });
    },
    [date, setDate, setSelectedDates]
  );
  useDateRollover({ date, onRollToDate: rollToDate, storageKeys: ["footy.date", "footy.user.date"] });

  useEffect(() => {
    void backtest.loadKpi(45);
    void backtest.loadAlerts(7);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only KPI bootstrap; re-running on `backtest` identity would refetch on every render
  }, []);

  useEffect(() => {
    if (!session?.access_token) {
      void loadHistory(7);
      return;
    }
    void syncHistory(7);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed to auth changes only; syncHistory identity is not stable and would re-trigger sync every render
  }, [session?.access_token, user?.role]);

  useEffect(() => {
    if (!session?.access_token || tracker.pendingHistoryCount <= 0) return;
    // Pending settlement poll: 15 min (was 90s) — cron already syncs 3×/day.
    const tm = setInterval(() => void syncHistory(7), 15 * 60_000);
    return () => clearInterval(tm);
  }, [session?.access_token, tracker.pendingHistoryCount, syncHistory, user?.role]);

  useEffect(() => {
    if (!session?.access_token) return;
    const onVis = () => {
      if (document.visibilityState === "visible") void syncHistory(7);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [session?.access_token, syncHistory]);

  useEffect(() => {
    if (!lastAuthEvent) return;
    if (lastAuthEvent === "PASSWORD_RECOVERY") {
      setIsAuthOpen(true);
      setStatus("Link-ul de reset este valid. Seteaza parola noua.");
      return;
    }
    if (lastAuthEvent === "SIGNED_IN") {
      /*
        The workspace copy of the same announcement. `consumeSignupConfirmation`
        is the SAME latch AuthLinkNotice uses, so whichever surface the user
        actually lands on says it, and the other cannot repeat it.
      */
      if (consumeSignupConfirmation()) {
        setStatus(t("auth.signupConfirmedTitle"));
        clearAuthHashFromUrl();
      }
    }
  }, [lastAuthEvent, t]);

  useEffect(() => {
    if (user?.role !== "admin") return;
    void refreshManagedProfiles().catch(() => setStatus("Nu am putut incarca lista utilizatorilor."));
  }, [user?.id, user?.role, refreshManagedProfiles]);

  const modelPulse = useMemo(() => {
    const cal = localCalendarDateKey();
    const season = inferSeason(date);
    if (backtest.kpiLoading) return { tone: "watch" as const, status: `Încărcare KPI · ${cal}` };
    const hit = (backtest.kpi?.hitRate ?? 0).toFixed(1);
    const roi = (backtest.kpi?.roi ?? 0).toFixed(2);
    if (backtest.alertsSeverity === "high") return { tone: "alert" as const, status: `Risk · ROI ${roi}% · S${season} · ${cal}` };
    if (backtest.alertsSeverity === "medium") return { tone: "watch" as const, status: `Atenție · Hit ${hit}% · ${cal}` };
    return { tone: "healthy" as const, status: `Calibrat · Hit ${hit}% · ROI ${roi}% · ${cal}` };
  }, [backtest.kpiLoading, backtest.kpi?.hitRate, backtest.kpi?.roi, backtest.alertsSeverity, date]);

  const observatoryShell = Boolean(user);
  const editorialDateLine = useMemo(
    () =>
      new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase(),
    []
  );

  const statisticsProps = {
    kpi: backtest.kpi,
    kpiLoading: backtest.kpiLoading,
    riskAlerts: backtest.riskAlerts,
    alertsSeverity: backtest.alertsSeverity,
    draftDrawdownThreshold: backtest.draftDrawdownThreshold,
    setDraftDrawdownThreshold: backtest.setDraftDrawdownThreshold,
    draftDriftThreshold: backtest.draftDriftThreshold,
    setDraftDriftThreshold: backtest.setDraftDriftThreshold,
    draftLowDataThreshold: backtest.draftLowDataThreshold,
    setDraftLowDataThreshold: backtest.setDraftLowDataThreshold,
    alertDrawdownThreshold: backtest.alertDrawdownThreshold,
    alertDriftThreshold: backtest.alertDriftThreshold,
    alertLowDataThreshold: backtest.alertLowDataThreshold,
    hasThresholdDraftChanges: backtest.hasThresholdDraftChanges,
    thresholdsSaved: backtest.thresholdsSaved,
    applyAlertThresholds: backtest.applyAlertThresholds,
    resetAlertThresholds: backtest.resetAlertThresholds
  };

  const trackerProps = {
    stats: tracker.trackerStats,
    animatedWins: tracker.animatedWins,
    animatedLosses: tracker.animatedLosses,
    animatedWinRate: tracker.animatedWinRate,
    isWinRatePulsing: tracker.isWinRatePulsing,
    isHistorySyncing,
    pendingHistoryCount: tracker.pendingHistoryCount,
    displayedPredsCount: predictions.preds.length,
    pendingAmongDisplayedPreds: tracker.pendingAmongDisplayedPreds,
    excludedWorstLossDaysCount: tracker.excludeWorstLossDays,
    onExcludedWorstLossDaysCountChange: tracker.setExcludeWorstLossDays,
    excludedLossDays: tracker.excludedLossDays,
    onBreakdownClick: () => setPerfCounterModalOpen(true)
  };

  const sharedListProps = {
    user,
    // Travels beside `user` so the list surfaces gate on effective access
    // rather than on the plan field they used to read.
    userTier,
    leaguesSorted: leagues.leaguesSorted,
    selectedSet: leagues.selectedSet,
    selectedLeagueIds: leagues.selectedLeagueIds,
    isLeaguesOpen,
    searchLeague: leagues.searchLeague,
    eliteLeagues: ELITE_LEAGUES,
    setIsLeaguesOpen,
    setSearchLeague: leagues.setSearchLeague,
    setSelectedLeagueIds: leagues.setSelectedLeagueIds,
    selectEliteLeagues: leagues.selectEliteLeagues,
    clearLeagueSelection: leagues.clearLeagueSelection,
    onOpenAuth: () => setIsAuthOpen(true),
    preds: predictions.preds,
    groupedDisplayedMatches: predictions.groupedDisplayedMatches,
    filterMode: predictions.filterMode,
    setFilterMode: predictions.setFilterMode,
    sortBy: predictions.sortBy,
    setSortBy: predictions.setSortBy,
    pendingAmongDisplayedPreds: tracker.pendingAmongDisplayedPreds,
    logoColors: predictions.logoColors,
    hashColor,
    onSelectMatch: predictions.setSelectedMatch
  };

  return {
    date,
    setDate,
    selectedDates,
    setSelectedDates,
    status,
    setStatus,
    isAuthOpen,
    setIsAuthOpen,
    perfCounterModalOpen,
    setPerfCounterModalOpen,
    perfAdminSnapshot,
    perfAdminLoading,
    adminTierDraftByUser,
    setAdminTierDraftByUser,
    adminExpiryDraftByUser,
    setAdminExpiryDraftByUser,
    user,
    userTier,
    session,
    authLoading,
    authError,
    managedProfiles,
    refreshManagedProfiles,
    actions,
    calls,
    leagues,
    predictions,
    tracker,
    warm,
    predict,
    loadPerfAdmin,
    modelPulse,
    observatoryShell,
    editorialDateLine,
    statisticsProps,
    trackerProps,
    sharedListProps
  };
}
