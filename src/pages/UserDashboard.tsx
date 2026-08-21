import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import LeaguePanel from "../components/LeaguePanel";
import PerformanceCounterModal from "../components/PerformanceCounterModal";
import SuccessRateTracker from "../components/SuccessRateTracker";
import type { AppNavView, MatchesSubFilter } from "../components/ux/appNav";
import { useWorkspaceRoute } from "./userDashboard/useWorkspaceRoute";
import TicketsSection from "../components/ux/TicketsSection";
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
import { useHistoryDetailSource } from "../hooks/useHistoryDetailSource";
import { useUiPrefs } from "../hooks/useUiPrefs";
import { PredictionRow } from "../types";
import Button from "../design-system/Button";
import Banner from "../design-system/Banner";
import Toast from "../design-system/Toast";
import UpgradePrompt, { type UpgradeTier } from "../design-system/UpgradePrompt";
import Overlay from "../design-system/Overlay";
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
import {
  canShowSpecialBet as canShowSpecialBetFor,
  clampTierDates,
  hasLegacyPredictionShape,
  shouldShowOnboarding
} from "./userDashboard/helpers";
import ProfileView from "./userDashboard/ProfileView";
import NotificationsView from "./userDashboard/NotificationsView";
import SettingsView from "./userDashboard/SettingsView";
import DateRangeChips from "./userDashboard/DateRangeChips";
import ReportPredictionDialog from "../components/support/ReportPredictionDialog";
import { useDashboardHistory } from "./userDashboard/useDashboardHistory";
import { usePredictionsCache } from "./userDashboard/usePredictionsCache";
import { useLeagueSelection } from "./userDashboard/useLeagueSelection";
import { useDerivedPredictions } from "./userDashboard/useDerivedPredictions";
import { useTrackerAnimations } from "./userDashboard/useTrackerAnimations";

/** How often the workspace re-reads server tier/quota state. See the effect below. */
const TIER_STATUS_POLL_MS = 5 * 60_000;

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
  // The consumer surface renders LeaguePanel through the modal Overlay, so
  // "open" means an inert, scroll-locked, focus-trapped workspace behind a
  // dialog. It opens from the shell's "Selectează ligi" trigger — never on
  // arrival, and never again because the window was resized.
  const { isLeaguesOpen, setIsLeaguesOpen } = useLeaguePanelState({ initialOpen: false });
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
  // Destination = URL (/workspace/<slug>): deep links, Back/Forward, reload. See useWorkspaceRoute.
  const { navView, setNavView } = useWorkspaceRoute();
  /*
   * Matches segment + search are a way of LOOKING at the slate, not an
   * account preference: they live for the session and survive tab switches,
   * but a new session starts on "all" with an empty search. (valueOnly /
   * minConfidence stay persistent — Settings calls them "saved filters".)
   */
  const [matchesFilter, setMatchesFilter] = useState<MatchesSubFilter>("all");
  const [matchSearch, setMatchSearch] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [upgradePrompt, setUpgradePrompt] = useState<{ feature: string; requiredTier: UpgradeTier } | null>(null);
  const { t, setLocale, locale } = useLocale();
  const {
    prefs,
    setLocale: setPrefsLocale,
    cycleTheme,
    toggleWatchlist,
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
  const showSettledMarketsOnly = prefs.settledOnly;
  const todayKey = localCalendarDateKey();
  // One predicate for both Special Bet surfaces (list modal + history) — see helpers.
  const canShowSpecialBet = canShowSpecialBetFor(userTier, tierQuotaExempt);
  const {
    history,
    historyStats,
    loadHistory,
    isHistorySyncing,
    pendingHistoryCount,
    marketValidationsByFixtureId,
    userPerformanceByLeague,
    historySearchLabels
  } = useDashboardHistory({ userId: user?.id, accessToken: session?.access_token });
  /*
    The modal's data source. For a fixture that exists in history this resolves
    to the by-fixture detail row; for anything else — and for any failure — it
    stays on `selectedMatch`, so the modal is never worse off than before.
    See useHistoryDetailSource for why membership, not the opening section,
    decides whether a request happens.
  */
  const { match: modalMatch } = useHistoryDetailSource(selectedMatch, history);
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
    analysisMatch
  } = useDerivedPredictions({
    preds,
    history,
    prefs,
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
      setStatus(t("dash.billingSuccess"));
      setNavView("settings");
    } else if (billing === "cancel") {
      setStatus(t("dash.billingCancelled"));
    }
    params.delete("billing");
    params.delete("tier");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState({}, "", next);
    // Runs once on mount (the URL param is consumed and stripped); `t` is read at
    // that moment only, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot URL consumption
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

  /*
    Every tick is a real request: /api/fixtures?tierStatus=1 INCRs the shared
    `anonrl:fixtures-day:{ip}:{hour}` rate-limit counter and reads the daily
    predict counter — 2 KV commands, whether it answers 200 or 402.

    At 30s that was 121 requests/hour per open tab, against a default cap of
    120/hour for that namespace: one workspace left open consumed an IP's
    entire fixture-listing budget, and everyone behind the same NAT shared it.

    Nothing on Home, Matches or the prediction flow reads this. It feeds
    predictCountToday / predictLimitToday / tierQuotaExempt, and those reach
    ProfileView alone — a screen you have to navigate to, which re-runs the
    session refresh on the way in. Five minutes is fresh enough for a quota
    line there, and drops the tab to ~10% of the budget.
  */
  useEffect(() => {
    if (!session?.access_token) return;
    const tm = setInterval(() => {
      void refreshTierStatus();
    }, TIER_STATUS_POLL_MS);
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

  const openMatch = useCallback((match: PredictionRow) => setSelectedMatch(match), []);

  // Navigation changes the destination and nothing else: the Matches segment
  // a user chose is still there when they come back (it used to reset to "all").
  const handleNav = useCallback((view: AppNavView) => setNavView(view), [setNavView]);
  const goLive = useCallback(() => {
    setMatchesFilter("live");
    setNavView("matches");
  }, [setNavView]);

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
      variant="hero"
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
      onPredict={() => void warmAndPredict()}
      predictBusy={warmPredictBusy}
      liveCount={homeLiveCount}
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
        <Banner tone="info" live="status" className="mb-3 font-semibold">
          {status}
        </Banner>
      )}
      {rehydratedNotice && (
        <Banner tone="info" className="mb-3 !text-xs">
          <span className="font-semibold text-[var(--fp-accent)]">{t("dash.rehydratedLabel")}</span>{" "}
          <span className="text-[var(--fp-text-muted)]">{rehydratedNotice}</span>
        </Banner>
      )}
      {userTier !== "free" && preds.length > 0 && hasLegacyPredictionShape(preds, userTier) && (
        <Banner
          tone="warning"
          className="mb-3"
          action={
            <Button size="sm" loading={warmPredictBusy} onClick={() => void warmAndPredict()}>
              {t("shell.predict")}
            </Button>
          }
        >
          <span className="font-semibold text-[var(--fp-text)]">{t("dash.needPredictForMarkets")}</span>
        </Banner>
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
          onGoLive={goLive}
          onGoHistory={() => handleNav("history")}
          onGoStatistics={() => handleNav("statistics")}
          onGoTickets={() => handleNav("tickets")}
          onPredict={() => void warmAndPredict()}
          trackerStats={trackerStats}
          selectedDate={activePredictDates[0] ?? date}
        />
      )}

      {navView === "matches" && (
        <MatchesSection
          matches={visiblePreds}
          accessTier={userTier}
          marketValidationsByFixtureId={marketValidationsByFixtureId}
          isWatched={isWatched}
          onToggleWatch={toggleWatchlist}
          onOpenMatch={openMatch}
          onUpgradeRequired={(feature, requiredTier) => setUpgradePrompt({ feature, requiredTier })}
          onPredict={() => void warmAndPredict()}
          matchesFilter={matchesFilter}
          onSetFilter={setMatchesFilter}
          search={matchSearch}
          onSearchChange={setMatchSearch}
          valueOnly={prefs.valueOnly}
          onToggleValueOnly={(checked) => updateFilters({ valueOnly: checked })}
          highConfActive={prefs.minConfidence > 0}
          onToggleHighConf={() =>
            updateFilters({ minConfidence: prefs.minConfidence > 0 ? 0 : HIGH_CONFIDENCE_THRESHOLD })
          }
          onOpenLeagues={() => setIsLeaguesOpen(true)}
          onRefresh={() => void restoreOrPredict()}
          refreshBusy={warmPredictBusy}
          extraDates={
            <DateRangeChips
              date={date}
              userTier={userTier}
              activePredictDates={activePredictDates}
              setSelectedDates={setSelectedDates}
              setStatus={setStatus}
            />
          }
          loading={warmPredictBusy && !visiblePreds.length}
        />
      )}

      {navView === "history" && (
        <HistorySection history={history} onOpenMatch={openMatch} onGoTickets={() => handleNav("tickets")} />
      )}

      {navView === "tickets" && (
        <TicketsSection
          betDate={todayKey}
          favoriteLeagueIds={user?.favoriteLeagues ?? []}
          fixtureIndex={gsbFixtureIndex}
          /* No tier gate exists for /api/special-bets, so the UI adds none (UX-G). */
          canUseGlobalSpecialBet={Boolean(user)}
          onUpgradeRequired={(feature) => setUpgradePrompt({ feature, requiredTier: "ultra" })}
        />
      )}

      {navView === "statistics" && (
        <StatisticsSection
          trackerSlot={trackerSlot}
          history={history}
          leagueBreakdown={userPerformanceByLeague}
          onStartPredicting={() => handleNav("home")}
          onViewResults={() => handleNav("history")}
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
          onOpenLeagues={() => setIsLeaguesOpen(true)}
          showModelInternals={prefs.showModelInternals}
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
      {modalMatch && (
        // Null fallback: the first open pays one cached network roundtrip; a
        // spinner for that beat would flash more than it informs.
        <Suspense fallback={null}>
          <MatchModal
            match={modalMatch}
            logoColors={{}}
            hashColor={hashColor}
            canShowSpecialBet={canShowSpecialBet}
            accessTier={userTier}
            presentation="focus"
            onClose={() => setSelectedMatch(null)}
            onUpgradeRequired={(feature, requiredTier) => setUpgradePrompt({ feature, requiredTier })}
            onReport={() => setReportRow(modalMatch)}
            showModelInternals={prefs.showModelInternals}
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
      <Toast message={toast} onDismiss={() => setToast(null)} dismissLabel={t("common.close")} />
      <ReportPredictionDialog
        open={Boolean(reportRow)}
        row={reportRow}
        onClose={() => setReportRow(null)}
        onSubmitted={() => setToast(t("predictionReport.successMessage"))}
      />
      <Overlay
        open={isLeaguesOpen}
        onClose={() => setIsLeaguesOpen(false)}
        presentation="drawer"
        closeOnBackdrop
        zClassName="z-[var(--fp-z-drawer)]"
        aria-label="League filter"
        backdropClassName="bg-fp-navy/30 backdrop-blur-[1px]"
        panelClassName="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-fp-lg sm:h-full sm:max-h-none sm:rounded-none sm:border-l sm:pb-4"
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
      </Overlay>
      {shouldShowOnboarding(user) && (
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
