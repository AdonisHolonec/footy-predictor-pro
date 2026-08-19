import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import MainBoardSection from "./MainBoardSection";
import StatisticsSection from "../../components/ux/StatisticsSection";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { HistoryEntry, HistoryStats } from "../../types";

/**
 * The Insights panel used to render a whole second copy of the Statistics
 * page. These tests pin the four things that copy brought with it — a second
 * track record, a second /api/backtest request, a second performance block and
 * a nested page-level <h1> — none of which is visible from this component's own
 * markup, because every one of them came from a child three levels down.
 */

/** Whichever locale the environment resolves to, the panel title is one of these. */
function eitherLocale(key: "insightsTitle" | "historyTitle"): RegExp {
  const leaf = (d: typeof en) => (d.dash as unknown as Record<string, string>)[key];
  const variants = [leaf(en), leaf(ro as unknown as typeof en)].map((s) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  return new RegExp(variants.join("|"));
}

const TRACKER = <div data-testid="tracker">performance tracker</div>;

const STATS = { wins: 4, losses: 2, settled: 6, winRate: 66.7 } as unknown as HistoryStats;

/** One settled entry, so "populated account" is a real state and not an empty one. */
const HISTORY = [
  {
    id: 1,
    kickoff: "2026-08-17T18:00:00Z",
    leagueId: 283,
    league: "Liga I",
    teams: { home: "Rapid", away: "Farul" },
    validation: "win",
    status: "FT"
  }
] as unknown as HistoryEntry[];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          public: true,
          source: "live_settled",
          days: 45,
          asOf: "2026-08-19T00:00:00.000Z",
          summary: {
            settled: 6,
            wins: 4,
            losses: 2,
            hitRate: 66.7,
            roi: 4.2,
            pnlUnits: 0.25,
            drawdown: 0,
            totalStake: 6,
            expectedValue: 0.3
          },
          trend: [],
          disclaimer: ""
        })
    })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** TrackRecordSection links to the full Statistics page, so it needs a router. */
function renderRouted(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function renderBoard(history: HistoryEntry[] = []) {
  return renderRouted(
    <MainBoardSection
      visiblePreds={[]}
      matchesFilter="all"
      valueOnly={false}
      updateFilters={() => {}}
      handleNav={() => {}}
      setNavView={() => {}}
      trackerStats={STATS}
      simpleRoi={null}
      userTier="free"
      marketValidationsByFixtureId={new Map()}
      isWatched={() => false}
      toggleWatchlist={() => {}}
      openMatch={() => {}}
      onUpgradeRequired={() => {}}
      warmAndPredict={async () => {}}
      analysisMatch={null}
      history={history}
      trackerSlot={TRACKER}
      canShowSpecialBet={false}
      continueMatch={null}
    />
  );
}

/** The panels are lazy: children mount only after the header is clicked. */
function openPanel(key: "insightsTitle" | "historyTitle") {
  const header = screen
    .getAllByRole("button")
    .find((b) => eitherLocale(key).test(b.textContent || ""));
  expect(header, `no panel header matched ${key}`).toBeTruthy();
  fireEvent.click(header!);
}

/** The Insights panel's own <section>, so assertions cannot stray into siblings. */
function insightsPanel(): HTMLElement {
  const header = screen
    .getAllByRole("button")
    .find((b) => eitherLocale("insightsTitle").test(b.textContent || ""));
  const section = header?.closest("section");
  expect(section, "Insights panel not found").toBeTruthy();
  return section as HTMLElement;
}

/** How many track records are mounted anywhere in the tree. */
function trackRecordCount(): number {
  return document.querySelectorAll("#track-record").length;
}

/** Requests for the public track record, regardless of who called it. */
function trackRecordRequests(): number {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes("view=public-track")).length;
}

describe("MainBoardSection Insights panel", () => {
  it("mounts exactly one track record, and asks the API exactly once", async () => {
    // Two were mounted: one inside StatisticsSection, one directly beside it,
    // with identical props. Duplicate id="track-record" and, on every expand,
    // two identical /api/backtest requests for the same 45 days.
    renderBoard(HISTORY);
    openPanel("insightsTitle");

    await waitFor(() => expect(trackRecordCount()).toBe(1));
    await waitFor(() => expect(trackRecordRequests()).toBe(1));
  });

  it("keeps the performance block out of Insights, so the view shows it once", async () => {
    // History and Insights were both handed `trackerSlot`, so opening both put
    // two performance blocks on one view — the duplication PR #94 removed
    // everywhere else. Measured on production before the fix: 2.
    renderBoard(HISTORY);
    openPanel("historyTitle");
    openPanel("insightsTitle");

    await waitFor(() => expect(trackRecordCount()).toBe(1));
    expect(screen.getAllByTestId("tracker")).toHaveLength(1);
    expect(insightsPanel().querySelectorAll('[data-testid="tracker"]')).toHaveLength(0);
  });

  it("does not announce itself as a second page", async () => {
    // StatisticsSection's header is `as="h1" size="page"`, so the copy printed
    // a page-level <h1>Statistics</h1> inside a panel titled "Insights", under
    // the board's own <h1>.
    renderBoard(HISTORY);
    openPanel("insightsTitle");

    await waitFor(() => expect(trackRecordCount()).toBe(1));
    expect(insightsPanel().querySelectorAll("h1")).toHaveLength(0);
  });

  it("renders no history tables at all — populated account or empty", async () => {
    // The tables defaulted to `[]` here because nothing ever passed `history`
    // or `leagueBreakdown`, so they printed 32 empty cells for EVERY account.
    // They belong to Statistics (PR #44); the fix removes them rather than
    // feeding them, so a populated account must not grow them back either.
    for (const history of [[], HISTORY]) {
      cleanup();
      fetchMock.mockClear();
      renderBoard(history);
      openPanel("insightsTitle");

      await waitFor(() => expect(trackRecordCount()).toBe(1));
      // HistoryTrustSection's three tables are the fingerprint: the track
      // record brings at most its own, and only when the API returns markets.
      expect(insightsPanel().querySelectorAll("table").length).toBeLessThanOrEqual(1);
      expect(trackRecordRequests()).toBe(1);
    }
  });

  it("leaves the History panel's own content alone", async () => {
    // Same view, different panel: the fix must not reach past Insights.
    renderBoard(HISTORY);
    openPanel("historyTitle");

    expect(await screen.findByText(/Rapid/)).toBeTruthy();
    expect(screen.getAllByTestId("tracker")).toHaveLength(1);
  });

  it("makes no request at all while Insights stays closed", () => {
    // The panel is lazy, and it must stay lazy: a track record that fetched on
    // mount would cost every board visit a request nobody asked for.
    renderBoard(HISTORY);
    expect(trackRecordRequests()).toBe(0);
    expect(trackRecordCount()).toBe(0);
  });
});

describe("StatisticsSection is unchanged by the Insights fix", () => {
  it("still renders the history tables when it is given history", async () => {
    // The dedicated Statistics view passes both props and must keep every
    // table the Insights copy was removed for.
    renderRouted(
      <StatisticsSection
        trackerSlot={TRACKER}
        history={HISTORY}
        leagueBreakdown={[
          { leagueId: 283, leagueName: "Liga I", wins: 4, losses: 2, pending: 0, settled: 6, winRate: 66.7 }
        ]}
      />
    );

    await waitFor(() => expect(document.querySelectorAll("table").length).toBeGreaterThanOrEqual(2));
    expect(screen.getAllByTestId("tracker")).toHaveLength(1);
    // Its page header is the reason it may not be embedded in a panel.
    expect(document.querySelectorAll("h1").length).toBe(1);
    expect(screen.getAllByText(/Liga I/).length).toBeGreaterThan(0);
  });
});
