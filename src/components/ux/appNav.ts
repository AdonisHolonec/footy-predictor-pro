/*
 * The consumer destination model (UX-B).
 *
 * Five primary destinations, one user-facing name each, the same set on
 * mobile and desktop:
 *
 *   Today · Matches · Results · Performance · Account
 *
 * Internal view ids keep their historical names (home / history / statistics /
 * profile) so nothing in state, prefs or tests has to be renamed for a label;
 * the URL slug and the i18n label are where the product vocabulary lives.
 *
 * What is deliberately NOT a destination:
 *  - "live": a filter on Matches (the Live segment), never a route. It used to
 *    be a tab that rendered the same list with a different heading and reset
 *    the user's filter on the way in and out.
 *  - "predictions": retired in UX-07n; its ranked list is the Matches "picks"
 *    filter.
 *  - "tickets": a secondary value product — reached from Today, from Match
 *    Detail and from the desktop rail, never from the bottom bar.
 */
export type AppNavView =
  | "home"
  | "matches"
  | "history"
  | "statistics"
  | "profile"
  | "tickets"
  | "notifications"
  | "settings";

/** Segment state of the Matches list. Local to the session, never a route. */
export type MatchesSubFilter = "all" | "live" | "favorites" | "picks";

export type NavItem = { id: AppNavView; labelKey: string; slug: string };

/** Every view, with its label key and URL slug (`/workspace/<slug>`). */
export const APP_NAV_ITEMS: NavItem[] = [
  { id: "home", labelKey: "nav.today", slug: "today" },
  { id: "matches", labelKey: "nav.matches", slug: "matches" },
  { id: "history", labelKey: "nav.results", slug: "results" },
  { id: "statistics", labelKey: "nav.performance", slug: "performance" },
  { id: "profile", labelKey: "nav.account", slug: "account" },
  { id: "tickets", labelKey: "nav.tickets", slug: "tickets" },
  { id: "notifications", labelKey: "nav.notifications", slug: "notifications" },
  { id: "settings", labelKey: "nav.settings", slug: "settings" }
];

const PRIMARY_IDS: AppNavView[] = ["home", "matches", "history", "statistics", "profile"];

/** The bottom bar AND the desktop rail: exactly these five, in this order. */
export const PRIMARY_NAV_ITEMS = PRIMARY_IDS.map((id) => APP_NAV_ITEMS.find((i) => i.id === id)!);

/** Desktop-only, visually subordinate to the primaries. */
export const DESKTOP_SECONDARY_NAV_ITEMS = APP_NAV_ITEMS.filter((i) => i.id === "tickets");

/** Back-compat aliases for the UX-0 names; both resolve to the primary set. */
export const MOBILE_TAB_ITEMS = PRIMARY_NAV_ITEMS;
export const DESKTOP_NAV_ITEMS = PRIMARY_NAV_ITEMS;

export const DEFAULT_VIEW: AppNavView = "home";

export function viewToSlug(view: AppNavView): string {
  return APP_NAV_ITEMS.find((i) => i.id === view)?.slug ?? "today";
}

/** Unknown or missing slugs land on Today — a deep link never 404s inside the workspace. */
export function slugToView(slug: string | undefined | null): AppNavView {
  const hit = APP_NAV_ITEMS.find((i) => i.slug === String(slug ?? "").toLowerCase());
  return hit ? hit.id : DEFAULT_VIEW;
}

export function workspacePath(view: AppNavView): string {
  return view === DEFAULT_VIEW ? "/workspace" : `/workspace/${viewToSlug(view)}`;
}
