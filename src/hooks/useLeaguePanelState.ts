import { useState } from "react";

export function isDesktopViewport() {
  return typeof window !== "undefined" ? window.innerWidth >= 1024 : true;
}

export function isCompactViewport() {
  return typeof window !== "undefined" ? window.innerWidth < 768 : false;
}

type LeaguePanelStateOptions = {
  /**
   * Whether the panel starts open. The two surfaces that render LeaguePanel
   * mean DIFFERENT things by "open", so neither may inherit a default:
   *
   * - the admin sidebar (App/useAppController) docks the panel in a column and
   *   uses this as DISCLOSURE state — expanded on desktop, collapsed where
   *   there is no room, hence `isDesktopViewport()`;
   * - the consumer workspace (UserDashboard) renders it through the modal
   *   Overlay, where "open" means an actual dialog with `#root` inert,
   *   aria-hidden, scroll locked and focus trapped. A modal nobody asked for
   *   is never correct, so it starts CLOSED and opens only from the
   *   "Selectează ligi" trigger.
   *
   * Seeding both from the viewport is what auto-opened the consumer drawer on
   * every desktop mount and left the workspace unreachable behind it.
   */
  initialOpen?: boolean;
};

export function useLeaguePanelState({ initialOpen = false }: LeaguePanelStateOptions = {}) {
  // Deliberately NOT re-derived from the viewport on resize. The listener that
  // did so overwrote user intent: closing the drawer and then resizing at all
  // — window drag, devtools, zoom — reopened it, so on desktop it could not be
  // dismissed. Open state belongs to the user; only the caller seeds it.
  const [isLeaguesOpen, setIsLeaguesOpen] = useState(initialOpen);

  return { isLeaguesOpen, setIsLeaguesOpen };
}
