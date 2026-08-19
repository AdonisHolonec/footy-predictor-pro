/*
 * "predictions" was a destination here until UX-07n. Neither the tab bar nor
 * the desktop rail ever listed it — both build from MOBILE_TAB_ITEMS — so the
 * only way in was ⌘K, and mobile has no keyboard. Its one unique asset, the
 * confidence-ranked list, is now the Matches "picks" filter.
 */
export type AppNavView =
  | "home"
  | "matches"
  | "live"
  | "history"
  | "statistics"
  | "notifications"
  | "profile"
  | "settings";

export type MatchesSubFilter = "all" | "live" | "favorites";

/** Nav items use i18n keys under `nav.*` — resolve labels via `t()`. */
export const APP_NAV_ITEMS: { id: AppNavView; labelKey: string; shortKey: string; mobileShortKey?: string }[] = [
  { id: "home", labelKey: "nav.home", shortKey: "nav.home" },
  /** Bottom tab reads "Predictions" (mobile) while the desktop sidebar keeps "Matches" — same view, id="matches". */
  { id: "matches", labelKey: "nav.matches", shortKey: "nav.matches", mobileShortKey: "nav.predictions" },
  { id: "live", labelKey: "nav.live", shortKey: "nav.live" },
  { id: "history", labelKey: "nav.history", shortKey: "nav.history", mobileShortKey: "nav.resultsShort" },
  { id: "statistics", labelKey: "nav.statistics", shortKey: "nav.stats" },
  { id: "notifications", labelKey: "nav.notifications", shortKey: "nav.alerts" },
  { id: "profile", labelKey: "nav.profile", shortKey: "nav.profile" },
  { id: "settings", labelKey: "nav.settings", shortKey: "nav.settings" }
];

/** Bottom bar: 5 primary destinations. Rest via sidebar / profile / ⌘K. */
export const MOBILE_TAB_ITEMS = APP_NAV_ITEMS.filter((i) =>
  (["home", "matches", "live", "history", "profile"] as AppNavView[]).includes(i.id)
);
