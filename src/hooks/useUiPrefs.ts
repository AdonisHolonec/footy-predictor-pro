import { useCallback, useEffect, useMemo, useState } from "react";
import { readStoredLocale, writeStoredLocale, type Locale } from "../i18n";
import { applyTheme, uiPrefsStorageKey, type UiTheme } from "../design-system/theme";

export type { UiTheme };
export type { Locale };

/**
 * "picks" is the confidence-ranked view of the slate: only rows carrying a
 * recommendation, best first. It used to be a nav destination of its own
 * (`navView === "predictions"`), which no tab bar or rail ever linked to.
 */
export type MatchesSubFilterPref = "all" | "live" | "favorites" | "picks";

/** Mirrors the 1X2 / Over-Under / BTTS market family used by marketTiers and the accuracy tracker. */
export type MarketPref = "oneXTwo" | "overUnder" | "btts";

export type UiPrefsV3 = {
  theme: UiTheme;
  locale: Locale;
  watchlistFixtureIds: number[];
  bookmarkFixtureIds: number[];
  favoriteTeamIds: number[];
  pinnedLeagueIds: number[];
  recentFixtureIds: number[];
  savedFilterName: string | null;
  minConfidence: number;
  minEv: number;
  valueOnly: boolean;
  settledOnly: boolean;
  matchSearch: string;
  matchesFilter: MatchesSubFilterPref;
  dashboardWidgets: string[];
  notificationsSeenIds: string[];
  /** From onboarding — empty means no preference, show every market. */
  preferredMarkets: MarketPref[];
  /** In-app "big live swing" alerts (client-derived, never emailed) — on by default. */
  notifyLiveSwing: boolean;
};

const DEFAULT_PREFS: UiPrefsV3 = {
  theme: "light",
  locale: "ro",
  watchlistFixtureIds: [],
  bookmarkFixtureIds: [],
  favoriteTeamIds: [],
  pinnedLeagueIds: [],
  recentFixtureIds: [],
  savedFilterName: null,
  minConfidence: 0,
  minEv: 0,
  valueOnly: false,
  settledOnly: false,
  matchSearch: "",
  matchesFilter: "all",
  dashboardWidgets: ["kpi", "continue", "recommended", "value", "matches"],
  notificationsSeenIds: [],
  preferredMarkets: [],
  notifyLiveSwing: true
};

/* Key shape owned by design-system/theme.ts so the pre-paint bootstrap and
   this hook can never disagree about where the preference lives. */
const storageKey = uiPrefsStorageKey;

function legacyKeys(userId?: string | null) {
  const id = userId || "anon";
  return [`footy:ui:v5:${id}`, `footy:ui:v4:${id}`, `footy:ui:v3:${id}`];
}

function readPrefs(userId?: string | null): UiPrefsV3 {
  const storedLocale = readStoredLocale();
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UiPrefsV3>;
      return { ...DEFAULT_PREFS, ...parsed, locale: parsed.locale || storedLocale, theme: parsed.theme || "light" };
    }
    for (const key of legacyKeys(userId)) {
      const legacy = localStorage.getItem(key);
      if (legacy) {
        const parsed = JSON.parse(legacy) as Partial<UiPrefsV3>;
        /* UI Sprint 2: light-first — force the new default regardless of the old stored theme. */
        return { ...DEFAULT_PREFS, ...parsed, theme: "light", locale: parsed.locale || storedLocale };
      }
    }
    return { ...DEFAULT_PREFS, locale: storedLocale };
  } catch {
    return { ...DEFAULT_PREFS, locale: storedLocale };
  }
}

/* Theme application moved to design-system/theme.ts (PR 2): this hook still
   owns CHANGING the preference — setTheme/cycleTheme below — but every DOM
   write goes through the app-level single writer, the same one the root
   ThemeBoot and the index.html bootstrap feed. First application no longer
   waits for this hook (i.e. for UserDashboard) to mount. */

export function useUiPrefs(userId?: string | null) {
  const [prefs, setPrefs] = useState<UiPrefsV3>(() => readPrefs(userId));

  useEffect(() => {
    setPrefs(readPrefs(userId));
  }, [userId]);

  useEffect(() => {
    applyTheme(prefs.theme);
    writeStoredLocale(prefs.locale || "ro");
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
    } catch {
      /* ignore quota */
    }
  }, [prefs, userId]);

  const setTheme = useCallback((theme: UiTheme) => {
    setPrefs((p) => ({ ...p, theme }));
  }, []);

  const setLocale = useCallback((locale: Locale) => {
    writeStoredLocale(locale);
    setPrefs((p) => ({ ...p, locale }));
  }, []);

  const cycleTheme = useCallback(() => {
    setPrefs((p) => {
      const order: UiTheme[] = ["light", "dark", "contrast"];
      const next = order[(order.indexOf(p.theme) + 1) % order.length];
      return { ...p, theme: next };
    });
  }, []);

  const toggleWatchlist = useCallback((fixtureId: number) => {
    setPrefs((p) => {
      const has = p.watchlistFixtureIds.includes(fixtureId);
      return {
        ...p,
        watchlistFixtureIds: has
          ? p.watchlistFixtureIds.filter((id) => id !== fixtureId)
          : [fixtureId, ...p.watchlistFixtureIds].slice(0, 80)
      };
    });
  }, []);

  const toggleBookmark = useCallback((fixtureId: number) => {
    setPrefs((p) => {
      const has = p.bookmarkFixtureIds.includes(fixtureId);
      return {
        ...p,
        bookmarkFixtureIds: has
          ? p.bookmarkFixtureIds.filter((id) => id !== fixtureId)
          : [fixtureId, ...p.bookmarkFixtureIds].slice(0, 80)
      };
    });
  }, []);

  const pushRecent = useCallback((fixtureId: number) => {
    setPrefs((p) => ({
      ...p,
      recentFixtureIds: [fixtureId, ...p.recentFixtureIds.filter((id) => id !== fixtureId)].slice(0, 20)
    }));
  }, []);

  const updateFilters = useCallback(
    (
      patch: Partial<
        Pick<
          UiPrefsV3,
          | "minConfidence"
          | "minEv"
          | "valueOnly"
          | "settledOnly"
          | "matchSearch"
          | "matchesFilter"
          | "preferredMarkets"
          | "notifyLiveSwing"
        >
      >
    ) => {
      setPrefs((p) => ({ ...p, ...patch }));
    },
    []
  );

  const markNotificationsSeen = useCallback((ids: string[]) => {
    setPrefs((p) => ({
      ...p,
      notificationsSeenIds: Array.from(new Set([...p.notificationsSeenIds, ...ids])).slice(-200)
    }));
  }, []);

  const isWatched = useCallback(
    (fixtureId: number) => prefs.watchlistFixtureIds.includes(fixtureId),
    [prefs.watchlistFixtureIds]
  );

  const isBookmarked = useCallback(
    (fixtureId: number) => prefs.bookmarkFixtureIds.includes(fixtureId),
    [prefs.bookmarkFixtureIds]
  );

  return useMemo(
    () => ({
      prefs,
      setPrefs,
      setTheme,
      setLocale,
      cycleTheme,
      toggleWatchlist,
      toggleBookmark,
      pushRecent,
      updateFilters,
      isWatched,
      isBookmarked,
      markNotificationsSeen
    }),
    [
      prefs,
      setTheme,
      setLocale,
      cycleTheme,
      toggleWatchlist,
      toggleBookmark,
      pushRecent,
      updateFilters,
      isWatched,
      isBookmarked,
      markNotificationsSeen
    ]
  );
}
