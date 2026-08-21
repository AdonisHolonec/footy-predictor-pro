import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import HistorySection from "./HistorySection";
import StatisticsSection from "./StatisticsSection";
import TicketsSection from "./TicketsSection";
import PerformanceTrend from "./PerformanceTrend";
import SuccessRateTracker from "../SuccessRateTracker";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { HistoryEntry } from "../../types";

/**
 * UX-E REDESIGN — the three surfaces as three products.
 *
 *   Results     = a chronological record: date first, one summary strip, one
 *                 filter row, the list dominant, a ticket link after it.
 *   Performance = a trust dashboard: one dominant personal figure, a public
 *                 model zone that looks different, interpretation collapsed.
 *   Tickets     = a secondary product: one primary "Build ticket" action,
 *                 builder closed until asked, history as scan lines.
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const either = (ns: string, key: string) => new RegExp(`${esc(E[ns][key])}|${esc(R[ns][key])}`);
const SRC = join(__dirname, "..", "..");
const src = (rel: string) => readFileSync(join(SRC, rel), "utf8");

vi.mock("./GlobalSpecialBetSection", () => ({
  default: ({ embedded }: { embedded?: boolean }) => <div data-testid="gsb-builder" data-embedded={String(Boolean(embedded))} />
}));
vi.mock("./GlobalSpecialBetHistory", () => ({
  default: ({ embedded, onBuild }: { embedded?: boolean; onBuild?: () => void }) => (
    <div data-testid="gsb-history" data-embedded={String(Boolean(embedded))}>
      <button type="button" onClick={onBuild} data-testid="history-empty-cta">
        cta
      </button>
    </div>
  )
}));
vi.mock("./CalibrationChart", () => ({ default: () => <div data-testid="calibration" /> }));
vi.mock("./HistoryTrustSection", () => ({ default: () => <div data-testid="breakdown" /> }));
vi.mock("../TrackRecordSection", () => ({ default: () => <div data-testid="track-record">72.0%</div> }));

afterEach(cleanup);

function entry(id: number, home: string, kickoff: string, validation: string): HistoryEntry {
  return {
    id,
    leagueId: 39,
    league: "Premier League",
    teams: { home, away: `${home} Away` },
    kickoff,
    status: validation === "pending" ? "NS" : "FT",
    score: validation === "pending" ? { home: null, away: null } : { home: 2, away: 1 },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 70, odd: 1.9 },
    validation,
    savedAt: kickoff
  } as unknown as HistoryEntry;
}
const TODAY = "2026-08-21";
const HISTORY = [
  entry(1, "Arsenal", "2026-08-21T10:00:00Z", "win"),
  entry(2, "Leeds", "2026-08-21T12:00:00Z", "loss"),
  entry(3, "Wolves", "2026-08-21T14:00:00Z", "win"),
  entry(4, "Rayo", "2026-08-21T18:00:00Z", "pending"),
  entry(5, "Milan", "2026-08-20T18:00:00Z", "win")
];

const stats = { wins: 12, losses: 5, winRate: 70.6, settled: 17 } as never;
function hero(extra: Record<string, unknown> = {}) {
  return (
    <SuccessRateTracker
      stats={stats}
      animatedWins={12}
      animatedLosses={5}
      animatedWinRate={70.6}
      isWinRatePulsing={false}
      isHistorySyncing={false}
      pendingHistoryCount={2}
      variant="hero"
      {...extra}
    />
  );
}

/** Document order: the first element's DOM position precedes the second's. */
const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("UX-E redesign · Results", () => {
  const renderResults = () => {
    const onGoTickets = vi.fn();
    render(<HistorySection history={HISTORY} today={TODAY} onGoTickets={onGoTickets} onOpenMatch={vi.fn()} />);
    return { onGoTickets };
  };

  it("date-first: the day navigation is the first strong context, before summary, filter and list", () => {
    renderResults();
    const nav = screen.getByTestId("results-day-nav");
    const summary = screen.getByTestId("results-summary");
    const controls = screen.getByTestId("results-controls");
    const list = document.querySelector("ul[aria-label]")!;
    expect(precedes(nav, summary)).toBe(true);
    expect(precedes(summary, controls)).toBe(true);
    expect(precedes(controls, list)).toBe(true);
    // The date label is display-sized; the filter labels are not.
    expect(screen.getByTestId("results-day-label").className).toMatch(/font-display/);
    expect(screen.getByTestId("results-day-label").className).toMatch(/text-lg/);
    expect(nav.getAttribute("aria-label")).toMatch(either("history", "dayNav"));
    expect(screen.getByRole("button", { name: either("history", "dayPrev") })).toBeTruthy();
    expect(screen.getByRole("button", { name: either("history", "dayNext") })).toBeTruthy();
  });

  it("the summary is one compact strip of figures (no KPI cards, no nested cards) with the pending count aside", () => {
    renderResults();
    const summary = screen.getByTestId("results-summary");
    expect(summary.querySelectorAll("[class*='rounded']").length).toBe(0);
    expect(summary.querySelectorAll("p").length).toBeLessThanOrEqual(9);
    expect(summary.textContent).toMatch(/3\D+2\D+1\D+67%/);
    expect(screen.getByTestId("results-pending").textContent).toMatch(/1/);
    expect(summary.className).toMatch(/flex/);
    expect(summary.className).not.toMatch(/grid-cols|flex-wrap/);
  });

  it("the filter is one horizontal row that scrolls rather than wrapping", () => {
    renderResults();
    const controls = screen.getByTestId("results-controls");
    expect(controls.className).toMatch(/overflow-x-auto/);
    expect(controls.firstElementChild!.className).toMatch(/w-max/);
    expect(controls.querySelectorAll("button").length).toBe(7);
  });

  it("the list dominates: rows are MatchListRow, nothing else renders between the filter and the list", () => {
    renderResults();
    const controls = screen.getByTestId("results-controls");
    const list = document.querySelector("ul[aria-label]")!;
    expect(controls.nextElementSibling).toBe(list);
    expect(document.querySelectorAll("li[data-match-row]").length).toBe(4);
  });

  it("the ticket link is secondary: after the list, not before it", () => {
    const { onGoTickets } = renderResults();
    const link = screen.getByTestId("results-tickets-link");
    const list = document.querySelector("ul[aria-label]")!;
    expect(precedes(list, link)).toBe(true);
    fireEvent.click(link);
    expect(onGoTickets).toHaveBeenCalledTimes(1);
  });

  it("no tracker, no inline builder, no inline ticket history, no charts above the record", () => {
    renderResults();
    expect(screen.queryByTestId("tracker-hero")).toBeNull();
    expect(screen.queryByTestId("gsb-builder")).toBeNull();
    expect(screen.queryByTestId("gsb-history")).toBeNull();
    // No chart anywhere above the list — the only SVGs allowed are the row status icons.
    expect(document.querySelector("canvas, [data-testid*='chart'], [data-slot='equity']")).toBeNull();
    expect(screen.getByTestId("results-controls").previousElementSibling!.querySelector("svg")).toBeNull();
    const source = src("components/ux/HistorySection.tsx");
    expect(source).not.toMatch(/SuccessRateTracker|GlobalSpecialBetSection|GlobalSpecialBetHistory|StatTile|CalibrationChart/);
  });
});

describe("UX-E redesign · Performance", () => {
  const renderPerf = (history: HistoryEntry[] = HISTORY) => {
    const onViewResults = vi.fn();
    render(<StatisticsSection trackerSlot={hero()} history={history} onViewResults={onViewResults} />);
    return { onViewResults };
  };

  it("Your Results is the dominant personal section with ONE primary hit rate and its W / L / settled line", async () => {
    renderPerf();
    await waitFor(() => expect(screen.getByTestId("track-record")).toBeTruthy());
    const yours = screen.getByTestId("performance-yours");
    const rate = yours.querySelector("[data-slot='tracker-rate']")!;
    expect(rate.textContent).toBe("70.6%");
    expect(rate.className).toMatch(/text-5xl/);
    // Exactly one element at display size inside the personal zone.
    expect(yours.querySelectorAll("[class*='text-5xl'], [class*='text-6xl']").length).toBe(1);
    const support = yours.querySelector("[data-slot='tracker-support']")!;
    expect(support.textContent).toMatch(/12/);
    expect(support.textContent).toMatch(/5/);
    expect(support.textContent).toMatch(/17/);
    // The personal rate appears once on the whole page.
    expect((document.body.textContent!.match(/70\.6%/g) || []).length).toBe(1);
    // Zone A precedes zone B.
    expect(precedes(yours, screen.getByTestId("performance-model"))).toBe(true);
  });

  it("Model Track Record is visually distinct and labelled as the public population", async () => {
    renderPerf();
    await waitFor(() => expect(screen.getByTestId("track-record")).toBeTruthy());
    const yours = screen.getByTestId("performance-yours");
    const model = screen.getByTestId("performance-model");
    expect(model.className).toMatch(/border-dashed/);
    expect(model.className).toMatch(/bg-\[var\(--fp-bg-muted\)\]/);
    expect(yours.className).not.toMatch(/border-dashed/);
    expect(yours.className).toMatch(/border-fp-accent/);
    expect(model.textContent).toMatch(either("perf", "modelEyebrow"));
    expect(model.textContent).toMatch(either("perf", "modelSub"));
    expect(E.perf.modelSub).toMatch(/all accounts/);
    expect(model.contains(screen.getByTestId("track-record"))).toBe(true);
    expect(yours.contains(screen.getByTestId("track-record"))).toBe(false);
  });

  it("the trend renders when data exists and is absent (not a fake 0%) when nothing settled", () => {
    const { unmount } = render(<PerformanceTrend history={HISTORY} />);
    const trend = screen.getByTestId("performance-trend");
    expect(trend.querySelectorAll("li").length).toBe(7);
    expect(trend.textContent).toMatch(/%/);
    expect(trend.querySelector("ol")!.getAttribute("aria-label")).toMatch(/7/);
    unmount();
    render(<PerformanceTrend history={[]} />);
    expect(screen.queryByTestId("performance-trend")).toBeNull();
  });

  it("breakdown and calibration are collapsed disclosures beneath both zones; there is one tracker", async () => {
    renderPerf();
    await waitFor(() => expect(screen.getByTestId("track-record")).toBeTruthy());
    const panels = screen.getByTestId("performance-breakdowns").querySelectorAll("button[aria-expanded]");
    expect(panels.length).toBe(2);
    panels.forEach((p) => expect(p.getAttribute("aria-expanded")).toBe("false"));
    expect(screen.queryByTestId("breakdown")).toBeNull();
    expect(screen.queryByTestId("calibration")).toBeNull();
    expect(precedes(screen.getByTestId("performance-model"), screen.getByTestId("performance-breakdowns"))).toBe(true);
    expect(screen.getAllByTestId("tracker-hero").length).toBe(1);
    // Desktop: the two zones share one grid that splits at xl.
    expect(screen.getByTestId("performance-yours").parentElement!.className).toMatch(/xl:grid-cols-2/);
  });

  it("the hero keeps the console reachable as a named action, not a secretly clickable panel", () => {
    const onBreakdownClick = vi.fn();
    render(hero({ onBreakdownClick }));
    const btn = screen.getByRole("button", { name: either("tracker", "openConsole") });
    fireEvent.click(btn);
    expect(onBreakdownClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("tracker-hero").tagName).toBe("DIV");
  });
});

describe("UX-E redesign · Tickets", () => {
  const renderTickets = (can = true) =>
    render(<TicketsSection betDate={TODAY} favoriteLeagueIds={[39]} canUseGlobalSpecialBet={can} onUpgradeRequired={vi.fn()} />);

  it("one primary Build ticket CTA is visible; the builder is closed by default and opens intentionally", () => {
    renderTickets();
    const cta = screen.getByTestId("tickets-build-cta");
    expect(cta.textContent).toMatch(either("tickets", "buildCta"));
    expect(cta.getAttribute("aria-expanded")).toBe("false");
    expect(cta.getAttribute("aria-controls")).toBe("tickets-build");
    expect(screen.queryByTestId("gsb-builder")).toBeNull();
    expect(screen.queryByTestId("tickets-build")).toBeNull();
    fireEvent.click(cta);
    expect(cta.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("tickets-build").contains(screen.getByTestId("gsb-builder"))).toBe(true);
    expect(screen.getAllByTestId("gsb-builder").length).toBe(1);
  });

  it("the history's empty-state CTA opens the same builder (one state, one builder)", () => {
    renderTickets();
    fireEvent.click(screen.getByTestId("history-empty-cta"));
    expect(screen.getAllByTestId("gsb-builder").length).toBe(1);
    expect(screen.getAllByTestId("gsb-history").length).toBe(1);
  });

  it("builder and history are embedded: no competing internal headings, headings coherent", () => {
    renderTickets();
    fireEvent.click(screen.getByTestId("tickets-build-cta"));
    expect(screen.getByTestId("gsb-builder").getAttribute("data-embedded")).toBe("true");
    expect(screen.getByTestId("gsb-history").getAttribute("data-embedded")).toBe("true");
    const headings = [...document.querySelectorAll("h1, h2")].map((h) => h.textContent?.trim() || "");
    expect(headings[0]).toMatch(either("nav", "tickets"));
    expect(headings.filter((h) => either("tickets", "buildTitle").test(h)).length).toBe(1);
    expect(headings.filter((h) => either("tickets", "historyTitle").test(h)).length).toBe(1);
    expect(document.body.textContent).not.toMatch(/Special Bet|Pariu special/i);
  });

  it("xl two-column only once the builder is open; history is the only column before", () => {
    renderTickets();
    const grid = screen.getByTestId("tickets-history").parentElement!;
    expect(grid.className).not.toMatch(/xl:grid-cols-2/);
    fireEvent.click(screen.getByTestId("tickets-build-cta"));
    expect(grid.className).toMatch(/xl:grid-cols-2/);
    expect(precedes(screen.getByTestId("tickets-build"), screen.getByTestId("tickets-history"))).toBe(true);
  });

  it("compact ticket rows: status · shape · legs · odds · date on one line, legs behind the disclosure", () => {
    const list = src("components/ux/GlobalSpecialBetTicketList.tsx");
    for (const slot of ["ticket-shape", "ticket-odds", "ticket-date", "ticket-reading"]) expect(list).toContain(`data-slot="${slot}"`);
    expect(list).toMatch(/min-h-\[var\(--fp-touch\)\]/);
    expect(list).toMatch(/EmptyState/);
    expect(list).toMatch(/tickets\.emptyCta/);
    expect(list).not.toMatch(/flex-wrap/);
  });

  it("locked accounts see the CTA and the locked copy; the gate itself is unchanged", () => {
    renderTickets(false);
    expect(screen.getByTestId("tickets-build-cta")).toBeTruthy();
    expect(screen.getByTestId("tickets-locked").textContent).toMatch(either("gsb", "lockedDesc"));
    expect(src("pages/UserDashboard.tsx")).toMatch(/canUseGlobalSpecialBet=\{Boolean\(user\)\}/);
  });
});

describe("UX-E redesign · responsive contract + accessibility", () => {
  it("no surface fixes a width above 390px", () => {
    for (const rel of [
      "components/ux/HistorySection.tsx",
      "components/ux/StatisticsSection.tsx",
      "components/ux/TicketsSection.tsx",
      "components/ux/PerformanceTrend.tsx"
    ]) {
      const source = src(rel);
      const fixed = [...source.matchAll(/(?:min-w|w)-\[(\d+)px\]/g)].map((m) => Number(m[1]));
      expect(fixed.every((n) => n <= 390), rel).toBe(true);
    }
  });

  it("status is never colour-only: the result row carries a labelled icon and Title-case tokens", () => {
    render(<HistorySection history={HISTORY} today={TODAY} onOpenMatch={vi.fn()} />);
    // Newest first: row 0 is the pending Rayo fixture; row 1 (Wolves) is settled.
    const first = document.querySelectorAll("li[data-match-row]")[1]!;
    // The badge carries a text label at sm+ and a labelled icon below sm — never colour alone.
    const odds = first.querySelector("[data-slot='odds']")!;
    expect(odds.textContent).toMatch(either("history", "win"));
    const icon = odds.querySelector("svg, [role='img']")!;
    expect(icon).toBeTruthy();
    expect((icon.getAttribute("aria-label") || icon.querySelector("title")?.textContent || "").trim().length).toBeGreaterThan(0);
    for (const [ns, key] of [["history", "win"], ["history", "loss"], ["history", "pendingBadge"]]) {
      expect(E[ns][key]).toMatch(/^\p{Lu}\p{Ll}/u);
      expect(R[ns][key]).toMatch(/^\p{Lu}\p{Ll}/u);
    }
  });

  it("every CTA, date control and collapsible is labelled; date controls use the 44px token", async () => {
    render(<StatisticsSection trackerSlot={hero({ onBreakdownClick: vi.fn() })} history={HISTORY} onViewResults={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("track-record")).toBeTruthy());
    for (const b of document.querySelectorAll("button")) {
      expect((b.getAttribute("aria-label") || b.textContent || "").trim().length, b.outerHTML).toBeGreaterThan(0);
    }
    for (const p of document.querySelectorAll("button[aria-expanded]")) expect(p.getAttribute("aria-controls")).toBeTruthy();
    cleanup();
    render(<HistorySection history={HISTORY} today={TODAY} onOpenMatch={vi.fn()} onGoTickets={vi.fn()} />);
    const prev = screen.getByRole("button", { name: either("history", "dayPrev") });
    expect(prev.className).toMatch(/var\(--fp-touch\)/);
  });

  it("RO and EN carry every redesign key, with no English leaking into RO", () => {
    for (const [ns, keys] of Object.entries({
      history: ["sumSettled", "sumRate"],
      perf: ["trendTitle", "trendNone"],
      tickets: ["buildCta", "emptyCta", "emptyDesc", "legs"]
    })) {
      for (const key of keys) {
        expect(E[ns][key], `${ns}.${key} en`).toBeTruthy();
        expect(R[ns][key], `${ns}.${key} ro`).toBeTruthy();
        expect(R[ns][key]).not.toBe(E[ns][key]);
      }
    }
  });
});
