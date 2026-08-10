import { describe, expect, test } from "vitest";
import type { PredictionRow } from "../types";
import { gradeOverUnder, resolveCardMarketOutcome } from "./cardMarketOutcome";
import { listSpecialBetCandidates, pickSpecialBetLegs, specialBetCombinedOutcome } from "./specialBet";

/**
 * Regression guard for the reported Special Bet settlement bug.
 *
 * Reported case: a 2-2 final with 18 corners and 7 shots on target. The market
 * tiles rendered WIN for Over 7.5 corners, Under 10.5 shots and Over 1.5 goals,
 * while the Special Bet rendered LOSE for all three legs and for the combination.
 *
 * Cause: `cardMarketValidations` is a cache, and `resolveCardMarketOutcome`
 * returned it before ever looking at the official totals. The tiles graded the
 * real total live (`PoissonMarketSection`), the Special Bet echoed a stale cache,
 * and the two disagreed. The official total now outranks the cache.
 */

const LABELS = {
  main: "Main",
  goals: "Goals",
  corners: "Corners",
  shots: "Shots",
  ht: "HT",
  gg: "GG",
  cards: "Cards"
};

/** 2-2 final: 4 goals, 18 corners, 7 shots on target — the reported fixture's shape. */
function settledRow(overrides: Record<string, unknown> = {}): PredictionRow {
  return {
    id: 1,
    status: "FT",
    score: { home: 2, away: 2 },
    teams: { home: "Home", away: "Away" },
    recommended: { pick: "Over 2.5", family: "Goals", confidence: 70, odd: 1.9 },
    marketResults: { cornersTotal: 18, shotsOnTargetTotal: 7 },
    probs: {
      pO15: 88,
      pO25: 70,
      corners: { total: { o7_5: 82 } },
      shotsOnTarget: { total: { o10_5: 22 } }
    },
    marketOdds: {
      corners: { odd: 1.8, line: 7.5, pick: "Over 7.5", over: 1.8, under: 2.0 },
      shotsOnTarget: { odd: 1.9, line: 10.5, pick: "Under 10.5", over: 2.1, under: 1.9 },
      goals15: { over: 1.25, under: 3.8 }
    },
    ...overrides
  } as unknown as PredictionRow;
}

/** The verdict cache as the server left it — wrong, and written before the stats landed. */
const STALE_LOSSES = {
  recommended: null,
  goals: "loss",
  corners: "loss",
  shots: "loss"
} as unknown as PredictionRow["cardMarketValidations"];

function legsOf(row: PredictionRow, stored = row.cardMarketValidations) {
  const legs = pickSpecialBetLegs(listSpecialBetCandidates(row, LABELS, stored), 3);
  return Object.fromEntries(legs.map((l) => [l.id, l]));
}

describe("gradeOverUnder handles both sides of a .5 line", () => {
  test("corners 18 clears Over 7.5", () => {
    expect(gradeOverUnder("over", 7.5, 18)).toBe("win");
  });

  test("shots 7 stays under Under 10.5", () => {
    expect(gradeOverUnder("under", 10.5, 7)).toBe("win");
  });

  test("goals 4 clears Over 1.5", () => {
    expect(gradeOverUnder("over", 1.5, 4)).toBe("win");
  });

  test("a total below the line loses an Over", () => {
    expect(gradeOverUnder("over", 10.5, 7)).toBe("loss");
  });

  test("a total above the line loses an Under", () => {
    expect(gradeOverUnder("under", 7.5, 18)).toBe("loss");
  });

  test("a missing total settles nothing", () => {
    expect(gradeOverUnder("over", 7.5, null)).toBe("pending");
    expect(gradeOverUnder("over", 7.5, Number.NaN)).toBe("pending");
  });
});

describe("Special Bet settles from the official total, not a stale cache", () => {
  test("reported case: every leg wins and so does the combination", () => {
    const legs = legsOf(settledRow());

    expect(legs.corners.pick).toBe("Over 7.5");
    expect(legs.corners.outcome).toBe("win");
    expect(legs.shots.pick).toBe("Under 10.5");
    expect(legs.shots.outcome).toBe("win");
    expect(legs.goals.pick).toBe("Over 1.5");
    expect(legs.goals.outcome).toBe("win");
    expect(specialBetCombinedOutcome(Object.values(legs))).toBe("win");
  });

  test("a stale LOSS cache no longer overrides the totals that disprove it", () => {
    const row = settledRow({ cardMarketValidations: STALE_LOSSES });
    const legs = legsOf(row);

    expect(legs.corners.outcome).toBe("win");
    expect(legs.shots.outcome).toBe("win");
    expect(legs.goals.outcome).toBe("win");
    expect(specialBetCombinedOutcome(Object.values(legs))).toBe("win");
  });

  test("the Special Bet and the market tiles cannot disagree", () => {
    const row = settledRow({ cardMarketValidations: STALE_LOSSES });
    const legs = legsOf(row);

    for (const marketId of ["goals", "corners", "shots"] as const) {
      expect(legs[marketId].outcome).toBe(resolveCardMarketOutcome(marketId, row));
    }
  });

  test("a genuinely lost leg still reads LOSE", () => {
    // Same fixture, but only 5 corners: Over 7.5 fails on the real total.
    const row = settledRow({ marketResults: { cornersTotal: 5, shotsOnTargetTotal: 7 } });
    const legs = legsOf(row);

    expect(legs.corners.outcome).toBe("loss");
    expect(legs.shots.outcome).toBe("win");
  });

  test("2 of 3 legs winning is a lost combination", () => {
    const row = settledRow({ marketResults: { cornersTotal: 5, shotsOnTargetTotal: 7 } });
    const legs = legsOf(row);

    expect([legs.goals.outcome, legs.shots.outcome]).toEqual(["win", "win"]);
    expect(specialBetCombinedOutcome(Object.values(legs))).toBe("loss");
  });

  test("without official totals the cached verdict is still honoured", () => {
    // The cache is a fallback, not a liability: with no statistics to check it
    // against, it remains the only answer available.
    const row = settledRow({
      marketResults: undefined,
      cardMarketValidations: STALE_LOSSES
    });

    expect(resolveCardMarketOutcome("corners", row)).toBe("loss");
  });

  test("an unfinished match settles nothing", () => {
    const row = settledRow({ status: "1H" });
    expect(resolveCardMarketOutcome("corners", row)).toBe(null);
  });
});
