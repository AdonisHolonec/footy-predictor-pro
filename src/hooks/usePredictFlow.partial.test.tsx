import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePredictFlow } from "./usePredictFlow";
import { mergePredictionRows } from "../utils/appUtils";
import type { PredictionRow } from "../types";

/**
 * RELIABILITY-001/003 / P0-B — a failed date must not discard the dates that succeeded.
 *
 * On 2026-09-11 a three-date Predict ran 2026-09-11 (200, 18.9s), 2026-09-12 (200, 63.7s)
 * and 2026-09-13 (401). The 401 leg did `setStatus(...); return;`, which dropped the local
 * `batches` array and skipped `onPredictCompleted` — the only path to the UI. Two
 * predictions that were already durable in `predictions_history` were shown as nothing.
 * A THROW (network, abort, JSON parse) escaped to an outer catch with the same result;
 * RELIABILITY-003 closes that path too.
 *
 * These tests pin the recovery unit at the DATE, and pin the things that make partial
 * completion safe: only the dates that actually completed are handed to the callback, the
 * callback runs at most once, and the failure status is applied AFTER the callback so the
 * consumer's own success line cannot bury it.
 */

const DATES = ["2026-09-11", "2026-09-12", "2026-09-13"];

/** Mirrors USER_PREDICT_FLOW_MESSAGES: the backend string is interpolated by the consumer. */
const MESSAGES = {
  predictRateLimit: "Limită zilnică Predict atinsă.",
  predictFailed: (code: number, backend: string) =>
    backend ? `Predict a eșuat (HTTP ${code}): ${backend}` : `Predict a eșuat (HTTP ${code}).`,
  predictException: (message: string) => `Eroare: ${message}`
};

/** `.at(-1)` needs the ES2022 lib; this project targets lower. */
function lastStatus(setStatus: { mock: { calls: unknown[][] } }) {
  const calls = setStatus.mock.calls;
  return calls[calls.length - 1]?.[0] as string;
}

const ok = (rows: Array<{ id: number }>) => ({ ok: true, status: 200, json: async () => rows });
const fail = (status: number, error?: string) => ({
  ok: false,
  status,
  json: async () => (error ? { error } : {})
});
/** A 200 whose body is not JSON — `response.json()` rejects, as it does in a browser. */
const badJson = () => ({
  ok: true,
  status: 200,
  json: async () => {
    throw new SyntaxError("Unexpected token '<'");
  }
});

/** Each entry is a response to resolve with, or an Error to reject with (a fetch throw). */
function setup(responses: Array<unknown>, overrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fetchMock.mockRejectedValueOnce(r);
    else fetchMock.mockResolvedValueOnce(r);
  }
  vi.stubGlobal("fetch", fetchMock);

  const onPredictCompleted = vi.fn().mockResolvedValue(undefined);
  const setStatus = vi.fn();

  const { result } = renderHook(() =>
    usePredictFlow<{ id: number }>({
      accessToken: "tok",
      selectedLeagueIds: [39],
      inferSeason: () => 2026,
      usageDay: "2026-09-11",
      setStatus,
      messages: MESSAGES,
      onPredictCompleted,
      ...overrides
    })
  );
  return { result, fetchMock, onPredictCompleted, setStatus };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("usePredictFlow — partial recovery", () => {
  it("all dates succeed: unchanged behaviour, completion gets every date", async () => {
    const { result, onPredictCompleted } = setup([ok([{ id: 1 }]), ok([{ id: 2 }]), ok([{ id: 3 }])]);

    const outcome = await result.current.predict(DATES);

    expect(onPredictCompleted).toHaveBeenCalledTimes(1);
    const [rows, , completedDates] = onPredictCompleted.mock.calls[0];
    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(completedDates).toEqual(DATES);
    expect(outcome).toMatchObject({ outcome: "success", failedDates: [], rowCount: 3 });
  });

  it("all dates succeed with zero rows: completion still runs, as on origin/main", async () => {
    // The consumer's "0 predictions generated" line is the only feedback a user gets for an
    // empty day; skipping completion would leave the "processing" status on screen.
    const { result, onPredictCompleted } = setup([ok([]), ok([])]);

    const outcome = await result.current.predict(["2026-09-11", "2026-09-12"]);

    expect(onPredictCompleted).toHaveBeenCalledTimes(1);
    expect(onPredictCompleted.mock.calls[0][0]).toEqual([]);
    expect(onPredictCompleted.mock.calls[0][2]).toEqual(["2026-09-11", "2026-09-12"]);
    expect(outcome).toMatchObject({ outcome: "success", rowCount: 0 });
  });

  it("date 1 and 2 succeed, date 3 fails: successful rows survive", async () => {
    const { result, onPredictCompleted } = setup([
      ok([{ id: 1 }]),
      ok([{ id: 2 }]),
      fail(401, "Token invalid sau expirat.")
    ]);

    const outcome = await result.current.predict(DATES);

    // The regression this whole change exists to prevent.
    expect(onPredictCompleted).toHaveBeenCalledTimes(1);
    const [rows] = onPredictCompleted.mock.calls[0];
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(outcome).toMatchObject({
      outcome: "partial_success",
      completedDates: ["2026-09-11", "2026-09-12"],
      failedDates: ["2026-09-13"],
      rowCount: 2
    });
  });

  it("date 1 succeeds, date 2 non-OK: date 3 never requested, completion gets date 1 only", async () => {
    // useWarm renders `pentru ${dates.length} zi(le)`; passing all three requested dates
    // would claim days that never completed.
    const { result, fetchMock, onPredictCompleted } = setup([ok([{ id: 1 }]), fail(503), ok([{ id: 3 }])]);

    const outcome = await result.current.predict(DATES);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onPredictCompleted).toHaveBeenCalledTimes(1);
    expect(onPredictCompleted.mock.calls[0][2]).toEqual(["2026-09-11"]);
    expect(outcome.completedDates).not.toContain("2026-09-12");
    expect(outcome.failedDates).toEqual(["2026-09-12", "2026-09-13"]);
  });

  it("the failure status survives the consumer's own success message", async () => {
    // Both real consumers call setStatus INSIDE onPredictCompleted.
    const setStatus = vi.fn();
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(ok([{ id: 1 }]));
    fetchMock.mockResolvedValueOnce(fail(401, "Token invalid sau expirat."));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      usePredictFlow<{ id: number }>({
        accessToken: "tok",
        selectedLeagueIds: [39],
        inferSeason: () => 2026,
        usageDay: "2026-09-11",
        setStatus,
        messages: MESSAGES,
        onPredictCompleted: async () => {
          setStatus("Gata! 1 predicții generate.");
        }
      })
    );

    await result.current.predict(["2026-09-11", "2026-09-12"]);

    const last = lastStatus(setStatus);
    expect(last).not.toBe("Gata! 1 predicții generate.");
    expect(last).toContain("Token invalid sau expirat.");
    // Partial completion is stated, never implied as full success.
    expect(last).toContain("1/2");
  });

  it("first date fails: completion is not called with an empty batch", async () => {
    const { result, onPredictCompleted, setStatus } = setup([fail(401, "Token invalid sau expirat."), ok([{ id: 2 }])]);

    const outcome = await result.current.predict(["2026-09-11", "2026-09-12"]);

    expect(onPredictCompleted).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ outcome: "failure", completedDates: [], rowCount: 0 });
    // No "0 predictions generated" over a real failure.
    expect(lastStatus(setStatus)).toBe("Predict a eșuat (HTTP 401): Token invalid sau expirat.");
  });

  it("every date fails: failure, no completion", async () => {
    const { result, onPredictCompleted } = setup([fail(500), fail(500), fail(500)]);

    const outcome = await result.current.predict(DATES);

    expect(onPredictCompleted).not.toHaveBeenCalled();
    expect(outcome.outcome).toBe("failure");
    expect(outcome.failedDates).toEqual(DATES);
  });

  it("429 keeps its dedicated rate-limit message and still preserves earlier rows", async () => {
    const { result, onPredictCompleted, setStatus } = setup([
      ok([{ id: 1 }]),
      fail(429, "Limită zilnică Predict atinsă.")
    ]);

    const outcome = await result.current.predict(["2026-09-11", "2026-09-12"]);

    expect(onPredictCompleted).toHaveBeenCalledTimes(1);
    expect(onPredictCompleted.mock.calls[0][0]).toEqual([{ id: 1 }]);
    expect(outcome.outcome).toBe("partial_success");
    expect(lastStatus(setStatus)).toBe("Limită zilnică Predict atinsă. (1/2)");
  });

  it("date 1 succeeds, date 2 fetch THROWS: date 3 never requested, date 1 handed over once", async () => {
    const { result, fetchMock, onPredictCompleted, setStatus } = setup([
      ok([{ id: 1 }]),
      new TypeError("Failed to fetch"),
      ok([{ id: 3 }])
    ]);

    const outcome = await result.current.predict(DATES);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onPredictCompleted).toHaveBeenCalledTimes(1);
    const [rows, token, completedDates] = onPredictCompleted.mock.calls[0];
    expect(rows).toEqual([{ id: 1 }]);
    expect(token).toBe("tok");
    expect(completedDates).toEqual(["2026-09-11"]);
    expect(outcome).toMatchObject({
      outcome: "partial_success",
      completedDates: ["2026-09-11"],
      failedDates: ["2026-09-12", "2026-09-13"],
      rowCount: 1
    });
    expect(lastStatus(setStatus)).toBe("Eroare: Failed to fetch (1/3)");
  });

  it("date 1 succeeds, date 2 JSON parse THROWS: same recovery as any other failure", async () => {
    const { result, onPredictCompleted, setStatus } = setup([ok([{ id: 1 }]), badJson()]);

    const outcome = await result.current.predict(["2026-09-11", "2026-09-12"]);

    expect(onPredictCompleted).toHaveBeenCalledTimes(1);
    expect(onPredictCompleted.mock.calls[0][0]).toEqual([{ id: 1 }]);
    expect(onPredictCompleted.mock.calls[0][2]).toEqual(["2026-09-11"]);
    // The unparseable date is failed, never counted as completed.
    expect(outcome.completedDates).toEqual(["2026-09-11"]);
    expect(outcome.failedDates).toEqual(["2026-09-12"]);
    expect(lastStatus(setStatus)).toBe("Eroare: Unexpected token '<' (1/2)");
  });

  it("first date THROWS: failure, no completion, the exception message is shown", async () => {
    const { result, fetchMock, onPredictCompleted, setStatus } = setup([new TypeError("Failed to fetch"), ok([{ id: 2 }])]);

    const outcome = await result.current.predict(["2026-09-11", "2026-09-12"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onPredictCompleted).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ outcome: "failure", completedDates: [], failedDates: ["2026-09-11", "2026-09-12"] });
    expect(lastStatus(setStatus)).toBe("Eroare: Failed to fetch");
  });

  it("the completion callback itself throws: it is not called twice and the error is shown", async () => {
    const onPredictCompleted = vi.fn().mockRejectedValue(new Error("history reload failed"));
    const { result, setStatus } = setup([ok([{ id: 1 }]), ok([{ id: 2 }])], { onPredictCompleted });

    const outcome = await result.current.predict(["2026-09-11", "2026-09-12"]);

    expect(onPredictCompleted).toHaveBeenCalledTimes(1);
    // Every date was computed server-side; nothing is marked for retry.
    expect(outcome).toMatchObject({ outcome: "success", completedDates: ["2026-09-11", "2026-09-12"], failedDates: [] });
    expect(lastStatus(setStatus)).toBe("Eroare: history reload failed");
  });

  it("the callback throws on a partial run: the date failure stays the visible message", async () => {
    const onPredictCompleted = vi.fn().mockRejectedValue(new Error("history reload failed"));
    const { result, setStatus } = setup([ok([{ id: 1 }]), fail(503)], { onPredictCompleted });

    await result.current.predict(["2026-09-11", "2026-09-12"]);

    expect(onPredictCompleted).toHaveBeenCalledTimes(1);
    expect(lastStatus(setStatus)).toBe("Predict a eșuat (HTTP 503). (1/2)");
  });

  it("a partial completion adds its rows to the per-user store and never shrinks it", async () => {
    // The real merge UserDashboard applies inside onPredictCompleted.
    let store: PredictionRow[] = [{ id: 900 } as PredictionRow, { id: 901 } as PredictionRow];
    const onPredictCompleted = vi.fn(async (rows: Array<{ id: number }>) => {
      store = mergePredictionRows(store, rows as unknown as PredictionRow[]);
    });
    const { result } = setup([ok([{ id: 1 }, { id: 2 }]), new TypeError("Failed to fetch")], { onPredictCompleted });

    await result.current.predict(["2026-09-11", "2026-09-12"]);

    expect(store.map((row) => Number(row.id)).sort((a, b) => a - b)).toEqual([1, 2, 900, 901]);
  });

  it("a run where nothing completes leaves the per-user store untouched", async () => {
    let store: PredictionRow[] = [{ id: 900 } as PredictionRow];
    const onPredictCompleted = vi.fn(async (rows: Array<{ id: number }>) => {
      store = mergePredictionRows(store, rows as unknown as PredictionRow[]);
    });
    const { result } = setup([new TypeError("Failed to fetch")], { onPredictCompleted });

    await result.current.predict(["2026-09-11"]);

    expect(onPredictCompleted).not.toHaveBeenCalled();
    expect(store).toEqual([{ id: 900 }]);
  });

  it("the failed date can be retried alone, without recomputing the successful one", async () => {
    const { result, fetchMock, onPredictCompleted } = setup([
      ok([{ id: 1 }]),
      new TypeError("Failed to fetch"),
      // retry of the failed date only
      ok([{ id: 2 }])
    ]);

    const first = await result.current.predict(["2026-09-11", "2026-09-12"]);
    expect(first.failedDates).toEqual(["2026-09-12"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retry = await result.current.predict(first.failedDates);

    expect(retry).toMatchObject({ outcome: "success", completedDates: ["2026-09-12"], rowCount: 1 });
    // 2 from the first run + exactly 1 for the retry: the successful date is not re-fetched.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retriedDate = new URL(String(fetchMock.mock.calls[2][0]), "http://localhost").searchParams.get("date");
    expect(retriedDate).toBe("2026-09-12");
    expect(onPredictCompleted).toHaveBeenCalledTimes(2);
  });

  it("no token and a session provider present: aborts without issuing a request", async () => {
    const { result, fetchMock, onPredictCompleted } = setup([ok([{ id: 1 }])], {
      accessToken: null,
      getSession: async () => null
    });

    const outcome = await result.current.predict(DATES);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onPredictCompleted).not.toHaveBeenCalled();
    expect(outcome.outcome).toBe("failure");
  });
});
