import { describe, it, expect } from "vitest";
import type { HistoryEntry } from "../types";
import {
  computeSimpleRoi,
  historyStatsFromRows,
  isRecommendedSlotExcluded,
  listCardMarketOutcomes
} from "./historyStats";

/**
 * Migration 066 on the client: the recommended slot of an invalid recommendation
 * stops counting, and nothing else moves. The module had no test file before
 * this PR, so the untouched behaviours are pinned here too.
 */

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 1,
    league: "Premier League",
    teams: { home: "A", away: "B" },
    kickoff: "2026-08-29T11:30:00Z",
    status: "FT",
    score: { home: 2, away: 2 },
    recommended: { pick: "Shots Over 10.5", confidence: 100, odd: 2.95 },
    validation: "win",
    cardMarketValidations: { recommended: "win", goals: "loss", corners: "win", shots: "win" },
    ...overrides
  } as unknown as HistoryEntry;
}

describe("recommended-market validity (066)", () => {
  it("[L] drops only the recommended slot — goals / corners / shots still count", () => {
    const baseline = historyStatsFromRows([entry()]);
    expect(baseline).toMatchObject({ wins: 3, losses: 1, settled: 4 });

    const excluded = historyStatsFromRows([entry({ recommendedMarketValid: false })]);
    expect(excluded.settled).toBe(3);
    expect(excluded.wins).toBe(2);
    expect(excluded.losses).toBe(1);
    expect(listCardMarketOutcomes(entry({ recommendedMarketValid: false }))).toEqual([
      "loss",
      "win",
      "win"
    ]);
  });

  it("[K] a valid or unclassified recommendation counts exactly as before", () => {
    const baseline = historyStatsFromRows([entry()]);
    for (const flag of [true, undefined]) {
      expect(historyStatsFromRows([entry({ recommendedMarketValid: flag })])).toEqual(baseline);
    }
  });

  it("[G] computeSimpleRoi ignores an invalid recommendation entirely — no stake, no P&L", () => {
    const rows = [
      entry({ id: 1, validation: "win", recommended: { pick: "Shots Over 10.5", confidence: 100, odd: 3 } }),
      entry({ id: 2, validation: "loss", recommended: { pick: "Over 2.5", confidence: 60, odd: 2 } })
    ] as HistoryEntry[];
    // 1u each: +2 and -1 over 2 units staked.
    expect(computeSimpleRoi(rows)).toBeCloseTo(50, 6);

    const remediated = [{ ...rows[0], recommendedMarketValid: false }, rows[1]] as HistoryEntry[];
    // Only the losing legitimate pick remains: -1 over 1 unit.
    expect(computeSimpleRoi(remediated)).toBeCloseTo(-100, 6);

    // Excluding every row leaves no stake at all, which is null, not 0%.
    expect(computeSimpleRoi(rows.map((r) => ({ ...r, recommendedMarketValid: false })))).toBeNull();
  });

  it("the legacy single-outcome fallback is the recommended pick, so it is excluded too", () => {
    const legacy = entry({ cardMarketValidations: null });
    expect(listCardMarketOutcomes(legacy)).toEqual(["win"]);
    expect(listCardMarketOutcomes({ ...legacy, recommendedMarketValid: false })).toEqual([]);
  });

  it("only an explicit false excludes", () => {
    expect(isRecommendedSlotExcluded(entry({ recommendedMarketValid: false }))).toBe(true);
    expect(isRecommendedSlotExcluded(entry({ recommendedMarketValid: true }))).toBe(false);
    expect(isRecommendedSlotExcluded(entry())).toBe(false);
  });

  it("push and half outcomes stay separate counters, unchanged by this PR", () => {
    const stats = historyStatsFromRows([
      entry({
        cardMarketValidations: { recommended: "push", goals: "half_win", corners: "half_loss", shots: "win" }
      })
    ]);
    expect(stats).toMatchObject({
      wins: 1,
      losses: 0,
      settled: 1,
      pushes: 1,
      halfWins: 1,
      halfLosses: 1
    });
  });
});
