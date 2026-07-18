import { useCallback, useEffect, useMemo, useState } from "react";

export type UiTheme = "dark" | "light" | "contrast";

export type UiPrefsV3 = {
  theme: UiTheme;
  watchlistFixtureIds: number[];
  favoriteTeamIds: number[];
  pinnedLeagueIds: number[];
  recentFixtureIds: number[];
  savedFilterName: string | null;
  minConfidence: number;
  minEv: number;
  valueOnly: boolean;
  dashboardWidgets: string[];
};

const DEFAULT_PREFS: UiPrefsV3 = {
  theme: "dark",
  watchlistFixtureIds: [],
  favoriteTeamIds: [],
  pinnedLeagueIds: [],
  recentFixtureIds: [],
  savedFilterName: null,
  minConfidence: 0,
  minEv: 0,
  valueOnly: false,
  dashboardWidgets: ["kpi", "continue", "recommended", "value", "matches"]
};

function storageKey(userId?: string | null) {
  return `footy:ui:v3:${userId || "anon"}`;
}

function readPrefs(userId?: string | null): UiPrefsV3 {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function applyTheme(theme: UiTheme) {
  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-contrast");
  if (theme === "light") root.classList.add("theme-light");
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
      const order: UiTheme[] = ["dark", "light", "contrast"];
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

  const pushRecent = useCallback((fixtureId: number) => {
    setPrefs((p) => ({
      ...p,
      recentFixtureIds: [fixtureId, ...p.recentFixtureIds.filter((id) => id !== fixtureId)].slice(0, 20)
    }));
  }, []);

  const updateFilters = useCallback((patch: Partial<Pick<UiPrefsV3, "minConfidence" | "minEv" | "valueOnly">>) => {
    setPrefs((p) => ({ ...p, ...patch }));
  }, []);

  const isWatched = useCallback(
    (fixtureId: number) => prefs.watchlistFixtureIds.includes(fixtureId),
    [prefs.watchlistFixtureIds]
  );

  return useMemo(
    () => ({
      prefs,
      setPrefs,
      setTheme,
      cycleTheme,
      toggleWatchlist,
      pushRecent,
      updateFilters,
      isWatched
    }),
    [prefs, setTheme, cycleTheme, toggleWatchlist, pushRecent, updateFilters, isWatched]
  );
}
