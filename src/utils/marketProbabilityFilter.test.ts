import { describe, expect, it } from "vitest";
import type { PredictionRow } from "../types";
import {
  MARKET_FILTERS,
  marketOdd,
  marketProbability,
  rankByMarketProbability,
  toPercent
} from "./marketProbabilityFilter";

/**
 * The ranking metric is a MARKET PROBABILITY the model already produced. These
 * tests exist to pin the two ways that goes quietly wrong: reading a lookalike
 * field (confidence, the winning side's probability, the full-time value when
 * the first half was asked for), and turning "no value" into "zero".
 */

type ProbsInput = {
  pGG?: unknown;
  pO15?: unknown;
  pO25?: unknown;
  firstHalf?: { pO15?: unknown } | null;
};

const row = (id: number, probs: ProbsInput | null | undefined, over: Record<string, unknown> = {}) =>
  ({
    id,
    kickoff: "2026-01-01T18:00:00+00:00",
    teams: { home: `H${id}`, away: `A${id}` },
    league: "L",
    status: "NS",
    probs,
    // Deliberately WRONG numbers in every lookalike field. If the ranking ever
    // reads one of these instead of `probs`, the orders below invert.
    recommended: { pick: "1", confidence: 100 - id },
    predictions: { marketTiers: { gg: { prob: 100 - id }, over25: { prob: 100 - id } } },
    valueBet: { ev: 100 - id },
    ...over
  }) as unknown as PredictionRow;

/** The brief's own worked example. */
const A = row(1, { pGG: 91, pO15: 96, pO25: 78, firstHalf: { pO15: 54 } });
const B = row(2, { pGG: 96, pO15: 91, pO25: 72, firstHalf: { pO15: 68 } });
const C = row(3, { pGG: 83, pO15: 99, pO25: 87, firstHalf: { pO15: 61 } });
const ids = (rows: PredictionRow[]) => rows.map((r) => r.id);

describe("rankByMarketProbability · the four markets", () => {
  it("[1] 'all' returns the very same array — order and identity untouched", () => {
    const input = [C, A, B];
    const out = rankByMarketProbability(input, "all");
    expect(out).toBe(input);
    expect(ids(out)).toEqual([3, 1, 2]);
  });

  it("[2] GG ranks by BTTS-yes probability, descending", () => {
    expect(ids(rankByMarketProbability([A, B, C], "gg"))).toEqual([2, 1, 3]);
  });

  it("[3] +1.5 FT ranks by full-time Over 1.5, descending", () => {
    expect(ids(rankByMarketProbability([A, B, C], "o15ft"))).toEqual([3, 1, 2]);
  });

  it("[4] +2.5 FT ranks by full-time Over 2.5, descending", () => {
    expect(ids(rankByMarketProbability([A, B, C], "o25ft"))).toEqual([3, 1, 2]);
  });

  it("[5] +1.5 FH ranks by FIRST-HALF Over 1.5, descending", () => {
    expect(ids(rankByMarketProbability([A, B, C], "o15fh"))).toEqual([2, 3, 1]);
  });

  it("reads the first-half container, not the full-time field of the same name", () => {
    // Full time says X is best; first half says Y. Same key, two containers.
    const X = row(10, { pO15: 99, firstHalf: { pO15: 10 } });
    const Y = row(11, { pO15: 10, firstHalf: { pO15: 60 } });
    expect(ids(rankByMarketProbability([X, Y], "o15ft"))).toEqual([10, 11]);
    expect(ids(rankByMarketProbability([X, Y], "o15fh"))).toEqual([11, 10]);
    expect(marketProbability(X, "o15fh")).toBe(10);
    expect(marketProbability(X, "o15ft")).toBe(99);
  });

  it("never ranks by confidence, the winning-side probability, or EV", () => {
    // Every lookalike on these rows points the OTHER way (100 - id).
    const lo = row(1, { pGG: 10 });
    const hi = row(2, { pGG: 90 });
    expect(ids(rankByMarketProbability([lo, hi], "gg"))).toEqual([2, 1]);
  });

  it("does not mutate the input array", () => {
    const input = [A, B, C];
    rankByMarketProbability(input, "gg");
    expect(ids(input)).toEqual([1, 2, 3]);
  });
});

describe("rankByMarketProbability · missing and malformed", () => {
  it("[6] a row without the market is excluded, not ranked last", () => {
    const none = row(4, { pO15: 50, pO25: 50 }); // no pGG
    const noFh = row(5, { pGG: 50, pO15: 50, pO25: 50 }); // no firstHalf block
    const emptyFh = row(6, { pGG: 50, firstHalf: {} }); // the `view=list` stub: truthy, no pO15
    expect(ids(rankByMarketProbability([A, none], "gg"))).toEqual([1]);
    expect(ids(rankByMarketProbability([A, noFh, emptyFh], "o15fh"))).toEqual([1]);
  });

  it("[7] probability 0 is a real value and stays in the list", () => {
    const zero = row(7, { pGG: 0 });
    expect(marketProbability(zero, "gg")).toBe(0);
    expect(ids(rankByMarketProbability([zero, A], "gg"))).toEqual([1, 7]);
  });

  it("[8] 100% is a real value and ranks first", () => {
    const sure = row(8, { pGG: 100 });
    expect(marketProbability(sure, "gg")).toBe(100);
    expect(ids(rankByMarketProbability([A, sure, B], "gg"))).toEqual([8, 2, 1]);
  });

  it("[10] null / undefined / NaN / junk are MISSING — never zero", () => {
    for (const junk of [null, undefined, NaN, Infinity, -Infinity, "", "   ", "abc", true, false, {}, []]) {
      expect(toPercent(junk), `toPercent(${String(junk)})`).toBeNull();
      expect(ids(rankByMarketProbability([row(9, { pGG: junk }), A], "gg"))).toEqual([1]);
    }
    // Number(null) === 0 is the exact trap: a missing value must not sneak in as 0%.
    expect(marketProbability(row(9, { pGG: null }), "gg")).toBeNull();
  });

  it("survives a row with no probs at all, and a null row", () => {
    expect(ids(rankByMarketProbability([row(12, null), row(13, undefined), A], "gg"))).toEqual([1]);
    expect(marketProbability(null, "gg")).toBeNull();
    expect(marketProbability(undefined, "gg")).toBeNull();
  });

  it("drops values outside 0-100 as corrupt rather than clamping them into the ranking", () => {
    expect(toPercent(-1)).toBeNull();
    expect(toPercent(100.01)).toBeNull();
    expect(toPercent(250)).toBeNull();
    expect(ids(rankByMarketProbability([row(14, { pGG: 250 }), A], "gg"))).toEqual([1]);
  });

  it("accepts a numeric string, the one tolerant case", () => {
    expect(toPercent("62.4")).toBe(62.4);
  });
});

describe("toPercent · the scale is explicit, never guessed", () => {
  it("treats a sub-1 value as the percentage it is — 0.7 means 0.7%, not 70%", () => {
    /*
      The tempting heuristic is "<= 1 looks like a fraction, so multiply by 100".
      It is wrong exactly where it fires: 0.7 is an ordinary first-half Over 1.5.
      Rescaling it would put a 0.7% match at the top of the list as 70%.
    */
    expect(toPercent(0.7)).toBe(0.7);
    expect(toPercent(1)).toBe(1);
    const tiny = row(20, { firstHalf: { pO15: 0.7 } });
    const real = row(21, { firstHalf: { pO15: 40 } });
    expect(ids(rankByMarketProbability([tiny, real], "o15fh"))).toEqual([21, 20]);
  });

  it("keeps the exact value — no rounding inside the ranking", () => {
    expect(toPercent(44.347033964730535)).toBe(44.347033964730535);
    const a = row(22, { pGG: 91.6 });
    const b = row(23, { pGG: 92.4 });
    // Both display as 92%, but the order is decided on the real numbers.
    expect(ids(rankByMarketProbability([a, b], "gg"))).toEqual([23, 22]);
  });
});

describe("rankByMarketProbability · determinism", () => {
  it("[9] ties break by kickoff ascending, then fixture id ascending", () => {
    const late = row(30, { pGG: 70 }, { kickoff: "2026-01-01T20:00:00+00:00" });
    const earlyHighId = row(32, { pGG: 70 }, { kickoff: "2026-01-01T15:00:00+00:00" });
    const earlyLowId = row(31, { pGG: 70 }, { kickoff: "2026-01-01T15:00:00+00:00" });
    const expected = [31, 32, 30];
    // Every input permutation yields the same output: the order is a function
    // of the data, not of arrival order or the engine's sort stability.
    for (const input of [
      [late, earlyHighId, earlyLowId],
      [earlyLowId, late, earlyHighId],
      [earlyHighId, earlyLowId, late]
    ]) {
      expect(ids(rankByMarketProbability(input, "gg"))).toEqual(expected);
    }
  });

  it("an unparseable kickoff sorts last among ties instead of scrambling them", () => {
    const bad = row(40, { pGG: 70 }, { kickoff: "not-a-date" });
    const good = row(41, { pGG: 70 });
    expect(ids(rankByMarketProbability([bad, good], "gg"))).toEqual([41, 40]);
  });

  it("a fixture listed twice is ranked once", () => {
    const first = row(50, { pGG: 60 });
    const again = row(50, { pGG: 99 });
    const out = rankByMarketProbability([first, again, A], "gg");
    expect(ids(out)).toEqual([1, 50]);
    expect(out[1]).toBe(first);
  });

  it("an empty list stays empty for every option", () => {
    for (const market of MARKET_FILTERS) expect(rankByMarketProbability([], market)).toEqual([]);
  });
});

describe("marketOdd · the price of the same side, or nothing", () => {
  const withOdds = (marketOdds: unknown) => row(60, { pGG: 50 }, { marketOdds });

  it("prices GG only from a GG quote — never from NGG", () => {
    expect(marketOdd(withOdds({ btts: { pick: "GG", odd: 1.75 } }), "gg")).toBe(1.75);
    expect(marketOdd(withOdds({ btts: { pick: "NGG", odd: 2.05 } }), "gg")).toBeNull();
    expect(marketOdd(withOdds({ btts: { pick: "GG", odd: 1.75, tradable: false } }), "gg")).toBeNull();
    expect(marketOdd(withOdds({ btts: { pick: "GG", odd: null } }), "gg")).toBeNull();
    expect(marketOdd(withOdds({}), "gg")).toBeNull();
  });

  it("prices the goals lines from their Over side", () => {
    const r = withOdds({
      goals15: { pick: "Over 1.5", odd: 1.3, over: 1.3, under: 3.4 },
      goals25: { pick: "Under 2.5", odd: 1.8, over: 2.0, under: 1.8 }
    });
    expect(marketOdd(r, "o15ft")).toBe(1.3);
    expect(marketOdd(r, "o25ft")).toBe(2.0);
  });

  it("never turns a first-half Under quote into an Over price", () => {
    expect(
      marketOdd(withOdds({ firstHalfGoals: { pick: "Under 1.5 FH", line: 1.5, odd: 1.36 } }), "o15fh")
    ).toBeNull();
    expect(
      marketOdd(withOdds({ firstHalfGoals: { pick: "Over 1.5 FH", line: 1.5, odd: 2.9 } }), "o15fh")
    ).toBe(2.9);
  });
});
