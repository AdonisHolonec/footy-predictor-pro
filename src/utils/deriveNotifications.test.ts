import { describe, expect, it } from "vitest";
import { deriveNotifications } from "./deriveNotifications";
import { deriveLiveWinProbability } from "./liveWinProbability";
import type { HistoryEntry, PredictionRow } from "../types";

function baseRow(over: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id: 1,
    leagueId: 39,
    league: "PL",
    teams: { home: "A", away: "B" },
    kickoff: "2026-07-21T18:00:00Z",
    status: "NS",
    probs: { p1: 40, pX: 30, p2: 30 },
    ...over
  } as PredictionRow;
}

const NOW = new Date("2026-07-21T17:00:00Z").getTime();

describe("deriveNotifications", () => {
  it("returns an empty list when there is nothing to report", () => {
    const result = deriveNotifications({ predictions: [], history: [], watchlistFixtureIds: [], now: NOW });
    expect(result).toEqual([]);
  });

  it("surfaces a watchlisted fixture kicking off within 2h as an upcoming notification", () => {
    const row = baseRow({ id: 1, kickoff: "2026-07-21T18:00:00Z" });
    const result = deriveNotifications({
      predictions: [row],
      history: [],
      watchlistFixtureIds: [1],
      now: NOW
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "kickoff-1", kind: "kickoff", fixtureId: 1 });
    expect(result[0].hoursToKickoff).toBeCloseTo(1, 1);
  });

  it("ignores a watchlisted fixture kicking off more than 2h away", () => {
    const row = baseRow({ id: 1, kickoff: "2026-07-21T21:00:00Z" });
    const result = deriveNotifications({
      predictions: [row],
      history: [],
      watchlistFixtureIds: [1],
      now: NOW
    });
    expect(result).toHaveLength(0);
  });

  it("ignores a watchlisted fixture that has already kicked off", () => {
    const row = baseRow({ id: 1, kickoff: "2026-07-21T16:00:00Z" });
    const result = deriveNotifications({
      predictions: [row],
      history: [],
      watchlistFixtureIds: [1],
      now: NOW
    });
    expect(result).toHaveLength(0);
  });

  it("surfaces a detected value bet regardless of watchlist status", () => {
    const row = baseRow({ id: 2, valueBet: { detected: true, ev: 7.5 } as PredictionRow["valueBet"] });
    const result = deriveNotifications({
      predictions: [row],
      history: [],
      watchlistFixtureIds: [],
      now: NOW
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "value-2", kind: "value", ev: 7.5 });
  });

  it("surfaces a live fixture with a shifting momentum trend above the confidence floor", () => {
    const row = baseRow({
      id: 6,
      momentum: { homeMomentum: 78, awayMomentum: 22, dominantTeam: "home", trend: "up", confidence: 67 }
    });
    const result = deriveNotifications({ predictions: [row], history: [], watchlistFixtureIds: [], now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "momentum-6-up", kind: "momentum", trend: "up" });
  });

  it("ignores a momentum trend below the confidence floor", () => {
    const row = baseRow({
      id: 7,
      momentum: { homeMomentum: 60, awayMomentum: 40, dominantTeam: "home", trend: "up", confidence: 33 }
    });
    const result = deriveNotifications({ predictions: [row], history: [], watchlistFixtureIds: [], now: NOW });
    expect(result).toHaveLength(0);
  });

  it("ignores a stable momentum trend regardless of confidence", () => {
    const row = baseRow({
      id: 8,
      momentum: { homeMomentum: 55, awayMomentum: 45, dominantTeam: "home", trend: "stable", confidence: 90 }
    });
    const result = deriveNotifications({ predictions: [row], history: [], watchlistFixtureIds: [], now: NOW });
    expect(result).toHaveLength(0);
  });

  it("surfaces a big live probability swing on an in-play fixture", () => {
    // Kickoff probs said home 40 / draw 30 / away 30; away leads 0-1 at 70' →
    // the live away chance is far above 30 pp, well over the swing threshold.
    const row = baseRow({
      id: 9,
      status: "2H",
      lambdas: { home: 1.5, away: 1.1 },
      score: { home: 0, away: 1, minute: 70 }
    });
    const result = deriveNotifications({ predictions: [row], history: [], watchlistFixtureIds: [], now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "liveswing-9-away-up", kind: "liveSwing", swingOutcome: "away" });
    expect(result[0].swingPp).toBeGreaterThan(15);
  });

  it("ignores a small live drift below the swing threshold", () => {
    // Kickoff probs are set to the model's own minute-0 values, so a 0-0 at 5'
    // has drifted only marginally — below the 15 pp floor.
    const lambdas = { home: 1.5, away: 1.1 };
    const atKickoff = deriveLiveWinProbability({
      status: "1H",
      lambdas,
      score: { home: 0, away: 0, minute: 0 }
    })!;
    const row = baseRow({
      id: 11,
      status: "1H",
      lambdas,
      probs: { p1: atKickoff.p1, pX: atKickoff.pX, p2: atKickoff.p2 } as PredictionRow["probs"],
      score: { home: 0, away: 0, minute: 5 }
    });
    const result = deriveNotifications({ predictions: [row], history: [], watchlistFixtureIds: [], now: NOW });
    expect(result).toHaveLength(0);
  });

  it("ignores fixtures where the live probability is not derivable", () => {
    const notInPlay = baseRow({ id: 12, status: "NS", lambdas: { home: 1.5, away: 1.1 }, score: { home: 0, away: 0, minute: 0 } });
    const noLambdas = baseRow({ id: 13, status: "2H", score: { home: 0, away: 2, minute: 70 } });
    const result = deriveNotifications({
      predictions: [notInPlay, noLambdas],
      history: [],
      watchlistFixtureIds: [],
      now: NOW
    });
    expect(result).toHaveLength(0);
  });

  it("reports the outcome that moved most, with a signed delta", () => {
    // Home was the 70 pp favourite; level 1-1 at 60' the collapse of the home
    // chance is the single biggest move (the compensating rise splits between
    // draw and away), so the alert points at home, downward.
    const row = baseRow({
      id: 14,
      status: "2H",
      probs: { p1: 70, pX: 15, p2: 15 } as PredictionRow["probs"],
      lambdas: { home: 1.5, away: 1.1 },
      score: { home: 1, away: 1, minute: 60 }
    });
    const result = deriveNotifications({ predictions: [row], history: [], watchlistFixtureIds: [], now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("liveSwing");
    expect(result[0].swingOutcome).toBe("home");
    expect(result[0].swingPp).toBeLessThan(-15);
    expect(result[0].id).toBe("liveswing-14-home-down");
  });

  it("surfaces a settled watchlisted prediction as win or loss", () => {
    const entry: HistoryEntry = {
      ...baseRow({ id: 3 }),
      savedAt: "2026-07-21T16:30:00Z",
      validation: "win"
    };
    const result = deriveNotifications({
      predictions: [],
      history: [entry],
      watchlistFixtureIds: [3],
      now: NOW
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "settled-3", kind: "settled", validation: "win" });
  });

  it("ignores a settled prediction for a fixture that is not watchlisted", () => {
    const entry: HistoryEntry = {
      ...baseRow({ id: 4 }),
      savedAt: "2026-07-21T16:30:00Z",
      validation: "loss"
    };
    const result = deriveNotifications({
      predictions: [],
      history: [entry],
      watchlistFixtureIds: [],
      now: NOW
    });
    expect(result).toHaveLength(0);
  });

  it("ignores a settled watchlisted prediction that is still pending", () => {
    const entry: HistoryEntry = {
      ...baseRow({ id: 5 }),
      savedAt: "2026-07-21T16:30:00Z",
      validation: "pending"
    };
    const result = deriveNotifications({
      predictions: [],
      history: [entry],
      watchlistFixtureIds: [5],
      now: NOW
    });
    expect(result).toHaveLength(0);
  });

  it("orders groups as upcoming kickoffs, then value bets, then settled results", () => {
    const kickoffRow = baseRow({ id: 10, kickoff: "2026-07-21T18:00:00Z" });
    const valueRow = baseRow({ id: 20, valueBet: { detected: true, ev: 3 } as PredictionRow["valueBet"] });
    const settledEntry: HistoryEntry = {
      ...baseRow({ id: 30 }),
      savedAt: "2026-07-21T16:30:00Z",
      validation: "win"
    };
    const result = deriveNotifications({
      predictions: [kickoffRow, valueRow],
      history: [settledEntry],
      watchlistFixtureIds: [10, 30],
      now: NOW
    });
    expect(result.map((n) => n.kind)).toEqual(["kickoff", "value", "settled"]);
  });
});
