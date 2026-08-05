import { describe, expect, it } from "vitest";
import {
  buildSpecialBetLegs,
  listSpecialBetCandidates,
  pickSpecialBetLegs,
  specialBetLiveAdjustmentBadge,
  SPECIAL_BET_STRONG_SIGNAL,
  type SpecialBetLeg,
  type SpecialBetLegId
} from "./specialBet";
import type { MarketFamilyKey } from "./formatRecommendation";
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

function leg(
  id: SpecialBetLegId,
  family: MarketFamilyKey,
  probability: number,
  pick: string
): SpecialBetLeg {
  return { id, label: id, pick, probability, odd: 1.8, outcome: null, family };
}

function expectUniqueFamilies(legs: SpecialBetLeg[]) {
  const families = legs.map((l) => l.family);
  expect(new Set(families).size).toBe(families.length);
}

describe("specialBet", () => {
  it("includes GG when odds exist and appends strong extras beyond base count", () => {
    const pool = listSpecialBetCandidates(baseRow(), labels);
    expect(pool.some((l) => l.id === "gg")).toBe(true);
    expect(pool.length).toBeGreaterThanOrEqual(3);

    const legs2 = pickSpecialBetLegs(pool, 2);
    expect(legs2.length).toBeGreaterThanOrEqual(2);
    expectUniqueFamilies(legs2);
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

  it("groups first-half goals with full-match goals as one correlated family", () => {
    const pool = listSpecialBetCandidates(baseRow(), labels);
    expect(pool.find((l) => l.id === "goals")?.family).toBe("GOALS");
    expect(pool.find((l) => l.id === "ht")?.family).toBe("GOALS");
  });
});

describe("specialBet Phase 1 family diversity", () => {
  it("never selects duplicate Corners legs", () => {
    const row = baseRow({
      recommended: { pick: "Under 10.5", confidence: 90, odd: 1.95, family: "Corners" }
    });
    const pool = listSpecialBetCandidates(row, labels);
    expect(pool.find((l) => l.id === "recommended")?.family).toBe("CORNERS");
    expect(pool.find((l) => l.id === "corners")?.family).toBe("CORNERS");

    const legs = pickSpecialBetLegs(pool, 3);
    expectUniqueFamilies(legs);
    expect(legs.filter((l) => l.family === "CORNERS")).toHaveLength(1);
    expect(legs.some((l) => l.id === "corners")).toBe(false);
  });

  it("never selects duplicate Goals legs (recommended + goals + ht)", () => {
    const row = baseRow({
      recommended: { pick: "Over 2.5", confidence: 93, odd: 1.9, family: "Over/Under" }
    });
    const pool = listSpecialBetCandidates(row, labels);
    expect(pool.find((l) => l.id === "recommended")?.family).toBe("GOALS");
    const legs = pickSpecialBetLegs(pool, 3);
    expectUniqueFamilies(legs);
    expect(legs.filter((l) => l.family === "GOALS")).toHaveLength(1);
  });

  it("never selects duplicate BTTS legs", () => {
    const pool = [
      leg("recommended", "BTTS", 92, "GG"),
      leg("gg", "BTTS", 88, "NGG"),
      leg("goals", "GOALS", 80, "Over 2.5"),
      leg("corners", "CORNERS", 75, "Over 8.5")
    ];
    const legs = pickSpecialBetLegs(pool, 3);
    expect(legs.map((l) => l.pick)).toEqual(["GG", "Over 2.5", "Over 8.5"]);
    expect(legs.filter((l) => l.family === "BTTS")).toHaveLength(1);
  });

  it("never selects duplicate Cards legs", () => {
    const pool = [
      leg("recommended", "CARDS", 90, "Over 3.5"),
      leg("cards", "CARDS", 85, "Under 3.5"),
      leg("gg", "BTTS", 80, "GG"),
      leg("goals", "GOALS", 70, "Over 2.5")
    ];
    const legs = pickSpecialBetLegs(pool, 3);
    expectUniqueFamilies(legs);
    expect(legs.filter((l) => l.family === "CARDS")).toHaveLength(1);
    expect(legs[0].pick).toBe("Over 3.5");
  });

  it("never selects duplicate Double Chance legs", () => {
    const pool = [
      leg("recommended", "DOUBLE_CHANCE", 91, "1X"),
      leg("goals", "GOALS", 80, "Over 2.5"),
      leg("gg", "BTTS", 78, "GG"),
      // Synthetic second DC (no dedicated DC slot in production pool)
      { ...leg("shots", "DOUBLE_CHANCE", 88, "12"), id: "shots" as const }
    ];
    const legs = pickSpecialBetLegs(pool, 3);
    expectUniqueFamilies(legs);
    expect(legs.filter((l) => l.family === "DOUBLE_CHANCE")).toHaveLength(1);
    expect(legs[0].pick).toBe("1X");
  });

  it("never selects duplicate 1X2 legs", () => {
    const pool = [
      leg("recommended", "1X2", 94, "1"),
      { ...leg("shots", "1X2", 90, "2"), id: "shots" as const },
      leg("gg", "BTTS", 85, "GG"),
      leg("corners", "CORNERS", 70, "Over 8.5")
    ];
    const legs = pickSpecialBetLegs(pool, 3);
    expectUniqueFamilies(legs);
    expect(legs.filter((l) => l.family === "1X2")).toHaveLength(1);
    expect(legs[0].pick).toBe("1");
  });

  it("from a multi-line Corners pool keeps only the highest-scoring Corners leg", () => {
    const pool = [
      leg("recommended", "CORNERS", 91, "Under 10.5"),
      leg("corners", "CORNERS", 88, "Over 9.5"),
      leg("goals", "GOALS", 80, "Over 2.5"),
      leg("gg", "BTTS", 78, "GG"),
      { ...leg("shots", "CORNERS", 75, "Under 11.5"), id: "shots" as const }
    ];
    const legs = pickSpecialBetLegs(pool, 3);
    expect(legs.map((l) => l.pick)).toEqual(["Under 10.5", "Over 2.5", "GG"]);
    expect(legs.filter((l) => l.family === "CORNERS")).toHaveLength(1);
  });

  it("treats Over/Under-tagged high lines as Corners so they cannot pair with the corners slot", () => {
    const row = baseRow({
      recommended: { pick: "Under 10.5", confidence: 92, odd: 1.95, family: "Over/Under" }
    });
    const pool = listSpecialBetCandidates(row, labels);
    expect(pool.find((l) => l.id === "recommended")?.family).toBe("CORNERS");
    const legs = pickSpecialBetLegs(pool, 3);
    expectUniqueFamilies(legs);
    expect(legs.filter((l) => l.family === "CORNERS")).toHaveLength(1);
  });
});

describe("specialBet edge cases + determinism", () => {
  it("is deterministic across repeated runs on the same fixture", () => {
    const row = baseRow();
    const a = buildSpecialBetLegs(row, labels, 3);
    const b = buildSpecialBetLegs(row, labels, 3);
    expect(a.map((l) => `${l.id}:${l.pick}:${l.family}`)).toEqual(
      b.map((l) => `${l.id}:${l.pick}:${l.family}`)
    );
  });

  it("breaks score ties with a fixed leg-id order (no randomness)", () => {
    const pool = [
      leg("corners", "CORNERS", 80, "Over 8.5"),
      leg("gg", "BTTS", 80, "GG"),
      leg("goals", "GOALS", 80, "Over 2.5")
    ];
    // Unsorted / reverse insertion — picker must still prefer goals before gg before corners.
    const legs = pickSpecialBetLegs([...pool].reverse(), 3);
    expect(legs.map((l) => l.id)).toEqual(["goals", "gg", "corners"]);
  });

  it("returns fewer than legCount when only one family is available", () => {
    const pool = [
      leg("recommended", "CORNERS", 90, "Under 10.5"),
      leg("corners", "CORNERS", 85, "Over 9.5")
    ];
    expect(pickSpecialBetLegs(pool, 3)).toHaveLength(1);
    expect(pickSpecialBetLegs(pool, 3)[0].pick).toBe("Under 10.5");
  });

  it("drops the recommended leg when odds or confidence are missing", () => {
    const noOdd = listSpecialBetCandidates(
      baseRow({
        recommended: { pick: "Under 10.5", confidence: 90, odd: null as unknown as number, family: "Corners" },
        odds: { home: null as unknown as number, draw: null as unknown as number, away: null as unknown as number },
        marketOdds: {
          btts: { pick: "GG", odd: 1.72 },
          goals25: { pick: "Over 2.5", line: 2.5, odd: 1.9, over: 1.9, under: 1.95 },
          corners: { pick: "Over 8.5", line: 8.5, odd: 1.8, over: 1.8, under: 2.0 },
          shotsOnTarget: { pick: "Over 4.5", line: 4.5, odd: 1.75, over: 1.75, under: 2.05 },
          firstHalfGoals: { pick: "Over 1.5 FH", line: 1.5, odd: 2.1, over: 2.1, under: 1.7 },
          cards: { pick: "Cards", line: 3.5, odd: 1.9, over: 1.9, under: 1.95 }
        }
      }),
      labels
    );
    expect(noOdd.some((l) => l.id === "recommended")).toBe(false);

    const noConf = listSpecialBetCandidates(
      baseRow({ recommended: { pick: "1", confidence: null as unknown as number, odd: 1.85 } }),
      labels
    );
    expect(noConf.some((l) => l.id === "recommended")).toBe(false);
  });

  it("handles missing recommendation pick (legacy / empty payload)", () => {
    const pool = listSpecialBetCandidates(
      baseRow({ recommended: { pick: "", confidence: 90, odd: 1.85 } }),
      labels
    );
    expect(pool.some((l) => l.id === "recommended")).toBe(false);
    const legs = pickSpecialBetLegs(pool, 2);
    expect(legs.length).toBeGreaterThanOrEqual(2);
    expectUniqueFamilies(legs);
  });

  it("resolves legacy rows without recommended.family via pick inference", () => {
    const pool = listSpecialBetCandidates(
      baseRow({
        recommended: { pick: "Under 10.5", confidence: 88, odd: 1.95 }
      }),
      labels
    );
    expect(pool.find((l) => l.id === "recommended")?.family).toBe("CORNERS");
    expectUniqueFamilies(pickSpecialBetLegs(pool, 3));
  });

  it("tolerates mixed legacy/new family spellings on the recommended leg", () => {
    for (const family of ["Corners", "corners", "CORNERS", "Over-Under", "over under"]) {
      const pick = family.toLowerCase().includes("corner") ? "Under 10.5" : "Over 2.5";
      const expected = family.toLowerCase().includes("corner") ? "CORNERS" : "GOALS";
      const pool = listSpecialBetCandidates(
        baseRow({ recommended: { pick, confidence: 90, odd: 1.9, family } }),
        labels
      );
      expect(pool.find((l) => l.id === "recommended")?.family).toBe(expected);
    }
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
