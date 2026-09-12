import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDateRollover } from "./useDateRollover";

vi.mock("../utils/appUtils", () => ({
  localCalendarDateKey: vi.fn()
}));

import { localCalendarDateKey } from "../utils/appUtils";

const setToday = (iso: string) => vi.mocked(localCalendarDateKey).mockReturnValue(iso);

function mount(date: string, onRollToDate = vi.fn(), intervalMs = 1_000) {
  const hook = renderHook(({ d }) => useDateRollover({ date: d, onRollToDate, intervalMs }), {
    initialProps: { d: date }
  });
  return { ...hook, onRollToDate };
}

describe("useDateRollover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setToday("2026-04-24");
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("starts a new visit on today when the stored day is from an earlier visit", () => {
    const { onRollToDate } = mount("2026-04-20");
    expect(onRollToDate).toHaveBeenCalledTimes(1);
    expect(onRollToDate).toHaveBeenCalledWith("2026-04-24");
  });

  it("never undoes a day the user chose during the visit — not on render, interval, focus or visibility", () => {
    const { rerender, onRollToDate } = mount("2026-04-24");
    rerender({ d: "2026-04-23" });
    vi.advanceTimersByTime(5_000);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    rerender({ d: "2026-03-01" });
    vi.advanceTimersByTime(5_000);
    expect(onRollToDate).not.toHaveBeenCalled();
  });

  it("rolls date on interval when day changes while the user follows today", () => {
    const { onRollToDate } = mount("2026-04-24");
    setToday("2026-04-25");
    vi.advanceTimersByTime(1_000);
    expect(onRollToDate).toHaveBeenCalledTimes(1);
    expect(onRollToDate).toHaveBeenCalledWith("2026-04-25");
  });

  it("rolls on visibilitychange when page becomes visible after midnight", () => {
    const { onRollToDate } = mount("2026-04-24", vi.fn(), 60_000);
    setToday("2026-04-25");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onRollToDate).toHaveBeenCalledWith("2026-04-25");
  });

  it("rolls on focus when the day changed", () => {
    const { onRollToDate } = mount("2026-04-24", vi.fn(), 60_000);
    setToday("2026-04-25");
    window.dispatchEvent(new Event("focus"));
    expect(onRollToDate).toHaveBeenCalledWith("2026-04-25");
  });

  it("does not roll at midnight when the user is browsing another day", () => {
    const { rerender, onRollToDate } = mount("2026-04-24");
    rerender({ d: "2026-04-22" });
    setToday("2026-04-25");
    vi.advanceTimersByTime(1_000);
    window.dispatchEvent(new Event("focus"));
    expect(onRollToDate).not.toHaveBeenCalled();
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
