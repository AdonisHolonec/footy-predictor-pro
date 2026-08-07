import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import LeaguePanel from "../components/LeaguePanel";
import PerformanceCounterModal from "../components/PerformanceCounterModal";
import SuccessRateTracker from "../components/SuccessRateTracker";
import type { AppNavView, MatchesSubFilter } from "../components/ux/appNav";
import CommandPalette from "../components/ux/CommandPalette";
import ConsumerShell from "../components/ux/ConsumerShell";
import PredictionFocusCard from "../components/ux/PredictionFocusCard";
import HomeSection from "../components/ux/HomeSection";
import MatchesSection from "../components/ux/MatchesSection";
import NotificationsSection from "../components/ux/NotificationsSection";
import OnboardingCarousel from "../components/ux/OnboardingCarousel";
import { deriveNotifications } from "../utils/deriveNotifications";
import { StatTile } from "../design-system";
import PricingCampaignBanner, { PlanCampaignPrice } from "../components/ux/PricingCampaignBanner";
import HistorySection from "../components/ux/HistorySection";
import StatisticsSection from "../components/ux/StatisticsSection";
import { ELITE_LEAGUES, ELITE_LEAGUE_META } from "../constants/appConstants";
import { USER_PREDICT_FLOW_MESSAGES } from "../constants/predictFlowMessages";
import { useAuth } from "../hooks/useAuth";
import { useDateRollover } from "../hooks/useDateRollover";
import { useHistorySync } from "../hooks/useHistorySync";
import { isCompactViewport, useLeaguePanelState } from "../hooks/useLeaguePanelState";
import { usePredictFlow } from "../hooks/usePredictFlow";
import { useLiveFixtureScorePoll } from "../hooks/useLiveFixtureScorePoll";
import { useMarketTotalsHydrate } from "../hooks/useMarketTotalsHydrate";
import { useUiPrefs } from "../hooks/useUiPrefs";
import { DayResponse, HistoryEntry, HistoryStats, League, PerformanceLeagueBreakdown, PredictionRow } from "../types";
import { isFinalMatchStatus } from "../utils/cardMarketOutcome";
import { formatRecommendedPick } from "../utils/formatRecommendation";
import Button from "../design-system/Button";
import Card from "../design-system/Card";
import Badge from "../design-system/Badge";
import EmptyState from "../design-system/EmptyState";
import Toast from "../design-system/Toast";
import CollapsiblePanel from "../design-system/CollapsiblePanel";
import Tooltip from "../design-system/Tooltip";
import UpgradePrompt, { type UpgradeTier } from "../design-system/UpgradePrompt";
import { useLocale } from "../context/LocaleContext";

// Statically imported ON PURPOSE: MatchCard / FeaturedPredictionCard anchor these
// three with static imports, so a lazy() here was theater — the bundler kept them
// in this chunk anyway and the build flagged INEFFECTIVE_DYNAMIC_IMPORT. Honest
// static imports until the Sprint 7 card refactor moves the anchors.
import PredictionLaboratoryPanel from "../components/PredictionLaboratory";
import FeatureImportanceChart from "../components/FeatureImportanceChart";
import PredictionContributionsChart from "../components/PredictionContributionsChart";

// The modal is the keystone split: it renders only when a match is opened, it is
// imported nowhere else, and five heavy panels ride in its static subtree. Making
// it lazy is what lets the panel splits below actually take effect.
const MatchModal = lazy(() => import("../components/MatchModal"));
const MonteCarloPanel = lazy(() => import("../components/MonteCarloPanel"));
const ConfidenceEnginePanel = lazy(() => import("../components/ConfidenceEnginePanel"));
const TrackRecordSection = lazy(() =>
  import("../components/TrackRecordSection").then((m) => ({ default: m.default }))
);
import {
  hashColor,
  inferSeason,
  isFixtureInPlay,
  isoToday,
  kickoffLocalDateKey,
  localCalendarDateKey,
  mergePredictionRows,
  mergePredsWithHistory,
  normalizeSelectedDates,
  useLocalStorageState
} from "../utils/appUtils";
import { syncHistoryAfterPredict } from "../utils/predictFlowUtils";
import { computeSimpleRoi, historyStatsFromRows, tallyEntryCardMarkets } from "../utils/historyStats";
import { loadBillingConfig, openBillingPortal, startCheckout } from "../services/billingService";
// Pure helpers extracted verbatim in Sprint 6 — the component keeps the
// wiring, ./userDashboard/helpers keeps the arithmetic.
import {
  MAIN_VIEWS,
  addIsoDay,
  clampTierDates,
  hasDerivateMarkets,
  hasLegacyPredictionShape,
  isFinalStatus,
  matchesPreferredMarkets
} from "./userDashboard/helpers";
import ProfileView from "./userDashboard/ProfileView";
import NotificationsView from "./userDashboard/NotificationsView";
import SettingsView from "./userDashboard/SettingsView";

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
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<number[]>([]);
  const [favoriteLeaguesByUser, setFavoriteLeaguesByUser] = useLocalStorageState<Record<string, number[]>>("footy.user.favoriteLeagueByUser", {});
  const [predictionsByUser, setPredictionsByUser] = useLocalStorageState<Record<string, PredictionRow[]>>("footy.user.predictionsByUser", {});
  const [searchLeague, setSearchLeague] = useState("");
  const { isLeaguesOpen, setIsLeaguesOpen } = useLeaguePanelState();
  const [preds, setPreds] = useState<PredictionRow[]>([]);
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
  const [day, setDay] = useState<DayResponse | null>(null);
  const [status, setStatus] = useState("");
  const [rehydratedNotice, setRehydratedNotice] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<PredictionRow | null>(null);
  const [historyStats, setHistoryStats] = useState<HistoryStats>({ wins: 0, losses: 0, settled: 0, winRate: 0 });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isWinRatePulsing, setIsWinRatePulsing] = useState(false);
  const [animatedWins, setAnimatedWins] = useState(0);
  const [animatedLosses, setAnimatedLosses] = useState(0);
  const [animatedWinRate, setAnimatedWinRate] = useState(0);
  const [dateSyncBadgeUntil, setDateSyncBadgeUntil] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [notifySafe, setNotifySafe] = useState<boolean>(user?.notificationPrefs?.safe ?? true);
  const [notifyValue, setNotifyValue] = useState<boolean>(user?.notificationPrefs?.value ?? true);
  const [notifyEmail, setNotifyEmail] = useState<boolean>(user?.notificationPrefs?.email ?? false);
  const [alertsPreview, setAlertsPreview] = useState<{ safe: number; value: number }>({ safe: 0, value: 0 });
  const [, setUserPredictionMap] = useLocalStorageState<Record<string, number[]>>("footy.user.predictionMap", {});
  /** Avoid re-hydrating selection from profile every time favoriteLeaguesByUser echoes from saves (caused “stuck” league list). */
  const lastSelectionHydrateUserId = useRef<string | null>(null);
  /** Distinguishes a genuine account switch (clear cached predictions) from a same-user refresh/session-restore (keep them). */
  const previousUserIdRef = useRef<string | null>(null);
  const [notifyEmailConsent, setNotifyEmailConsent] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [warmPredictBusy, setWarmPredictBusy] = useState(false);
  const [notifSaveBusy, setNotifSaveBusy] = useState(false);
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
  const trackerStats = useMemo(() => historyStats, [historyStats]);
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
  const predIdSet = useMemo(() => new Set(preds.map((p) => p.id)), [preds]);
  const pendingAmongDisplayedPreds = useMemo(
    () => history.filter((h) => h.validation === "pending" && predIdSet.has(h.id)).length,
    [history, predIdSet]
  );
  const visiblePreds = useMemo(() => {
    let rows = [...preds].sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
    const listFilter: MatchesSubFilter | "predictions" =
      navView === "live"
        ? "live"
        : navView === "predictions"
          ? "predictions"
          : matchesFilter === "favorites" || matchesFilter === "live"
            ? matchesFilter
            : "all";
    if (listFilter === "live") {
      rows = rows.filter((row) => isFixtureInPlay(row.status));
    } else if (listFilter === "favorites") {
      const ids = new Set(prefs.watchlistFixtureIds);
      rows = rows.filter((row) => ids.has(Number(row.id)));
    } else if (listFilter === "predictions") {
      rows = rows
        .filter((row) => !row.insufficientData && Boolean(row.recommended?.pick))
        .slice()
        .sort((a, b) => Number(b.recommended?.confidence || 0) - Number(a.recommended?.confidence || 0));
    }
    if (showSettledMarketsOnly) {
      rows = rows.filter((row) => isFinalStatus(row.status) && hasDerivateMarkets(row));
    }
    const q = matchSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => {
        const hay = `${row.teams.home} ${row.teams.away} ${row.league} ${row.recommended?.pick || ""}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (prefs.minConfidence > 0) {
      rows = rows.filter((row) => {
        const c = Number(row.recommended?.confidence);
        return Number.isFinite(c) && c >= prefs.minConfidence;
      });
    }
    if (prefs.minEv > 0) {
      rows = rows.filter((row) => {
        const e = Number(row.valueBet?.ev ?? row.valueEngine?.expectedValue);
        return Number.isFinite(e) && e >= prefs.minEv;
      });
    }
    if (prefs.valueOnly) {
      rows = rows.filter(
        (row) => Boolean(row.valueBet?.detected) || Number(row.valueBet?.ev ?? row.valueEngine?.expectedValue) > 0
      );
    }
    if (prefs.preferredMarkets.length) {
      rows = rows.filter((row) => matchesPreferredMarkets(row, prefs.preferredMarkets));
    }
    return rows;
  }, [
    preds,
    showSettledMarketsOnly,
    navView,
    matchesFilter,
    prefs.watchlistFixtureIds,
    prefs.minConfidence,
    prefs.minEv,
    prefs.valueOnly,
    prefs.preferredMarkets,
    matchSearch
  ]);
  const homePreds = useMemo(() => {
    let rows = [...preds].sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
    if (showSettledMarketsOnly) {
      rows = rows.filter((row) => isFinalStatus(row.status) && hasDerivateMarkets(row));
    }
    const q = matchSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => {
        const hay = `${row.teams.home} ${row.teams.away} ${row.league} ${row.recommended?.pick || ""}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (prefs.minConfidence > 0) {
      rows = rows.filter((row) => {
        const c = Number(row.recommended?.confidence);
        return Number.isFinite(c) && c >= prefs.minConfidence;
      });
    }
    if (prefs.valueOnly) {
      rows = rows.filter(
        (row) => Boolean(row.valueBet?.detected) || Number(row.valueBet?.ev ?? row.valueEngine?.expectedValue) > 0
      );
    }
    if (prefs.preferredMarkets.length) {
      rows = rows.filter((row) => matchesPreferredMarkets(row, prefs.preferredMarkets));
    }
    return rows;
  }, [preds, showSettledMarketsOnly, prefs.minConfidence, prefs.valueOnly, prefs.preferredMarkets, matchSearch]);
  const homeLiveCount = useMemo(() => preds.filter((row) => isFixtureInPlay(row.status)).length, [preds]);
  const notificationItems = useMemo(
    () => deriveNotifications({ predictions: preds, history, watchlistFixtureIds: prefs.watchlistFixtureIds }),
    [preds, history, prefs.watchlistFixtureIds]
  );
  const continueMatch = useMemo(() => {
    const recent = prefs.recentFixtureIds[0];
    if (!recent) return null;
    return preds.find((p) => Number(p.id) === recent) || null;
  }, [prefs.recentFixtureIds, preds]);
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
  const prevWinRateRef = useRef(trackerStats.winRate);
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
      const response = await fetch("/api/history?days=30&limit=2000&mine=1", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await response.json();
      if (!json?.ok) return;
      const items = (Array.isArray(json.items) ? json.items : []) as HistoryEntry[];
      setHistory(items);
      setHistoryStats(json.stats || historyStatsFromRows(items));
    } catch {
      // keep existing data on failure
    }
  }, [user?.id, session?.access_token]);

  const { isHistorySyncing, syncHistory } = useHistorySync({
    accessToken: session?.access_token,
    defaultDays: 7,
    cooldownMs: 10 * 60_000,
    onAfterSync: loadHistory
  });
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

  function setSelectedLeagueIdsLimited(nextIds: number[]) {
    const normalized = Array.from(new Set(nextIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))));
    setSelectedLeagueIds(normalized);
  }

  const leaguesSorted = useMemo(() => {
    const allowedLeagueSet = new Set(ELITE_LEAGUES.map((id) => Number(id)));
    const liveById = new Map((day?.leagues ?? []).map((league) => [Number(league.id), league] as const));
    const leagues = ELITE_LEAGUE_META.map((meta) => {
      const existing = liveById.get(Number(meta.id));
      return {
        id: meta.id,
        name: existing?.name || meta.name,
        country: existing?.country || meta.country,
        matches: Number(existing?.matches || 0),
        logo: existing?.logo
      };
    })
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
    const isDifferentUser = previousUserIdRef.current !== null && previousUserIdRef.current !== user.id;
    previousUserIdRef.current = user.id;
    if (!isDifferentUser) return;
    setPredictionsByUser((prev) => {
      const next = { ...prev };
      delete next[user.id];
      return next;
    });
    setSelectedDates([isoToday()]);
  }, [user?.id]);

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
      const kickoffDate = kickoffLocalDateKey(row.kickoff);
      if (!selectedDateSet.has(kickoffDate)) return false;
      /* Until favorite leagues hydrate, keep date-matched rows visible. */
      if (!selectedLeagueSet.size) return true;
      return selectedLeagueSet.has(Number(row.leagueId));
    });
    // predictionsByUser never receives live poll data (score/momentum/liveAdjustment)
    // — it lives only in-memory on `preds`. Re-filtering from the cache on every
    // predictionsByUser change (history sync, xg hydrate, tier promotion, etc.)
    // would otherwise silently discard it mid-match. Carry it forward unless the
    // cache shows the match freshly settled (then trust the settled snapshot).
    setPreds((prevPreds) => {
      const prevById = new Map(prevPreds.map((p) => [Number(p.id), p]));
      return filtered.map((row) => {
        const prev = prevById.get(Number(row.id));
        if (!prev) return row;
        if (isFinalMatchStatus(row.status) && !isFinalMatchStatus(prev.status)) return row;
        return {
          ...row,
          status: prev.status || row.status,
          score: prev.score ?? row.score,
          momentum: prev.momentum ?? row.momentum,
          confidenceEngine: row.confidenceEngine
            ? { ...row.confidenceEngine, liveAdjustment: prev.confidenceEngine?.liveAdjustment ?? row.confidenceEngine?.liveAdjustment }
            : row.confidenceEngine
        };
      });
    });
    if (hasLegacyPredictionShape(localPredictions, userTier) && filtered.length) {
      setRehydratedNotice(t("dash.legacyNotice"));
    }
  }, [user?.id, userTier, predictionsByUser, selectedLeagueIds.join("|"), selectedDates.join("|"), date]);

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
    if (!user?.id || !session?.access_token) return;
    setFavoriteLeaguesByUser((prev) => ({ ...prev, [user.id]: selectedLeagueIds }));
    const timer = setTimeout(() => {
      void updateFavoriteLeagues(selectedLeagueIds).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Nu am putut salva preferintele de ligi.";
        setStatus(message);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [selectedLeagueIds, user?.id, session?.access_token, updateFavoriteLeagues, setFavoriteLeaguesByUser]);

  useEffect(() => {
    void fetchDays(normalizeSelectedDates(selectedDates.length ? selectedDates : [date]));
  }, [date, selectedDates.join("|")]);

  useEffect(() => {
    if (!user?.id || !history.length) return;
    setPredictionsByUser((prev) => {
      const rows = prev[user.id];
      if (!rows?.length) return prev;
      const merged = mergePredsWithHistory(rows, history);
      if (merged === rows) return prev;
      return { ...prev, [user.id]: merged };
    });
  }, [history, user?.id, setPredictionsByUser]);

  const tierShapeRehydrateKeyRef = useRef("");
  useEffect(() => {
    if (!user?.id) return;
    if (!session?.access_token) return;
    if (!selectedLeagueIds.length) return;
    // Rehydrate when cache is empty or under-masked for the current effective tier (mobile free→ultra case).
    if (preds.length > 0 && !hasLegacyPredictionShape(preds, userTier)) return;
    const shapeKey = `${user.id}|${userTier}|${normalizeSelectedDates(selectedDates.length ? selectedDates : [date]).join(",")}|${selectedLeagueIds.join(",")}`;
    if (preds.length > 0 && hasLegacyPredictionShape(preds, userTier)) {
      if (tierShapeRehydrateKeyRef.current === shapeKey) return;
      tierShapeRehydrateKeyRef.current = shapeKey;
    }
    void rehydratePredictionsFromHistory();
  }, [user?.id, session?.access_token, preds, userTier, selectedLeagueIds.join("|"), selectedDates.join("|"), date]);

  useEffect(() => {
    if (!session?.access_token) return;
    void syncHistory();
  }, [session?.access_token, syncHistory]);

  useEffect(() => {
    if (!session?.access_token) return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void syncHistory();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [session?.access_token, syncHistory]);

  useEffect(() => {
    if (dateSyncBadgeUntil <= Date.now()) return;
    const tm = setTimeout(() => setDateSyncBadgeUntil(0), Math.max(0, dateSyncBadgeUntil - Date.now()));
    return () => clearTimeout(tm);
  }, [dateSyncBadgeUntil]);

  useEffect(() => {
    if (!session?.access_token) return;
    if (pendingHistoryCount <= 0) return;
    const tm = setInterval(() => {
      if (isHistorySyncing) return;
      void syncHistory(7);
    }, 15 * 60_000);
    return () => clearInterval(tm);
  }, [session?.access_token, pendingHistoryCount, isHistorySyncing, syncHistory]);

  useEffect(() => {
    if (!session?.access_token) return;
    const tm = setInterval(() => {
      void refreshTierStatus();
    }, 30000);
    return () => clearInterval(tm);
  }, [session?.access_token, refreshTierStatus]);

  // Drop free-masked localStorage rows when the user is promoted (tierStatus / admin grant).
  const prevEffectiveTierRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!user?.id) return;
    const nextTier = String(userTier || user.tier || "free").toLowerCase();
    const prevTier = prevEffectiveTierRef.current;
    prevEffectiveTierRef.current = nextTier;
    if (!prevTier || prevTier === nextTier) return;
    const rank: Record<string, number> = { free: 0, premium: 1, ultra: 2 };
    if ((rank[nextTier] ?? 0) <= (rank[prevTier] ?? 0)) return;
    setPredictionsByUser((prev) => {
      if (!prev[user.id]?.length) return prev;
      const copy = { ...prev };
      delete copy[user.id];
      return copy;
    });
    setPreds((prev) => (prev.length ? [] : prev));
    setStatus("Plan upgraded — run Predict again for full markets.");
  }, [user?.id, userTier, user?.tier, setPredictionsByUser]);

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

  async function rehydratePredictionsFromHistory(): Promise<PredictionRow[]> {
    try {
      if (!user?.id || !session?.access_token) return [];
      const response = await fetch("/api/history?days=14&limit=1000&mine=1", {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      const json = await response.json();
      if (!response.ok || !json?.ok || !Array.isArray(json.items)) return [];
      /** Doar răspuns user-scoped (join user_prediction_fixtures); refuză istoric global dacă lipsește flag. */
      if (json.mine !== true) return [];

      const effectiveDates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
      const selectedDateSet = new Set(effectiveDates);
      const selectedLeagueSet = new Set(selectedLeagueIds.map((id) => Number(id)));
      const hydrated = (json.items as PredictionRow[])
        .filter((row) => {
          const kickoffDate = kickoffLocalDateKey(row.kickoff);
          if (!selectedDateSet.has(kickoffDate)) return false;
          if (!selectedLeagueSet.size) return true;
          return selectedLeagueSet.has(Number(row.leagueId));
        })
        .slice(0, 80);

      if (!hydrated.length) return [];

      setPreds(hydrated);
      if (user?.id) {
        setPredictionsByUser((prev) => ({
          ...prev,
          [user.id]: mergePredictionRows(prev[user.id] || [], hydrated)
        }));
        setUserPredictionMap((prev) => {
          const existing = prev[user.id] || [];
          const merged = Array.from(new Set([...existing, ...hydrated.map((item) => Number(item.id))]));
          return { ...prev, [user.id]: merged };
        });
      }
      setStatus(t("dash.restoredHistory", { n: hydrated.length }));
      setRehydratedNotice(t("dash.restoredNotice", { n: hydrated.length }));
      return hydrated;
    } catch {
      return [];
    }
  }

  useEffect(() => {
    if (!rehydratedNotice) return;
    const tm = setTimeout(() => setRehydratedNotice(null), 5000);
    return () => clearTimeout(tm);
  }, [rehydratedNotice]);

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
    } catch (error: any) {
      setStatus(error?.message || "Nu am putut salva preferintele de notificare.");
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

  const historySearchLabels = useMemo(
    () =>
      history
        .slice(0, 40)
        .map((h) => `${h.teams?.home || "?"} vs ${h.teams?.away || "?"} · ${h.league || ""}`.trim()),
    [history]
  );

  const isMainBoard =
    MAIN_VIEWS.includes(navView) && navView !== "home" && navView !== "matches" && navView !== "live";
  const simpleRoi = useMemo(() => computeSimpleRoi(history), [history]);
  const analysisMatch = useMemo(() => {
    const playable = preds.filter((p) => !p.insufficientData);
    return (
      [...playable].sort(
        (a, b) => Number(b.recommended?.confidence || 0) - Number(a.recommended?.confidence || 0)
      )[0] || preds[0] || null
    );
  }, [preds]);

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
        <>
          {(userTier === "premium" || userTier === "ultra") &&
            (() => {
              const tomorrow = addIsoDay(date, 1);
              const dayAfter = addIsoDay(date, 2);
              const plus1On = activePredictDates.includes(tomorrow);
              const plus2On = activePredictDates.includes(dayAfter);
              const chipOn =
                "h-8 shrink-0 rounded-[var(--fp-radius-sm)] border border-[var(--fp-accent)] bg-[var(--fp-accent)] px-1.5 text-[10px] font-bold text-white shadow-[var(--fp-shadow-sm)] ring-1 ring-[var(--fp-accent)]/35 sm:h-9 sm:px-2 sm:text-xs sm:ring-2";
              const chipOff =
                "h-8 shrink-0 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-1.5 text-[10px] font-bold text-[var(--fp-text-muted)] sm:h-9 sm:px-2 sm:text-xs";
              return (
                <>
                  <Tooltip label={`${t("shell.includeTomorrow")} · ${plus1On ? t("shell.dayRangeOn") : t("shell.dayRangeOff")}`}>
                    <button
                      type="button"
                      title={t("shell.includeTomorrow")}
                      aria-pressed={plus1On}
                      onClick={() => {
                        if (plus1On) {
                          setSelectedDates(clampTierDates(date, userTier, [date]));
                        } else {
                          setSelectedDates(clampTierDates(date, userTier, [date, tomorrow]));
                          setStatus(t("dash.needPredictForDates"));
                        }
                      }}
                      className={plus1On ? chipOn : chipOff}
                    >
                      {t("shell.plus1Day")}
                    </button>
                  </Tooltip>
                  {userTier === "ultra" ? (
                    <Tooltip label={`${t("shell.includeNext2")} · ${plus2On ? t("shell.dayRangeOn") : t("shell.dayRangeOff")}`}>
                      <button
                        type="button"
                        title={t("shell.includeNext2")}
                        aria-pressed={plus2On}
                        onClick={() => {
                          if (plus2On) {
                            setSelectedDates(clampTierDates(date, userTier, [date, tomorrow]));
                          } else {
                            setSelectedDates(
                              clampTierDates(date, userTier, [date, tomorrow, dayAfter])
                            );
                            setStatus(t("dash.needPredictForDates"));
                          }
                        }}
                        className={plus2On ? chipOn : chipOff}
                      >
                        {t("shell.plus2Days")}
                      </button>
                    </Tooltip>
                  ) : null}
                </>
              );
            })()}
        </>
      }
    >
      {(warmPredictBusy || trialBusy !== null || billingBusy !== null || exportBusy || notifSaveBusy) && (
        <span className="mb-3 inline-flex items-center gap-1 rounded-full border border-[var(--fp-accent)]/30 bg-[var(--fp-accent-muted)] px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[var(--fp-accent)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--fp-accent)] motion-reduce:animate-none" />
          {t("dash.loading")}
        </span>
      )}
      {dateSyncBadgeUntil > Date.now() && (
        <span className="mb-3 ml-2 inline-flex items-center gap-1 rounded-full border border-[var(--fp-success)]/35 bg-[var(--fp-success)]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[var(--fp-success)]">
          {t("dash.dataSynced")}
        </span>
      )}
      {status && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 rounded-[var(--fp-radius)] border border-[var(--fp-accent)]/25 bg-[var(--fp-accent-muted)] px-3 py-2.5 text-sm font-semibold text-[var(--fp-text)]"
        >
          {status}
        </div>
      )}
      {rehydratedNotice && (
        <div className="mb-3 rounded-[var(--fp-radius)] border border-[var(--fp-accent)]/30 bg-[var(--fp-accent-muted)] px-3 py-2 text-xs">
          <span className="font-semibold text-[var(--fp-accent)]">Date vechi actualizate.</span>{" "}
          <span className="text-[var(--fp-text-muted)]">{rehydratedNotice}</span>
        </div>
      )}
      {userTier !== "free" && preds.length > 0 && hasLegacyPredictionShape(preds, userTier) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--fp-radius)] border border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10 px-3 py-2.5 text-sm">
          <p className="min-w-0 flex-1 font-semibold text-[var(--fp-text)]">{t("dash.needPredictForMarkets")}</p>
          <Button size="sm" loading={warmPredictBusy} onClick={() => void warmAndPredict()}>
            {t("shell.predict")}
          </Button>
        </div>
      )}

      {navView === "home" && (
        <HomeSection
          matches={homePreds}
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
          onToggleHighConf={() => updateFilters({ minConfidence: prefs.minConfidence > 0 ? 0 : 70 })}
          trackerStats={trackerStats}
          history={history}
          leagueBreakdown={userPerformanceByLeague}
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
        <div className="space-y-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--fp-text)] sm:text-[length:var(--fp-hero)]">
                {t("dash.predictions")}
              </h1>
              <p className="mt-0.5 text-xs text-[var(--fp-text-muted)] sm:text-sm">{t("dash.predictionsSub")}</p>
            </div>
            <div className="inline-flex flex-wrap items-center gap-1 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-0.5">
              {(
                [
                  ["all", "dash.filterAll"],
                  ["live", "dash.filterLive"],
                  ["favorites", "dash.filterFavorites"]
                ] as const
              ).map(([id, key]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    if (id === "live") handleNav("live");
                    else {
                      setNavView("matches");
                      updateFilters({ matchesFilter: id });
                    }
                  }}
                  title={t("dash.filterTitle", { label: t(key) })}
                  className={`h-9 rounded-md px-2.5 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                    id === "live" ? "hidden lg:inline-flex" : ""
                  } ${
                    (id === "live" ? matchesFilter === "live" : matchesFilter === id)
                      ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                      : "text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
                  }`}
                  aria-pressed={id === "live" ? matchesFilter === "live" : matchesFilter === id}
                >
                  {t(key)}
                </button>
              ))}
              <label className="flex h-9 items-center gap-1.5 border-l border-[var(--fp-border)] px-2.5 text-xs font-bold text-[var(--fp-text-muted)]">
                {t("dash.filterValue")}
                <input
                  type="checkbox"
                  checked={prefs.valueOnly}
                  onChange={(e) => updateFilters({ valueOnly: e.target.checked })}
                  className="accent-[var(--fp-accent)]"
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
            <StatTile label={t("dash.kpiToday")} value={String(visiblePreds.length)} tone="neutral" />
            <StatTile
              label={t("dash.kpiAccuracy")}
              value={trackerStats.settled ? `${trackerStats.winRate.toFixed(0)}%` : "—"}
              tone={!trackerStats.settled ? "neutral" : trackerStats.winRate >= 50 ? "success" : "warning"}
            />
            <StatTile
              label={t("dash.kpiRoi")}
              value={simpleRoi != null ? `${simpleRoi >= 0 ? "+" : ""}${simpleRoi.toFixed(1)}%` : "—"}
              tone={simpleRoi == null ? "neutral" : simpleRoi >= 0 ? "success" : "danger"}
            />
            <StatTile
              label={t("dash.kpiWinRate")}
              value={trackerStats.settled ? `${trackerStats.winRate.toFixed(0)}%` : "—"}
              tone={!trackerStats.settled ? "neutral" : trackerStats.winRate >= 50 ? "success" : "warning"}
            />
          </div>

          {!visiblePreds.length ? (
            <EmptyState
              title={matchesFilter === "favorites" ? t("dash.emptyFavoritesTitle") : t("dash.emptyPredsTitle")}
              description={
                matchesFilter === "favorites" ? t("dash.emptyFavoritesDesc") : t("dash.emptyPredsDesc")
              }
              actionLabel={matchesFilter === "favorites" ? t("dash.showAll") : t("shell.predict")}
              onAction={
                matchesFilter === "favorites"
                  ? () => updateFilters({ matchesFilter: "all" })
                  : () => void warmAndPredict()
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visiblePreds.map((row) => (
                <PredictionFocusCard
                  key={row.id}
                  row={row}
                  accessTier={userTier}
                  marketValidations={
                    marketValidationsByFixtureId.get(Number(row.id)) ?? row.cardMarketValidations ?? null
                  }
                  watched={isWatched(Number(row.id))}
                  onToggleWatch={() => toggleWatchlist(Number(row.id))}
                  onOpen={() => openMatch(row)}
                  onUpgradeRequired={(feature, requiredTier) => setUpgradePrompt({ feature, requiredTier })}
                />
              ))}
            </div>
          )}

          <CollapsiblePanel title={t("dash.advancedTitle")} subtitle={t("dash.advancedSub")}>
            {!analysisMatch ? (
              <p className="text-sm text-[var(--fp-text-muted)]">{t("dash.advancedEmpty")}</p>
            ) : (
              <Suspense fallback={<p className="text-sm text-[var(--fp-text-muted)]">{t("dash.advancedLoading")}</p>}>
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--fp-text)]">
                      {analysisMatch.teams.home} {t("common.vs")} {analysisMatch.teams.away}
                    </p>
                    <Button size="sm" variant="secondary" onClick={() => openMatch(analysisMatch)}>
                      {t("dash.openFocus")}
                    </Button>
                  </div>
                  <MonteCarloPanel
                    match={analysisMatch}
                    homeColor={hashColor(analysisMatch.teams.home)}
                    awayColor={hashColor(analysisMatch.teams.away)}
                  />
                  {analysisMatch.featureImportance && (
                    <FeatureImportanceChart importance={analysisMatch.featureImportance} />
                  )}
                  {analysisMatch.confidenceEngine && (
                    <ConfidenceEnginePanel
                      engine={analysisMatch.confidenceEngine}
                      recommendationPick={
                        analysisMatch.recommended?.pick
                          ? formatRecommendedPick(analysisMatch.recommended.pick, analysisMatch.recommended.family, t)
                              .label
                          : null
                      }
                    />
                  )}
                  {analysisMatch.predictionContributions && (
                    <PredictionContributionsChart data={analysisMatch.predictionContributions} />
                  )}
                </div>
              </Suspense>
            )}
          </CollapsiblePanel>

          <CollapsiblePanel title={t("dash.historyTitle")} subtitle={t("dash.historySub")}>
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
            />
          </CollapsiblePanel>

          <CollapsiblePanel title={t("dash.labTitle")} subtitle={t("dash.labSub")}>
            {!analysisMatch ? (
              <p className="text-sm text-[var(--fp-text-muted)]">{t("dash.labEmpty")}</p>
            ) : (
              <Suspense fallback={<p className="text-sm text-[var(--fp-text-muted)]">{t("dash.labLoading")}</p>}>
                <PredictionLaboratoryPanel match={analysisMatch} />
              </Suspense>
            )}
          </CollapsiblePanel>

          <CollapsiblePanel title={t("dash.insightsTitle")} subtitle={t("dash.insightsSub")}>
            <Suspense fallback={<p className="text-sm text-[var(--fp-text-muted)]">{t("dash.insightsLoading")}</p>}>
              <StatisticsSection
                trackerSlot={trackerSlot}
                winRate={trackerStats.winRate}
                settled={trackerStats.settled}
                wins={trackerStats.wins}
                losses={trackerStats.losses}
              />
              <div className="mt-6">
                <TrackRecordSection />
              </div>
            </Suspense>
          </CollapsiblePanel>

          {continueMatch && (
            <button
              type="button"
              onClick={() => openMatch(continueMatch)}
              className="flex w-full min-h-[var(--fp-touch)] items-center justify-between rounded-[var(--fp-radius)] border border-[var(--fp-accent)]/25 bg-[var(--fp-accent-muted)] px-4 py-3 text-left"
            >
              <span>
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--fp-accent)]">Continue</span>
                <br />
                <span className="font-semibold">
                  {continueMatch.teams.home} vs {continueMatch.teams.away}
                </span>
              </span>
              <span className="text-[var(--fp-accent)]">Open →</span>
            </button>
          )}
        </div>
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
      {isLeaguesOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-end bg-[var(--fp-navy)]/30 backdrop-blur-[1px] sm:items-stretch" onClick={() => setIsLeaguesOpen(false)}>
          <div
            className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--fp-shadow-lg)] sm:h-full sm:max-h-none sm:rounded-none sm:border-l sm:pb-4"
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
          }}
        />
      )}
    </ConsumerShell>
  );
}
