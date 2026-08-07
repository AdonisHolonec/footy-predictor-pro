import { describe, expect, test } from "vitest";
import type { PredictionRow } from "../types";
import { resolveCardMarketOutcome } from "./cardMarketOutcome";

/**
 * Regression guard for the P0 settlement inconsistency.
 *
 * Reported case: recommended pick "Over 7.5" on family Corners, match finished 1-0,
 * official corners 8. Markets → Corners rendered WIN, Special Bet rendered LOSE, and
 * Recommended Prediction rendered "no result". Three surfaces, three answers.
 *
 * Every one of those surfaces resolves the recommended verdict through
 * `resolveCardMarketOutcome("recommended", …)`:
 *   - PredictionFocusCard  → Recommended Prediction tile
 *   - MatchCard            → final-pick WIN/LOSE badge
 *   - MatchModal           → final-pick WIN/LOSE badge
 *   - specialBet.ts        → the "recommended" leg of the Special Bet
 * so proving this one function cannot disagree with itself proves the four agree.
 */

/** 1-0 final: goals total is 1, corners total is 8. The two must never be confused. */
function cornersRow(overrides: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id: 1,
    status: "FT",
    score: { home: 1, away: 0 },
    recommended: { pick: "Over 7.5", family: "Corners", confidence: 72, odd: 1.85 },
    marketResults: { cornersTotal: 8 },
    ...overrides
  } as unknown as PredictionRow;
}

describe("recommended settlement is server-resolved only", () => {
  test("reported case: persisted WIN renders WIN on every surface", () => {
    const row = cornersRow({
      cardMarketValidations: { recommended: "win", goals: null, corners: "win", shots: null }
    } as Partial<PredictionRow>);

    expect(resolveCardMarketOutcome("recommended", row)).toBe("win");
    expect(resolveCardMarketOutcome("corners", row)).toBe("win");
  });

  test("a Corners pick is never graded against goals scored", () => {
    // The old client fallback parsed "Over 7.5", compared it to home+away = 1, and returned
    // "loss". Any result other than the persisted value means the fallback is back.
    const row = cornersRow({
      cardMarketValidations: { recommended: "pending", goals: null, corners: "win", shots: null }
    } as Partial<PredictionRow>);

    expect(resolveCardMarketOutcome("recommended", row)).not.toBe("loss");
    expect(resolveCardMarketOutcome("recommended", row)).toBe("pending");
  });

  test("pending persists as pending — the client never upgrades or guesses it", () => {
    for (const stored of ["pending", null] as const) {
      const row = cornersRow({
        cardMarketValidations: { recommended: stored, goals: null, corners: null, shots: null }
      } as Partial<PredictionRow>);
      expect(resolveCardMarketOutcome("recommended", row)).toBe(stored);
    }
  });

  test("an explicit `stored` argument wins over the row's own validations", () => {
    // MatchCard passes row.cardMarketValidations; PredictionFocusCard passes the hydrated map.
    // Both must land on the same value when they carry the same verdict.
    const row = cornersRow({
      cardMarketValidations: { recommended: "pending", goals: null, corners: null, shots: null }
    } as Partial<PredictionRow>);

    expect(
      resolveCardMarketOutcome("recommended", row, {
        recommended: "win",
        goals: null,
        corners: "win",
        shots: null
      })
    ).toBe("win");
  });

  test("a 1X2 recommended pick is also server-resolved, not regraded from the score", () => {
    // "1" is trivially gradeable from a 1-0 score, but the client must still not do it:
    // one exception is how a second evaluator gets reintroduced.
    const row = cornersRow({
      recommended: { pick: "1", family: "1X2", confidence: 60, odd: 2.1 },
      cardMarketValidations: { recommended: "pending", goals: null, corners: null, shots: null }
    } as unknown as Partial<PredictionRow>);

    expect(resolveCardMarketOutcome("recommended", row)).toBe("pending");
  });

  test("non-recommended markets still settle locally from their own totals", () => {
    // Phase 0 restricts only the recommended pick — corners/goals/shots keep their local
    // grading, which is safe because their market family is fixed by construction.
    const row = cornersRow({
      probs: { corners: { total: { o7_5: 61 } } },
      marketOdds: { corners: { odd: 1.9, line: 7.5, pick: "Over 7.5" } },
      cardMarketValidations: { recommended: "pending", goals: null, corners: null, shots: null }
    } as unknown as Partial<PredictionRow>);

    expect(resolveCardMarketOutcome("corners", row)).toBe("win");
  });
});
