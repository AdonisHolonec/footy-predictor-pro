/**
 * ThemeBoot (PR 2) — root-level theme application, independent of any page.
 * These tests are the executable form of the architectural claim: a route
 * gets its theme without UserDashboard ever mounting.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThemeBoot from "./ThemeBoot";
import { uiPrefsStorageKey } from "./theme";

const authState = { user: null as null | { id: string }, loading: false };
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => authState
}));

function themeClasses() {
  return [...document.documentElement.classList].filter((c) => c.startsWith("theme-"));
}

describe("ThemeBoot", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    localStorage.clear();
    authState.user = null;
    authState.loading = false;
  });
  afterEach(cleanup);

  it("applies the light fallback for an anonymous visitor — no dashboard involved", async () => {
    render(<ThemeBoot />);
    await waitFor(() => expect(themeClasses()).toEqual(["theme-light"]));
  });

  it("applies dark and contrast from the anonymous persisted preference", async () => {
    for (const theme of ["dark", "contrast"] as const) {
      localStorage.setItem(uiPrefsStorageKey(), JSON.stringify({ theme }));
      const { unmount } = render(<ThemeBoot />);
      await waitFor(() => expect(themeClasses()).toEqual([`theme-${theme}`]));
      unmount();
    }
  });

  it("applies the signed-in user's own stored preference once the session resolves", async () => {
    localStorage.setItem(uiPrefsStorageKey("u-9"), JSON.stringify({ theme: "dark" }));
    authState.user = { id: "u-9" };
    render(<ThemeBoot />);
    await waitFor(() => expect(themeClasses()).toEqual(["theme-dark"]));
  });

  it("holds the pre-paint class while the session is still loading — no flash", async () => {
    // The index.html bootstrap applied the mirrored theme; until auth
    // resolves, ThemeBoot must not fight it.
    document.documentElement.classList.add("theme-dark");
    authState.loading = true;
    render(<ThemeBoot />);
    await new Promise((r) => setTimeout(r, 20));
    expect(themeClasses()).toEqual(["theme-dark"]);
  });
});
