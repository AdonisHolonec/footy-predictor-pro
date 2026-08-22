import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import HistorySection from "./HistorySection";
import StatisticsSection from "./StatisticsSection";
import TicketsSection from "./TicketsSection";
import { APP_NAV_ITEMS, DESKTOP_SECONDARY_NAV_ITEMS, PRIMARY_NAV_ITEMS } from "./appNav";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { HistoryEntry } from "../../types";

/**
 * UX-E — Results = records · Performance = interpretation · Tickets = the
 * multi-leg product. Three jobs, three surfaces, one status vocabulary, one
 * rendering per fact.
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const either = (ns: string, key: string) => new RegExp(`^(${esc(E[ns][key])}|${esc(R[ns][key])})`);
const SRC = join(__dirname, "..", "..");
const src = (rel: string) => readFileSync(join(SRC, rel), "utf8");

vi.mock("./GlobalSpecialBetSection", () => ({ default: () => <div data-testid="gsb-builder" /> }));
vi.mock("./GlobalSpecialBetHistory", () => ({ default: () => <div data-testid="gsb-history" /> }));
vi.mock("./CalibrationChart", () => ({ default: () => <div data-testid="calibration" /> }));
vi.mock("./HistoryTrustSection", () => ({ default: () => <div data-testid="breakdown" /> }));
vi.mock("../TrackRecordSection", () => ({ default: () => <div data-testid="track-record" /> }));

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
  entry(5, "Milan", "2026-08-20T18:00:00Z", "push"),
  entry(6, "Genoa", "2026-08-20T16:00:00Z", "half_win"),
  entry(7, "Lazio", "2026-08-19T16:00:00Z", "half_loss")
];

function renderResults(props: Record<string, unknown> = {}) {
  const onGoTickets = vi.fn();
  const onOpenMatch = vi.fn();
  render(<HistorySection history={HISTORY} today={TODAY} onGoTickets={onGoTickets} onOpenMatch={onOpenMatch} {...props} />);
  return { onGoTickets, onOpenMatch };
}
const rows = () => [...document.querySelectorAll("li[data-match-row]")].map((li) => li.querySelector("[data-slot='home']")?.textContent);
const btn = (ns: string, key: string) => screen.getByRole("button", { name: either(ns, key) }) as HTMLButtonElement;

describe("UX-E · Results", () => {
  it("[1][3] the selected day drives the rows; previous / next / today navigate", () => {
    renderResults();
    // Earliest kick-off first, top to bottom.
    expect(rows()).toEqual(["Arsenal", "Leeds", "Wolves", "Rayo"]);
    expect(screen.getByTestId("results-day-nav").textContent).toMatch(new RegExp(`${esc(E.history.dayToday)}|${esc(R.history.dayToday)}`));
    expect(btn("history", "dayNext").disabled).toBe(true);
    fireEvent.click(btn("history", "dayPrev"));
    expect(rows()).toEqual(["Genoa", "Milan"]);
    expect(screen.getByTestId("results-day-nav").textContent).toMatch(new RegExp(`${esc(E.history.dayYesterday)}|${esc(R.history.dayYesterday)}`));
    fireEvent.click(btn("history", "dayPrev"));
    expect(rows()).toEqual(["Lazio"]);
    expect(btn("history", "dayPrev").disabled).toBe(true);
    fireEvent.click(btn("history", "dayToday"));
    expect(rows()).toHaveLength(4);
  });

  it("[2][7] the outcome filter uses the single status vocabulary and covers every emitted status", () => {
    renderResults();
    const labels = [...screen.getByTestId("results-controls").querySelectorAll("button")].map((b) => b.textContent?.trim() || "");
    for (const key of ["win", "loss", "pendingBadge", "outcomePush", "outcomeHalfWin", "outcomeHalfLoss"]) {
      expect(labels.some((l) => either("history", key).test(l)), key).toBe(true);
    }
    expect(labels.join(" ")).not.toMatch(/\bVoid\b/);
    // One vocabulary: per-match tokens are the ticket tokens — Title case, no WIN / LOSE shouting.
    expect(E.history.win).toBe(E.gsb.statusWon);
    expect(E.history.loss).toBe(E.gsb.statusLost);
    expect(E.history.pendingBadge).toBe(E.gsb.statusPending);
    expect(R.history.win).toBe(R.gsb.statusWon);
    expect(R.history.loss).toBe(R.gsb.statusLost);
    fireEvent.click(btn("history", "win"));
    expect(rows()).toEqual(["Arsenal", "Wolves"]);
    fireEvent.click(btn("history", "pendingBadge"));
    expect(rows()).toEqual(["Rayo"]);
    fireEvent.click(btn("history", "dayPrev"));
    expect(rows()).toEqual([]);
    fireEvent.click(btn("history", "outcomePush"));
    expect(rows()).toEqual(["Milan"]);
  });

  it("[4][5] rows use the compact list grammar, no tracker above them, the day's rate stated once", () => {
    renderResults();
    expect(screen.queryByTestId("tracker")).toBeNull();
    expect(document.querySelector("ul[aria-label]")).toBeTruthy();
    const first = document.querySelector("li[data-match-row] > button")!;
    expect(first.querySelector("[data-slot='prediction']")?.textContent).toMatch(/2\.5/);
    expect(first.querySelector("[data-slot='odds']")?.textContent).toMatch(/1\.90/);
    const summary = screen.getByTestId("results-summary").textContent || "";
    expect(summary).toMatch(/3\D+2\D+1\D+67%/);
    expect((document.body.textContent!.match(/67%/g) || []).length).toBe(1);
  });

  it("[6] the ticket summary links to Tickets and no ticket history renders inline", () => {
    const { onGoTickets } = renderResults();
    fireEvent.click(screen.getByTestId("results-tickets-link"));
    expect(onGoTickets).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("gsb-history")).toBeNull();
    expect(src("components/ux/HistorySection.tsx")).not.toMatch(/GlobalSpecialBetHistory|HistorySpecialBetCard|SuccessRateTracker/);
  });

  it("opens Match Detail from a row (where the per-match ticket builder lives)", () => {
    const { onOpenMatch } = renderResults();
    fireEvent.click(document.querySelector("li[data-match-row] > button")!);
    expect(onOpenMatch).toHaveBeenCalledTimes(1);
  });
});

describe("UX-E · Performance", () => {
  function renderPerf() {
    const onViewResults = vi.fn();
    render(<StatisticsSection trackerSlot={<div data-testid="tracker">60%</div>} history={[]} onViewResults={onViewResults} />);
    return { onViewResults };
  }

  it("[8][9] Your Results and Model Track Record are two labelled sections, populations named", async () => {
    renderPerf();
    await waitFor(() => expect(screen.getByTestId("track-record")).toBeTruthy());
    const yours = screen.getByTestId("performance-yours");
    const model = screen.getByTestId("performance-model");
    expect(yours.textContent).toMatch(new RegExp(`${esc(E.perf.yoursTitle)}|${esc(R.perf.yoursTitle)}`));
    expect(yours.textContent).toMatch(new RegExp(`${esc(E.perf.yoursSub)}|${esc(R.perf.yoursSub)}`));
    expect(model.textContent).toMatch(new RegExp(`${esc(E.perf.modelTitle)}|${esc(R.perf.modelTitle)}`));
    expect(model.textContent).toMatch(new RegExp(`${esc(E.perf.modelSub)}|${esc(R.perf.modelSub)}`));
    expect(yours.contains(screen.getByTestId("tracker"))).toBe(true);
    expect(model.contains(screen.getByTestId("track-record"))).toBe(true);
    expect(yours.contains(screen.getByTestId("track-record"))).toBe(false);
  });

  it("Performance is a primary destination", () => {
    expect(PRIMARY_NAV_ITEMS.map((i) => i.id)).toContain("statistics");
  });

  it("[10][11][13] one tracker, and it lives only on Performance", () => {
    renderPerf();
    expect(screen.getAllByTestId("tracker")).toHaveLength(1);
    for (const rel of ["components/ux/HistorySection.tsx", "components/ux/HomeSection.tsx", "pages/Login.tsx", "components/ux/TicketsSection.tsx"]) {
      expect(src(rel), rel).not.toMatch(/SuccessRateTracker/);
    }
    expect((src("pages/UserDashboard.tsx").match(/trackerSlot=\{trackerSlot\}/g) || []).length).toBe(1);
  });

  it("[14] mobile: breakdowns and calibration are collapsed; the first viewport is the tracker", () => {
    renderPerf();
    expect(screen.queryByTestId("breakdown")).toBeNull();
    expect(screen.queryByTestId("calibration")).toBeNull();
    const b = btn("perf", "breakdownTitle");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(b);
    expect(screen.getByTestId("breakdown")).toBeTruthy();
    expect(btn("perf", "reliabilityTitle").getAttribute("aria-expanded")).toBe("false");
  });

  it("[15] links down to Results, never the other way", () => {
    const { onViewResults } = renderPerf();
    fireEvent.click(screen.getByTestId("performance-view-results"));
    expect(onViewResults).toHaveBeenCalledTimes(1);
    expect(src("components/ux/HistorySection.tsx")).not.toMatch(/StatisticsSection|TrackRecordSection|HistoryTrustSection/);
  });

  it("[12] ROI: two products, two formulas, both labelled — neither silently chosen", () => {
    const yours = src("utils/historyStats.ts");
    expect(yours).toMatch(/export function computeSimpleRoi/);
    expect(yours).toMatch(/stake \+= 1/);
    expect(src("components/ux/HistoryTrustSection.tsx")).toMatch(/computeSimpleRoi/);
    expect(src("components/TrackRecordSection.tsx")).toMatch(/trackRecordService|public-track/);
    expect(E.perf.modelSub).toMatch(/all accounts/);
    expect(E.dash.yieldRoiHint).toMatch(/unit/);
  });
});

describe("UX-E · Tickets", () => {
  it("[16][17][18] Tickets is a destination composing the existing builder and history under two labelled parts", () => {
    expect(APP_NAV_ITEMS.some((i) => i.id === "tickets" && i.slug === "tickets")).toBe(true);
    expect(DESKTOP_SECONDARY_NAV_ITEMS.map((i) => i.id)).toEqual(["tickets"]);
    render(<TicketsSection betDate={TODAY} favoriteLeagueIds={[39]} canUseGlobalSpecialBet />);
    // Redesign: the builder is closed until the one primary action asks for it.
    expect(screen.queryByTestId("gsb-builder")).toBeNull();
    fireEvent.click(screen.getByTestId("tickets-build-cta"));
    expect(screen.getByTestId("tickets-build").contains(screen.getByTestId("gsb-builder"))).toBe(true);
    expect(screen.getByTestId("tickets-history").contains(screen.getByTestId("gsb-history"))).toBe(true);
    expect(screen.getByTestId("tickets-build").textContent).toMatch(new RegExp(`${esc(E.tickets.buildTitle)}|${esc(R.tickets.buildTitle)}`));
    expect(screen.getByTestId("tickets-history").textContent).toMatch(new RegExp(`${esc(E.tickets.historyTitle)}|${esc(R.tickets.historyTitle)}`));
  });

  it("[19][20] one builder and one history implementation in the consumer tree", () => {
    for (const rel of ["components/ux/HomeSection.tsx", "components/ux/HistorySection.tsx", "components/ux/MatchesSection.tsx", "pages/UserDashboard.tsx"]) {
      expect(src(rel), rel).not.toMatch(/<GlobalSpecialBetSection|<GlobalSpecialBetHistory/);
    }
    const tickets = src("components/ux/TicketsSection.tsx");
    expect((tickets.match(/<GlobalSpecialBetSection/g) || []).length).toBe(1);
    expect((tickets.match(/<GlobalSpecialBetHistory/g) || []).length).toBe(1);
  });

  it("[21][22] Match Detail keeps the per-match builder as a collapsed ticket row; Results only links", () => {
    const modal = src("components/MatchModal.tsx");
    expect(modal).toMatch(/data-layer="specialBet"/);
    expect(modal).toMatch(/title=\{tr\("detail\.ticketTitle"\)\}/);
    expect(E.detail.ticketTitle).toMatch(/ticket/i);
    expect(src("components/ux/HistorySection.tsx")).toMatch(/onGoTickets/);
  });

  it("one user-facing name: no 'Special Bet' reaches a rendered string in either catalogue", () => {
    for (const [name, dict] of [
      ["en", en],
      ["ro", ro]
    ] as const) {
      const leaves: string[] = [];
      const walk = (node: unknown) => {
        if (typeof node === "string") leaves.push(node);
        else if (node && typeof node === "object") Object.values(node as Record<string, unknown>).forEach(walk);
      };
      walk(dict);
      expect(leaves.filter((l) => /special bet|pariu special/i.test(l)), name).toEqual([]);
    }
  });
});

describe("UX-E · accessibility and i18n", () => {
  it("[23][24] date controls and filters are buttons; the day is aria-current; accordions expose aria-expanded/controls", () => {
    renderResults();
    const nav = screen.getByTestId("results-day-nav");
    expect(nav.querySelectorAll("button").length).toBeGreaterThanOrEqual(2);
    expect(nav.querySelector("[aria-current='date']")).toBeTruthy();
    for (const b of screen.getByTestId("results-controls").querySelectorAll("[aria-pressed]")) {
      expect(b.tagName).toBe("BUTTON");
    }
    cleanup();
    render(<StatisticsSection trackerSlot={<div />} history={[]} />);
    const accordions = document.querySelectorAll("button[aria-expanded]");
    expect(accordions.length).toBeGreaterThanOrEqual(2);
    for (const b of accordions) expect(b.getAttribute("aria-controls")).toBeTruthy();
  });

  it("[25] every new label exists in RO and EN", () => {
    const keys: [string, string[]][] = [
      ["history", ["dayNav", "dayPrev", "dayNext", "dayToday", "dayYesterday", "daySummary", "dayPending", "ticketResults", "emptyDayTitle", "emptyFilteredTitle"]],
      ["perf", ["viewResults", "breakdownTitle", "reliabilityTitle"]],
      ["tickets", ["buildTitle", "historyTitle", "buildSub", "historySub"]]
    ];
    for (const [ns, list] of keys) {
      for (const key of list) {
        expect(E[ns][key], `${ns}.${key}`).toBeTypeOf("string");
        expect(R[ns][key], `${ns}.${key}`).toBeTypeOf("string");
      }
    }
  });
});
