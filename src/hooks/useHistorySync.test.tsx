import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHistorySync } from "./useHistorySync";

describe("useHistorySync", () => {
  it("does not POST sync for normal users (P0 cron/admin only)", async () => {
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

    expect(fetchMock).not.toHaveBeenCalled();
    expect(afterSync).toHaveBeenCalledWith(30);
  });

  it("posts sync only when allowSync is true", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useHistorySync({
        accessToken: "tok",
        allowSync: true,
        cooldownMs: 10_000
      })
    );

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(20_000);
    await result.current.syncHistory(30);
    nowSpy.mockReturnValue(25_000);
    await result.current.syncHistory(30);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/history?sync=1&days=30", {
      method: "POST",
      headers: { Authorization: "Bearer tok" }
    });
    nowSpy.mockRestore();
  });
});
