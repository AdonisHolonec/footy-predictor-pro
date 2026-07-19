import { useCallback, useEffect, useMemo, useState } from "react";

export type UiTheme = "light" | "dark" | "contrast";

export type MatchesSubFilterPref = "all" | "live" | "favorites";

export type UiPrefsV3 = {
  theme: UiTheme;
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
};

const DEFAULT_PREFS: UiPrefsV3 = {
  theme: "light",
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
  dashboardWidgets: ["kpi", "continue", "recommended", "value", "matches"]
};

function storageKey(userId?: string | null) {
  return `footy:ui:v5:${userId || "anon"}`;
}

function legacyKeys(userId?: string | null) {
  const id = userId || "anon";
  return [`footy:ui:v4:${id}`, `footy:ui:v3:${id}`];
}

function readPrefs(userId?: string | null): UiPrefsV3 {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    for (const key of legacyKeys(userId)) {
      const legacy = localStorage.getItem(key);
      if (legacy) {
        const parsed = JSON.parse(legacy) as Partial<UiPrefsV3>;
        /* Enterprise UI V2: light-first — do not carry over dark as default. */
        return { ...DEFAULT_PREFS, ...parsed, theme: "light" };
      }
    }
    return { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function applyTheme(theme: UiTheme) {
  const root = document.documentElement;
  /* Light is default :root — only add classes for dark / contrast. */
  root.classList.remove("theme-light", "theme-dark", "theme-contrast");
  if (theme === "dark") root.classList.add("theme-dark");
  if (theme === "contrast") root.classList.add("theme-contrast");
  root.dataset.theme = theme;
}

export function useUiPrefs(userId?: string | null) {
  const [prefs, setPrefs] = useState<UiPrefsV3>(() => readPrefs(userId));

  useEffect(() => {
    setPrefs(readPrefs(userId));
  }, [userId]);

  useEffect(() => {
    applyTheme(prefs.theme);
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
    } catch {
      /* ignore quota */
    }
  }, [prefs, userId]);

  const setTheme = useCallback((theme: UiTheme) => {
    setPrefs((p) => ({ ...p, theme }));
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
          "minConfidence" | "minEv" | "valueOnly" | "settledOnly" | "matchSearch" | "matchesFilter"
        >
      >
    ) => {
      setPrefs((p) => ({ ...p, ...patch }));
    },
    []
  );

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
      cycleTheme,
      toggleWatchlist,
      toggleBookmark,
      pushRecent,
      updateFilters,
      isWatched,
      isBookmarked
    }),
    [
      prefs,
      setTheme,
      cycleTheme,
      toggleWatchlist,
      toggleBookmark,
      pushRecent,
      updateFilters,
      isWatched,
      isBookmarked
    ]
  );
}
