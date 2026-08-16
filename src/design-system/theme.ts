/**
 * Theme foundation — the ONE owner of theme application (PR 2).
 *
 * Before this module, the `theme-light|dark|contrast` class on <html> was
 * written exclusively by an effect inside useUiPrefs, which only UserDashboard
 * mounts. Every surface that renders before (or instead of) the dashboard —
 * /login, /privacy, /track-record, the admin shell, the auth splash — ran on
 * the classless :root fallback, so the theme a page got depended on the
 * navigation path that led to it. That is an application concern, not a page
 * concern, and it lives here now:
 *
 *   index.html bootstrap  → applies the last APPLIED theme before first paint
 *                           (reads THEME_MIRROR_KEY — see the inline script);
 *   <ThemeBoot/> at root  → re-resolves the signed-in user's stored preference
 *                           once the session is known, on every route;
 *   useUiPrefs            → still owns the *preference* (Settings cycles it),
 *                           but delegates every DOM write to applyTheme below.
 *
 * One DOM writer, three callers. A structural guard (themeOwnership.guard)
 * keeps any second `classList` theme writer from creeping back in.
 */

export type UiTheme = "light" | "dark" | "contrast";

export const UI_THEMES: readonly UiTheme[] = ["light", "dark", "contrast"] as const;

const THEME_CLASSES = ["theme-light", "theme-dark", "theme-contrast"] as const;

/**
 * Last APPLIED theme, user-agnostic — the anti-flash contract with the inline
 * bootstrap in index.html, which must stay dependency-free and therefore
 * repeats this literal. The ownership guard asserts the two stay identical.
 */
export const THEME_MIRROR_KEY = "footy:theme";

/** Per-user UI prefs blob — the same key useUiPrefs persists into. Exported
 *  from here (not from useUiPrefs) so the two modules cannot import-cycle. */
export function uiPrefsStorageKey(userId?: string | null): string {
  return `footy:ui:v6:${userId || "anon"}`;
}

export function isUiTheme(value: unknown): value is UiTheme {
  return value === "light" || value === "dark" || value === "contrast";
}

/**
 * The single DOM writer. Applies exactly one theme class (an explicit class is
 * always set — legacy `.lab-*` surfaces key their light overrides off
 * `html.theme-light`, so "no class" and "light" are NOT the same thing for
 * them) and mirrors the applied value for the pre-paint bootstrap.
 *
 * `data-theme` is intentionally gone: it was written on every apply and read
 * by nothing (no CSS selector, no JS, no test consumed it — Phase 0 audit).
 */
export function applyTheme(theme: UiTheme): void {
  const root = document.documentElement;
  root.classList.remove(...THEME_CLASSES);
  root.classList.add(`theme-${theme}`);
  try {
    localStorage.setItem(THEME_MIRROR_KEY, theme);
  } catch {
    /* storage full/blocked — the class is applied either way */
  }
}

/**
 * The persisted preference for one user, with the exact semantics the app has
 * always had: the v6 blob's `theme` field when valid, otherwise "light".
 * (Legacy v3–v5 blobs force-migrated to light in useUiPrefs, so collapsing
 * them to the same "light" here is behaviour-identical.)
 */
export function readStoredTheme(userId?: string | null): UiTheme {
  try {
    const raw = localStorage.getItem(uiPrefsStorageKey(userId));
    if (raw) {
      const theme = (JSON.parse(raw) as { theme?: unknown }).theme;
      if (isUiTheme(theme)) return theme;
    }
  } catch {
    /* unreadable blob — fall through to the default */
  }
  return "light";
}

/** What the pre-paint bootstrap applied — exposed for tests and diagnostics. */
export function readMirroredTheme(): UiTheme {
  try {
    const value = localStorage.getItem(THEME_MIRROR_KEY);
    if (isUiTheme(value)) return value;
  } catch {
    /* ignore */
  }
  return "light";
}
