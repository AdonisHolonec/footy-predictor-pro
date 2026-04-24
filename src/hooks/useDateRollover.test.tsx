import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDateRollover } from "./useDateRollover";

vi.mock("../utils/appUtils", () => ({
  localCalendarDateKey: vi.fn()
}));

import { localCalendarDateKey } from "../utils/appUtils";

describe("useDateRollover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(localCalendarDateKey).mockReturnValue("2026-04-24");
  });

  it("rolls date on interval when day changes", () => {
    const onRollToDate = vi.fn();
    vi.mocked(localCalendarDateKey).mockReturnValue("2026-04-25");

    renderHook(() =>
      useDateRollover({
        date: "2026-04-24",
        onRollToDate,
        intervalMs: 1_000
      })
    );

    vi.advanceTimersByTime(1_000);
    expect(onRollToDate).toHaveBeenCalledWith("2026-04-25");
  });

  it("rolls on visibilitychange when page becomes visible", () => {
    const onRollToDate = vi.fn();
    vi.mocked(localCalendarDateKey).mockReturnValue("2026-04-25");
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true
    });

    renderHook(() =>
      useDateRollover({
        date: "2026-04-24",
        onRollToDate
      })
    );

    document.dispatchEvent(new Event("visibilitychange"));
    expect(onRollToDate).toHaveBeenCalledWith("2026-04-25");
  });

  it("rolls on focus when date changed", () => {
    const onRollToDate = vi.fn();
    vi.mocked(localCalendarDateKey).mockReturnValue("2026-04-25");

    renderHook(() =>
      useDateRollover({
        date: "2026-04-24",
        onRollToDate
      })
    );

    window.dispatchEvent(new Event("focus"));
    expect(onRollToDate).toHaveBeenCalledWith("2026-04-25");
  });

  it("rolls from storage event only for allowed keys", () => {
    const onRollToDate = vi.fn();

    renderHook(() =>
      useDateRollover({
        date: "2026-04-24",
        onRollToDate,
        storageKeys: ["footy.date", "footy.user.date"]
      })
    );

    window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: "2026-04-25" }));
    expect(onRollToDate).not.toHaveBeenCalled();

    window.dispatchEvent(new StorageEvent("storage", { key: "footy.date", newValue: "2026-04-25" }));
    expect(onRollToDate).toHaveBeenCalledWith("2026-04-25");
  });
});
