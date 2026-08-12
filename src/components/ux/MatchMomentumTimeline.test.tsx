import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MatchMomentumTimeline, { buildTimelineSegments } from "./MatchMomentumTimeline";
import type { PredictionRow } from "../../types";

/**
 * Presentation-layer tests for the transparent segmented momentum timeline.
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

describe("MatchMomentumTimeline — transparent segmented strip", () => {
  it("renders home/away/neutral segments in chronological order with team-identity colors", () => {
    const { rerender } = render(<MatchMomentumTimeline {...baseProps(10, 70)} />);
    rerender(<MatchMomentumTimeline {...baseProps(20, 30)} />);
    rerender(<MatchMomentumTimeline {...baseProps(30, 52)} />);

    const strip = screen.getByTestId("momentum-strip");
    const segments = Array.from(strip.querySelectorAll<HTMLElement>("[data-side]"));
    expect(segments.map((s) => s.dataset.side)).toEqual(["home", "away", "neutral"]);

    // Team identity comes from the app-wide Home/Away tokens, never a generic pair.
    expect(segments[0].className).toContain("bg-[var(--fp-accent)]");
    expect(segments[1].className).toContain("bg-[var(--fp-danger)]");
    // Neutral is a discreet low-opacity treatment, not a team colour.
    expect(segments[2].className).not.toContain("fp-accent");
    expect(segments[2].className).not.toContain("fp-danger");
    expect(Number(segments[2].style.opacity)).toBeLessThan(0.3);
  });

  it("segment widths grow with the real minute interval they cover", () => {
    const { rerender } = render(<MatchMomentumTimeline {...baseProps(5, 70)} />);
    rerender(<MatchMomentumTimeline {...baseProps(25, 70)} />);

    const strip = screen.getByTestId("momentum-strip");
    const segments = Array.from(strip.querySelectorAll<HTMLElement>("[data-side]"));
    expect(segments.map((s) => s.style.flexGrow)).toEqual(["5", "20"]);
  });

  it("each segment carries an accessible minute/team label", () => {
    const { rerender } = render(<MatchMomentumTimeline {...baseProps(10, 70)} />);
    rerender(<MatchMomentumTimeline {...baseProps(20, 30)} />);

    const strip = screen.getByTestId("momentum-strip");
    const segments = Array.from(strip.querySelectorAll<HTMLElement>("[data-side]"));
    expect(segments[0].title).toContain("Steaua");
    expect(segments[0].title).toContain("10");
    expect(segments[1].title).toContain("Dinamo");
    expect(segments[0].getAttribute("aria-label")).toBe(segments[0].title);
  });

  it("renders nothing at all while there is no momentum history yet", () => {
    render(
      <MatchMomentumTimeline
        {...{ ...baseProps(0, 50), score: { home: 0, away: 0, minute: null as unknown as number } }}
      />
    );
    expect(screen.queryByTestId("momentum-root")).toBeNull();
  });

  it("the momentum block and the strip have no opaque background of their own", () => {
    render(<MatchMomentumTimeline {...baseProps(10, 70)} />);

    const root = screen.getByTestId("momentum-root");
    const strip = screen.getByTestId("momentum-strip");
    for (const el of [root, strip]) {
      expect(el.className).toContain("bg-transparent");
      // No card treatment: no solid background, border, or shadow utilities.
      expect(el.className).not.toMatch(/bg-\[var\(--fp-bg/);
      expect(el.className).not.toMatch(/(^|\s)border(\s|-\[)/);
      expect(el.className).not.toContain("shadow");
    }
  });

  it("the strip fills its container without horizontal overflow mechanics", () => {
    render(<MatchMomentumTimeline {...baseProps(10, 70)} />);
    const strip = screen.getByTestId("momentum-strip");
    expect(strip.className).toContain("w-full");
    expect(strip.className).not.toContain("overflow-x");
    // Segments are flex-basis 0 + flex-grow, so they always share the row — the
    // strip can never exceed its container at 390 / 768 / 1440 px.
    const segments = Array.from(strip.querySelectorAll<HTMLElement>("[data-side]"));
    for (const seg of segments) expect(seg.style.flexBasis).toBe("0px");
  });

  it("does not mutate the momentum data it renders", () => {
    const momentum = momentumAt(70);
    const frozen = JSON.stringify(momentum);
    render(<MatchMomentumTimeline {...{ ...baseProps(10, 70), momentum }} />);
    expect(JSON.stringify(momentum)).toBe(frozen);
  });
});
