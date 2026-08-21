import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MatchMomentumTimeline, {
  buildTimelineSegments,
  findDominantPeriod,
  threatLevel,
  THREAT_HEIGHT_PCT
} from "./MatchMomentumTimeline";
import type { PredictionRow } from "../../types";

/**
 * Presentation-layer tests for the mirrored momentum chart.
 * Business logic (MomentumEngine scoring, event parsing, history accumulation
 * rules) is intentionally NOT asserted here — see tests/momentumEngine.test.js.
 */

type Momentum = NonNullable<PredictionRow["momentum"]>;

function momentumAt(home: number): Momentum {
  return {
    homeMomentum: home,
    awayMomentum: 100 - home,
    dominantTeam: home - (100 - home) > 10 ? "home" : (100 - home) - home > 10 ? "away" : "balanced",
    trend: "stable",
    confidence: 80
  };
}

function baseProps(minute: number, home: number) {
  return {
    fixtureId: 42,
    status: "1H",
    score: { home: 0, away: 0, minute },
    momentum: momentumAt(home),
    homeTeam: "Steaua",
    awayTeam: "Dinamo",
    recommendedPick: "Over 2.5",
    confidenceLabel: "72%"
  };
}

afterEach(cleanup);

describe("buildTimelineSegments (pure presentation mapping)", () => {
  it("classifies segments with the engine's ±10pp dominance threshold", () => {
    const segments = buildTimelineSegments([
      { minute: 10, homeMomentum: 70, awayMomentum: 30 },
      { minute: 20, homeMomentum: 30, awayMomentum: 70 },
      { minute: 30, homeMomentum: 52, awayMomentum: 48 }
    ]);
    expect(segments.map((s) => s.side)).toEqual(["home", "away", "neutral"]);
  });

  it("preserves chronological ordering and real interval durations", () => {
    const segments = buildTimelineSegments([
      { minute: 5, homeMomentum: 70, awayMomentum: 30 },
      { minute: 25, homeMomentum: 70, awayMomentum: 30 },
      { minute: 30, homeMomentum: 30, awayMomentum: 70 }
    ]);
    expect(segments.map((s) => [s.fromMinute, s.toMinute])).toEqual([
      [0, 5],
      [5, 25],
      [25, 30]
    ]);
    // Duration → width mapping input: 5, 20 and 5 minutes respectively.
    expect(segments.map((s) => s.toMinute - s.fromMinute)).toEqual([5, 20, 5]);
  });

  it("maps dominance magnitude into 0..1 without altering the underlying numbers", () => {
    const [seg] = buildTimelineSegments([{ minute: 10, homeMomentum: 80, awayMomentum: 20 }]);
    expect(seg.magnitude).toBeCloseTo(0.6);
    expect(seg.homeMomentum).toBe(80);
    expect(seg.awayMomentum).toBe(20);
  });

  it("empty history produces no segments", () => {
    expect(buildTimelineSegments([])).toEqual([]);
  });
});

/**
 * The mirrored chart: one bar per observed interval, home above a central baseline and
 * away below it, height = threat.
 *
 * Every guarantee the previous flat strip carried is re-asserted here against the new
 * markup — chronological side order, minute-proportional widths, per-bar labels, no
 * card-in-card surface, no overflow mechanics. The visual changed; the contract did not.
 */
function bars(): HTMLElement[] {
  return Array.from(screen.getByTestId("momentum-chart").querySelectorAll<HTMLElement>("[data-side]"));
}

describe("MatchMomentumTimeline — mirrored momentum chart", () => {
  it("renders home/away/neutral intervals in chronological order", () => {
    const { rerender } = render(<MatchMomentumTimeline {...baseProps(10, 70)} />);
    rerender(<MatchMomentumTimeline {...baseProps(20, 30)} />);
    rerender(<MatchMomentumTimeline {...baseProps(30, 52)} />);
    expect(bars().map((b) => b.dataset.side)).toEqual(["home", "away", "neutral"]);
  });

  it("puts the home bar above the baseline and the away bar below it", () => {
    const { rerender } = render(<MatchMomentumTimeline {...baseProps(10, 80)} />);
    rerender(<MatchMomentumTimeline {...baseProps(20, 20)} />);
    const [home, away] = bars();
    // Each column is [upper half, lower half]; the filled span tells us which side.
    expect(home.children[0].querySelector("span")).not.toBeNull();
    expect(home.children[1].querySelector("span")).toBeNull();
    expect(away.children[0].querySelector("span")).toBeNull();
    expect(away.children[1].querySelector("span")).not.toBeNull();
  });

  it("draws a balanced interval symmetrically about the axis, not as an away bar", () => {
    // Below-the-line is the away identity. A neutral stub rendered only underneath read
    // as "the away side had that spell" when the engine had called the minute level.
    render(<MatchMomentumTimeline {...baseProps(10, 51)} />);
    const [neutral] = bars();
    expect(neutral.dataset.side).toBe("neutral");
    const above = neutral.children[0].querySelector("span") as HTMLElement | null;
    const below = neutral.children[1].querySelector("span") as HTMLElement | null;
    expect(above, "balanced interval has no stub above the axis").not.toBeNull();
    expect(below, "balanced interval has no stub below the axis").not.toBeNull();
    expect(above!.style.height).toBe(below!.style.height);
    // And it stays quieter than a real team bar.
    expect(Number(above!.style.opacity)).toBeLessThan(0.62);
  });

  it("uses the momentum identity colours, gold for home and the light partner for away", () => {
    const { rerender } = render(<MatchMomentumTimeline {...baseProps(10, 80)} />);
    rerender(<MatchMomentumTimeline {...baseProps(20, 20)} />);
    const [home, away] = bars();
    expect(home.querySelector("span")!.style.background).toContain("--fp-momentum-home");
    expect(away.querySelector("span")!.style.background).toContain("--fp-momentum-away");
  });

  it("bar height rises across the three threat levels", () => {
    // 52 vs 48 -> 4pp (balanced), 60 vs 40 -> 20pp (medium), 90 vs 10 -> 80pp (high).
    const { rerender } = render(<MatchMomentumTimeline {...baseProps(10, 52)} />);
    rerender(<MatchMomentumTimeline {...baseProps(20, 60)} />);
    rerender(<MatchMomentumTimeline {...baseProps(30, 90)} />);
    const [low, medium, high] = bars();
    expect(low.dataset.level).toBe("low");
    expect(medium.dataset.level).toBe("medium");
    expect(high.dataset.level).toBe("high");
    const h = (el: HTMLElement) => parseFloat(el.querySelector("span")!.style.height);
    expect(h(medium)).toBeGreaterThan(h(low));
    expect(h(high)).toBeGreaterThan(h(medium));
  });

  it("threatLevel reuses the engine threshold for the low cut and never invents dominance", () => {
    // 10pp is DOMINANCE_THRESHOLD_PP — at or below it the bar is the shortest.
    expect(threatLevel({ side: "home", magnitude: 0.1 })).toBe("low");
    expect(threatLevel({ side: "home", magnitude: 0.101 })).toBe("medium");
    expect(threatLevel({ side: "home", magnitude: 0.3 })).toBe("medium");
    expect(threatLevel({ side: "home", magnitude: 0.31 })).toBe("high");
    // A balanced interval is never promoted to a team-coloured threat.
    expect(threatLevel({ side: "neutral", magnitude: 0.9 })).toBe("low");
    expect(THREAT_HEIGHT_PCT.low).toBeLessThan(THREAT_HEIGHT_PCT.medium);
    expect(THREAT_HEIGHT_PCT.medium).toBeLessThan(THREAT_HEIGHT_PCT.high);
  });

  it("gives the most recent interval the strongest emphasis", () => {
    const { rerender } = render(<MatchMomentumTimeline {...baseProps(10, 80)} />);
    rerender(<MatchMomentumTimeline {...baseProps(20, 80)} />);
    const all = bars();
    const latest = all[all.length - 1];
    const older = all[0];
    expect(latest.dataset.latest).toBe("true");
    expect(older.dataset.latest).toBeUndefined();
    expect(Number(latest.querySelector("span")!.style.opacity)).toBeGreaterThan(
      Number(older.querySelector("span")!.style.opacity)
    );
  });

  it("bar widths still grow with the real minute interval they cover", () => {
    const { rerender } = render(<MatchMomentumTimeline {...baseProps(5, 70)} />);
    rerender(<MatchMomentumTimeline {...baseProps(25, 70)} />);
    expect(bars().map((b) => b.style.flexGrow)).toEqual(["5", "20"]);
  });

  it("each bar still carries a minute/team label", () => {
    const { rerender } = render(<MatchMomentumTimeline {...baseProps(10, 70)} />);
    rerender(<MatchMomentumTimeline {...baseProps(20, 30)} />);
    const [home, away] = bars();
    expect(home.title).toContain("Steaua");
    expect(home.title).toContain("10");
    expect(away.title).toContain("Dinamo");
  });

  it("renders a single interval without a layout collapse", () => {
    render(<MatchMomentumTimeline {...baseProps(10, 80)} />);
    expect(bars()).toHaveLength(1);
    expect(screen.getByTestId("momentum-chart")).toBeTruthy();
  });

  it("renders nothing at all while there is no momentum history yet", () => {
    render(
      <MatchMomentumTimeline
        {...{ ...baseProps(0, 50), score: { home: 0, away: 0, minute: null as unknown as number } }}
      />
    );
    expect(screen.queryByTestId("momentum-root")).toBeNull();
  });

  it("the momentum block and the chart have no opaque surface of their own", () => {
    render(<MatchMomentumTimeline {...baseProps(10, 70)} />);
    for (const el of [screen.getByTestId("momentum-root"), screen.getByTestId("momentum-chart")]) {
      expect(el.className).toContain("bg-transparent");
      expect(el.className).not.toMatch(/bg-\[var\(--fp-bg/);
      expect(el.className).not.toMatch(/(^|\s)border(\s|-\[)/);
      expect(el.className).not.toContain("shadow");
    }
  });

  it("the chart fills its container without horizontal overflow mechanics", () => {
    render(<MatchMomentumTimeline {...baseProps(10, 70)} />);
    const chart = screen.getByTestId("momentum-chart");
    expect(chart.className).toContain("w-full");
    expect(chart.className).not.toContain("overflow-x");
    // flex-basis 0 + flex-grow means the columns always share the row, so the chart
    // cannot exceed its container at 390 / 430 / 768 / desktop.
    for (const b of bars()) expect(b.style.flexBasis).toBe("0px");
  });

  it("does not mutate the momentum data it renders", () => {
    const momentum = momentumAt(70);
    const frozen = JSON.stringify(momentum);
    render(<MatchMomentumTimeline {...{ ...baseProps(10, 70), momentum }} />);
    expect(JSON.stringify(momentum)).toBe(frozen);
  });
});

describe("dominant period — grouping only, never new dominance logic", () => {
  const seg = (fromMinute: number, toMinute: number, side: "home" | "away" | "neutral") => ({
    fromMinute,
    toMinute,
    side,
    magnitude: 0.5,
    homeMomentum: 60,
    awayMomentum: 40
  });

  it("returns the longest unbroken run belonging to the dominant team", () => {
    const period = findDominantPeriod(
      [seg(0, 5, "home"), seg(5, 10, "away"), seg(10, 40, "home"), seg(40, 45, "home")],
      "home"
    );
    expect(period).toEqual({ fromMinute: 10, toMinute: 45, side: "home" });
  });

  it("follows the engine dominantTeam rather than picking a winner itself", () => {
    const segments = [seg(0, 30, "home"), seg(30, 40, "away")];
    expect(findDominantPeriod(segments, "away")).toEqual({ fromMinute: 30, toMinute: 40, side: "away" });
    expect(findDominantPeriod(segments, "balanced")).toBeNull();
  });

  it("has no period when the dominant team never held one", () => {
    expect(findDominantPeriod([seg(0, 30, "neutral")], "home")).toBeNull();
    expect(findDominantPeriod([], "home")).toBeNull();
  });

  it("annotates the dominant period on the chart when one exists", () => {
    const { rerender } = render(<MatchMomentumTimeline {...baseProps(10, 80)} />);
    rerender(<MatchMomentumTimeline {...baseProps(40, 80)} />);
    expect(screen.getByTestId("momentum-dominant-bracket")).toBeTruthy();
    expect(screen.getByTestId("momentum-dominant-label").textContent).toContain("Steaua");
  });

  it("shows no annotation for a balanced match", () => {
    render(<MatchMomentumTimeline {...baseProps(10, 50)} />);
    expect(screen.queryByTestId("momentum-dominant-bracket")).toBeNull();
    expect(screen.queryByTestId("momentum-dominant-label")).toBeNull();
  });
});

describe("accessibility — meaning survives without colour or position", () => {
  it("the chart carries a textual summary naming side, threat and period", () => {
    const { rerender } = render(<MatchMomentumTimeline {...baseProps(10, 90)} />);
    rerender(<MatchMomentumTimeline {...baseProps(40, 90)} />);
    const label = screen.getByTestId("momentum-chart").getAttribute("aria-label") || "";
    expect(label.length).toBeGreaterThan(20);
    // Threat and dominant period are stated in words, not only encoded in the bars.
    expect(label).toMatch(/High|Ridicat/);
    expect(label).toContain("Steaua");
  });

  it("the summary reports a balanced match without claiming a dominant team", () => {
    render(<MatchMomentumTimeline {...baseProps(10, 50)} />);
    const label = screen.getByTestId("momentum-chart").getAttribute("aria-label") || "";
    expect(label).toMatch(/Balanced|Echilibrat/);
    expect(label).not.toMatch(/Dominant period|Perioadă de dominare/);
  });

  it("uses no hard-coded English — every fragment comes from the catalogue", async () => {
    const { en } = await import("../../i18n/en");
    const m = en.match as unknown as Record<string, string>;
    for (const key of [
      "momentumHowToRead",
      "momentumThreatLow",
      "momentumThreatMedium",
      "momentumThreatHigh",
      "momentumCurrentThreat",
      "momentumDominantPeriod"
    ]) {
      expect(typeof m[key], `missing i18n key: match.${key}`).toBe("string");
    }
  });
});

describe("responsive — mobile first", () => {
  it("hides the explanatory copy below desktop and keeps the graph", () => {
    render(<MatchMomentumTimeline {...baseProps(10, 70)} />);
    const explain = screen.getByText(/Bar direction shows|Direcţia barei/);
    // Present in the DOM for desktop, hidden until lg — never occupying mobile height.
    expect(explain.className).toContain("hidden");
    expect(explain.className).toContain("lg:block");
  });

  it("keeps the dominant-period wording desktop-only but the team name always visible", () => {
    const { rerender } = render(<MatchMomentumTimeline {...baseProps(10, 80)} />);
    rerender(<MatchMomentumTimeline {...baseProps(40, 80)} />);
    const label = screen.getByTestId("momentum-dominant-label");
    expect(label.textContent).toContain("Steaua");
    expect(label.querySelector(".hidden.sm\\:inline")).not.toBeNull();
  });

  it("scales the chart height up from mobile to desktop", () => {
    render(<MatchMomentumTimeline {...baseProps(10, 70)} />);
    const row = screen.getByTestId("momentum-chart").querySelector<HTMLElement>(".flex.h-\\[68px\\]");
    expect(row, "mobile chart height not found").not.toBeNull();
    expect(row!.className).toContain("sm:h-[92px]");
  });
});

