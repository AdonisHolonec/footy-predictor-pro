/**
 * Theme foundation (PR 2) — the behaviour the architecture promises:
 * application does not depend on UserDashboard, every theme can be applied
 * from the root, the historical fallback is unchanged, and a persisted
 * preference is respected.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyTheme,
  isUiTheme,
  readMirroredTheme,
  readStoredTheme,
  THEME_MIRROR_KEY,
  uiPrefsStorageKey
} from "./theme";

describe("applyTheme — the single DOM writer", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    localStorage.clear();
  });

  it("applies each of the three themes as exactly one explicit class", () => {
    for (const theme of ["light", "dark", "contrast"] as const) {
      applyTheme(theme);
      const classes = [...document.documentElement.classList].filter((c) => c.startsWith("theme-"));
      expect(classes).toEqual([`theme-${theme}`]);
    }
  });

  it("is idempotent and never stacks classes when switching", () => {
    applyTheme("dark");
    applyTheme("dark");
    applyTheme("contrast");
    applyTheme("light");
    const classes = [...document.documentElement.classList].filter((c) => c.startsWith("theme-"));
    expect(classes).toEqual(["theme-light"]);
  });

  it("mirrors the applied theme for the pre-paint bootstrap", () => {
    applyTheme("contrast");
    expect(localStorage.getItem(THEME_MIRROR_KEY)).toBe("contrast");
    expect(readMirroredTheme()).toBe("contrast");
  });

  it("no longer writes the dead data-theme attribute", () => {
    // Written on every apply for two sprints, read by nothing (no CSS
    // selector, no JS). Consolidation removed it; keep it removed.
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe("readStoredTheme — the persisted preference, unchanged semantics", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the historical fallback: nothing stored → light", () => {
    expect(readStoredTheme()).toBe("light");
    expect(readStoredTheme("user-1")).toBe("light");
  });

  it("respects a persisted per-user preference", () => {
    localStorage.setItem(uiPrefsStorageKey("user-1"), JSON.stringify({ theme: "dark" }));
    localStorage.setItem(uiPrefsStorageKey(), JSON.stringify({ theme: "contrast" }));
    expect(readStoredTheme("user-1")).toBe("dark");
    // The anonymous scope is its own account-less preference, same as before.
    expect(readStoredTheme(null)).toBe("contrast");
  });

  it("treats an invalid or corrupt stored value as the light default", () => {
    localStorage.setItem(uiPrefsStorageKey("user-1"), JSON.stringify({ theme: "midnight" }));
    expect(readStoredTheme("user-1")).toBe("light");
    localStorage.setItem(uiPrefsStorageKey("user-2"), "{not json");
    expect(readStoredTheme("user-2")).toBe("light");
  });

  it("uses the same storage key shape useUiPrefs persists into", () => {
    expect(uiPrefsStorageKey("abc")).toBe("footy:ui:v6:abc");
    expect(uiPrefsStorageKey()).toBe("footy:ui:v6:anon");
  });
});

describe("isUiTheme", () => {
  it("accepts exactly the three shipped themes — no auto/system invented", () => {
    expect(isUiTheme("light")).toBe(true);
    expect(isUiTheme("dark")).toBe(true);
    expect(isUiTheme("contrast")).toBe(true);
    for (const bad of ["auto", "system", "", null, undefined, 1]) expect(isUiTheme(bad)).toBe(false);
  });
});
