import assert from "node:assert/strict";
import { test } from "node:test";
import {
  repriceCandidateLine,
  priceLineFromBlock,
  ladderLinesFromBlock,
  enumerateLineSelections
} from "../../../server-utils/pipeline/decision/repriceCandidateLine.js";

/**
 * The bookmaker decides which lines exist. When the model's line is not quoted we either
 * reprice at the bookmaker's line or mark the selection non-tradable — we never move the
 * odd onto the model's line, and never move the line while leaving the probability behind.
 *
 * Contract asserted throughout: tradable === true  =>  probabilityLine === bookLine.
 */

/** Market block shaped like buildPoissonMarketBlock's output. */
function block({ lines = {}, lambdaHome = 0, lambdaAway = 0, correlation = 0 } = {}) {
  return { total: { ...lines }, lambdaHome, lambdaAway, correlation };
}

/** API-Football-shaped odds payload offering exactly the given lines. */
function bookWith(marketName, lines, bookNames = ["bet365", "unibet", "pinnacle"]) {
  return {
    response: [
      {
        bookmakers: bookNames.map((name) => ({
          name,
          bets: [
            {
              name: marketName,
              values: lines.flatMap(([ln, over, under]) => [
                { value: `Over ${ln}`, odd: String(over) },
                { value: `Under ${ln}`, odd: String(under) }
              ])
            }
          ]
        }))
      }
    ]
  };
}

/* ------------------------------------------------------------- ladder basics */

test("ladderLinesFromBlock reads the precomputed lines, ascending", () => {
  assert.deepEqual(ladderLinesFromBlock(block({ lines: { o10_5: 40, o8_5: 61, o9_5: 50 } })), [8.5, 9.5, 10.5]);
  assert.deepEqual(ladderLinesFromBlock(null), []);
});

test("priceLineFromBlock prefers the ladder and complements Under from Over", () => {
  const b = block({ lines: { o8_5: 61.2 } });
  const over = priceLineFromBlock(b, "over", 8.5);
  assert.equal(over.probabilityPct, 61.2);
  assert.equal(over.probabilityLine, 8.5);
  assert.equal(over.source, "ladder");

  const under = priceLineFromBlock(b, "under", 8.5);
  assert.equal(under.probabilityPct, 38.8);
  assert.equal(under.probabilityLine, 8.5);
  assert.equal(under.source, "ladder");
});

test("priceLineFromBlock falls back to the block's own lambdas for an off-ladder line", () => {
  const b = block({ lines: { o18_5: 70, o20_5: 55 }, lambdaHome: 11, lambdaAway: 10, correlation: 0.05 });
  const priced = priceLineFromBlock(b, "over", 19.5);
  assert.equal(priced.source, "analytic");
  assert.equal(priced.probabilityLine, 19.5);
  // Monotone in the line: P(Over 19.5) sits between the two ladder neighbours.
  assert.ok(priced.probabilityPct < 70 && priced.probabilityPct > 55);
});

test("priceLineFromBlock returns null when the model has neither ladder nor lambdas", () => {
  assert.equal(priceLineFromBlock(block({ lines: { o8_5: 61 } }), "over", 19.5), null);
  assert.equal(priceLineFromBlock(null, "over", 8.5), null);
});

/* ------------------------------------- CASE 3 / 6: shots 6.5 vs bookmaker 8.5 */

test("model shots 6.5 with a bookmaker 8.5 quote becomes Over 8.5 priced at 8.5", () => {
  const sot = block({ lines: { o6_5: 72, o7_5: 63, o8_5: 54, o9_5: 44, o10_5: 35 } });
  const out = repriceCandidateLine({
    block: sot,
    side: "over",
    requestedLine: 6.5,
    quote: { line: 8.5, over: 1.75, under: 2.05, bookmakersUsed: 3 }
  });
  assert.equal(out.tradable, true);
  assert.equal(out.bookLine, 8.5);
  assert.equal(out.probabilityLine, 8.5);
  assert.equal(out.probabilityPct, 54, "must be P(Over 8.5), never P(Over 6.5) = 72");
  assert.equal(out.odd, 1.75);
  assert.equal(out.lineExact, false);
  assert.equal(out.repriced, "ladder");
  assert.equal(out.requestedLine, 6.5);
});

test("lineExact=false never transfers the odd onto the model's line", () => {
  const sot = block({ lines: { o6_5: 72, o8_5: 54 } });
  const out = repriceCandidateLine({
    block: sot,
    side: "over",
    requestedLine: 6.5,
    quote: { line: 8.5, over: 1.75, bookmakersUsed: 3 }
  });
  // The odd exists, but it belongs to 8.5 and the result says so.
  assert.notEqual(out.probabilityLine, out.requestedLine);
  assert.equal(out.probabilityLine, out.bookLine);
  assert.notEqual(out.probabilityPct, 72);
});

test("no model probability at the bookmaker's line makes the selection non-tradable", () => {
  // Shots total ladder steps by 2.0 and carries no lambdas here: 19.5 cannot be priced.
  const shotsTotal = block({ lines: { o18_5: 70, o20_5: 55 } });
  const out = repriceCandidateLine({
    block: shotsTotal,
    side: "over",
    requestedLine: 18.5,
    quote: { line: 19.5, over: 1.9, bookmakersUsed: 4 }
  });
  assert.equal(out.tradable, false);
  assert.equal(out.odd, null, "a non-tradable selection carries no price");
  assert.equal(out.probabilityLine, null);
  assert.equal(out.probabilityPct, null);
  assert.equal(out.reason, "no_model_probability_at_book_line");
});

test("an off-ladder bookmaker line is repriced analytically when lambdas are available", () => {
  const shotsTotal = block({
    lines: { o18_5: 70, o20_5: 55, o22_5: 40, o24_5: 27 },
    lambdaHome: 11,
    lambdaAway: 10,
    correlation: 0.05
  });
  const out = repriceCandidateLine({
    block: shotsTotal,
    side: "over",
    requestedLine: 20.5,
    quote: { line: 19.5, over: 1.9, bookmakersUsed: 4 }
  });
  assert.equal(out.tradable, true);
  assert.equal(out.repriced, "analytic");
  assert.equal(out.bookLine, 19.5);
  assert.equal(out.probabilityLine, 19.5);
  assert.equal(out.odd, 1.9);
});

/* ------------------------------ CASE 5: corners P(9.5) never meets odds(10.5) */

test("corners: P(9.5) with odds(10.5) is impossible — the result is P(10.5) with odds(10.5)", () => {
  const corners = block({ lines: { o7_5: 78, o8_5: 68, o9_5: 57, o10_5: 45, o11_5: 34, o12_5: 24 } });
  const out = repriceCandidateLine({
    block: corners,
    side: "over",
    requestedLine: 9.5,
    quote: { line: 10.5, over: 1.95, under: 1.85, bookmakersUsed: 3 }
  });
  assert.equal(out.probabilityPct, 45, "P(Over 10.5), not P(Over 9.5) = 57");
  assert.equal(out.probabilityLine, 10.5);
  assert.equal(out.bookLine, 10.5);
  assert.equal(out.odd, 1.95);
});

/* ---------------------------------------------------------------- edge cases */

test("a missing quote or a missing side price yields a non-tradable, priceless selection", () => {
  const b = block({ lines: { o8_5: 54 } });
  const noQuote = repriceCandidateLine({ block: b, side: "over", requestedLine: 8.5, quote: null });
  assert.equal(noQuote.tradable, false);
  assert.equal(noQuote.reason, "no_bookmaker_quote");

  const noSide = repriceCandidateLine({
    block: b,
    side: "under",
    requestedLine: 8.5,
    quote: { line: 8.5, over: 1.9, under: null, bookmakersUsed: 2 }
  });
  assert.equal(noSide.tradable, false);
  assert.equal(noSide.odd, null);
  assert.equal(noSide.reason, "no_odd_for_side");
});

test("an exactly-quoted line is tradable and not flagged as repriced", () => {
  const out = repriceCandidateLine({
    block: block({ lines: { o9_5: 57 } }),
    side: "over",
    requestedLine: 9.5,
    quote: { line: 9.5, over: 1.8, bookmakersUsed: 5 }
  });
  assert.equal(out.tradable, true);
  assert.equal(out.lineExact, true);
  assert.equal(out.repriced, false);
  assert.equal(out.probabilityLine, out.bookLine);
});

/* -------------------------------------------------------------- enumeration */

test("enumerateLineSelections returns one tradable selection per offered side and line", () => {
  const corners = block({ lines: { o8_5: 68, o9_5: 57, o10_5: 45 } });
  const odds = bookWith("Corners Over/Under", [
    [9.5, 1.8, 2.0],
    [10.5, 1.95, 1.85]
  ]);
  const out = enumerateLineSelections({
    oddsData: odds,
    marketNames: ["Corners Over/Under", "Total Corners"],
    kind: "corners",
    block: corners,
    preferredLine: 9.5,
    maxLineDelta: 1
  });
  assert.equal(out.length, 4, "over+under for each of the two offered lines");
  assert.ok(out.every((s) => s.tradable && s.probabilityLine === s.bookLine));
  assert.ok(!out.some((s) => s.bookLine === 8.5), "8.5 is not offered, so it is not a selection");
  for (let i = 1; i < out.length; i += 1) {
    assert.ok(out[i - 1].probabilityPct >= out[i].probabilityPct, "sorted by probability");
  }
});

test("enumerateLineSelections discovers the bookmaker's own lines for a market with no ladder", () => {
  // Cards without the opt-in block: lambdas only, priced analytically at the offered lines.
  const cards = block({ lambdaHome: 4.2, lambdaAway: 0, correlation: 0 });
  const odds = bookWith("Cards Over/Under", [
    [3.5, 1.5, 2.5],
    [4.5, 2.2, 1.65],
    [5.5, 3.4, 1.32]
  ]);
  const out = enumerateLineSelections({
    oddsData: odds,
    marketNames: ["Cards Over/Under", "Total Cards"],
    block: cards,
    preferredLine: 3.5
  });
  const underLines = out
    .filter((s) => s.side === "under")
    .map((s) => s.bookLine)
    .sort((a, b) => a - b);
  assert.deepEqual(underLines, [3.5, 4.5, 5.5], "each offered line competes on its own probability");
  // Under is monotonically more likely as the line rises.
  const byLine = Object.fromEntries(
    out.filter((s) => s.side === "under").map((s) => [s.bookLine, s.probabilityPct])
  );
  assert.ok(byLine[5.5] > byLine[4.5] && byLine[4.5] > byLine[3.5]);
});

test("enumerateLineSelections drops lines the model cannot price", () => {
  const shotsTotal = block({ lines: { o18_5: 70, o20_5: 55 } }); // no lambdas -> no analytic path
  const odds = bookWith("Total Shots", [
    [19.5, 1.9, 1.9],
    [20.5, 2.1, 1.75]
  ]);
  const out = enumerateLineSelections({
    oddsData: odds,
    marketNames: ["Total Shots"],
    kind: "shots_total",
    block: shotsTotal,
    preferredLine: 20.5
  });
  assert.ok(out.length > 0);
  assert.ok(out.every((s) => s.bookLine === 20.5), "19.5 is unpriceable here and must be absent");
});

test("a bookmaker line outside any internal list is still discovered and priced", () => {
  // The regression this guards: an engine that probes its own list of lines silently skips
  // real, tradable lines. Discovery starts from the book's board, so 4.0 and 6.5 — neither
  // on the model's ladder nor on any conventional cards list — both become candidates.
  const cards = block({ lambdaHome: 4.2, lambdaAway: 0, correlation: 0 });
  const odds = bookWith("Cards Over/Under", [
    [4.0, 1.85, 1.95],
    [6.5, 4.2, 1.22]
  ]);
  const out = enumerateLineSelections({
    oddsData: odds,
    marketNames: ["Cards Over/Under", "Total Cards"],
    block: cards,
    preferredLine: 3.5
  });
  const lines = [...new Set(out.map((s) => s.bookLine))].sort((a, b) => a - b);
  assert.deepEqual(lines, [4, 6.5], "every line the book offers is discovered");
  assert.ok(out.every((s) => s.probabilityLine === s.bookLine));
  assert.ok(out.every((s) => s.repriced === "analytic"));
});

test("a shots-total price can never reach a shots-on-target selection, or vice versa", () => {
  // Same line number, different markets. scoreMarketName's `kind` filters keep them apart.
  const odds = {
    response: [
      {
        bookmakers: [
          {
            name: "bet365",
            bets: [
              {
                name: "Total Shots",
                values: [
                  { value: "Over 8.5", odd: "1.10" },
                  { value: "Under 8.5", odd: "6.50" }
                ]
              },
              {
                name: "Total Shots on Target",
                values: [
                  { value: "Over 8.5", odd: "2.05" },
                  { value: "Under 8.5", odd: "1.78" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
  const blk = block({ lines: { o8_5: 54 } });

  const totals = enumerateLineSelections({
    oddsData: odds,
    marketNames: ["Total Shots"],
    kind: "shots_total",
    block: blk,
    preferredLine: 8.5
  });
  const sot = enumerateLineSelections({
    oddsData: odds,
    marketNames: ["Total Shots on Target", "Shots On Target"],
    kind: "shots_on_target",
    block: blk,
    preferredLine: 8.5
  });

  assert.equal(totals.find((s) => s.side === "over").odd, 1.1, "total shots keeps its own price");
  assert.equal(sot.find((s) => s.side === "over").odd, 2.05, "SOT keeps its own price");
  assert.ok(!totals.some((s) => s.odd === 2.05), "no SOT price leaked into total shots");
  assert.ok(!sot.some((s) => s.odd === 1.1), "no total-shots price leaked into SOT");
});

test("enumerateLineSelections is a pure function of its arguments", () => {
  const args = {
    oddsData: bookWith("Corners Over/Under", [[9.5, 1.8, 2.0]]),
    marketNames: ["Corners Over/Under"],
    kind: "corners",
    block: block({ lines: { o9_5: 57 } }),
    preferredLine: 9.5,
    maxLineDelta: 1
  };
  assert.deepEqual(enumerateLineSelections(args), enumerateLineSelections(args));
  assert.deepEqual(enumerateLineSelections({ oddsData: null, block: null }), []);
});
