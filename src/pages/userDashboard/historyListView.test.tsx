import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../context/LocaleContext";
import { useDashboardHistory } from "./useDashboardHistory";
import { usePredictionsCache } from "./usePredictionsCache";

/**
 * Which History caller gets the light projection.
 *
 * `?view=list` is opt-in precisely because /api/history is ALSO a prediction
 * source: usePredictionsCache.rehydratePredictionsFromHistory() pipes the
 * response into setPreds, feeding the prediction cards and
 * hasLegacyPredictionShape(). Sending view=list from there would both strip the
 * cards and leave every row looking "legacy" — which re-triggers the rehydrate
 * that fetched it, an unbounded loop against the endpoint this change exists to
 * relieve.
 *
 * These assertions are on the requests actually issued, not on source text.
 */

let fetchMock: ReturnType<typeof vi.fn>;

function historyResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, mine: true, items: [], stats: { wins: 0, losses: 0, settled: 0, winRate: 0 } })
  };
}

beforeEach(() => {
  fetchMock = vi.fn(async () => historyResponse());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every /api/history request issued, ignoring sync and detail traffic. */
function listRequests(): string[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/api/history") && !u.includes("sync=1") && !u.includes("fixtureId="));
}

function HistoryProbe() {
  useDashboardHistory({ userId: "user-1", accessToken: "token-1" });
  return null;
}

function CacheProbe() {
  const cache = usePredictionsCache({
    user: { id: "user-1", tier: "ultra" } as never,
    userTier: "ultra",
    accessToken: "token-1",
    date: "2026-08-18",
    selectedDates: ["2026-08-18"],
    setSelectedDates: () => {},
    selectedLeagueIds: [283],
    history: [],
    setStatus: () => {}
  } as never);
  return <button onClick={() => void cache.rehydratePredictionsFromHistory()}>go</button>;
}

describe("history list view opt-in", () => {
  it("asks for the light projection from the dashboard History list", async () => {
    render(
      <LocaleProvider>
        <HistoryProbe />
      </LocaleProvider>
    );

    await waitFor(() => expect(listRequests().length).toBeGreaterThan(0));
    const dashboardCall = listRequests().find((u) => u.includes("limit=2000"));
    expect(dashboardCall, "the dashboard History request was not issued").toBeTruthy();
    expect(dashboardCall).toContain("view=list");
    // The parameters that were already there must be untouched.
    expect(dashboardCall).toContain("days=30");
    expect(dashboardCall).toContain("mine=1");
  });

  it("never sends view=list from the prediction hydration path", async () => {
    const { getByText } = render(
      <LocaleProvider>
        <CacheProbe />
      </LocaleProvider>
    );

    getByText("go").click();

    await waitFor(() => expect(listRequests().some((u) => u.includes("view=prediction-list"))).toBe(true));
    const rehydrateCall = listRequests().find((u) => u.includes("view=prediction-list"));
    expect(
      rehydrateCall,
      "prediction hydration opted into the History LIST projection — this degrades the cards and can loop"
    ).not.toContain("view=list&");
    expect(rehydrateCall?.endsWith("view=list")).toBe(false);
    // P3-B gave hydration its own projection, which keeps probs and modelVersion.
    expect(rehydrateCall).toContain("mine=1");
  });
});
