/**
 * League panel state — the contract that keeps a modal from opening itself.
 *
 * One hook feeds two surfaces that mean different things by "open": the admin
 * sidebar (disclosure, docked in a column) and the consumer workspace (a real
 * Overlay dialog that makes #root inert). Seeding both from the viewport
 * auto-opened the consumer drawer on every desktop mount, and a resize
 * listener reopened it whenever the window changed size at all — so on desktop
 * the workspace could not be reached and the drawer could not be dismissed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { isCompactViewport, isDesktopViewport, useLeaguePanelState } from "./useLeaguePanelState";

const DESKTOP = 1366;

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
}

/** A real resize event, exactly as a window drag / devtools / zoom would fire. */
function fireResize(width: number) {
  act(() => {
    setViewport(width);
    window.dispatchEvent(new Event("resize"));
  });
}

afterEach(() => setViewport(1024));

describe("useLeaguePanelState — initial state is the caller's decision", () => {
  it("defaults to CLOSED at a desktop viewport (the consumer drawer must not open itself)", () => {
    setViewport(DESKTOP);
    const { result } = renderHook(() => useLeaguePanelState());
    expect(result.current.isLeaguesOpen).toBe(false);
  });

  it("defaults to CLOSED at a mobile viewport too", () => {
    setViewport(390);
    const { result } = renderHook(() => useLeaguePanelState());
    expect(result.current.isLeaguesOpen).toBe(false);
  });

  it("initialOpen:false is explicit and closed — the consumer workspace call", () => {
    setViewport(DESKTOP);
    const { result } = renderHook(() => useLeaguePanelState({ initialOpen: false }));
    expect(result.current.isLeaguesOpen).toBe(false);
  });

  it("initialOpen:true starts OPEN — the admin sidebar's desktop disclosure", () => {
    setViewport(DESKTOP);
    const { result } = renderHook(() => useLeaguePanelState({ initialOpen: true }));
    expect(result.current.isLeaguesOpen).toBe(true);
  });

  it("the caller still drives it: setIsLeaguesOpen opens and closes", () => {
    setViewport(DESKTOP);
    const { result } = renderHook(() => useLeaguePanelState());
    act(() => result.current.setIsLeaguesOpen(true));
    expect(result.current.isLeaguesOpen).toBe(true);
    act(() => result.current.setIsLeaguesOpen(false));
    expect(result.current.isLeaguesOpen).toBe(false);
  });
});

describe("useLeaguePanelState — resize never overrides user intent", () => {
  it("a closed panel stays closed when the viewport grows into desktop range", () => {
    setViewport(390);
    const { result } = renderHook(() => useLeaguePanelState());
    expect(result.current.isLeaguesOpen).toBe(false);
    fireResize(DESKTOP);
    expect(result.current.isLeaguesOpen).toBe(false);
  });

  it("a panel the user CLOSED stays closed across a resize within desktop range", () => {
    setViewport(1440);
    const { result } = renderHook(() => useLeaguePanelState({ initialOpen: true }));
    expect(result.current.isLeaguesOpen).toBe(true);

    act(() => result.current.setIsLeaguesOpen(false)); // the user dismisses it
    fireResize(1400); // still desktop — this used to reopen it
    expect(result.current.isLeaguesOpen).toBe(false);
  });

  it("a panel the user OPENED stays open when the viewport shrinks below desktop", () => {
    setViewport(DESKTOP);
    const { result } = renderHook(() => useLeaguePanelState());
    act(() => result.current.setIsLeaguesOpen(true));
    fireResize(390);
    expect(result.current.isLeaguesOpen).toBe(true);
  });

  it("survives the full mobile → desktop → mobile round trip closed", () => {
    setViewport(390);
    const { result } = renderHook(() => useLeaguePanelState());
    fireResize(1440);
    expect(result.current.isLeaguesOpen).toBe(false);
    fireResize(390);
    expect(result.current.isLeaguesOpen).toBe(false);
  });
});

describe("viewport helpers stay exactly as they were", () => {
  // useWarm, usePerformanceTracker and useTrackerAnimations import these
  // independently; the fix must not disturb them.
  it("isDesktopViewport is >= 1024", () => {
    setViewport(1023);
    expect(isDesktopViewport()).toBe(false);
    setViewport(1024);
    expect(isDesktopViewport()).toBe(true);
  });

  it("isCompactViewport is < 768", () => {
    setViewport(767);
    expect(isCompactViewport()).toBe(true);
    setViewport(768);
    expect(isCompactViewport()).toBe(false);
  });
});

describe("structural guards — the defect cannot come back", () => {
  const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

  it("the hook registers NO resize listener at all", () => {
    const src = read("useLeaguePanelState.ts");
    expect(/addEventListener\(\s*(["'])resize\1/.test(src)).toBe(false);
  });

  it("the hook never derives open state from the viewport", () => {
    const src = read("useLeaguePanelState.ts");
    // isDesktopViewport/isCompactViewport are still DEFINED here and exported;
    // what must never return is the hook body calling either to seed state.
    const body = src.slice(src.indexOf("export function useLeaguePanelState"));
    expect(/isDesktopViewport\(\)/.test(body)).toBe(false);
    expect(/isCompactViewport\(\)/.test(body)).toBe(false);
  });

  it("the consumer workspace asks for a CLOSED panel explicitly", () => {
    const src = read("../pages/UserDashboard.tsx");
    expect(/useLeaguePanelState\(\{\s*initialOpen:\s*false\s*\}\)/.test(src)).toBe(true);
  });

  it("the admin controller keeps its desktop disclosure explicitly", () => {
    const src = read("useAppController.ts");
    expect(/useLeaguePanelState\(\{\s*initialOpen:\s*isDesktopViewport\(\)\s*\}\)/.test(src)).toBe(true);
  });
});
