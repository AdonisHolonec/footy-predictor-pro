import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePredictFlow } from "./usePredictFlow";

describe("usePredictFlow", () => {
  it("predict dedupes rows and returns callback payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: 1, score: "old" },
        { id: 1, score: "new" }
      ]
    });
    vi.stubGlobal("fetch", fetchMock);

    const onPredictCompleted = vi.fn().mockResolvedValue(undefined);
    const setStatus = vi.fn();

    const { result } = renderHook(() =>
      usePredictFlow({
        accessToken: "tok",
        selectedLeagueIds: [39],
        inferSeason: () => 2025,
        usageDay: "2026-04-24",
        setStatus,
        onPredictCompleted
      })
    );

    await result.current.predict(["2026-04-24"]);

    expect(onPredictCompleted).toHaveBeenCalled();
    const [rows] = onPredictCompleted.mock.calls[0];
    expect(rows).toEqual([{ id: 1, score: "new" }]);
  });

  it("sets rate-limit status on 429", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({})
    });
    vi.stubGlobal("fetch", fetchMock);

    const setStatus = vi.fn();
    const { result } = renderHook(() =>
      usePredictFlow({
        selectedLeagueIds: [39],
        inferSeason: () => 2025,
        usageDay: "2026-04-24",
        setStatus,
        messages: {
          warmRateLimit: "warm-limit",
          predictRateLimit: "predict-limit",
          warmFailed: () => "warm-failed",
          predictFailed: () => "predict-failed",
          warmException: () => "warm-ex",
          predictException: () => "predict-ex"
        }
      })
    );

    await result.current.predict(["2026-04-24"]);

    expect(setStatus).toHaveBeenCalledWith("predict-limit");
  });
});
