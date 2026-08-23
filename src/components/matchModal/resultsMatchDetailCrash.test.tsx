import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HistorySection from "../ux/HistorySection";
import MatchModal from "../MatchModal";
import MatchModalErrorBoundary, { MatchDetailUnavailable } from "./MatchModalErrorBoundary";
import { useHistoryDetailSource } from "../../hooks/useHistoryDetailSource";
import { __clearHistoryDetailCache } from "../../hooks/useHistoryDetail";
import type { HistoryEntry, PredictionRow } from "../../types";

/**
 * UX-J - Results -> Match Detail must never blank the workspace.
 *
 * Production: the Results list is the `view=list` projection (no `probs`);
 * clicking a row handed that row to MatchModal, which read `match.probs.p1`
 * and threw; with no boundary the whole React root unmounted - white screen,
 * for pre-match, live and FT alike.
 *
 * The harness mirrors UserDashboard's composition exactly:
 * selectedMatch -> useHistoryDetailSource -> (notice | boundary -> modal).
 */

vi.mock("../PredictionLaboratory", () => ({ default: () => null }));
vi.mock("../MonteCarloPanel", () => ({ default: () => null }));

const TODAY = "2026-08-22";

/** Exactly what mapDbRowToHistoryListEntry produces: no probs, no odds, no valueEngine. */
function listEntry(id: number, status: string, validation: string): HistoryEntry {
  const final = ["FT", "AET", "PEN"].includes(status);
  return {
    id,
    leagueId: 39,
    league: "Premier League",
    teams: { home: `Home ${id}`, away: `Away ${id}` },
    kickoff: `${TODAY}T${String(10 + id).padStart(2, "0")}:00:00+03:00`,
    status,
    score: final || status === "2H" ? { home: 2, away: 1, ...(status === "2H" ? { minute: 60 } : {}) } : { home: null, away: null },
    recommended: { pick: "Over 2.5", confidence: 71, odd: 1.85, family: "Over/Under" },
    savedAt: `${TODAY}T08:00:00+03:00`,
    validation,
    cardMarkets: { goals: { line: 2.5, pick: "over 2.5", side: "over", probability: 71 } },
    cardMarketValidations: { goals: validation, recommended: validation },
    modelVersion: "v3",
    logos: null,
    hasCornersMarket: false,
    hasShotsMarket: false
  } as unknown as HistoryEntry;
}

/** The by-fixture detail: the persisted full row. */
function detailItem(id: number, extra: Record<string, unknown> = {}) {
  return {
    ...(listEntry(id, "FT", "win") as unknown as Record<string, unknown>),
    probs: { p1: 0.48, pX: 0.27, p2: 0.25 },
    odds: { home: 1.9, draw: 3.4, away: 4.1 },
    ...extra
  };
}

/** A full in-memory prediction row (Home / Matches shape). */
function fullRow(id: number): PredictionRow {
  return detailItem(id, { status: "NS", validation: "pending" }) as unknown as PredictionRow;
}

type Deferred = { resolve: (v: unknown) => void };
let pending: Deferred[];
let fetchMock: ReturnType<typeof vi.fn>;
const ok = (item: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, scope: "fixture_detail", item }) });
const fail = (status: number) => ({ ok: false, status, json: async () => ({ ok: false, error: `HTTP ${status}` }) });

function Harness({ history, preset }: { history: HistoryEntry[]; preset?: PredictionRow | null }) {
  const [selectedMatch, setSelectedMatch] = useState<PredictionRow | null>(preset ?? null);
  const { match: modalMatch, error, awaitingDetail, loading } = useHistoryDetailSource(selectedMatch, history as unknown as PredictionRow[]);
  return (
    <>
      <span data-testid="hook-state">{`${modalMatch ? "modal" : "none"}:${loading ? "loading" : "idle"}:${awaitingDetail ? "awaiting" : "ready"}:${error ? "err" : "ok"}`}</span>
      <HistorySection history={history} today={TODAY} onOpenMatch={(row) => setSelectedMatch(row as unknown as PredictionRow)} />
      {awaitingDetail && error && <MatchDetailUnavailable message={error} onClose={() => setSelectedMatch(null)} />}
      {modalMatch && (
        <MatchModalErrorBoundary onClose={() => setSelectedMatch(null)}>
          <Suspense fallback={null}>
            <MatchModal match={modalMatch} logoColors={{}} onClose={() => setSelectedMatch(null)} hashColor={() => "#888"} accessTier="ultra" presentation="focus" />
          </Suspense>
        </MatchModalErrorBoundary>
      )}
    </>
  );
}

const rows = () => [...document.querySelectorAll("li[data-match-row]")].map((li) => li.querySelector("[data-slot='home']")?.textContent);
const hook = () => String(screen.getByTestId("hook-state").textContent);
const modal = () => document.querySelector("[data-layer='decision']");
const notice = () => screen.queryByTestId("match-detail-unavailable");
const clickRow = (home: string) => fireEvent.click([...document.querySelectorAll("li[data-match-row] > button")].find((b) => b.textContent?.includes(home))!);
const clickWonFilter = () => fireEvent.click([...document.querySelectorAll('[data-testid="results-controls"] button')].find((b) => /Câștigat|Won/.test(b.textContent || ""))!);
const closeModal = () => fireEvent.click(screen.getAllByRole("button").find((b) => /închide|close/i.test(b.getAttribute("aria-label") || ""))!);
const flush = () => new Promise((r) => setTimeout(r, 20));
/** Only the by-fixture history reads - the modal's own xG request is not under test here. */
const detailCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/history")).length;

beforeEach(() => {
  __clearHistoryDetailCache();
  pending = [];
  fetchMock = vi.fn((url: string) =>
    String(url).includes("/api/history")
      ? new Promise((resolve) => pending.push({ resolve }))
      : Promise.resolve({ ok: false, status: 404, json: async () => ({ ok: false }) })
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const HISTORY = [listEntry(1, "NS", "pending"), listEntry(2, "2H", "pending"), listEntry(3, "FT", "win")];
const detailFor = (id: number) =>
  detailItem(id, id === 1 ? { status: "NS", validation: "pending", score: { home: null, away: null } } : id === 2 ? { status: "2H", validation: "pending" } : {});

describe("UX-J · Results survives opening a match", () => {
  for (const [label, home] of [
    ["7. pre-match", "Home 1"],
    ["6. live", "Home 2"],
    ["5. FT", "Home 3"]
  ] as const) {
    it(`${label}: click -> list stays, modal waits for detail, then renders; close restores the same list`, async () => {
      render(<Harness history={HISTORY} />);
      const before = rows();
      clickRow(home);
      // 1/2/3/8: list mounted, no modal yet, one detail request in flight, nothing thrown.
      expect(rows()).toEqual(before);
      expect(modal()).toBeNull();
      await waitFor(() => expect(pending.length).toBe(1));
      expect(hook()).toBe("none:loading:awaiting:ok");
      const id = Number(home.replace("Home ", ""));
      await act(async () => {
        pending[0].resolve(ok(detailFor(id)));
      });
      // 4: the modal renders from the full detail; the list is untouched.
      await waitFor(() => expect(modal()).toBeTruthy());
      expect(rows()).toEqual(before);
      await waitFor(() => expect(hook()).toBe("modal:idle:ready:ok"));
      // 14: close -> identical list, no second detail request.
      closeModal();
      await waitFor(() => expect(modal()).toBeNull());
      expect(rows()).toEqual(before);
      expect(detailCalls()).toBe(1);
    });
  }

  it("2. the clicked Results row has no probs - and is never handed to the modal", async () => {
    render(<Harness history={HISTORY} />);
    expect((HISTORY[2] as unknown as { probs?: unknown }).probs).toBeUndefined();
    clickRow("Home 3");
    await waitFor(() => expect(pending.length).toBe(1));
    expect(modal()).toBeNull();
    expect(notice()).toBeNull();
  });

  it("8/17. a detail that never resolves: no white screen, no stuck loading, Results stays interactive", async () => {
    render(<Harness history={HISTORY} />);
    clickRow("Home 3");
    await waitFor(() => expect(pending.length).toBe(1));
    expect(rows()).toHaveLength(3);
    clickWonFilter();
    expect(rows()).toEqual(["Home 3"]);
    expect(modal()).toBeNull();
    expect(notice()).toBeNull();
  });

  for (const [label, status] of [
    ["9. 404", 404],
    ["10. 500", 500]
  ] as const) {
    it(`${label}: detail fails -> Results stays, a closable notice appears, no modal, no crash`, async () => {
      render(<Harness history={HISTORY} />);
      clickRow("Home 3");
      await waitFor(() => expect(pending.length).toBe(1));
      await act(async () => {
        pending[0].resolve(fail(status));
      });
      await waitFor(() => expect(notice()).toBeTruthy());
      expect(rows()).toHaveLength(3);
      expect(modal()).toBeNull();
      expect(hook()).toBe("none:idle:awaiting:err");
      fireEvent.click(notice()!.querySelector("button")!);
      await waitFor(() => expect(notice()).toBeNull());
      expect(rows()).toHaveLength(3);
      expect(hook()).toBe("none:idle:ready:ok");
    });
  }

  it("11. a malformed detail (no probs) is not a modal model either: list stays, no crash", async () => {
    render(<Harness history={HISTORY} />);
    clickRow("Home 3");
    await waitFor(() => expect(pending.length).toBe(1));
    await act(async () => {
      pending[0].resolve(ok({ ...detailItem(3), probs: undefined }));
    });
    await flush();
    expect(rows()).toHaveLength(3);
    expect(modal()).toBeNull();
  });

  it("12. a full Home/Matches row still opens the modal immediately - it does not wait for any detail", () => {
    render(<Harness history={HISTORY} preset={fullRow(1)} />);
    // Synchronous, first paint: the row itself is the model (the detail refresh
    // that may follow for an in-history fixture is unchanged, pre-existing behaviour).
    expect(modal()).toBeTruthy();
    expect(hook()).toMatch(/^modal:(idle|loading):ready:ok$/);
    expect(rows()).toHaveLength(3);
  });

  it("13. a cached final detail reopens instantly", async () => {
    const first = render(<Harness history={HISTORY} />);
    clickRow("Home 3");
    await waitFor(() => expect(pending.length).toBe(1));
    await act(async () => {
      pending[0].resolve(ok(detailItem(3)));
    });
    await waitFor(() => expect(modal()).toBeTruthy());
    first.unmount();
    render(<Harness history={HISTORY} />);
    clickRow("Home 3");
    await waitFor(() => expect(modal()).toBeTruthy());
    expect(detailCalls()).toBe(1);
  });

  it("15/16. opening a match performs no list writes: the history prop is the only list source and is untouched", async () => {
    const frozen = HISTORY.map((r) => ({ ...r }));
    render(<Harness history={HISTORY} />);
    clickRow("Home 3");
    await waitFor(() => expect(pending.length).toBe(1));
    await act(async () => {
      pending[0].resolve(ok(detailItem(3)));
    });
    await waitFor(() => expect(modal()).toBeTruthy());
    expect(HISTORY).toEqual(frozen);
    expect(rows()).toEqual(["Home 1", "Home 2", "Home 3"]);
  });
});

describe("UX-J · defensive guards and boundary", () => {
  it("18. a probs-less row forced straight into the modal is contained by the boundary - never the app root", () => {
    // The modal is NOT a probs-optional component (markets, derived panels and
    // the signal edge all read probs). UX-J's contract is the gate in
    // useHistoryDetailSource; the boundary is the second line. Prove the second line.
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <>
        <HistorySection history={HISTORY} today={TODAY} />
        <MatchModalErrorBoundary onClose={() => {}}>
          <MatchModal match={listEntry(3, "FT", "win") as unknown as PredictionRow} logoColors={{}} onClose={() => {}} hashColor={() => "#888"} accessTier="ultra" presentation="focus" />
        </MatchModalErrorBoundary>
      </>
    );
    expect(rows()).toHaveLength(3);
    expect(modal()).toBeNull();
    expect(notice()).toBeTruthy();
    expect(console.error).toHaveBeenCalledWith("[match-modal] render failed", expect.any(Error), expect.any(String));
  });

  it("19/20. the boundary catches a throwing modal child; the list beside it keeps working; close recovers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Boom(): never {
      throw new Error("boom");
    }
    function H() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <HistorySection history={HISTORY} today={TODAY} onOpenMatch={() => setOpen(true)} />
          {open && (
            <MatchModalErrorBoundary onClose={() => setOpen(false)}>
              <Boom />
            </MatchModalErrorBoundary>
          )}
        </>
      );
    }
    render(<H />);
    expect(rows()).toHaveLength(3);
    expect(notice()).toBeTruthy();
    expect(console.error).toHaveBeenCalledWith("[match-modal] render failed", expect.any(Error), expect.any(String));
    clickWonFilter();
    expect(rows()).toEqual(["Home 3"]);
    fireEvent.click(notice()!.querySelector("button")!);
    await waitFor(() => expect(notice()).toBeNull());
    expect(rows()).toEqual(["Home 3"]);
  });
});
