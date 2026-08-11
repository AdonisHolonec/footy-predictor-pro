import { describe, expect, test } from "vitest";
import type { PredictionRow } from "../types";
import { deriveAlignedOuPick, matchingMarketOdd, shotsDisplayOdd } from "./marketPicks";

/**
 * The frontend must honour the server's line contract exactly: an odd is only ever shown
 * against the line it belongs to. Three escapes used to live in this module — a
 * cross-market bypass that skipped the line check for total-shots / team-SOT sources, an
 * unchecked `shotsOnTarget.odd` fallback, and a 4.0-wide tolerance on shots total. All
 * three could print a price the user could not obtain.
 */

function row(marketOdds: PredictionRow["marketOdds"]): PredictionRow {
  return { marketOdds } as PredictionRow;
}

describe("matchingMarketOdd", () => {
  test("returns the price when the quote is for exactly this line and side", () => {
    const quote = { pick: "Over 8.5", line: 8.5, odd: 1.75, over: 1.75, under: 2.05, tradable: true };
    expect(matchingMarketOdd(quote, "over", 8.5)).toBe(1.75);
    expect(matchingMarketOdd(quote, "under", 8.5)).toBe(2.05);
  });

  test("returns null for a foreign line", () => {
    const quote = { pick: "Over 8.5", line: 8.5, odd: 1.75, over: 1.75, under: 2.05, tradable: true };
    expect(matchingMarketOdd(quote, "over", 6.5)).toBeNull();
    expect(matchingMarketOdd(quote, "over", 9.5)).toBeNull();
  });

  test("respects the server's tradable=false verdict even when an odd is present", () => {
    const quote = { pick: "Over 6.5", line: 6.5, odd: 1.75, over: 1.75, tradable: false };
    expect(matchingMarketOdd(quote, "over", 6.5)).toBeNull();
  });

  test("a cross-market source no longer bypasses the line-distance check", () => {
    // oddSource total-shots used to skip the distance check entirely, so this returned 1.75.
    const quote = {
      pick: "Over 6.5",
      line: 8.5,
      odd: 1.75,
      over: 1.75,
      oddSource: "shots_total",
      tradable: true
    };
    expect(matchingMarketOdd(quote, "over", 6.5)).toBeNull();
  });

  test("team-SOT sources are held to the same line check", () => {
    for (const oddSource of ["team_home", "team_away"]) {
      const quote = { pick: "Over 3.5", line: 3.5, odd: 1.9, over: 1.9, oddSource, tradable: true };
      expect(matchingMarketOdd(quote, "over", 6.5)).toBeNull();
    }
  });

  test("defaults to exact-line matching", () => {
    const quote = { pick: "Over 9.5", line: 9.5, odd: 1.8, over: 1.8, tradable: true };
    // 1.0 away — the old 1.5 default would have matched this.
    expect(matchingMarketOdd(quote, "over", 8.5)).toBeNull();
  });
});

describe("shotsDisplayOdd", () => {
  test("shows the SOT price for the SOT line", () => {
    const r = row({ shotsOnTarget: { pick: "Over 8.5", line: 8.5, odd: 1.75, over: 1.75, tradable: true } });
    expect(shotsDisplayOdd(r, "over", 8.5)).toBe(1.75);
  });

  test("model line 6.5 never receives the bookmaker's 8.5 price", () => {
    const r = row({
      shotsOnTarget: {
        pick: "Over 6.5",
        line: 6.5,
        odd: null,
        over: null,
        tradable: false,
        requestedLine: 6.5,
        bookLine: 8.5,
        lineExact: false,
        untradableReason: "no_model_probability_at_book_line"
      }
    });
    expect(shotsDisplayOdd(r, "over", 6.5)).toBeNull();
  });

  test("no longer falls back to the total-shots market", () => {
    const r = row({
      shotsTotal: { pick: "Over 20.5", line: 20.5, odd: 1.9, over: 1.9, tradable: true }
    });
    // Total shots is a different market: it may never price the shots-on-target row.
    expect(shotsDisplayOdd(r, "over", 6.5)).toBeNull();
    expect(shotsDisplayOdd(r, "over", 20.5)).toBeNull();
  });

  test("no longer falls back to a raw SOT odd with no line check", () => {
    const r = row({
      shotsOnTarget: { pick: "Over 10.5", line: 10.5, odd: 2.6, over: 2.6, tradable: true }
    });
    expect(shotsDisplayOdd(r, "over", 6.5)).toBeNull();
  });
});

describe("deriveAlignedOuPick", () => {
  const ladder = { o7_5: 78, o8_5: 68, o9_5: 57, o10_5: 45 };

  // The model's own best line here is Over 7.5 at 78%.

  test("prefers the server's probability at the bookmaker's line", () => {
    const pick = deriveAlignedOuPick(ladder, {
      pick: "Over 8.5",
      line: 8.5,
      odd: 1.95,
      probabilityLine: 8.5,
      probabilityPct: 68,
      tradable: true
    });
    expect(pick).toEqual({ line: 8.5, side: "over", probability: 68 });
  });

  test("re-reads the ladder at the book line when the server did not supply one", () => {
    const pick = deriveAlignedOuPick(ladder, { pick: "Over 8.5", line: 8.5, odd: 1.95 });
    // P(Over 8.5) = 68, never P(Over 7.5) = 78 which is the model's own best line.
    expect(pick).toEqual({ line: 8.5, side: "over", probability: 68 });
  });

  test("keeps the model line rather than moving the line without its probability", () => {
    // 8.0 is inside the tolerance but absent from the ladder: the old code returned line
    // 8.0 carrying P(7.5) = 78, moving the line and leaving the probability behind.
    const pick = deriveAlignedOuPick(ladder, { pick: "Over 8.0", line: 8.0, odd: 1.9 });
    expect(pick).toEqual({ line: 7.5, side: "over", probability: 78 });
  });

  test("a book line beyond the tolerance leaves the model line untouched", () => {
    const pick = deriveAlignedOuPick(ladder, { pick: "Over 10.5", line: 10.5, odd: 1.95 });
    expect(pick).toEqual({ line: 7.5, side: "over", probability: 78 });
  });

  test("falls back to the model line when the server marks the quote non-tradable", () => {
    const pick = deriveAlignedOuPick(ladder, {
      pick: "Over 8.5",
      line: 8.5,
      odd: 1.95,
      tradable: false
    });
    expect(pick).toEqual({ line: 7.5, side: "over", probability: 78 });
  });

  test("probability and line always describe the same event", () => {
    const quotes = [
      { pick: "Over 9.5", line: 9.5, odd: 1.8 },
      { pick: "Under 8.5", line: 8.5, odd: 2.1 },
      { pick: "Over 11.5", line: 11.5, odd: 2.4 },
      null
    ];
    for (const quote of quotes) {
      const pick = deriveAlignedOuPick(ladder, quote);
      expect(pick).not.toBeNull();
      const key = `o${String(pick?.line).replace(".", "_")}` as keyof typeof ladder;
      const pOver = ladder[key];
      expect(pOver).toBeDefined();
      expect(pick?.probability).toBe(pick?.side === "over" ? pOver : 100 - pOver);
    }
  });
});
