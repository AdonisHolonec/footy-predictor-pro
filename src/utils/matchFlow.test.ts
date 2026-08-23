import { describe, expect, it } from "vitest";
import {
  DOMINANCE_THRESHOLD_PP,
  INTENSITY_REFERENCE,
  INTERVAL_STAT_KEYS,
  MARKER_MAX_LANES,
  MOMENTUM_WEIGHTS,
  buildMatchFlowSegments,
  eventKindsPresent,
  findDominantPeriod,
  layoutEventMarkers,
  mergeHistoryPoints,
  scoreInterval,
  threatLevel
} from "./matchFlow";
import { DEFAULT_MOMENTUM_WEIGHTS } from "../../server-utils/momentum/MomentumEngine.js";
import type { MatchLiveEvent, MomentumHistoryPoint, MomentumRawStats } from "../types";

/**
 * The match-flow derivation. The property under test throughout is that the series
 * describes INTERVALS — what each side did between two readings — and never the totals
 * standing at a reading, which is what made every bar point the same way.
 */

const stats = (
  shotsTotal: number,
  shotsOnTarget: number,
  corners: number,
  yellowCards = 0,
  redCards = 0,
  possession = 50
): MomentumRawStats => ({ possession, shotsTotal, shotsOnTarget, corners, yellowCards, redCards });

const point = (
  minute: number,
  homeMomentum: number,
  home: MomentumRawStats,
  away: MomentumRawStats
): MomentumHistoryPoint => ({
  minute,
  homeMomentum,
  awayMomentum: 100 - homeMomentum,
  raw: { home, away }
});

/**
 * A real shape: the away side leads 12–5 on shots by the hour, so EVERY cumulative
 * snapshot says "away". The intervals do not: the home side had 40'–48', the away side
 * had 48'–56', and 56'–63' was level.
 */
const ALTERNATING: MomentumHistoryPoint[] = [
  point(40, 30, stats(2, 1, 0), stats(6, 2, 4, 1)),
  point(48, 34, stats(4, 2, 2), stats(7, 2, 4, 1)),
  point(56, 28, stats(4, 2, 2, 1), stats(11, 4, 6, 1)),
  point(63, 26, stats(5, 2, 2, 1), stats(12, 4, 6, 1))
];

describe("guard — the mirrored weights cannot drift from the engine", () => {
  it("MOMENTUM_WEIGHTS equals DEFAULT_MOMENTUM_WEIGHTS for every key it mirrors", () => {
    for (const [key, value] of Object.entries(MOMENTUM_WEIGHTS)) {
      expect(DEFAULT_MOMENTUM_WEIGHTS[key as keyof typeof DEFAULT_MOMENTUM_WEIGHTS], key).toBe(value);
    }
  });

  it("every interval stat is a weighted engine input, and possession is deliberately not one", () => {
    for (const key of INTERVAL_STAT_KEYS) {
      expect(MOMENTUM_WEIGHTS[key], key).toBeTypeOf("number");
    }
    expect(INTERVAL_STAT_KEYS).not.toContain("possession");
  });

  it("the intensity reference is spelled out of the weights, not a free constant", () => {
    expect(INTENSITY_REFERENCE).toBeCloseTo(
      MOMENTUM_WEIGHTS.shotsOnTarget + MOMENTUM_WEIGHTS.shotsTotal + MOMENTUM_WEIGHTS.corners
    );
  });
});

describe("A/B/C/T — both sides can hold the initiative, and it changes hands", () => {
  it("[C][T] alternates even though one side leads every cumulative total", () => {
    const segments = buildMatchFlowSegments(ALTERNATING);
    expect(segments.map((s) => s.side)).toEqual(["away", "home", "away", "neutral"]);
    // The proof that this is not the totals talking: at every reading the away side is
    // ahead on shots, yet the 40'–48' interval belongs to the home side.
    for (const pt of ALTERNATING) {
      expect(pt.raw!.away.shotsTotal!).toBeGreaterThan(pt.raw!.home.shotsTotal!);
    }
    const home = segments.find((s) => s.side === "home")!;
    expect([home.fromMinute, home.toMinute]).toEqual([40, 48]);
  });

  it("[A] a side that does everything in the interval owns it outright", () => {
    const [, seg] = buildMatchFlowSegments([
      point(10, 50, stats(0, 0, 0), stats(0, 0, 0)),
      point(20, 50, stats(3, 2, 1), stats(0, 0, 0))
    ]);
    expect(seg.side).toBe("home");
    expect(seg.homeMomentum).toBe(100);
    expect(seg.fromDelta).toBe(true);
  });

  it("[B] and the mirror case is symmetric", () => {
    const [, seg] = buildMatchFlowSegments([
      point(10, 50, stats(0, 0, 0), stats(0, 0, 0)),
      point(20, 50, stats(0, 0, 0), stats(3, 2, 1))
    ]);
    expect(seg.side).toBe("away");
    expect(seg.awayMomentum).toBe(100);
  });

  it("[D][S] a quiet interval is level and sits on the axis, whatever the totals say", () => {
    const [, seg] = buildMatchFlowSegments([
      point(10, 12, stats(0, 0, 0), stats(9, 5, 7)),
      point(20, 12, stats(0, 0, 0), stats(9, 5, 7))
    ]);
    expect(seg.side).toBe("neutral");
    expect(seg.intensity).toBe(0);
    expect(threatLevel(seg)).toBe("low");
  });

  it("cards dim a side without inverting it, exactly as the engine clamps", () => {
    const { home, away } = scoreInterval(
      point(10, 50, stats(0, 0, 0), stats(0, 0, 0)),
      point(20, 50, stats(0, 0, 0, 2), stats(1, 0, 0))
    );
    expect(home).toBe(0);
    expect(away).toBeCloseTo(MOMENTUM_WEIGHTS.shotsTotal);
  });
});

describe("E/P — one observation, and the minutes nobody watched", () => {
  it("[E] a lone reading is a point, never an interval reaching back to kick-off", () => {
    const segments = buildMatchFlowSegments([point(63, 26, stats(5, 2, 2), stats(12, 4, 6))]);
    expect(segments).toHaveLength(1);
    expect(segments[0].fromMinute).toBe(63);
    expect(segments[0].toMinute).toBe(63);
    expect(segments[0].fromDelta).toBe(false);
  });

  it("[P] no reading, no segment — the series never fills minutes it did not observe", () => {
    expect(buildMatchFlowSegments([])).toEqual([]);
    const segments = buildMatchFlowSegments(ALTERNATING);
    expect(Math.min(...segments.map((s) => s.fromMinute))).toBe(40);
    expect(segments.reduce((n, s) => n + (s.toMinute - s.fromMinute), 0)).toBe(23);
  });

  it("an interval whose endpoints carry no counters falls back to the snapshot, flagged", () => {
    const segments = buildMatchFlowSegments([
      { minute: 10, homeMomentum: 70, awayMomentum: 30 },
      { minute: 20, homeMomentum: 20, awayMomentum: 80 }
    ]);
    expect(segments.map((s) => s.side)).toEqual(["home", "away"]);
    expect(segments.every((s) => s.fromDelta === false)).toBe(true);
    expect(segments.every((s) => s.intensity === undefined)).toBe(true);
  });
});

describe("R — malformed data never becomes geometry", () => {
  it("non-finite readings are dropped before they can be drawn", () => {
    const dirty = [
      point(40, 30, stats(1, 0, 0), stats(1, 0, 0)),
      { minute: Number.NaN, homeMomentum: 50, awayMomentum: 50 },
      { minute: 50, homeMomentum: Number.POSITIVE_INFINITY, awayMomentum: 50 },
      { minute: 55, homeMomentum: undefined as unknown as number, awayMomentum: 50 },
      point(60, 40, stats(3, 1, 1), stats(1, 0, 0))
    ];
    expect(mergeHistoryPoints(dirty, []).map((p) => p.minute)).toEqual([40, 60]);
    for (const seg of buildMatchFlowSegments(dirty)) {
      expect(Number.isFinite(seg.fromMinute)).toBe(true);
      expect(Number.isFinite(seg.toMinute)).toBe(true);
      expect(Number.isFinite(seg.magnitude)).toBe(true);
      expect(seg.magnitude).toBeGreaterThanOrEqual(0);
      expect(seg.magnitude).toBeLessThanOrEqual(1);
      if (seg.intensity !== undefined) {
        expect(seg.intensity).toBeGreaterThanOrEqual(0);
        expect(seg.intensity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("a counter that goes backwards upstream is treated as no growth, never negative", () => {
    const { home, away } = scoreInterval(
      point(10, 50, stats(5, 3, 2), stats(1, 0, 0)),
      point(20, 50, stats(4, 2, 1), stats(2, 0, 0))
    );
    expect(home).toBe(0);
    expect(away).toBeCloseTo(MOMENTUM_WEIGHTS.shotsTotal);
  });

  it("one side's revision downward never cancels out what the other side actually did", () => {
    // Home's totals are revised down while away really does take two shots and hits the
    // target once. Treating the revision as negative growth would net it off against the
    // away side's work and understate how busy the interval was.
    const { home, away, threat } = scoreInterval(
      point(10, 50, stats(5, 3, 2), stats(1, 0, 0)),
      point(20, 50, stats(4, 2, 1), stats(3, 1, 0))
    );
    expect(home).toBe(0);
    const awayWork = 2 * MOMENTUM_WEIGHTS.shotsTotal + MOMENTUM_WEIGHTS.shotsOnTarget;
    expect(away).toBeCloseTo(awayWork);
    expect(threat).toBeCloseTo(awayWork);
  });

  it("a null counter on one side is not read as zero for that side", () => {
    const partial = scoreInterval(
      { minute: 10, homeMomentum: 50, awayMomentum: 50, raw: { home: stats(1, 0, 0), away: stats(1, 0, 0) } },
      {
        minute: 20,
        homeMomentum: 50,
        awayMomentum: 50,
        raw: {
          home: { ...stats(1, 0, 0), shotsTotal: null },
          away: { ...stats(1, 0, 0), shotsTotal: null }
        }
      }
    );
    expect(partial.home).toBe(0);
    expect(partial.away).toBe(0);
  });
});

describe("height — intensity is threat volume, not imbalance", () => {
  it("a lopsided but empty interval stays short; a busy one grows", () => {
    const quiet = buildMatchFlowSegments([
      point(10, 50, stats(2, 1, 1), stats(2, 1, 1)),
      point(20, 50, stats(2, 1, 1), stats(2, 1, 1))
    ])[1];
    const busy = buildMatchFlowSegments([
      point(10, 50, stats(0, 0, 0), stats(0, 0, 0)),
      point(20, 50, stats(2, 1, 1), stats(0, 0, 0))
    ])[1];
    expect(threatLevel(quiet)).toBe("low");
    expect(threatLevel(busy)).toBe("high");
  });

  it("snapshot-only intervals keep the engine's imbalance ladder", () => {
    expect(threatLevel({ side: "neutral", magnitude: 0.9 })).toBe("low");
    expect(threatLevel({ side: "home", magnitude: DOMINANCE_THRESHOLD_PP / 100 })).toBe("low");
    expect(threatLevel({ side: "home", magnitude: 0.2 })).toBe("medium");
    expect(threatLevel({ side: "away", magnitude: 0.5 })).toBe("high");
  });
});

describe("dominant periods come from the series", () => {
  it("needs a sustained run, not the current leader", () => {
    expect(findDominantPeriod(buildMatchFlowSegments(ALTERNATING))).toBeNull();
  });

  it("reports the run when the intervals actually sustain one", () => {
    const sustained = buildMatchFlowSegments([
      point(10, 50, stats(0, 0, 0), stats(0, 0, 0)),
      point(20, 50, stats(0, 0, 0), stats(2, 1, 0)),
      point(30, 50, stats(0, 0, 0), stats(4, 2, 1)),
      point(40, 50, stats(2, 1, 0), stats(4, 2, 1))
    ]);
    expect(findDominantPeriod(sustained)).toEqual({ fromMinute: 10, toMinute: 30, side: "away" });
  });
});

describe("F/G/Q/L — event markers on the axis", () => {
  const ev = (minute: number, team: "home" | "away", type: MatchLiveEvent["type"], extra: number | null = null) =>
    ({ minute, extra, team, type, player: "X" }) as MatchLiveEvent;

  it("[F] every event lands at its real minute, as a share of the axis", () => {
    const markers = layoutEventMarkers([ev(0, "home", "goal"), ev(45, "away", "yellow"), ev(90, "home", "red")], 90);
    expect(markers.map((m) => m.pct)).toEqual([0, 50, 100]);
    expect(markers.map((m) => m.event.team)).toEqual(["home", "away", "home"]);
  });

  it("[G] events at the same or adjacent minutes stack instead of overlapping", () => {
    const markers = layoutEventMarkers(
      [ev(46, "away", "substitution"), ev(46, "away", "substitution"), ev(47, "home", "yellow")],
      90
    );
    expect(markers.map((m) => m.lane)).toEqual([0, 1, 2]);
    expect(new Set(markers.map((m) => m.lane)).size).toBe(3);
  });

  it("[G] stacking is bounded — a crowd shares the last lane rather than growing forever", () => {
    const markers = layoutEventMarkers(
      Array.from({ length: 6 }, () => ev(60, "home", "yellow")),
      90
    );
    expect(Math.max(...markers.map((m) => m.lane))).toBe(MARKER_MAX_LANES - 1);
  });

  it("[Q] an event without a usable minute is dropped, never parked at 0'", () => {
    const markers = layoutEventMarkers(
      [
        { minute: Number.NaN, extra: null, team: "home", type: "goal" } as MatchLiveEvent,
        { minute: undefined as unknown as number, extra: null, team: "away", type: "yellow" } as MatchLiveEvent,
        ev(30, "home", "goal")
      ],
      90
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].minute).toBe(30);
  });

  it("added time counts toward the position", () => {
    const [marker] = layoutEventMarkers([ev(45, "home", "goal", 2)], 94);
    expect(marker.minute).toBe(47);
  });

  it("[L] corners cannot appear: they are not an event kind upstream sends", () => {
    const markers = layoutEventMarkers([ev(12, "home", "goal"), ev(30, "away", "yellow")], 90);
    expect(eventKindsPresent(markers)).toEqual(["goal", "yellow"]);
    expect(eventKindsPresent(markers)).not.toContain("corner");
  });

  it("the legend lists only the kinds this match produced, in a stable order", () => {
    const markers = layoutEventMarkers(
      [ev(70, "home", "substitution"), ev(12, "away", "red"), ev(30, "home", "goal")],
      90
    );
    expect(eventKindsPresent(markers)).toEqual(["goal", "red", "substitution"]);
  });

  it("markers never escape the axis, whatever the minute", () => {
    const markers = layoutEventMarkers([ev(0, "home", "goal"), ev(200, "away", "goal")], 90);
    for (const m of markers) {
      expect(m.pct).toBeGreaterThanOrEqual(0);
      expect(m.pct).toBeLessThanOrEqual(100);
    }
  });
});
