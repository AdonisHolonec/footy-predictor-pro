import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import LeaguePanel from "../components/LeaguePanel";
import PerformanceCounterModal from "../components/PerformanceCounterModal";
import SuccessRateTracker from "../components/SuccessRateTracker";
import type { AppNavView } from "../components/ux/appNav";
import CommandPalette from "../components/ux/CommandPalette";
import ConsumerShell from "../components/ux/ConsumerShell";
import HomeSection from "../components/ux/HomeSection";
import MatchesSection from "../components/ux/MatchesSection";
import OnboardingCarousel from "../components/ux/OnboardingCarousel";
import HistorySection from "../components/ux/HistorySection";
import StatisticsSection from "../components/ux/StatisticsSection";
import { ELITE_LEAGUES, ELITE_LEAGUE_META, HIGH_CONFIDENCE_THRESHOLD } from "../constants/appConstants";
import { USER_PREDICT_FLOW_MESSAGES } from "../constants/predictFlowMessages";
import { useAuth } from "../hooks/useAuth";
import { useDateRollover } from "../hooks/useDateRollover";
import { useLeaguePanelState } from "../hooks/useLeaguePanelState";
import { usePredictFlow } from "../hooks/usePredictFlow";
import { useLiveFixtureScorePoll } from "../hooks/useLiveFixtureScorePoll";
import { useMarketTotalsHydrate } from "../hooks/useMarketTotalsHydrate";
import { useUiPrefs } from "../hooks/useUiPrefs";
import { PredictionRow } from "../types";
import Button from "../design-system/Button";
import Toast from "../design-system/Toast";
import UpgradePrompt, { type UpgradeTier } from "../design-system/UpgradePrompt";
import { useLocale } from "../context/LocaleContext";


// The modal is the keystone split: it renders only when a match is opened, it is
// imported nowhere else, and five heavy panels ride in its static subtree. Making
// it lazy is what lets the panel splits below actually take effect.
const MatchModal = lazy(() => import("../components/MatchModal"));
import {
  hashColor,
  inferSeason,
  isoToday,
  kickoffLocalDateKey,
  localCalendarDateKey,
  mergePredictionRows,
  normalizeSelectedDates,
  useLocalStorageState
} from "../utils/appUtils";
import { syncHistoryAfterPredict } from "../utils/predictFlowUtils";
import { buildFixtureLabelIndex } from "../utils/globalSpecialBetView";
import { loadBillingConfig } from "../services/billingService";
// Pure helpers extracted verbatim in Sprint 6 — the component keeps the
// wiring, ./userDashboard/helpers keeps the arithmetic.
import { MAIN_VIEWS, clampTierDates, hasLegacyPredictionShape } from "./userDashboard/helpers";
import ProfileView from "./userDashboard/ProfileView";
import NotificationsView from "./userDashboard/NotificationsView";
import SettingsView from "./userDashboard/SettingsView";
import DateRangeChips from "./userDashboard/DateRangeChips";
import MainBoardSection from "./userDashboard/MainBoardSection";
import ReportPredictionDialog from "../components/support/ReportPredictionDialog";
import { useDashboardHistory } from "./userDashboard/useDashboardHistory";
import { usePredictionsCache } from "./userDashboard/usePredictionsCache";
import { useLeagueSelection } from "./userDashboard/useLeagueSelection";
import { useDerivedPredictions } from "./userDashboard/useDerivedPredictions";
import { useTrackerAnimations } from "./userDashboard/useTrackerAnimations";

export default function UserDashboard() {
  const {
    user,
    userTier,
    isSubscriptionExpired,
    trialRemainingTime,
    tierQuotaExempt,
    predictCountToday,
    predictLimitToday,
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
  const { isLeaguesOpen, setIsLeaguesOpen } = useLeaguePanelState();
  const [status, setStatus] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<PredictionRow | null>(null);
  const {
    selectedLeagueIds,
    setSelectedLeagueIdsLimited,
    searchLeague,
    setSearchLeague,
    leaguesSorted,
    fetchDays
  } = useLeagueSelection({
    user,
    accessToken: session?.access_token,
    date,
    selectedDates,
    updateFavoriteLeagues,
    setStatus
  });
  const [dateSyncBadgeUntil, setDateSyncBadgeUntil] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  // Support and Feedback are owned by SupportEntry inside SettingsView; only the
  // prediction report stays here, because it is opened from a card in a list.
  const [reportRow, setReportRow] = useState<PredictionRow | null>(null);
  const [notifySafe, setNotifySafe] = useState<boolean>(user?.notificationPrefs?.safe ?? true);
  const [notifyValue, setNotifyValue] = useState<boolean>(user?.notificationPrefs?.value ?? true);
  const [notifyEmail, setNotifyEmail] = useState<boolean>(user?.notificationPrefs?.email ?? false);
  const [alertsPreview, setAlertsPreview] = useState<{ safe: number; value: number }>({ safe: 0, value: 0 });
  const [notifyEmailConsent, setNotifyEmailConsent] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [warmPredictBusy, setWarmPredictBusy] = useState(false);
  const [notifSaveBusy, setNotifSaveBusy] = useState(false);
  /** Set when onboarding finished with leagues picked — the effect below fires the first predict once the selection state has propagated. */
  const [onboardingAutoPredict, setOnboardingAutoPredict] = useState(false);
  const [perfCounterModalOpen, setPerfCounterModalOpen] = useState(false);
  const [trialBusy, setTrialBusy] = useState<"premium" | "ultra" | null>(null);
  const [billingBusy, setBillingBusy] = useState<"premium" | "ultra" | "portal" | null>(null);
  const [billingConfigured, setBillingConfigured] = useState(false);
  const [navView, setNavView] = useState<AppNavView>("home");
  const [commandOpen, setCommandOpen] = useState(false);
  const [upgradePrompt, setUpgradePrompt] = useState<{ feature: string; requiredTier: UpgradeTier } | null>(null);
  const { t, setLocale, locale } = useLocale();
  const {
    prefs,
    setLocale: setPrefsLocale,
    cycleTheme,
    toggleWatchlist,
    pushRecent,
    updateFilters,
    isWatched,
    markNotificationsSeen
  } = useUiPrefs(user?.id);

  useEffect(() => {
    if (prefs.locale && prefs.locale !== locale) setLocale(prefs.locale);
  }, [prefs.locale]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (locale !== prefs.locale) setPrefsLocale(locale);
  }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const matchesFilter = prefs.matchesFilter;
  const matchSearch = prefs.matchSearch;
  const showSettledMarketsOnly = prefs.settledOnly;
  const todayKey = localCalendarDateKey();
  const {
    history,
    historyStats,
    loadHistory,
    isHistorySyncing,
    pendingHistoryCount,
    marketValidationsByFixtureId,
    userPerformanceByLeague,
    historySearchLabels,
    simpleRoi
  } = useDashboardHistory({ userId: user?.id, accessToken: session?.access_token });
  const trackerStats = historyStats;
  const {
    preds,
    setPreds,
    predictionsByUser,
    setPredictionsByUser,
    setUserPredictionMap,
    rehydratedNotice,
    rehydratePredictionsFromHistory
  } = usePredictionsCache({
    user,
    userTier,
    accessToken: session?.access_token,
    date,
    selectedDates,
    setSelectedDates,
    selectedLeagueIds,
    history,
    setStatus
  });
  useLiveFixtureScorePoll(preds, setPreds, { enabled: Boolean(user) });
  useMarketTotalsHydrate(preds, setPreds, {
    enabled: Boolean(user),
    userId: user?.id ?? null,
    setPredictionsByUser
  });
  useEffect(() => {
    setSelectedMatch((cur) => {
      if (!cur) return cur;
      const next = preds.find((p) => p.id === cur.id);
      return next ?? cur;
    });
  }, [preds]);
  const {
    pendingAmongDisplayedPreds,
    visiblePreds,
    homePreds,
    homeCounts,
    homeLiveCount,
    notificationItems,
    continueMatch,
    analysisMatch
  } = useDerivedPredictions({
    preds,
    history,
    prefs,
    navView,
    matchesFilter,
    matchSearch,
    showSettledMarketsOnly
  });
  const { isWinRatePulsing, animatedWins, animatedLosses, animatedWinRate } = useTrackerAnimations(trackerStats);
  const activePredictDates = useMemo(() => {
    const seedDate = normalizeSelectedDates(selectedDates.length ? selectedDates : [date])[0] || date;
    return clampTierDates(seedDate, userTier, selectedDates.length ? selectedDates : [seedDate]);
  }, [selectedDates, date, userTier]);
  const rollToDate = useCallback(
    (nextDate: string) => {
      setDate(nextDate);
      setSelectedDates((prev) => {
        const normalized = normalizeSelectedDates(prev?.length ? prev : [nextDate]);
        const anchored = [nextDate, ...normalized.filter((d) => d !== nextDate)];
        return clampTierDates(nextDate, userTier, anchored);
      });
      setDateSyncBadgeUntil(Date.now() + 6000);
    },
    [setDate, setSelectedDates, userTier]
  );
  useDateRollover({
    date,
    onRollToDate: rollToDate,
    storageKeys: ["footy.date", "footy.user.date"]
  });
  const formatRemaining = (ms: number) => {
    if (!ms || ms <= 0) return "00:00:00";
    const total = Math.floor(ms / 1000);
    const h = String(Math.floor(total / 3600)).padStart(2, "0");
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  useEffect(() => {
    let cancelled = false;
    loadBillingConfig()
      .then((cfg) => {
        if (!cancelled) setBillingConfigured(Boolean(cfg.configured));
      })
      .catch(() => {
        if (!cancelled) setBillingConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    if (billing === "success") {
      setStatus("Plată reușită. Abonamentul se activează în câteva secunde — reîncarcă profilul dacă tier-ul nu apare.");
      setNavView("settings");
    } else if (billing === "cancel") {
      setStatus("Checkout anulat.");
    }
    params.delete("billing");
    params.delete("tier");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState({}, "", next);
  }, [setStatus]);

  const { warm: runWarm, predict: runPredict } = usePredictFlow<PredictionRow>({
    accessToken: session?.access_token,
    getSession,
    selectedLeagueIds,
    inferSeason,
    usageDay: todayKey,
    setStatus,
    predictLimit: "50",
    messages: USER_PREDICT_FLOW_MESSAGES,
    onWarmCompleted: async () => {
      setStatus("Warm finalizat pentru ligile favorite.");
    },
    onPredictCompleted: async (deduped, token) => {
      setPreds(deduped);
      if (user?.id) {
        setPredictionsByUser((prev) => ({
          ...prev,
          [user.id]: mergePredictionRows(prev[user.id] || [], deduped)
        }));
        setUserPredictionMap((prev) => {
          const existing = prev[user.id] || [];
          const merged = Array.from(new Set([...existing, ...deduped.map((item) => Number(item.id))]));
          return { ...prev, [user.id]: merged };
        });
      }
      setStatus(t("dash.generated", { n: deduped.length }));
      await syncHistoryAfterPredict(token, 7);
      await loadHistory();
    }
  });

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
    if (dateSyncBadgeUntil <= Date.now()) return;
    const tm = setTimeout(() => setDateSyncBadgeUntil(0), Math.max(0, dateSyncBadgeUntil - Date.now()));
    return () => clearTimeout(tm);
  }, [dateSyncBadgeUntil]);

  useEffect(() => {
    if (!session?.access_token) return;
    const tm = setInterval(() => {
      void refreshTierStatus();
    }, 30000);
    return () => clearInterval(tm);
  }, [session?.access_token, refreshTierStatus]);

  /**
   * Readable labels for Global Special Bet snapshots.
   *
   * `special_bet_selections` stores fixture_id and league_id only, so the names
   * are joined here from rows the app already loaded. Presentation only — it
   * never influences which selections a bet contains — and a fixture missing
   * from both sources degrades to its id rather than to an invented name.
   */
  const gsbFixtureIndex = useMemo(() => buildFixtureLabelIndex([preds, history]), [preds, history]);

  useEffect(() => {
    const safeCount = preds.filter((row) => !row.insufficientData && Number(row.recommended?.confidence) >= 70).length;
    const valueCount = preds.filter((row) => row.valueBet?.detected).length;
    setAlertsPreview({ safe: safeCount, value: valueCount });
  }, [preds]);

  async function warm() {
    if (!selectedLeagueIds.length) return setStatus(t("dash.selectLeague"));
    await runWarm(activePredictDates);
  }

  async function predict() {
    if (!selectedLeagueIds.length) return setStatus(t("dash.selectLeague"));
    await runPredict(activePredictDates);
  }

  async function saveNotificationPrefs() {
    if (notifyEmail && !notifyEmailConsent) {
      setStatus("Pentru e-mail trebuie sa bifezi confirmarea din politica de confidentialitate.");
      return;
    }
    setNotifSaveBusy(true);
    try {
      await updateNotificationPreferences({
        safe: notifySafe,
        value: notifyValue,
        email: notifyEmail,
        emailConsentAcknowledged: notifyEmail ? true : undefined
      });
      setStatus("Preferintele de notificare au fost salvate.");
    } catch (error) {
      setStatus((error as { message?: string })?.message || "Nu am putut salva preferintele de notificare.");
    } finally {
      setNotifSaveBusy(false);
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

  async function warmAndPredict() {
    setWarmPredictBusy(true);
    try {
      await warm();
      await predict();
    } finally {
      setWarmPredictBusy(false);
    }
  }

  useEffect(() => {
    if (!onboardingAutoPredict || !selectedLeagueIds.length) return;
    setOnboardingAutoPredict(false);
    void warmAndPredict();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- warmAndPredict is a stable-in-practice component function; the effect must fire exactly once per onboarding completion
  }, [onboardingAutoPredict, selectedLeagueIds]);

  /** Refresh: reload saved picks. Runs Predict when saved rows are under-masked for the plan. */
  async function restoreOrPredict() {
    if (!selectedLeagueIds.length) {
      setStatus(t("dash.selectLeague"));
      return;
    }
    const cached = user?.id ? predictionsByUser[user.id] || [] : [];
    const effectiveDates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
    const selectedDateSet = new Set(effectiveDates);
    const selectedLeagueSet = new Set(selectedLeagueIds.map((id) => Number(id)));
    const fromCache = cached.filter((row) => {
      const kickoffDate = kickoffLocalDateKey(row.kickoff);
      if (!selectedDateSet.has(kickoffDate)) return false;
      return selectedLeagueSet.has(Number(row.leagueId));
    });

    if (fromCache.length && !hasLegacyPredictionShape(fromCache, userTier)) {
      setPreds(fromCache);
      setStatus(t("dash.showingSaved", { n: fromCache.length }));
      return;
    }

    const hydrated = await rehydratePredictionsFromHistory();
    if (hydrated.length && !hasLegacyPredictionShape(hydrated, userTier)) return;

    if (fromCache.length || hydrated.length) {
      setStatus(t("dash.needPredictForMarkets"));
      await warmAndPredict();
      return;
    }
    await warmAndPredict();
  }

  const openMatch = useCallback(
    (match: PredictionRow) => {
      pushRecent(Number(match.id));
      setSelectedMatch(match);
    },
    [pushRecent]
  );

  const handleNav = useCallback(
    (view: AppNavView) => {
      setNavView(view);
      if (view === "matches") updateFilters({ matchesFilter: "all" });
      if (view === "live") updateFilters({ matchesFilter: "live" });
    },
    [updateFilters]
  );

  const isMainBoard =
    MAIN_VIEWS.includes(navView) && navView !== "home" && navView !== "matches" && navView !== "live";

  const trackerSlot = (
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
  );

  return (
    <ConsumerShell
      activeNav={navView}
      onNavigate={handleNav}
      date={date}
      onDateChange={(next) => {
        setDate(next);
        setSelectedDates(normalizeSelectedDates([next]));
        void fetchDays([next]);
      }}
      search={matchSearch}
      onSearchChange={(q) => updateFilters({ matchSearch: q })}
      onOpenLeagues={() => setIsLeaguesOpen(true)}
      onRefresh={() => void restoreOrPredict()}
      refreshBusy={warmPredictBusy}
      onPredict={() => void warmAndPredict()}
      predictBusy={warmPredictBusy}
      favoritesActive={matchesFilter === "favorites"}
      onToggleFavorites={() =>
        updateFilters({ matchesFilter: matchesFilter === "favorites" ? "all" : "favorites" })
      }
      onOpenNotifications={() => setNavView("notifications")}
      onOpenProfile={() => setNavView("profile")}
      onOpenSettings={() => setNavView("settings")}
      onOpenSearch={() => setCommandOpen(true)}
      email={user?.email}
      tier={userTier}
      extraDates={
        <DateRangeChips
          date={date}
          userTier={userTier}
          activePredictDates={activePredictDates}
          setSelectedDates={setSelectedDates}
          setStatus={setStatus}
        />
      }
    >
      {(warmPredictBusy || trialBusy !== null || billingBusy !== null || exportBusy || notifSaveBusy) && (
        <span className="mb-3 inline-flex items-center gap-1 rounded-full border border-fp-accent/30 bg-[var(--fp-accent-muted)] px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[var(--fp-accent)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--fp-accent)] motion-reduce:animate-none" />
          {t("dash.loading")}
        </span>
      )}
      {dateSyncBadgeUntil > Date.now() && (
        <span className="mb-3 ml-2 inline-flex items-center gap-1 rounded-full border border-fp-success/35 bg-fp-success/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[var(--fp-success)]">
          {t("dash.dataSynced")}
        </span>
      )}
      {status && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 rounded-[var(--fp-radius)] border border-fp-accent/25 bg-[var(--fp-accent-muted)] px-3 py-2.5 text-sm font-semibold text-[var(--fp-text)]"
        >
          {status}
        </div>
      )}
      {rehydratedNotice && (
        <div className="mb-3 rounded-[var(--fp-radius)] border border-fp-accent/30 bg-[var(--fp-accent-muted)] px-3 py-2 text-xs">
          <span className="font-semibold text-[var(--fp-accent)]">Date vechi actualizate.</span>{" "}
          <span className="text-[var(--fp-text-muted)]">{rehydratedNotice}</span>
        </div>
      )}
      {userTier !== "free" && preds.length > 0 && hasLegacyPredictionShape(preds, userTier) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--fp-radius)] border border-fp-warning/40 bg-fp-warning/10 px-3 py-2.5 text-sm">
          <p className="min-w-0 flex-1 font-semibold text-[var(--fp-text)]">{t("dash.needPredictForMarkets")}</p>
          <Button size="sm" loading={warmPredictBusy} onClick={() => void warmAndPredict()}>
            {t("shell.predict")}
          </Button>
        </div>
      )}

      {navView === "home" && (
        <HomeSection
          matches={homePreds}
          counts={homeCounts}
          analysisMatch={analysisMatch}
          liveCount={homeLiveCount}
          accessTier={userTier}
          marketValidationsByFixtureId={marketValidationsByFixtureId}
          isWatched={isWatched}
          onToggleWatch={toggleWatchlist}
          onOpenMatch={openMatch}
          onUpgradeRequired={(feature, requiredTier) => setUpgradePrompt({ feature, requiredTier })}
          onGoMatches={() => handleNav("matches")}
          onGoLive={() => handleNav("live")}
          onGoHistory={() => handleNav("history")}
          onGoStatistics={() => handleNav("statistics")}
          onPredict={() => void warmAndPredict()}
          valueOnly={prefs.valueOnly}
          onToggleValue={() => updateFilters({ valueOnly: !prefs.valueOnly })}
          highConfActive={prefs.minConfidence > 0}
          onToggleHighConf={() =>
            updateFilters({ minConfidence: prefs.minConfidence > 0 ? 0 : HIGH_CONFIDENCE_THRESHOLD })
          }
          trackerStats={trackerStats}
          history={history}
          /* Generation date, not a pool filter: the GSB pool is every upcoming
             predicted fixture, so the card no longer follows the browsed date. */
          betDate={todayKey}
          /* The profile's favourite leagues, not the local league filter: the
             server validates the scope against profiles.favorite_leagues and
             rejects anything outside it. */
          favoriteLeagueIds={user?.favoriteLeagues ?? []}
          gsbFixtureIndex={gsbFixtureIndex}
          /* No tier gate exists for /api/special-bets, so the UI adds none. */
          canUseGlobalSpecialBet={Boolean(user)}
        />
      )}

      {(navView === "matches" || navView === "live") && (
        <MatchesSection
          mode={navView === "live" ? "live" : "all"}
          matches={visiblePreds}
          accessTier={userTier}
          marketValidationsByFixtureId={marketValidationsByFixtureId}
          isWatched={isWatched}
          onToggleWatch={toggleWatchlist}
          onOpenMatch={openMatch}
          onUpgradeRequired={(feature, requiredTier) => setUpgradePrompt({ feature, requiredTier })}
          onReportMatch={setReportRow}
          onPredict={() => void warmAndPredict()}
          matchesFilter={matchesFilter === "favorites" ? "favorites" : "all"}
          onSetFilter={(f) => updateFilters({ matchesFilter: f })}
          onGoLive={() => handleNav("live")}
          valueOnly={prefs.valueOnly}
          onToggleValueOnly={(checked) => updateFilters({ valueOnly: checked })}
          loading={warmPredictBusy && !visiblePreds.length}
        />
      )}

      {isMainBoard && (
        <MainBoardSection
          visiblePreds={visiblePreds}
          matchesFilter={matchesFilter}
          valueOnly={prefs.valueOnly}
          updateFilters={updateFilters}
          handleNav={handleNav}
          setNavView={setNavView}
          trackerStats={trackerStats}
          simpleRoi={simpleRoi}
          userTier={userTier}
          marketValidationsByFixtureId={marketValidationsByFixtureId}
          isWatched={isWatched}
          toggleWatchlist={toggleWatchlist}
          openMatch={openMatch}
          onUpgradeRequired={(feature, requiredTier) => setUpgradePrompt({ feature, requiredTier })}
          warmAndPredict={warmAndPredict}
          analysisMatch={analysisMatch}
          history={history}
          trackerSlot={trackerSlot}
          pendingHistoryCount={pendingHistoryCount}
          canShowSpecialBet={user?.role === "admin" || userTier === "ultra"}
          continueMatch={continueMatch}
        />
      )}

      {navView === "history" && (
        <HistorySection
          history={history}
          trackerSlot={trackerSlot}
          pendingCount={pendingHistoryCount}
          wins={trackerStats.wins}
          losses={trackerStats.losses}
          settled={trackerStats.settled}
          winRate={trackerStats.winRate}
          onOpenMatch={openMatch}
          canShowSpecialBet={user?.role === "admin" || userTier === "ultra"}
          onUpgradeRequired={(feature, requiredTier) => setUpgradePrompt({ feature, requiredTier })}
          gsbFixtureIndex={gsbFixtureIndex}
          canUseGlobalSpecialBet={Boolean(user)}
        />
      )}

      {navView === "statistics" && (
        <StatisticsSection
          trackerSlot={trackerSlot}
          winRate={trackerStats.winRate}
          settled={trackerStats.settled}
          wins={trackerStats.wins}
          losses={trackerStats.losses}
          history={history}
          leagueBreakdown={userPerformanceByLeague}
        />
      )}

      {navView === "notifications" && (
        <NotificationsView
          notificationItems={notificationItems}
          alertsPreview={alertsPreview}
          preds={preds}
          prefs={prefs}
          openMatch={openMatch}
          history={history}
          markNotificationsSeen={markNotificationsSeen}
          onToggleLiveSwing={(enabled) => updateFilters({ notifyLiveSwing: enabled })}
          saveNotificationPrefs={saveNotificationPrefs}
          notifSaveBusy={notifSaveBusy}
          notifySafe={notifySafe}
          setNotifySafe={setNotifySafe}
          notifyValue={notifyValue}
          setNotifyValue={setNotifyValue}
          notifyEmail={notifyEmail}
          setNotifyEmail={setNotifyEmail}
          notifyEmailConsent={notifyEmailConsent}
          setNotifyEmailConsent={setNotifyEmailConsent}
        />
      )}

      {navView === "profile" && (
        <ProfileView
          user={user}
          userTier={userTier}
          isSubscriptionExpired={isSubscriptionExpired}
          trialRemainingTime={trialRemainingTime}
          tierQuotaExempt={tierQuotaExempt}
          predictCountToday={predictCountToday}
          predictLimitToday={predictLimitToday}
          logout={logout}
          activate24hTrial={activate24hTrial}
          updateFilters={updateFilters}
          setStatus={setStatus}
          trialBusy={trialBusy}
          setTrialBusy={setTrialBusy}
          billingBusy={billingBusy}
          setBillingBusy={setBillingBusy}
          billingConfigured={billingConfigured}
          formatRemaining={formatRemaining}
          handleNav={handleNav}
        />
      )}

      {navView === "settings" && (
        <SettingsView
          prefs={prefs}
          updateFilters={updateFilters}
          logout={logout}
          cycleTheme={cycleTheme}
          downloadPersonalDataExport={downloadPersonalDataExport}
          exportBusy={exportBusy}
          onSupportSubmitted={(key) => setToast(t(key))}
        />
      )}

      <PerformanceCounterModal
        open={perfCounterModalOpen}
        onClose={() => setPerfCounterModalOpen(false)}
        days={30}
        globalByLeague={userPerformanceByLeague}
        accessToken={session?.access_token ?? null}
        isAdmin={false}
        leagueTableHeading="Predicțiile tale · pe ligă (ultimele 30 zile)"
      />
      {selectedMatch && (
        // Null fallback: the first open pays one cached network roundtrip; a
        // spinner for that beat would flash more than it informs.
        <Suspense fallback={null}>
          <MatchModal
            match={selectedMatch}
            logoColors={{}}
            hashColor={hashColor}
            canShowSpecialBet={user?.role === "admin" || userTier === "ultra"}
            accessTier={userTier}
            presentation="focus"
            onClose={() => setSelectedMatch(null)}
            onUpgradeRequired={(feature, requiredTier) => setUpgradePrompt({ feature, requiredTier })}
          />
        </Suspense>
      )}
      <UpgradePrompt
        open={Boolean(upgradePrompt)}
        feature={upgradePrompt?.feature ?? ""}
        requiredTier={upgradePrompt?.requiredTier ?? "premium"}
        onClose={() => setUpgradePrompt(null)}
        onGoUpgrade={() => {
          setSelectedMatch(null);
          setNavView("profile");
          window.setTimeout(() => {
            document.getElementById("upgrade")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 80);
        }}
      />
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onOpen={() => setCommandOpen(true)}
        matches={preds}
        historyLabels={historySearchLabels}
        onSelectMatch={openMatch}
        onNavigate={handleNav}
        onPredict={() => void warmAndPredict()}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <ReportPredictionDialog
        open={Boolean(reportRow)}
        row={reportRow}
        onClose={() => setReportRow(null)}
        onSubmitted={() => setToast(t("predictionReport.successMessage"))}
      />
      {isLeaguesOpen && (
        <div className="fixed inset-0 z-[var(--fp-z-drawer)] flex items-end justify-end bg-fp-navy/30 backdrop-blur-[1px] sm:items-stretch" onClick={() => setIsLeaguesOpen(false)}>
          <div
            className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-fp-lg sm:h-full sm:max-h-none sm:rounded-none sm:border-l sm:pb-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal
            aria-label="League filter"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">{t("dash.leaguesTitle")}</h2>
              <Button variant="ghost" size="sm" onClick={() => setIsLeaguesOpen(false)}>
                {t("dash.close")}
              </Button>
            </div>
            <LeaguePanel
              leaguesSorted={leaguesSorted}
              selectedSet={new Set(selectedLeagueIds)}
              selectedLeagueIds={selectedLeagueIds}
              isLeaguesOpen
              searchLeague={searchLeague}
              eliteLeagues={ELITE_LEAGUES}
              setIsLeaguesOpen={setIsLeaguesOpen}
              setSearchLeague={setSearchLeague}
              setSelectedLeagueIds={setSelectedLeagueIdsLimited}
              selectEliteLeagues={() => setSelectedLeagueIdsLimited(leaguesSorted.map((league) => Number(league.id)))}
              clearLeagueSelection={() => setSelectedLeagueIdsLimited([])}
            />
          </div>
        </div>
      )}
      {user && !user.onboardingCompleted && (
        <OnboardingCarousel
          leagueOptions={ELITE_LEAGUE_META}
          initialLeagueIds={selectedLeagueIds}
          onComplete={({ leagueIds, markets }) => {
            setSelectedLeagueIdsLimited(leagueIds);
            updateFilters({ preferredMarkets: markets });
            void markOnboardingComplete().catch(() => {});
            // First value moment: generate predictions right away instead of dropping
            // the new user on an empty dashboard. Deferred via effect — warm/predict
            // read selectedLeagueIds, which hasn't propagated yet in this handler.
            setOnboardingAutoPredict(leagueIds.length > 0);
          }}
        />
      )}
    </ConsumerShell>
  );
}
