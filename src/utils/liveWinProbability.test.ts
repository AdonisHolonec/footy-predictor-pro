import { describe, expect, it } from "vitest";
import { appendLiveWinHistory, deriveLiveWinProbability, type LiveWinHistoryPoint } from "./liveWinProbability";

type Input = Parameters<typeof deriveLiveWinProbability>[0];

function liveRow(overrides: Partial<Input> = {}): Input {
  return {
    status: "2H",
    lambdas: { home: 1.5, away: 1.1 },
    score: { home: 0, away: 0, minute: 60 },
    ...overrides
  };
}

describe("deriveLiveWinProbability", () => {
  it("returns null when the fixture is not in play", () => {
    expect(deriveLiveWinProbability(liveRow({ status: "NS" }))).toBeNull();
    expect(deriveLiveWinProbability(liveRow({ status: "FT" }))).toBeNull();
    expect(deriveLiveWinProbability(liveRow({ status: "PST" }))).toBeNull();
  });

  it("returns null beyond regulation (extra time / penalties) where 1X2-at-90 semantics break", () => {
    expect(deriveLiveWinProbability(liveRow({ status: "ET" }))).toBeNull();
    expect(deriveLiveWinProbability(liveRow({ status: "P" }))).toBeNull();
    expect(deriveLiveWinProbability(liveRow({ status: "BT" }))).toBeNull();
  });

  it("returns null when lambdas are missing or not positive finite numbers", () => {
    expect(deriveLiveWinProbability(liveRow({ lambdas: undefined }))).toBeNull();
    expect(deriveLiveWinProbability(liveRow({ lambdas: { home: 0, away: 1.1 } }))).toBeNull();
    expect(deriveLiveWinProbability(liveRow({ lambdas: { home: Number.NaN, away: 1.1 } }))).toBeNull();
  });

  it("returns null when the live score or minute is not available", () => {
    expect(deriveLiveWinProbability(liveRow({ score: undefined }))).toBeNull();
    expect(deriveLiveWinProbability(liveRow({ score: { home: null, away: 0, minute: 60 } }))).toBeNull();
    expect(deriveLiveWinProbability(liveRow({ score: { home: 0, away: 0, minute: null } }))).toBeNull();
    expect(deriveLiveWinProbability(liveRow({ score: { home: 0, away: 0 } }))).toBeNull();
  });

  it("sums to 100 and favours the stronger side at kickoff-equivalent state (minute 0, 0-0)", () => {
    const live = deriveLiveWinProbability(liveRow({ score: { home: 0, away: 0, minute: 0 } }));
    expect(live).not.toBeNull();
    expect(live!.p1 + live!.pX + live!.p2).toBeCloseTo(100, 6);
    expect(live!.remainingFraction).toBe(1);
    expect(live!.p1).toBeGreaterThan(live!.p2);
  });

  it("is symmetric for equal lambdas and an equal score", () => {
    const live = deriveLiveWinProbability(
      liveRow({ lambdas: { home: 1.3, away: 1.3 }, score: { home: 1, away: 1, minute: 50 } })
    );
    expect(live).not.toBeNull();
    expect(live!.p1).toBeCloseTo(live!.p2, 6);
  });

  it("makes a late two-goal lead near-certain", () => {
    const live = deriveLiveWinProbability(liveRow({ score: { home: 2, away: 0, minute: 89 } }));
    expect(live).not.toBeNull();
    expect(live!.p1).toBeGreaterThan(95);
    expect(live!.p2).toBeLessThan(1);
  });

  it("makes the draw dominant late in a 0-0", () => {
    const live = deriveLiveWinProbability(
      liveRow({ lambdas: { home: 1.2, away: 1.0 }, score: { home: 0, away: 0, minute: 85 } })
    );
    expect(live).not.toBeNull();
    expect(live!.pX).toBeGreaterThan(live!.p1);
    expect(live!.pX).toBeGreaterThan(live!.p2);
  });

  it("collapses to the current result during stoppage time (minute >= 90)", () => {
    const live = deriveLiveWinProbability(liveRow({ score: { home: 1, away: 0, minute: 90 } }));
    expect(live).not.toBeNull();
    expect(live!.p1).toBeCloseTo(100, 6);
    expect(live!.pX).toBeCloseTo(0, 6);
    expect(live!.remainingFraction).toBe(0);
  });

  it("treats half-time as 45 minutes played", () => {
    const live = deriveLiveWinProbability(liveRow({ status: "HT", score: { home: 0, away: 1, minute: 45 } }));
    expect(live).not.toBeNull();
    expect(live!.remainingFraction).toBeCloseTo(0.5, 6);
    expect(live!.p2).toBeGreaterThan(live!.p1);
  });

  it("grows the leader's probability as the clock runs down", () => {
    const early = deriveLiveWinProbability(liveRow({ score: { home: 1, away: 0, minute: 30 } }));
    const late = deriveLiveWinProbability(liveRow({ score: { home: 1, away: 0, minute: 70 } }));
    expect(early).not.toBeNull();
    expect(late).not.toBeNull();
    expect(late!.p1).toBeGreaterThan(early!.p1);
  });
});

describe("appendLiveWinHistory", () => {
  const point = (minute: number, p1 = 40): LiveWinHistoryPoint => ({ minute, p1, pX: 30, p2: 30 });

  it("appends a point for a new minute without mutating the input", () => {
    const prev = [point(10)];
    const next = appendLiveWinHistory(prev, point(11));
    expect(next).toHaveLength(2);
    expect(next[1].minute).toBe(11);
    expect(prev).toHaveLength(1);
  });

  it("replaces the last point when the minute repeats (latest values win)", () => {
    const prev = [point(10, 40)];
    const next = appendLiveWinHistory(prev, point(10, 55));
    expect(next).toHaveLength(1);
    expect(next[0].p1).toBe(55);
  });

  it("caps the history length by dropping the oldest points", () => {
    let history: LiveWinHistoryPoint[] = [];
    for (let minute = 0; minute < 130; minute++) {
      history = appendLiveWinHistory(history, point(minute));
    }
    expect(history.length).toBeLessThanOrEqual(120);
    expect(history[0].minute).toBe(130 - history.length);
    expect(history[history.length - 1].minute).toBe(129);
  });
});
