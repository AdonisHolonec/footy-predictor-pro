import { describe, expect, it, vi } from "vitest";
import { buildAuthHeaders, dedupePredictionsById, syncHistoryAfterPredict } from "./predictFlowUtils";

describe("predictFlowUtils", () => {
  it("buildAuthHeaders returns Authorization when token exists", () => {
    expect(buildAuthHeaders("abc")).toEqual({ Authorization: "Bearer abc" });
    expect(buildAuthHeaders(null)).toEqual({});
  });

  it("dedupePredictionsById keeps last row by id", () => {
    const rows = [
      { id: 1, v: "old" },
      { id: 2, v: "two" },
      { id: 1, v: "new" }
    ];
    expect(dedupePredictionsById(rows)).toEqual([
      { id: 1, v: "new" },
      { id: 2, v: "two" }
    ]);
  });

  it("syncHistoryAfterPredict is a no-op for users (P0)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await syncHistoryAfterPredict("tok-1");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
