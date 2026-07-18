export type AppNavView =
  | "home"
  | "matches"
  | "history"
  | "statistics"
  | "notifications"
  | "profile";

export type MatchesSubFilter = "all" | "live" | "favorites";

export const APP_NAV_ITEMS: { id: AppNavView; label: string; short: string }[] = [
  { id: "home", label: "Home", short: "Home" },
  { id: "matches", label: "Meciuri", short: "Meciuri" },
  { id: "history", label: "Istoric", short: "Istoric" },
  { id: "statistics", label: "Statistici", short: "Stats" },
  { id: "notifications", label: "Notificări", short: "Alert" },
  { id: "profile", label: "Profil", short: "Profil" }
];

/** Bottom bar keeps 5 items; notifications live in the top bar on mobile. */
export const MOBILE_TAB_ITEMS = APP_NAV_ITEMS.filter((i) => i.id !== "notifications");
