import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import LeaguePanel from "../components/LeaguePanel";
import MatchModal from "../components/MatchModal";
import PerformanceCounterModal from "../components/PerformanceCounterModal";
import SuccessRateTracker from "../components/SuccessRateTracker";
import type { AppNavView, MatchesSubFilter } from "../components/ux/appNav";
import CommandPalette from "../components/ux/CommandPalette";
import ConsumerShell from "../components/ux/ConsumerShell";
import PredictionFocusCard from "../components/ux/PredictionFocusCard";
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
import { useUiPrefs } from "../hooks/useUiPrefs";
import { DayResponse, HistoryEntry, HistoryStats, League, PerformanceLeagueBreakdown, PredictionRow } from "../types";
import Button from "../design-system/Button";
import Card from "../design-system/Card";
import Badge from "../design-system/Badge";
import EmptyState from "../design-system/EmptyState";
import Toast from "../design-system/Toast";
import CollapsiblePanel from "../design-system/CollapsiblePanel";
import Tooltip from "../design-system/Tooltip";
import UpgradePrompt, { type UpgradeTier } from "../design-system/UpgradePrompt";
import { useLocale } from "../context/LocaleContext";

const PredictionLaboratoryPanel = lazy(() => import("../components/PredictionLaboratory"));
const MonteCarloPanel = lazy(() => import("../components/MonteCarloPanel"));
const FeatureImportanceChart = lazy(() => import("../components/FeatureImportanceChart"));
const ConfidenceEnginePanel = lazy(() => import("../components/ConfidenceEnginePanel"));
const PredictionContributionsChart = lazy(() => import("../components/PredictionContributionsChart"));
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
import { loadBillingConfig, openBillingPortal, startCheckout } from "../services/billingService";

function historyStatsFromRows(rows: HistoryEntry[]): HistoryStats {
  const wins = rows.filter((r) => r.validation === "win").length;
  const losses = rows.filter((r) => r.validation === "loss").length;
  const settled = wins + losses;
  const winRate = settled ? (wins / settled) * 100 : 0;
  return { wins, losses, settled, winRate };
}

function hasLegacyPredictionShape(rows: PredictionRow[]): boolean {
  return rows.some((row) => {
    // Rows produced by current backend always include modelVersion; do not treat masked tier rows as stale.
    if (row?.modelVersion) return false;
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

function tierPredictWindowDays(tier?: string) {
  if (tier === "ultra") return 3; // today +2
  if (tier === "premium") return 2; // today +1
  return 1; // free
}

function addIsoDay(dateIso: string, plusDays: number) {
  const [y, m, d] = String(dateIso).split("-").map((v) => Number(v));
  const utc = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  utc.setUTCDate(utc.getUTCDate() + plusDays);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function buildTierDates(baseDate: string, tier?: string) {
  const span = tierPredictWindowDays(tier);
  const out: string[] = [];
  for (let i = 0; i < span; i += 1) out.push(addIsoDay(baseDate, i));
  return normalizeSelectedDates(out);
}

function clampTierDates(baseDate: string, tier: string | undefined, dates: string[]) {
  const allowed = new Set(buildTierDates(baseDate, tier));
  const filtered = normalizeSelectedDates((dates || []).filter((d) => allowed.has(d)));
  return filtered.length ? filtered : [baseDate];
}

/** Simple 1u ROI from settled history — display only, no engine change. */
function computeSimpleRoi(rows: HistoryEntry[]): number | null {
  let stake = 0;
  let pnl = 0;
  for (const h of rows) {
    if (h.validation !== "win" && h.validation !== "loss") continue;
    const odd = Number(h.recommended?.odd ?? h.valueBet?.odd);
    if (!Number.isFinite(odd) || odd <= 1) continue;
    stake += 1;
    if (h.validation === "win") pnl += odd - 1;
    else pnl -= 1;
  }
  if (!stake) return null;
  return (pnl / stake) * 100;
}

const MAIN_VIEWS: AppNavView[] = ["home", "matches", "predictions", "live"];

export default function UserDashboard() {
  const {
    user,
    userTier,
    trialRemainingTime,
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
  const { isLeaguesOpen, setIsLeaguesOpen } = useLeaguePanelState();
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
    isWatched
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
    let rows = preds;
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
    matchSearch
  ]);
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
    predictLimit: "15",
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
    setPreds(filtered);
    if (hasLegacyPredictionShape(localPredictions) && filtered.length) {
      setRehydratedNotice(t("dash.legacyNotice"));
    }
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

  async function rehydratePredictionsFromHistory(): Promise<number> {
    try {
      if (!user?.id || !session?.access_token) return 0;
      const response = await fetch("/api/history?days=14&limit=1000&mine=1", {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      const json = await response.json();
      if (!response.ok || !json?.ok || !Array.isArray(json.items)) return 0;
      /** Doar răspuns user-scoped (join user_prediction_fixtures); refuză istoric global dacă lipsește flag. */
      if (json.mine !== true) return 0;

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

      if (!hydrated.length) return 0;

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
      return hydrated.length;
    } catch {
      return 0;
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

  /** Prefer cache/history restore so Refresh does not burn quota when picks already exist. */
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
    if (fromCache.length) {
      setPreds(fromCache);
      setStatus(t("dash.showingSaved", { n: fromCache.length }));
      return;
    }
    const restoredCount = await rehydratePredictionsFromHistory();
    if (restoredCount > 0) return;
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

  const isMainBoard = MAIN_VIEWS.includes(navView);
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
          {userTier === "premium" && (
            <Tooltip label={t("shell.includeTomorrow")}>
              <button
                type="button"
                title={t("shell.includeTomorrow")}
                onClick={() => setSelectedDates(clampTierDates(date, userTier, [date, addIsoDay(date, 1)]))}
                className="h-9 rounded-[var(--fp-radius-sm)] border border-[var(--fp-accent)]/40 bg-[var(--fp-accent-muted)] px-2.5 text-xs font-bold text-[var(--fp-accent)]"
              >
                {t("shell.plus1Day")}
              </button>
            </Tooltip>
          )}
          {userTier === "ultra" && (
            <>
              <Tooltip label={t("shell.includeTomorrow")}>
                <button
                  type="button"
                  title={t("shell.includeTomorrow")}
                  onClick={() => setSelectedDates(clampTierDates(date, userTier, [date, addIsoDay(date, 1)]))}
                  className="h-9 rounded-[var(--fp-radius-sm)] border border-[var(--fp-accent)]/40 bg-[var(--fp-accent-muted)] px-2.5 text-xs font-bold text-[var(--fp-accent)]"
                >
                  {t("shell.plus1Day")}
                </button>
              </Tooltip>
              <Tooltip label={t("shell.includeNext2")}>
                <button
                  type="button"
                  title={t("shell.includeNext2")}
                  onClick={() =>
                    setSelectedDates(clampTierDates(date, userTier, [date, addIsoDay(date, 1), addIsoDay(date, 2)]))
                  }
                  className="h-9 rounded-[var(--fp-radius-sm)] border border-[var(--fp-accent)]/40 bg-[var(--fp-accent-muted)] px-2.5 text-xs font-bold text-[var(--fp-accent)]"
                >
                  {t("shell.plus2Days")}
                </button>
              </Tooltip>
            </>
          )}
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
                      setNavView("home");
                      updateFilters({ matchesFilter: id });
                    }
                  }}
                  title={t("dash.filterTitle", { label: t(key) })}
                  className={`h-9 rounded-md px-2.5 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                    (id === "live" ? navView === "live" || matchesFilter === "live" : matchesFilter === id && navView !== "live")
                      ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                      : "text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
                  }`}
                  aria-pressed={
                    id === "live" ? navView === "live" || matchesFilter === "live" : matchesFilter === id && navView !== "live"
                  }
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

          {!visiblePreds.length ? (
            <EmptyState
              title={matchesFilter === "favorites" ? t("dash.emptyFavoritesTitle") : t("dash.emptyPredsTitle")}
              description={
                matchesFilter === "favorites" ? t("dash.emptyFavoritesDesc") : t("dash.emptyPredsDesc")
              }
              actionLabel={matchesFilter === "favorites" ? t("dash.showAll") : t("dash.restoreRefresh")}
              onAction={
                matchesFilter === "favorites"
                  ? () => updateFilters({ matchesFilter: "all" })
                  : () => void restoreOrPredict()
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visiblePreds.map((row) => (
                <PredictionFocusCard
                  key={row.id}
                  row={row}
                  watched={isWatched(Number(row.id))}
                  onToggleWatch={() => toggleWatchlist(Number(row.id))}
                  onOpen={() => openMatch(row)}
                />
              ))}
            </div>
          )}

          <div className="grid grid-cols-4 gap-1.5 rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-2 shadow-[var(--fp-shadow-sm)] sm:gap-2 sm:p-3">
            {[
              { label: t("dash.kpiToday"), value: String(visiblePreds.length) },
              {
                label: t("dash.kpiAccuracy"),
                value: trackerStats.settled ? `${trackerStats.winRate.toFixed(0)}%` : "—"
              },
              {
                label: t("dash.kpiRoi"),
                value: simpleRoi != null ? `${simpleRoi >= 0 ? "+" : ""}${simpleRoi.toFixed(1)}%` : "—"
              },
              {
                label: t("dash.kpiWinRate"),
                value: trackerStats.settled ? `${trackerStats.winRate.toFixed(0)}%` : "—"
              }
            ].map((k) => (
              <div key={k.label} className="min-w-0 px-1 text-center">
                <p className="truncate text-[9px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">{k.label}</p>
                <p className="mt-0.5 font-display text-base font-bold tabular-nums text-[var(--fp-text)] sm:text-lg">
                  {k.value}
                </p>
              </div>
            ))}
          </div>

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
                      recommendationPick={analysisMatch.recommended?.pick || null}
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
        />
      )}

      {navView === "statistics" && (
        <StatisticsSection
          trackerSlot={trackerSlot}
          winRate={trackerStats.winRate}
          settled={trackerStats.settled}
          wins={trackerStats.wins}
          losses={trackerStats.losses}
        />
      )}

      {navView === "notifications" && (
        <section className="space-y-6">
          <header>
            <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-[0.2em] text-[var(--fp-accent)]">
              Notificări
            </p>
            <h1 className="mt-1 font-display text-[length:var(--fp-hero)] font-semibold">Notifications</h1>
            <p className="mt-2 text-sm text-[var(--fp-text-muted)]">Alerte Low Risk / Value și email (beta).</p>
          </header>
          <Card>
            <p className="font-mono text-[10px] text-[var(--fp-text-muted)]">
              Preview: {alertsPreview.safe} low-risk · {alertsPreview.value} value
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <label className="flex min-h-[var(--fp-touch)] items-center gap-2 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] px-3 text-sm">
                <input type="checkbox" checked={notifySafe} onChange={(e) => setNotifySafe(e.target.checked)} />
                Low Risk alerts
              </label>
              <label className="flex min-h-[var(--fp-touch)] items-center gap-2 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] px-3 text-sm">
                <input type="checkbox" checked={notifyValue} onChange={(e) => setNotifyValue(e.target.checked)} />
                Value alerts
              </label>
              <label className="flex min-h-[var(--fp-touch)] items-center gap-2 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] px-3 text-sm">
                <input
                  type="checkbox"
                  checked={notifyEmail}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setNotifyEmail(next);
                    if (!next) setNotifyEmailConsent(false);
                  }}
                />
                Email (beta)
              </label>
            </div>
            {notifyEmail && (
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-[11px] text-[var(--fp-text-muted)]">
                <input
                  type="checkbox"
                  checked={notifyEmailConsent}
                  onChange={(e) => setNotifyEmailConsent(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Confirm consimțământul pentru email — vezi{" "}
                  <Link to="/privacy" className="text-[var(--fp-accent)] underline">
                    politica
                  </Link>
                  .
                </span>
              </label>
            )}
            <Button className="mt-4" loading={notifSaveBusy} onClick={() => void saveNotificationPrefs()}>
              Salvează preferințe
            </Button>
          </Card>
        </section>
      )}

      {navView === "profile" && (
        <section className="space-y-6">
          <header>
            <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-[0.2em] text-[var(--fp-accent)]">
              Profil
            </p>
            <h1 className="mt-1 font-display text-[length:var(--fp-hero)] font-semibold">Profile</h1>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--fp-text-muted)]">
              {user?.email} <Badge tone="accent">{userTier}</Badge>
            </p>
          </header>

          {!tierQuotaExempt && (
            <Card id="upgrade" className="scroll-mt-28">
              <h2 className="font-display text-[length:var(--fp-section)] font-semibold">Abonament</h2>
              <p className="mt-1 text-sm text-[var(--fp-text-muted)]">
                Premium (25/zi) sau Ultra (50/zi). Poți plăti inclusiv în timpul unui trial.
              </p>
              <PricingCampaignBanner className="mt-3" />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--fp-accent)]">Premium</p>
                  <PlanCampaignPrice tier="premium" />
                </div>
                <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--fp-accent)]">Ultra</p>
                  <PlanCampaignPrice tier="ultra" />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  disabled={!billingConfigured || billingBusy !== null}
                  loading={billingBusy === "premium"}
                  onClick={async () => {
                    setBillingBusy("premium");
                    try {
                      window.location.href = await startCheckout("premium");
                    } catch (e: unknown) {
                      setStatus(e instanceof Error ? e.message : "Checkout Premium eșuat.");
                      setBillingBusy(null);
                    }
                  }}
                >
                  {t("pricing.subscribePremium")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!billingConfigured || billingBusy !== null}
                  loading={billingBusy === "ultra"}
                  onClick={async () => {
                    setBillingBusy("ultra");
                    try {
                      window.location.href = await startCheckout("ultra");
                    } catch (e: unknown) {
                      setStatus(e instanceof Error ? e.message : "Checkout Ultra eșuat.");
                      setBillingBusy(null);
                    }
                  }}
                >
                  {t("pricing.subscribeUltra")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={!billingConfigured || billingBusy !== null}
                  loading={billingBusy === "portal"}
                  onClick={async () => {
                    setBillingBusy("portal");
                    try {
                      window.location.href = await openBillingPortal();
                    } catch (e: unknown) {
                      setStatus(e instanceof Error ? e.message : "Portal billing eșuat.");
                      setBillingBusy(null);
                    }
                  }}
                >
                  Manage billing
                </Button>
              </div>
              {!billingConfigured && (
                <p className="mt-3 text-xs text-[var(--fp-text-muted)]">
                  Stripe nu este configurat pe server. Trial-urile 24h rămân disponibile.
                </p>
              )}
            </Card>
          )}

          {!tierQuotaExempt && (
            <Card>
              <h2 className="font-display text-[length:var(--fp-section)] font-semibold">Trial 24h</h2>
              <p className="mt-1 text-sm text-[var(--fp-text-muted)]">Un singur trial activ. Nu blochează Subscribe.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={trialBusy !== null || !!user?.premium_trial_activated_at || trialRemainingTime.ultraMs > 0}
                  loading={trialBusy === "premium"}
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
                >
                  {user?.premium_trial_activated_at
                    ? "Premium trial used"
                    : trialRemainingTime.ultraMs > 0
                      ? "Ultra trial activ"
                      : "Activate Premium 24h"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={trialBusy !== null || !!user?.ultra_trial_activated_at || trialRemainingTime.premiumMs > 0}
                  loading={trialBusy === "ultra"}
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
                >
                  {user?.ultra_trial_activated_at
                    ? "Ultra trial used"
                    : trialRemainingTime.premiumMs > 0
                      ? "Premium trial activ"
                      : "Activate Ultra 24h"}
                </Button>
              </div>
              {(trialRemainingTime.premiumMs > 0 || trialRemainingTime.ultraMs > 0) && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {trialRemainingTime.premiumMs > 0 && (
                    <Badge tone="accent">Trial Premium: {formatRemaining(trialRemainingTime.premiumMs)}</Badge>
                  )}
                  {trialRemainingTime.ultraMs > 0 && (
                    <Badge tone="warning">Trial Ultra: {formatRemaining(trialRemainingTime.ultraMs)}</Badge>
                  )}
                </div>
              )}
            </Card>
          )}

          {!user?.onboardingCompleted && (
            <Card>
              <h2 className="font-display text-[length:var(--fp-section)] font-semibold">Onboarding</h2>
              <p className="mt-1 text-sm text-[var(--fp-text-muted)]">Alege ligi favorite în Matches, apoi confirmă.</p>
              <Button className="mt-3" onClick={() => void completeOnboarding()}>
                Finalizează onboarding
              </Button>
            </Card>
          )}

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-[length:var(--fp-section)] font-semibold">Settings</h2>
                <p className="mt-1 text-sm text-[var(--fp-text-muted)]">Theme, filters defaults, and privacy export.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => handleNav("settings")}>
                Open Settings
              </Button>
            </div>
            <div className="mt-4">
              <Button variant="danger" onClick={() => void logout()}>
                Log out
              </Button>
            </div>
          </Card>
        </section>
      )}

      {navView === "settings" && (
        <section className="space-y-6">
          <header>
            <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-[0.2em] text-[var(--fp-accent)]">
              Settings
            </p>
            <h1 className="mt-1 font-display text-[length:var(--fp-hero)] font-semibold">Settings</h1>
            <p className="mt-2 text-sm text-[var(--fp-text-muted)]">Appearance, saved filters, and privacy.</p>
          </header>

          <Card>
            <h2 className="font-display text-[length:var(--fp-section)] font-semibold">Appearance</h2>
            <p className="mt-1 text-sm text-[var(--fp-text-muted)]">
              Current theme: <strong className="text-[var(--fp-text)]">{prefs.theme}</strong>
            </p>
            <Button className="mt-3" variant="secondary" onClick={cycleTheme}>
              Change theme
            </Button>
          </Card>

          <Card>
            <h2 className="font-display text-[length:var(--fp-section)] font-semibold">Saved filters</h2>
            <p className="mt-1 text-sm text-[var(--fp-text-muted)]">
              Confidence ≥ {prefs.minConfidence}% · EV ≥ {prefs.minEv}% · Best Value only:{" "}
              {prefs.valueOnly ? "on" : "off"} · Settled: {prefs.settledOnly ? "on" : "off"}
            </p>
            <p className="mt-2 text-xs text-[var(--fp-text-faint)]">
              Filters persist across sessions. Adjust them on Matches / Predictions / Live.
            </p>
            <Button
              className="mt-3"
              variant="ghost"
              size="sm"
              onClick={() =>
                updateFilters({
                  minConfidence: 0,
                  minEv: 0,
                  valueOnly: false,
                  settledOnly: false,
                  matchSearch: "",
                  matchesFilter: "all"
                })
              }
            >
              Reset filters
            </Button>
          </Card>

          <Card>
            <h2 className="font-display text-[length:var(--fp-section)] font-semibold">Personal data (GDPR)</h2>
            <p className="mt-1 text-sm text-[var(--fp-text-muted)]">
              Download your export JSON — see the{" "}
              <Link to="/privacy" className="text-[var(--fp-accent)] underline">
                privacy policy
              </Link>
              .
            </p>
            <Button className="mt-3" variant="secondary" loading={exportBusy} onClick={() => void downloadPersonalDataExport()}>
              Download export JSON
            </Button>
          </Card>

          <Card>
            <Button variant="danger" onClick={() => void logout()}>
              Log out
            </Button>
          </Card>
        </section>
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
        <MatchModal
          match={selectedMatch}
          logoColors={{}}
          hashColor={hashColor}
          canShowSpecialBet={user?.role === "admin" || user?.tier === "ultra"}
          presentation="focus"
          onClose={() => setSelectedMatch(null)}
          onUpgradeRequired={(feature, requiredTier) => setUpgradePrompt({ feature, requiredTier })}
        />
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
    </ConsumerShell>
  );
}
