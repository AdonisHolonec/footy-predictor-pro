export type AppNavView =
  | "home"
  | "matches"
  | "predictions"
  | "live"
  | "history"
  | "statistics"
  | "notifications"
  | "profile"
  | "settings";

export type MatchesSubFilter = "all" | "live" | "favorites";

/** Nav items use i18n keys under `nav.*` — resolve labels via `t()`. */
export const APP_NAV_ITEMS: { id: AppNavView; labelKey: string; shortKey: string }[] = [
  { id: "home", labelKey: "nav.home", shortKey: "nav.home" },
  { id: "matches", labelKey: "nav.matches", shortKey: "nav.matches" },
  { id: "predictions", labelKey: "nav.predictions", shortKey: "nav.picks" },
  { id: "live", labelKey: "nav.live", shortKey: "nav.live" },
  { id: "history", labelKey: "nav.history", shortKey: "nav.history" },
  { id: "statistics", labelKey: "nav.statistics", shortKey: "nav.stats" },
  { id: "notifications", labelKey: "nav.notifications", shortKey: "nav.alerts" },
  { id: "profile", labelKey: "nav.profile", shortKey: "nav.profile" },
  { id: "settings", labelKey: "nav.settings", shortKey: "nav.settings" }
];

/** Bottom bar: 5 primary destinations. Rest via sidebar / profile / ⌘K. */
export const MOBILE_TAB_ITEMS = APP_NAV_ITEMS.filter((i) =>
  (["home", "matches", "live", "history", "profile"] as AppNavView[]).includes(i.id)
);
