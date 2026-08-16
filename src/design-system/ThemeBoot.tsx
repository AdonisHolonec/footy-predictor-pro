import { useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { applyTheme, readStoredTheme } from "./theme";

/**
 * Root-level theme application — mounted once in RootRouter, above every
 * route, so no page depends on UserDashboard for its theme.
 *
 * The pre-paint class comes from the index.html bootstrap (last applied
 * theme); this component's job is the per-user correction: once the session
 * resolves, apply the theme THAT account persisted. While auth is still
 * loading it deliberately does nothing — the bootstrap's class holds, which
 * is what prevents a light→dark→light flash on slow sessions.
 *
 * UserDashboard's useUiPrefs re-applies the same value when it mounts (same
 * data, same single writer — idempotent), and remains the owner of CHANGING
 * the preference. First application is the application's job, done here.
 */
export default function ThemeBoot() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    applyTheme(readStoredTheme(user?.id));
  }, [user?.id, loading]);

  return null;
}
