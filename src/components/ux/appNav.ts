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

export const APP_NAV_ITEMS: { id: AppNavView; label: string; short: string }[] = [
  { id: "home", label: "Home", short: "Home" },
  { id: "matches", label: "Matches", short: "Matches" },
  { id: "predictions", label: "Predictions", short: "Picks" },
  { id: "live", label: "Live", short: "Live" },
  { id: "history", label: "History", short: "History" },
  { id: "statistics", label: "Statistics", short: "Stats" },
  { id: "notifications", label: "Notifications", short: "Alerts" },
  { id: "profile", label: "Profile", short: "Profile" },
  { id: "settings", label: "Settings", short: "Settings" }
];

/** Bottom bar: 5 primary destinations. Rest via sidebar / profile / ⌘K. */
export const MOBILE_TAB_ITEMS = APP_NAV_ITEMS.filter((i) =>
  (["home", "matches", "live", "history", "profile"] as AppNavView[]).includes(i.id)
);
