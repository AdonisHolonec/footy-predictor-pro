import { describe, expect, it } from "vitest";
import {
  listSpecialBetCandidates,
  pickSpecialBetLegs,
  specialBetLiveAdjustmentBadge,
  SPECIAL_BET_STRONG_SIGNAL
} from "./specialBet";
import type { PredictionRow } from "../types";

const labels = {
  main: "Main",
  goals: "Goals",
  corners: "Corners",
  shots: "Shots",
  ht: "HT",
  gg: "GG/NGG",
  cards: "Cards"
};

function baseRow(over: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id: 1,
    leagueId: 39,
    league: "PL",
    teams: { home: "A", away: "B" },
    kickoff: "2026-07-21T18:00:00Z",
    status: "NS",
    probs: {
      p1: 40,
      pX: 30,
      p2: 30,
      pGG: 88,
      pNGG: 12,
      pO25: 70,
      pU25: 30,
      pO15: 80,
      pU15: 20,
      pO35: 40,
      pU35: 60,
      pDC1X: 70,
      pDC12: 70,
      pDCX2: 60,
      corners: { total: { o8_5: 86, o9_5: 70 } },
      shotsOnTarget: { total: { o4_5: 60 } },
      firstHalf: { pO15: 55, pGG: 40 }
    },
    predictions: { oneXtwo: "1", gg: "GG", over25: "Peste 2.5", correctScore: "1-0" },
    recommended: { pick: "1", confidence: 90, odd: 1.85 },
    odds: { home: 1.85, draw: 3.4, away: 4.2 },
    marketOdds: {
      btts: { pick: "GG", odd: 1.72 },
      goals25: { pick: "Over 2.5", line: 2.5, odd: 1.9, over: 1.9, under: 1.95 },
      corners: { pick: "Over 8.5", line: 8.5, odd: 1.8, over: 1.8, under: 2.0 },
      shotsOnTarget: { pick: "Over 4.5", line: 4.5, odd: 1.75, over: 1.75, under: 2.05 },
      firstHalfGoals: { pick: "Over 1.5 FH", line: 1.5, odd: 2.1, over: 2.1, under: 1.7 },
      cards: { pick: "Cards", line: 3.5, odd: 1.9, over: 1.9, under: 1.95 }
    },
    ...over
  } as PredictionRow;
}

describe("specialBet", () => {
  it("includes GG when odds exist and appends strong extras beyond base count", () => {
    const pool = listSpecialBetCandidates(baseRow(), labels);
    expect(pool.some((l) => l.id === "gg")).toBe(true);
    expect(pool.length).toBeGreaterThanOrEqual(3);

    const legs2 = pickSpecialBetLegs(pool, 2);
    expect(legs2.length).toBeGreaterThanOrEqual(2);
    const strongOutsideBase = pool.slice(2).filter((c) => c.probability >= SPECIAL_BET_STRONG_SIGNAL);
    if (strongOutsideBase.length > 0) {
      expect(legs2.length).toBeGreaterThan(2);
      expect(legs2.length).toBeLessThanOrEqual(4);
    }
  });

  it("omits markets without book odds", () => {
    const row = baseRow({
      marketOdds: {
        goals25: { pick: "Over 2.5", line: 2.5, odd: 1.9, over: 1.9, under: 1.95 }
      },
      recommended: { pick: "Peste 2.5", confidence: 70, odd: 1.9 }
    });
    const pool = listSpecialBetCandidates(row, labels);
    expect(pool.every((l) => Number(l.odd) > 1)).toBe(true);
    expect(pool.some((l) => l.id === "gg")).toBe(false);
  });

  it("passes liveAdjustment through only on the recommended leg", () => {
    const row = baseRow({
      confidenceEngine: {
        confidence: 70,
        liveAdjustment: { delta: 3, reason: "aligned" }
      } as PredictionRow["confidenceEngine"]
    });
    const pool = listSpecialBetCandidates(row, labels);
    const recommended = pool.find((l) => l.id === "recommended");
    expect(recommended?.liveAdjustment).toEqual({ delta: 3, reason: "aligned" });
    expect(pool.filter((l) => l.id !== "recommended").every((l) => !l.liveAdjustment)).toBe(true);
  });

  it("omits liveAdjustment on the recommended leg outside live play", () => {
    const pool = listSpecialBetCandidates(baseRow(), labels);
    const recommended = pool.find((l) => l.id === "recommended");
    expect(recommended?.liveAdjustment).toBeFalsy();
  });

  it("never selects two legs from the same market family", () => {
    // Recommended is itself a Corners pick (family persisted by the recommendation
    // engine) — same family as the dedicated "corners" slot, just a different line.
    // Reproduces the reported bug: Under 10.5 Corners (recommended) alongside
    // Over 8.5 Corners (dedicated slot) would be two correlated Corners legs.
    const row = baseRow({
      recommended: { pick: "Under 10.5", confidence: 90, odd: 1.95, family: "Corners" }
    });
    const pool = listSpecialBetCandidates(row, labels);
    const corners = pool.find((l) => l.id === "corners");
    expect(corners?.family).toBe("CORNERS");
    expect(pool.find((l) => l.id === "recommended")?.family).toBe("CORNERS");

    const legs2 = pickSpecialBetLegs(pool, 2);
    const families2 = legs2.map((l) => l.family);
    expect(new Set(families2).size).toBe(families2.length);
    expect(legs2.some((l) => l.id === "recommended")).toBe(true);
    expect(legs2.some((l) => l.id === "corners")).toBe(false);

    const legs3 = pickSpecialBetLegs(pool, 3);
    const families3 = legs3.map((l) => l.family);
    expect(new Set(families3).size).toBe(families3.length);
    expect(legs3.some((l) => l.id === "corners")).toBe(false);
  });

  it("groups first-half goals with full-match goals as one correlated family", () => {
    const pool = listSpecialBetCandidates(baseRow(), labels);
    const goals = pool.find((l) => l.id === "goals");
    const ht = pool.find((l) => l.id === "ht");
    expect(goals?.family).toBe("GOALS");
    expect(ht?.family).toBe("GOALS");
  });
});

describe("specialBetLiveAdjustmentBadge", () => {
  it("renders a positive success badge when aligned", () => {
    expect(specialBetLiveAdjustmentBadge({ delta: 3, reason: "aligned" })).toEqual({
      delta: "+3",
      tone: "success"
    });
  });

  it("renders a negative danger badge when contradicted", () => {
    expect(specialBetLiveAdjustmentBadge({ delta: -2, reason: "contradicted" })).toEqual({
      delta: "-2",
      tone: "danger"
    });
  });

  it("returns null for neutral or missing adjustment", () => {
    expect(specialBetLiveAdjustmentBadge({ delta: 0, reason: "neutral" })).toBeNull();
    expect(specialBetLiveAdjustmentBadge(null)).toBeNull();
    expect(specialBetLiveAdjustmentBadge(undefined)).toBeNull();
  });
});
