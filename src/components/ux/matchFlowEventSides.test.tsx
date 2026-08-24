import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MatchMomentumTimeline from "./MatchMomentumTimeline";
import { MARKER_MAX_LANES } from "../../utils/matchFlow";
import type { MatchLiveEvent, MomentumHistoryPoint, MomentumRawStats, PredictionRow } from "../../types";

/**
 * EVENT MARKERS BELONG TO THEIR TEAM'S HALF.
 *
 * The regression this file exists for: Bologna–Lazio rendered every marker — Lazio's three
 * yellows and its substitution included — below the axis, inside the home half, because the
 * marker layer computed a horizontal position and a lane and nothing else. Team identity
 * was present the whole way through (api/fixtures.js resolves it from team.id and drops
 * anything it cannot attribute) and was simply never consulted for vertical placement.
 *
 * Every assertion here reads the RENDERED chart, not the layout helper, because the helper
 * was already returning the right event objects while the chart was wrong.
 *
 * jsdom performs no layout, so "above/below the axis" is asserted structurally: the away
 * band is the frame's `top-0` child and the home band its `bottom-0` child, around a chart
 * whose baseline sits at `top-1/2` of symmetric padding. That containment IS the geometry.
 */

type Momentum = NonNullable<PredictionRow["momentum"]>;

const stats = (
  shotsTotal: number,
  shotsOnTarget: number,
  corners: number,
  yellowCards = 0,
  redCards = 0,
  possession = 50
): MomentumRawStats => ({ possession, shotsTotal, shotsOnTarget, corners, yellowCards, redCards });

/** Enough readings for the series to exist; the bars are not what this file is about. */
const HISTORY: MomentumHistoryPoint[] = [
  { minute: 15, homeMomentum: 55, awayMomentum: 45, raw: { home: stats(3, 1, 2), away: stats(2, 1, 1) } },
  { minute: 30, homeMomentum: 48, awayMomentum: 52, raw: { home: stats(5, 2, 3, 1), away: stats(5, 2, 2, 1) } },
  { minute: 45, homeMomentum: 44, awayMomentum: 56, raw: { home: stats(6, 2, 4, 2), away: stats(8, 4, 3, 3) } }
];

const MOMENTUM: Momentum = {
  homeMomentum: 44,
  awayMomentum: 56,
  dominantTeam: "away",
  trend: "stable",
  confidence: 70,
  raw: { home: stats(6, 2, 4, 2), away: stats(8, 4, 3, 3) },
  history: HISTORY
} as unknown as Momentum;

const ev = (
  minute: number,
  team: MatchLiveEvent["team"],
  type: MatchLiveEvent["type"],
  player: string,
  extra: number | null = null
): MatchLiveEvent => ({ minute, extra, team, type, player });

/** The screenshot, transcribed. Bologna at home, Lazio away. */
const BOLOGNA_LAZIO: MatchLiveEvent[] = [
  ev(44, "away", "yellow", "Rovella"),
  ev(41, "home", "yellow", "Freuler"),
  ev(34, "home", "yellow", "Lucumi"),
  ev(34, "away", "yellow", "Guendouzi"),
  ev(22, "away", "yellow", "Romagnoli"),
  ev(19, "away", "substitution", "Castellanos")
];

function renderFlow(liveEvents: MatchLiveEvent[] | undefined, homeTeam = "Bologna", awayTeam = "Lazio") {
  render(
    <MatchMomentumTimeline
      fixtureId={1_234_567}
      status="2H"
      score={{ home: 0, away: 0, minute: 63 }}
      momentum={MOMENTUM}
      homeTeam={homeTeam}
      awayTeam={awayTeam}
      liveEvents={liveEvents}
      recommendedPick="Under 3.5 Cards"
      confidenceLabel="74%"
      detailsPanel={false}
    />
  );
}

const band = (side: "away" | "home" | "neutral") => screen.queryByTestId(`momentum-events-${side}`);
const inBand = (side: "away" | "home" | "neutral") =>
  Array.from(band(side)?.querySelectorAll<HTMLElement>("[data-testid='momentum-event-marker']") ?? []);
const allMarkers = () =>
  Array.from(
    screen.getByTestId("momentum-events").querySelectorAll<HTMLElement>("[data-testid='momentum-event-marker']")
  );
/** "44' Rovella yellow" reduced to something a test can compare. */
const idOf = (m: HTMLElement) => `${m.dataset.kind}@${(m.getAttribute("aria-label") || "").match(/\d+/)?.[0]}`;

afterEach(cleanup);

describe("Bologna-Lazio regression - every marker in its own team's half", () => {
  it("all four Lazio events render ABOVE the axis, in the away band", () => {
    renderFlow(BOLOGNA_LAZIO);
    expect(inBand("away").map(idOf).sort()).toEqual(
      ["substitution@19", "yellow@22", "yellow@34", "yellow@44"].sort()
    );
    for (const m of inBand("away")) {
      expect(m.dataset.team).toBe("away");
      expect(m.getAttribute("aria-label")).toContain("Lazio");
    }
  });

  it("both Bologna events render BELOW the axis, in the home band", () => {
    renderFlow(BOLOGNA_LAZIO);
    expect(inBand("home").map(idOf).sort()).toEqual(["yellow@34", "yellow@41"].sort());
    for (const m of inBand("home")) {
      expect(m.dataset.team).toBe("home");
      expect(m.getAttribute("aria-label")).toContain("Bologna");
    }
  });

  it("no marker appears in the other team's half, and none is lost", () => {
    renderFlow(BOLOGNA_LAZIO);
    expect(allMarkers()).toHaveLength(BOLOGNA_LAZIO.length);
    expect(inBand("away")).toHaveLength(4);
    expect(inBand("home")).toHaveLength(2);
    expect(band("neutral")).toBeNull();
    // The bug, stated as an assertion: nothing away-owned may sit in the home band.
    expect(inBand("home").every((m) => m.dataset.team === "home")).toBe(true);
    expect(inBand("away").every((m) => m.dataset.team === "away")).toBe(true);
  });

  it("[M1] the away band is anchored above the bars and the home band below them", () => {
    renderFlow(BOLOGNA_LAZIO);
    // Inverting the mapping - or anchoring both bands to the same edge - fails here.
    expect(band("away")!.className).toContain("top-0");
    expect(band("away")!.className).not.toContain("bottom-0");
    expect(band("home")!.className).toContain("bottom-0");
    expect(band("home")!.className).not.toContain("top-0");
    // Away stacks upward off the axis, home downward: opposite CSS edges, by construction.
    for (const m of inBand("away")) {
      expect(m.style.bottom).not.toBe("");
      expect(m.style.top).toBe("");
    }
    for (const m of inBand("home")) {
      expect(m.style.top).not.toBe("");
      expect(m.style.bottom).toBe("");
    }
  });

  it("[M7] the same kind on opposite teams lands on opposite sides", () => {
    // 34' is a yellow for BOTH teams. If kind decided the side they would coincide.
    renderFlow(BOLOGNA_LAZIO);
    const at34 = allMarkers().filter((m) => idOf(m) === "yellow@34");
    expect(at34).toHaveLength(2);
    expect(at34.map((m) => m.dataset.side).sort()).toEqual(["away", "home"]);
    expect(new Set(at34.map((m) => m.dataset.kind)).size).toBe(1);
  });

  it("[M4] reversing the event order changes nothing about who owns what", () => {
    renderFlow(BOLOGNA_LAZIO);
    const forward = allMarkers()
      .map((m) => `${m.dataset.side}:${idOf(m)}`)
      .sort();
    cleanup();
    renderFlow([...BOLOGNA_LAZIO].reverse());
    expect(
      allMarkers()
        .map((m) => `${m.dataset.side}:${idOf(m)}`)
        .sort()
    ).toEqual(forward);
  });

  it("[F] markers keep their real minute, and the horizontal axis is untouched", () => {
    renderFlow(BOLOGNA_LAZIO);
    const pctOf = (id: string) => Number.parseFloat(allMarkers().find((m) => idOf(m) === id)!.style.left);
    // 90' axis (nothing pushes past it here), so a minute is 1/0.9 of a percent.
    expect(pctOf("substitution@19")).toBeCloseTo((19 / 90) * 100, 5);
    expect(pctOf("yellow@44")).toBeCloseTo((44 / 90) * 100, 5);
    for (const m of allMarkers()) {
      const pct = Number.parseFloat(m.style.left);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });
});

describe("A-J - the rest of the ownership contract, in the rendered chart", () => {
  it("[A] an away-only fixture renders no home band at all", () => {
    renderFlow([ev(20, "away", "goal", "Castellanos"), ev(70, "away", "yellow", "Rovella")]);
    expect(inBand("away")).toHaveLength(2);
    expect(band("home")).toBeNull();
    expect(band("neutral")).toBeNull();
  });

  it("[B] a home-only fixture renders no away band at all", () => {
    renderFlow([ev(20, "home", "goal", "Orsolini"), ev(70, "home", "red", "Lucumi")]);
    expect(inBand("home")).toHaveLength(2);
    expect(band("away")).toBeNull();
    expect(band("neutral")).toBeNull();
  });

  it("[C] a mixed fixture splits by team, not by anything else", () => {
    renderFlow([
      ev(10, "home", "goal", "Orsolini"),
      ev(20, "away", "goal", "Castellanos"),
      ev(30, "home", "yellow", "Freuler"),
      ev(40, "away", "substitution", "Guendouzi")
    ]);
    expect(inBand("home").map((m) => m.dataset.kind)).toEqual(["goal", "yellow"]);
    expect(inBand("away").map((m) => m.dataset.kind)).toEqual(["goal", "substitution"]);
  });

  it("[D] same-minute home and away events stay distinguishable", () => {
    renderFlow([ev(55, "home", "yellow", "Freuler"), ev(55, "away", "yellow", "Rovella")]);
    const [home] = inBand("home");
    const [away] = inBand("away");
    expect(home.style.left).toBe(away.style.left);
    // Identical minute, identical kind - the halves are the only thing telling them apart,
    // and they must: same lane index, opposite anchoring edge.
    expect(home.dataset.lane).toBe("0");
    expect(away.dataset.lane).toBe("0");
    expect(home.style.top).toBe("0px");
    expect(away.style.bottom).toBe("0px");
  });

  it("[E] three away and three home events at one minute all keep a distinct slot", () => {
    renderFlow([
      ev(60, "away", "yellow", "A"),
      ev(60, "away", "yellow", "B"),
      ev(60, "away", "substitution", "C"),
      ev(60, "home", "yellow", "D"),
      ev(60, "home", "yellow", "E"),
      ev(60, "home", "substitution", "F")
    ]);
    expect(inBand("away").map((m) => m.dataset.lane)).toEqual(["0", "1", "2"]);
    expect(inBand("home").map((m) => m.dataset.lane)).toEqual(["0", "1", "2"]);
    // [M5] the cap is spent per team; a global ladder would have collapsed three of these.
    expect(allMarkers()).toHaveLength(6);
    for (const m of allMarkers()) expect(Number(m.dataset.lane)).toBeLessThan(MARKER_MAX_LANES);
  });

  it("[F] an unknown team goes to the neutral lane - never to home", () => {
    renderFlow([
      { minute: 25, extra: null, team: "Lazio", type: "yellow", player: "Rovella" } as unknown as MatchLiveEvent,
      ev(60, "home", "yellow", "Freuler")
    ]);
    expect(inBand("neutral")).toHaveLength(1);
    expect(inBand("neutral")[0].dataset.side).toBe("neutral");
    // [M6] the whole point: the unattributable event is NOT in the home half.
    expect(inBand("home").map(idOf)).toEqual(["yellow@60"]);
    expect(band("away")).toBeNull();
  });

  it("[G] a missing team goes to the neutral lane too, and sits on the axis", () => {
    renderFlow([{ minute: 25, extra: null, type: "goal", player: "?" } as unknown as MatchLiveEvent]);
    expect(inBand("neutral")).toHaveLength(1);
    expect(band("neutral")!.className).toContain("top-1/2");
    expect(band("home")).toBeNull();
    expect(band("away")).toBeNull();
    // No team name can be claimed for it, so none is.
    const label = inBand("neutral")[0].getAttribute("aria-label") || "";
    expect(label).not.toContain("Bologna");
    expect(label).not.toContain("Lazio");
  });

  it("[H] goal, card, substitution and VAR all obey team ownership", () => {
    const kinds = ["goal", "penalty", "ownGoal", "penaltyMissed", "yellow", "red", "substitution", "var"] as const;
    renderFlow([
      ...kinds.map((k, i) => ev(5 + i * 9, "away", k, `A${i}`)),
      ...kinds.map((k, i) => ev(5 + i * 9, "home", k, `H${i}`))
    ]);
    expect(inBand("away").map((m) => m.dataset.kind)).toEqual([...kinds]);
    expect(inBand("home").map((m) => m.dataset.kind)).toEqual([...kinds]);
    expect(inBand("away").every((m) => m.dataset.team === "away")).toBe(true);
    expect(inBand("home").every((m) => m.dataset.team === "home")).toBe(true);
  });

  it("[I] stoppage time keeps both its minute and its team", () => {
    renderFlow([ev(45, "away", "goal", "Castellanos", 3), ev(90, "home", "red", "Lucumi", 5)]);
    const away = inBand("away")[0];
    const home = inBand("home")[0];
    // The axis now runs to 95', so 48' and 95' are shares of that, not of 90'.
    expect(Number.parseFloat(away.style.left)).toBeCloseTo((48 / 95) * 100, 5);
    expect(Number.parseFloat(home.style.left)).toBeCloseTo(100, 5);
    expect(away.dataset.team).toBe("away");
    expect(home.dataset.team).toBe("home");
  });

  it("[J] no events means no marker layer and no reserved room", () => {
    renderFlow([]);
    expect(screen.queryByTestId("momentum-events")).toBeNull();
    const frame = screen.getByTestId("momentum-flow");
    expect(frame.style.paddingTop).toBe("0px");
    expect(frame.style.paddingBottom).toBe("0px");
    // The chart itself is unaffected by the absence.
    expect(screen.getByTestId("momentum-chart")).toBeTruthy();
  });
});

describe("[M8] the event layer never reaches the momentum layer", () => {
  it("bars are identical with events, without them, and with every team swapped", () => {
    const barSignature = () =>
      Array.from(screen.getByTestId("momentum-chart").querySelectorAll<HTMLElement>("[data-side]")).map((b) =>
        [b.dataset.side, b.dataset.level, b.dataset.dominant, b.style.flexGrow].join("|")
      );

    renderFlow(BOLOGNA_LAZIO);
    const withEvents = barSignature();
    cleanup();

    renderFlow([]);
    expect(barSignature()).toEqual(withEvents);
    cleanup();

    // Every event handed to the other team: still not an input to the series.
    renderFlow(
      BOLOGNA_LAZIO.map((e) => ({ ...e, team: e.team === "home" ? "away" : "home" }) as MatchLiveEvent)
    );
    expect(barSignature()).toEqual(withEvents);
    // ...though the markers themselves did move, which is what proves the swap took.
    expect(inBand("away")).toHaveLength(2);
    expect(inBand("home")).toHaveLength(4);
  });
});
