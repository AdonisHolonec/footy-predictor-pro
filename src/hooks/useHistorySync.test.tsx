import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHistorySync } from "./useHistorySync";

describe("useHistorySync", () => {
  it("runs sync and onAfterSync once", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const afterSync = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useHistorySync({
        accessToken: "tok",
        defaultDays: 30,
        onAfterSync: afterSync
      })
    );

    await result.current.syncHistory();

    expect(fetchMock).toHaveBeenCalledWith("/api/history?sync=1&days=30", {
      method: "POST",
      headers: { Authorization: "Bearer tok" }
    });
    expect(afterSync).toHaveBeenCalledWith(30);
  });

  it("respects cooldown between sync calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(20_000);

    const { result } = renderHook(() =>
      useHistorySync({
        accessToken: "tok",
        cooldownMs: 10_000
      })
    );

    await result.current.syncHistory(30);
    nowSpy.mockReturnValue(25_000);
    await result.current.syncHistory(30);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });
});
