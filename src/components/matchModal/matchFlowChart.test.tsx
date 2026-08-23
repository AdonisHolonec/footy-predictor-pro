import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import LiveLayer from "./LiveLayer";
import { MARKER_MAX_LANES } from "../../utils/matchFlow";
import { translate } from "../../i18n/translate";
import { ro } from "../../i18n/ro";
import type { MomentumHistoryPoint, MomentumRawStats, PredictionRow } from "../../types";

/**
 * MATCH FLOW in the rendered modal: the axis carries the derived series AND the real
 * events, at their real minutes, without either becoming the other.
 */

type Leaves = Record<string, Record<string, string>>;
const R = ro as unknown as Leaves;
const tr = (key: string, params?: Record<string, string | number>) => translate("ro", key, params);

const stats = (
  shotsTotal: number,
  shotsOnTarget: number,
  corners: number,
  yellowCards = 0,
  redCards = 0,
  possession = 50
): MomentumRawStats => ({ possession, shotsTotal, shotsOnTarget, corners, yellowCards, redCards });

const pt = (
  minute: number,
  homeMomentum: number,
  home: MomentumRawStats,
  away: MomentumRawStats
): MomentumHistoryPoint => ({ minute, homeMomentum, awayMomentum: 100 - homeMomentum, raw: { home, away } });

/** Away leads the totals throughout; the intervals still change hands. */
const HISTORY: MomentumHistoryPoint[] = [
  pt(40, 30, stats(2, 1, 0), stats(6, 2, 4, 1)),
  pt(48, 34, stats(4, 2, 2), stats(7, 2, 4, 1)),
  pt(56, 28, stats(4, 2, 2, 1), stats(11, 4, 6, 1)),
  pt(63, 26, stats(5, 2, 2, 1), stats(12, 4, 6, 1))
];

const EVENTS = [
  { minute: 22, extra: null, team: "away", type: "goal", player: "Bremer" },
  { minute: 43, extra: null, team: "home", type: "yellow", player: "R. Schmid" },
  { minute: 46, extra: null, team: "away", type: "substitution", player: "O. Popescu" },
  { minute: 47, extra: null, team: "away", type: "var", player: null },
  { minute: 58, extra: null, team: "home", type: "red", player: "M. Camora" }
];

function match(extra: Record<string, unknown> = {}): PredictionRow {
  return {
    id: 1607999,
    leagueId: 135,
    league: "Serie A",
    teams: { home: "Frosinone", away: "Juventus" },
    kickoff: "2026-08-23T17:30:00.000Z",
    status: "2H",
    logos: { home: "", away: "" },
    score: { home: 0, away: 1, minute: 63 },
    probs: { p1: 20, pX: 28, p2: 52, pGG: 45, pO25: 50, pU35: 70, pO15: 78 },
    predictions: { oneXtwo: "2", gg: "NG", over25: "Under 2.5", correctScore: "0-1" },
    recommended: { pick: "Shots Under 30.5", family: "Shots", confidence: 91, odd: 1.5 },
    momentum: {
      homeMomentum: 26,
      awayMomentum: 74,
      dominantTeam: "away",
      trend: "stable",
      confidence: 70,
      raw: { home: stats(5, 2, 2, 1), away: stats(12, 4, 6, 1) },
      history: HISTORY
    },
    liveEvents: EVENTS,
    ...extra
  } as unknown as PredictionRow;
}

function renderFlow(row: PredictionRow = match()) {
  render(<LiveLayer match={row} tr={tr} hasLiveScore confidenceLabel="91%" recommendedPick="Shots Under 30.5" />);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${R.card.momentum}`) }));
}

const markers = () =>
  Array.from(
    screen.getByTestId("momentum-events").querySelectorAll<HTMLElement>("[data-testid='momentum-event-marker']")
  );
const bars = () => Array.from(screen.getByTestId("momentum-chart").querySelectorAll<HTMLElement>("[data-side]"));
const openPanel = (title: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${title}`) }));

afterEach(cleanup);

describe("H/I/J/K — every event kind reaches the axis, on the right side", () => {
  it("goal, yellow, red, substitution and VAR each render a marker", () => {
    renderFlow();
    expect(markers().map((m) => m.dataset.kind)).toEqual(["goal", "yellow", "substitution", "var", "red"]);
  });

  it("a marker belongs to the team that caused it", () => {
    renderFlow();
    const byKind = Object.fromEntries(markers().map((m) => [m.dataset.kind, m]));
    expect(byKind.goal.dataset.team).toBe("away");
    expect(byKind.yellow.dataset.team).toBe("home");
    expect(byKind.red.dataset.team).toBe("home");
    expect(byKind.goal.style.borderBottomColor).toBe("var(--fp-momentum-away)");
    expect(byKind.yellow.style.borderBottomColor).toBe("var(--fp-momentum-home)");
  });

  it("[F] markers sit at their real minute, not at an index", () => {
    renderFlow();
    const goal = markers().find((m) => m.dataset.kind === "goal")!;
    // 22' of a 90' axis.
    expect(goal.style.left).toBe(`${(22 / 90) * 100}%`);
  });

  it("[G] neighbouring minutes stack rather than overlap", () => {
    renderFlow();
    // 43', 46' and 47' all fall inside one marker's width of each other, so each takes
    // its own lane instead of three icons landing on the same spot.
    const byKind = Object.fromEntries(markers().map((m) => [m.dataset.kind, m]));
    expect([byKind.yellow.dataset.lane, byKind.substitution.dataset.lane, byKind.var.dataset.lane]).toEqual([
      "0",
      "1",
      "2"
    ]);
    expect(new Set([byKind.yellow.style.top, byKind.substitution.style.top, byKind.var.style.top]).size).toBe(3);
    // A well-separated event drops back to the first lane.
    expect(byKind.goal.dataset.lane).toBe("0");
  });

  it("every marker names its team, minute and kind for assistive tech", () => {
    renderFlow();
    for (const m of markers()) {
      const label = m.getAttribute("aria-label") || "";
      expect(label).toMatch(/Frosinone|Juventus/);
      expect(label).toMatch(/\d+'/);
      expect(label.length).toBeGreaterThan(8);
    }
  });
});

describe("L — corners are a statistic here, never a marker", () => {
  it("the axis legend offers no corner entry even though the match had nine", () => {
    renderFlow();
    const legend = screen.getByTestId("momentum-event-legend").textContent || "";
    expect(legend).toContain(R.match.eventGoal);
    expect(legend).toContain(R.match.eventYellow);
    expect(legend).not.toContain(R.match.momentumCorners);
    expect(markers().some((m) => m.dataset.kind === "corner")).toBe(false);
  });

  it("the corner count still lives in LIVE STATS, labelled", () => {
    renderFlow();
    openPanel(R.detail.statsTitle);
    const rows = Array.from(
      document.querySelector("[data-slot='live-stats']")!.querySelectorAll<HTMLElement>(":scope > div")
    );
    const corners = rows.find((r) => (r.children[2] as HTMLElement).textContent === R.match.momentumCorners)!;
    expect(corners).toBeTruthy();
    expect(corners.textContent).toMatch(/2.*Cornere.*6/);
  });
});

describe("M/N/O — the axis reads as a match clock", () => {
  it("[M] the live minute is marked on the chart", () => {
    renderFlow();
    expect(screen.getByTestId("momentum-now").style.left).toBe(`${(63 / 90) * 100}%`);
  });

  it("[O] half time is named on the axis, not numbered", () => {
    renderFlow();
    const text = screen.getByTestId("momentum-root").textContent || "";
    expect(text).toContain(R.match.momentumHalfTime);
    expect(text).not.toContain("45'");
  });

  it("[N] so is full time, while the axis still ends at regulation", () => {
    renderFlow();
    const text = screen.getByTestId("momentum-root").textContent || "";
    expect(text).toContain(R.match.momentumFullTime);
    expect(text).not.toContain("90'");
  });

  it("added time past 90' makes it an ordinary minute again — nothing is called full time early", () => {
    renderFlow(
      match({
        score: { home: 0, away: 1, minute: 94 },
        liveEvents: [{ minute: 90, extra: 4, team: "home", type: "goal", player: "Late" }]
      })
    );
    const text = screen.getByTestId("momentum-root").textContent || "";
    expect(text).toContain("90'");
    expect(text).not.toContain(R.match.momentumFullTime);
  });
});

describe("C/T in the DOM — the chart alternates instead of painting one colour", () => {
  it("both teams own bars, and a quiet interval sits on the axis", () => {
    renderFlow();
    const sides = bars().map((b) => b.dataset.side);
    expect(sides).toContain("home");
    expect(sides).toContain("away");
    expect(sides).toContain("neutral");
  });

  it("the away side leads every cumulative total in this fixture, and still does not own every bar", () => {
    renderFlow();
    expect(bars().filter((b) => b.dataset.side === "home").length).toBeGreaterThan(0);
  });

  it("alternating initiative alternates ACROSS the axis: away above, home below, level straddling", () => {
    renderFlow();
    // [upper half, lower half] per column — which half is filled is the whole message.
    const filled = (b: HTMLElement) => [
      b.children[0].querySelector("span") != null,
      b.children[1].querySelector("span") != null
    ];
    for (const bar of bars()) {
      const [above, below] = filled(bar);
      if (bar.dataset.side === "away") expect([above, below], "away sits above").toEqual([true, false]);
      if (bar.dataset.side === "home") expect([above, below], "home sits below").toEqual([false, true]);
      if (bar.dataset.side === "neutral") expect([above, below], "level straddles").toEqual([true, true]);
    }
    // Both directions really occur in this fixture, so the assertions above are not vacuous.
    const sides = bars().map((b) => b.dataset.side);
    expect(sides.filter((s) => s === "away").length).toBeGreaterThan(0);
    expect(sides.filter((s) => s === "home").length).toBeGreaterThan(0);
  });

  it("the legend says which half is whose, in the same order as the chart", () => {
    renderFlow();
    const root = screen.getByTestId("momentum-root");
    const order = (Array.from(root.querySelectorAll("[data-testid]")) as HTMLElement[]).map((n) => n.dataset.testid);
    expect(order.indexOf("momentum-legend-away")).toBeLessThan(order.indexOf("momentum-chart"));
    expect(order.indexOf("momentum-chart")).toBeLessThan(order.indexOf("momentum-legend-home"));
    expect(screen.getByTestId("momentum-legend-away").textContent).toContain("Juventus");
    expect(screen.getByTestId("momentum-legend-home").textContent).toContain("Frosinone");
  });

  it("event markers are independent of bar direction — they stay on the time axis", () => {
    renderFlow();
    // A home event and an away event both live in the same marker strip, outside the
    // chart's two halves: markers report WHAT happened, bars report WHO was on top.
    const strip = screen.getByTestId("momentum-events");
    const home = markers().find((m) => m.dataset.kind === "red")!;
    const away = markers().find((m) => m.dataset.kind === "goal")!;
    expect(strip.contains(home)).toBe(true);
    expect(strip.contains(away)).toBe(true);
    expect(screen.getByTestId("momentum-chart").contains(home)).toBe(false);
    expect(home.style.top).toBe(away.style.top);
  });
});

describe("U — the axis is not a second events list, and not a second stats panel", () => {
  it("markers carry no visible text; the readable detail stays in EVENIMENTE", () => {
    renderFlow();
    for (const m of markers()) {
      expect(m.textContent).not.toMatch(/Bremer|Schmid|Camora/);
      expect(m.textContent!.trim().length).toBeLessThanOrEqual(2);
    }
    openPanel(R.detail.eventsTitle);
    expect(document.querySelectorAll("[data-slot='live-events'] li")).toHaveLength(EVENTS.length);
    expect(document.querySelector("[data-slot='live-events']")!.textContent).toMatch(/Bremer/);
  });

  it("no live-stat numbers are repeated inside the momentum block", () => {
    renderFlow();
    openPanel(R.detail.statsTitle);
    const root = screen.getByTestId("momentum-root").textContent || "";
    expect(root).not.toMatch(/Posesie \d/);
    expect(root).not.toMatch(/Pe poartă \d/);
    expect(document.querySelectorAll("[data-slot='live-stats']")).toHaveLength(1);
  });
});

describe("V — geometry invariants that must hold at any width", () => {
  it("nothing is positioned outside the axis and no bar has invalid geometry", () => {
    renderFlow();
    for (const m of markers()) {
      const pct = Number.parseFloat(m.style.left);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
      expect(Number(m.dataset.lane)).toBeLessThan(MARKER_MAX_LANES);
    }
    for (const b of bars()) {
      expect(b.style.flexGrow).toMatch(/^\d+$/);
      for (const fill of b.querySelectorAll<HTMLElement>("span")) {
        expect(fill.style.height).toMatch(/^\d+(\.\d+)?%$/);
      }
    }
  });

  it("the marker strip grows by lanes only, so it cannot silently become a tall band", () => {
    renderFlow();
    const strip = screen.getByTestId("momentum-events");
    const lanes = Math.max(...markers().map((m) => Number(m.dataset.lane))) + 1;
    expect(strip.style.height).toBe(`${lanes * 18}px`);
    expect(lanes).toBeLessThanOrEqual(MARKER_MAX_LANES);
  });

  it("the chart still owns no scroll container of its own", () => {
    renderFlow();
    const chart = screen.getByTestId("momentum-chart");
    expect(chart.className).not.toMatch(/overflow-(x|y)?-?(auto|scroll)/);
    expect(chart.className).toContain("w-full");
  });
});

describe("partial history is stated, never filled in", () => {
  it("the series starts at the first reading and says so", () => {
    renderFlow();
    expect(screen.getByTestId("momentum-partial").textContent).toContain("40");
    expect(screen.getByTestId("momentum-unobserved").style.flexGrow).toBe("40");
  });

  it("but the events before it are still on the axis — they are real", () => {
    renderFlow();
    const early = markers().filter((m) => Number.parseFloat(m.style.left) < (40 / 90) * 100);
    expect(early.length).toBeGreaterThan(0);
    expect(early.map((m) => m.dataset.kind)).toContain("goal");
  });
});
