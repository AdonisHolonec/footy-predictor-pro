import { useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { slugToView, workspacePath, type AppNavView } from "../../components/ux/appNav";

/**
 * The workspace destination lives in the URL — `/workspace/<slug>` — not in
 * component state (UX-B §19).
 *
 *  - deep links open the right view (`/workspace/results`)
 *  - Back / Forward move between views, because every navigation is a history
 *    entry
 *  - a reload lands where the user was
 *  - an unknown slug resolves to Today rather than 404-ing inside the app
 *
 * Navigation changes the destination and nothing else: no filter, search or
 * selection is touched here, so the Matches segment a user chose is still
 * there when they come back.
 */
export function useWorkspaceRoute(): { navView: AppNavView; setNavView: (view: AppNavView) => void } {
  const { view: slug } = useParams<{ view?: string }>();
  const navigate = useNavigate();
  const navView = slugToView(slug);
  const setNavView = useCallback(
    (view: AppNavView) => {
      if (view !== navView) navigate(workspacePath(view));
    },
    [navigate, navView]
  );
  return { navView, setNavView };
}
