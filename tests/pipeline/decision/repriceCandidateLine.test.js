import assert from "node:assert/strict";
import { test } from "node:test";
import {
  repriceCandidateLine,
  priceLineFromBlock,
  ladderLinesFromBlock,
  enumerateLineSelections,
  isContestableLine,
  isLineOnModelScale,
  isScaleGuardedKind,
  MIN_CONTESTABLE_LINE_MASS,
  MIN_LINE_TO_LAMBDA_RATIO,
  SCALE_GUARDED_KINDS
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

/* ------------------------------------------ market scale guard (audit: fixture 1557383) */

const FULL_MATCH = { betType: "total", period: "full_match", scope: "match" };

/** The persisted total-shots block of Liverpool 2–2 Nottingham Forest (fixture 1557383). */
function liverpoolTotalShotsBlock() {
  return block({
    lines: { o18_5: 95.3, o20_5: 89.4, o22_5: 79.8, o24_5: 66.8 },
    lambdaHome: 14,
    lambdaAway: 12.89,
    correlation: 0.05
  });
}

/** The same fixture's persisted shots-on-target block. */
function liverpoolSotBlock() {
  return block({
    lines: { o6_5: 86.6, o7_5: 77.5, o8_5: 66.2, o9_5: 53.7, o10_5: 41.3 },
    lambdaHome: 5.12,
    lambdaAway: 4.84,
    correlation: 0.06
  });
}

/** Odds payload with one "Total Shots" board per bookmaker: [name, line, over, under]. */
function totalShotsBoards(boards) {
  return {
    response: [
      {
        bookmakers: boards.map(([name, ln, over, under]) => ({
          name,
          bets: [
            {
              id: 211,
              name: "Total Shots",
              values: [
                { value: `Over ${ln}`, odd: String(over) },
                { value: `Under ${ln}`, odd: String(under) }
              ]
            }
          ]
        }))
      }
    ]
  };
}

test("AUDIT 1557383: a single-bookmaker 'Total Shots' board at 10.5 @2.95 can never become a total-shots selection", () => {
  const sel = repriceCandidateLine({
    block: liverpoolTotalShotsBlock(),
    side: "over",
    requestedLine: 18.5,
    quote: { line: 10.5, over: 2.95, under: 1.3, bookmakersUsed: 1, market: FULL_MATCH },
    expectedMarket: FULL_MATCH,
    kind: "shots_total"
  });
  assert.equal(sel.tradable, false);
  assert.equal(sel.reason, "line_off_model_scale");
  assert.equal(sel.odd, null, "no price may survive on a line off the model's scale");
  assert.equal(sel.probabilityPct, null, "no 100% may be manufactured at that line");
  assert.equal(sel.bookLine, 10.5, "the refused line is still reported for diagnostics");

  // The hopeless Under of the same line is refused too — the LINE is wrong, not a side.
  const under = repriceCandidateLine({
    block: liverpoolTotalShotsBlock(),
    side: "under",
    requestedLine: 18.5,
    quote: { line: 10.5, over: 2.95, under: 1.3, bookmakersUsed: 1, market: FULL_MATCH },
    expectedMarket: FULL_MATCH,
    kind: "shots_total"
  });
  assert.equal(under.tradable, false);
  assert.equal(under.reason, "line_off_model_scale");

  // Through discovery — exactly the production path (preferred books, single board).
  const pool = enumerateLineSelections({
    oddsData: totalShotsBoards([["Unibet", 10.5, 2.95, 1.3]]),
    marketNames: ["Total Shots"],
    kind: "shots_total",
    block: liverpoolTotalShotsBlock(),
    preferredLine: 18.5,
    preferredBookmakers: ["bet365", "unibet", "pinnacle"]
  });
  assert.deepEqual(pool, [], "nothing tradable exists at 10.5 on a λ_total ≈ 26.9 block");
});

test("legitimate total-shots lines stay tradable: 21.5 on the Liverpool block, 27.5 / 28.5 / 29.5 across books", () => {
  const single = repriceCandidateLine({
    block: liverpoolTotalShotsBlock(),
    side: "over",
    requestedLine: 18.5,
    quote: { line: 21.5, over: 1.44, under: 2.6, bookmakersUsed: 1, market: FULL_MATCH },
    expectedMarket: FULL_MATCH,
    kind: "shots_total"
  });
  assert.equal(single.tradable, true);
  assert.equal(single.reason, null);
  assert.equal(single.repriced, "analytic");
  assert.equal(single.probabilityLine, 21.5);
  assert.ok(single.probabilityPct > 70 && single.probabilityPct < 99, `21.5 is a real line here (${single.probabilityPct}%)`);

  // Every model-scale line on the block — ladder (22.5 / 24.5) and analytic (23.5) alike —
  // is guarded under kind "shots_total" and stays tradable on BOTH sides.
  for (const [line, over, under] of [[22.5, 1.5, 2.5], [23.5, 1.57, 2.35], [24.5, 1.65, 2.2]]) {
    for (const side of ["over", "under"]) {
      const sel = repriceCandidateLine({
        block: liverpoolTotalShotsBlock(),
        side,
        requestedLine: 18.5,
        quote: { line, over, under, bookmakersUsed: 1, market: FULL_MATCH },
        expectedMarket: FULL_MATCH,
        kind: "shots_total"
      });
      assert.equal(sel.tradable, true, `Total Shots ${side} ${line}`);
      assert.equal(sel.reason, null, `Total Shots ${side} ${line}`);
      assert.equal(sel.probabilityLine, line);
      assert.equal(sel.odd, side === "over" ? over : under);
    }
  }

  const pool = enumerateLineSelections({
    oddsData: totalShotsBoards([
      ["Bet365", 27.5, 1.83, 1.83],
      ["1xBet", 28.5, 1.9, 1.8],
      ["Superbet", 29.5, 2.0, 1.72]
    ]),
    marketNames: ["Total Shots"],
    kind: "shots_total",
    block: liverpoolTotalShotsBlock(),
    preferredLine: 18.5,
    preferredBookmakers: ["bet365", "unibet", "1xbet", "superbet"]
  });
  const lines = [...new Set(pool.map((s) => s.bookLine))].sort((a, b) => a - b);
  assert.deepEqual(lines, [27.5, 28.5, 29.5], "normal bookmaker dispersion is untouched");
  assert.ok(pool.every((s) => s.tradable && s.probabilityLine === s.bookLine));
});

test("a 10.5 outlier board among 27.5 / 28.5 / 29.5 is dropped while the real lines survive", () => {
  const pool = enumerateLineSelections({
    oddsData: totalShotsBoards([
      ["Bet365", 27.5, 1.83, 1.83],
      ["1xBet", 28.5, 1.9, 1.8],
      ["Unibet", 10.5, 2.9, 1.3],
      ["Superbet", 29.5, 2.0, 1.72]
    ]),
    marketNames: ["Total Shots"],
    kind: "shots_total",
    block: liverpoolTotalShotsBlock(),
    preferredLine: 18.5,
    preferredBookmakers: ["bet365", "unibet", "1xbet", "superbet"]
  });
  const lines = [...new Set(pool.map((s) => s.bookLine))].sort((a, b) => a - b);
  assert.deepEqual(lines, [27.5, 28.5, 29.5]);
  assert.ok(!pool.some((s) => s.bookLine === 10.5));
  assert.ok(pool.every((s) => s.probabilityPct < 99));
});

test("legitimate shots-on-target lines (7.5 / 8.5) on the SOT block are unaffected by the guard", () => {
  const board = bookWith("Total ShotOnGoal", [
    [7.5, 1.41, 2.57],
    [8.5, 1.7, 2.1]
  ], ["bet365"]);
  const pool = enumerateLineSelections({
    oddsData: board,
    marketNames: ["Total ShotOnGoal", "Shots On Target"],
    kind: "shots_on_target",
    block: liverpoolSotBlock(),
    preferredLine: 6.5,
    preferredBookmakers: ["bet365", "unibet"]
  });
  const lines = [...new Set(pool.map((s) => s.bookLine))].sort((a, b) => a - b);
  assert.deepEqual(lines, [7.5, 8.5]);
  const over75 = pool.find((s) => s.side === "over" && s.bookLine === 7.5);
  assert.equal(over75.tradable, true);
  assert.equal(over75.probabilityPct, 77.5, "ladder value, exactly as before");
  assert.equal(over75.odd, 1.41);
});

/**
 * SCOPE — the guard is a Total Shots correction, nothing else. The blocks below are the
 * persisted production blocks of fixtures a global 1% variant would have touched: each
 * is a line the books really quote, priced by a confident model on the right scale.
 * They must keep enumerating exactly as they did before the guard existed.
 */
test("SCOPE: only kind 'shots_total' is scale-guarded", () => {
  assert.deepEqual([...SCALE_GUARDED_KINDS], ["shots_total"]);
  assert.equal(isScaleGuardedKind("shots_total"), true);
  for (const kind of ["shots_on_target", "corners", "generic", "goals", null, undefined, ""]) {
    assert.equal(isScaleGuardedKind(kind), false, String(kind));
  }
  assert.equal(MIN_CONTESTABLE_LINE_MASS, 0.01);
  assert.equal(isContestableLine({ pWin: 0.99, pLoss: 0.01 }), true, "exactly 1% is still contestable");
  assert.equal(isContestableLine({ pWin: 0.995, pLoss: 0.005 }), false);
  assert.equal(isContestableLine(null), false);

  // The identical 10.5 quote on the identical block: refused for Total Shots, priced as
  // before for every other kind — the guard never leaks past its family.
  const quote = { line: 10.5, over: 2.95, under: 1.3, bookmakersUsed: 1, market: FULL_MATCH };
  const guarded = repriceCandidateLine({
    block: liverpoolTotalShotsBlock(),
    side: "over",
    requestedLine: 18.5,
    quote,
    expectedMarket: FULL_MATCH,
    kind: "shots_total"
  });
  assert.equal(guarded.tradable, false);
  assert.equal(guarded.reason, "line_off_model_scale");
  for (const kind of ["corners", "shots_on_target", "generic", null]) {
    const open = repriceCandidateLine({
      block: liverpoolTotalShotsBlock(),
      side: "over",
      requestedLine: 18.5,
      quote,
      expectedMarket: FULL_MATCH,
      kind
    });
    assert.equal(open.tradable, true, `kind=${kind} is not scale-guarded`);
    assert.equal(open.reason, null, `kind=${kind}`);
  }
});

test("SOT stays independent: real SOT lines 6.5–9.5 with < 1% Under mass remain tradable (fixture 1552148)", () => {
  // Persisted SOT block, λ 6.39 / 8.95, ladder o6_5 = 99.4. Over 6.5 @1.10 is a genuine
  // shots-on-target line at a genuine short price — a global guard variant refused it.
  const sot = block({
    lines: { o6_5: 99.4, o7_5: 98.5, o8_5: 96.8, o9_5: 94, o10_5: 89.6 },
    lambdaHome: 6.39,
    lambdaAway: 8.95,
    correlation: 0.06
  });
  const pool = enumerateLineSelections({
    oddsData: bookWith("Total ShotOnGoal", [
      [6.5, 1.1, 6.3],
      [7.5, 1.2, 4.5],
      [8.5, 1.36, 3.1],
      [9.5, 1.6, 2.3]
    ], ["bet365"]),
    marketNames: ["Total ShotOnGoal", "Shots On Target"],
    kind: "shots_on_target",
    block: sot,
    preferredLine: 6.5,
    preferredBookmakers: ["bet365", "unibet"]
  });
  const lines = [...new Set(pool.map((s) => s.bookLine))].sort((a, b) => a - b);
  assert.deepEqual(lines, [6.5, 7.5, 8.5, 9.5], "every offered SOT line is still enumerated");
  assert.equal(pool.length, 8, "both sides of every SOT line remain tradable");
  const over65 = pool.find((s) => s.side === "over" && s.bookLine === 6.5);
  assert.equal(over65.tradable, true);
  assert.equal(over65.probabilityPct, 99.4);
  assert.equal(over65.odd, 1.1);
  assert.ok(
    Math.min(over65.asian.pWin, over65.asian.pLoss) < MIN_CONTESTABLE_LINE_MASS,
    "precisely a line a global guard would have removed — SOT must not be guarded"
  );
});

test("corners stay independent: real corners lines with < 1% opposite mass remain tradable (fixtures 1607603 / 1497653)", () => {
  // 1607603 — λ 7.09 / 9.06, five books at Over 7.5 @1.41 (model 99.1%): a persisted Recommended.
  const highCorners = block({
    lines: { o7_5: 99.1, o8_5: 97.9, o9_5: 95.9, o10_5: 92.6, o11_5: 87.9, o12_5: 81.5 },
    lambdaHome: 7.09,
    lambdaAway: 9.06,
    correlation: 0.08
  });
  const high = enumerateLineSelections({
    oddsData: bookWith("Corners Over/Under", [
      [7.5, 1.41, 2.6],
      [8.5, 1.55, 2.3],
      [9.5, 1.75, 2.0]
    ], ["bet365", "unibet", "pinnacle", "william hill", "bwin"]),
    marketNames: ["Corners Over/Under", "Total Corners"],
    kind: "corners",
    block: highCorners,
    preferredLine: 9.5
  });
  assert.equal(high.length, 6, "both sides of all three corners lines stay tradable");
  const over75 = high.find((s) => s.side === "over" && s.bookLine === 7.5);
  assert.equal(over75.probabilityPct, 99.1);
  assert.equal(over75.odd, 1.41);
  assert.equal(over75.bookmakersUsed, 5);
  assert.ok(Math.min(over75.asian.pWin, over75.asian.pLoss) < MIN_CONTESTABLE_LINE_MASS);

  // 1497653 — λ 3.1 / 1.93, four books at Under 12.5 @1.33 (model 99.7%).
  const lowCorners = block({
    lines: { o7_5: 14, o8_5: 7.3, o9_5: 3.5, o10_5: 1.6, o11_5: 0.7, o12_5: 0.3 },
    lambdaHome: 3.1,
    lambdaAway: 1.93,
    correlation: 0.08
  });
  const low = enumerateLineSelections({
    oddsData: bookWith("Corners Over/Under", [
      [10.5, 2.1, 1.7],
      [12.5, 2.785, 1.33]
    ], ["bet365", "unibet", "pinnacle", "bwin"]),
    marketNames: ["Corners Over/Under", "Total Corners"],
    kind: "corners",
    block: lowCorners,
    preferredLine: 9.5
  });
  assert.equal(low.length, 4);
  const under125 = low.find((s) => s.side === "under" && s.bookLine === 12.5);
  assert.equal(under125.tradable, true);
  assert.equal(under125.odd, 1.33);
  assert.ok(Math.min(under125.asian.pWin, under125.asian.pLoss) < MIN_CONTESTABLE_LINE_MASS);

  // Extreme-but-quoted corners lines (books post 2.5 / 3.5 and 16.5+ on skewed fixtures)
  // are lines on the corners scale: the corners block prices them and nothing refuses them.
  const wide = block({
    lines: { o7_5: 73.7, o8_5: 61.6, o9_5: 48.8, o10_5: 36.5, o11_5: 25.8, o12_5: 17.2 },
    lambdaHome: 6.58,
    lambdaAway: 3,
    correlation: 0.08
  });
  for (const line of [1.5, 2.5, 3.5, 16.5, 18.5]) {
    for (const side of ["over", "under"]) {
      const sel = repriceCandidateLine({
        block: wide,
        side,
        requestedLine: 9.5,
        quote: { line, over: 1.02, under: 12, bookmakersUsed: 3, market: FULL_MATCH },
        expectedMarket: FULL_MATCH,
        kind: "corners"
      });
      assert.equal(sel.tradable, true, `corners ${side} ${line}`);
      assert.equal(sel.reason, null, `corners ${side} ${line}`);
    }
  }
});

test("cards boards on their own scale enumerate exactly as before the guard", () => {
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
  const lines = [...new Set(out.map((s) => s.bookLine))].sort((a, b) => a - b);
  assert.deepEqual(lines, [3.5, 4.5, 5.5]);
  assert.equal(out.length, 6, "both sides of every offered cards line remain tradable");
});

/* ------------------------------------------ line-scale guard (production: fixture 1570355) */

/** The persisted total-shots block of fixture 1570355 (λ 6.13 / 14 = 20.13). */
function fixture1570355TotalShotsBlock() {
  return block({
    lines: { o18_5: 62.9, o20_5: 45.3, o22_5: 29, o24_5: 16.5 },
    lambdaHome: 6.13,
    lambdaAway: 14,
    correlation: 0.05
  });
}

test("PRODUCTION 1570355: a 'Total Shots' board at 10.5 @3.05 on a λ_total 20.13 block is refused although 1.02% is left for the Under", () => {
  const quote = { line: 10.5, over: 3.05, under: 1.27, bookmakersUsed: 1, market: FULL_MATCH };
  // The mass guard alone lets this through — that is exactly the hole being closed.
  const priced = priceLineFromBlock(fixture1570355TotalShotsBlock(), "over", 10.5);
  assert.ok(isContestableLine(priced.asian), `pLoss=${priced.asian.pLoss} clears the 1% floor on its own`);
  assert.ok(priced.asian.pLoss > 0.01 && priced.asian.pLoss < 0.011);
  assert.equal(isLineOnModelScale(fixture1570355TotalShotsBlock(), 10.5), false, "10.5 / 20.13 = 0.52 < 0.60");

  for (const side of ["over", "under"]) {
    const sel = repriceCandidateLine({
      block: fixture1570355TotalShotsBlock(),
      side,
      requestedLine: 18.5,
      quote,
      expectedMarket: FULL_MATCH,
      kind: "shots_total"
    });
    assert.equal(sel.tradable, false, side);
    assert.equal(sel.reason, "line_off_model_scale", side);
    assert.equal(sel.odd, null, side);
    assert.equal(sel.probabilityPct, null, side);
    assert.equal(sel.bookLine, 10.5, side);
  }

  // Candidate construction — the production path (kind flows through discovery).
  const pool = enumerateLineSelections({
    oddsData: totalShotsBoards([["Unibet", 10.5, 3.05, 1.27]]),
    marketNames: ["Total Shots"],
    kind: "shots_total",
    block: fixture1570355TotalShotsBlock(),
    preferredLine: 18.5,
    preferredBookmakers: ["bet365", "unibet", "pinnacle"]
  });
  assert.deepEqual(pool, [], "no selection may exist at 10.5 on a λ_total ≈ 20 block");

  // The fixture's real board (24.5 from two books) is still priced, both sides.
  const real = enumerateLineSelections({
    oddsData: totalShotsBoards([["Bet365", 24.5, 2.145, 1.63], ["Unibet", 10.5, 3.05, 1.27]]),
    marketNames: ["Total Shots"],
    kind: "shots_total",
    block: fixture1570355TotalShotsBlock(),
    preferredLine: 18.5,
    preferredBookmakers: ["bet365", "unibet", "pinnacle"]
  });
  assert.deepEqual([...new Set(real.map((s) => s.bookLine))], [24.5]);
  assert.equal(real.length, 2);
  const under245 = real.find((s) => s.side === "under");
  assert.equal(under245.tradable, true, "the legitimate Under is untouched");
  assert.equal(under245.odd, 1.63);
});

test("line-scale guard: legitimate Total Shots lines near the boundary stay tradable — 20.5 on λ 26.62 (0.77) and 17.5 on λ 28 (0.625)", () => {
  // Fixture 1565226 — the lowest-ratio legitimate recommendation ever persisted.
  const low = block({
    lines: { o18_5: 95.8, o20_5: 88.5, o22_5: 76.3, o24_5: 60.6 },
    lambdaHome: 14,
    lambdaAway: 12.62,
    correlation: 0.05
  });
  const over205 = repriceCandidateLine({
    block: low,
    side: "over",
    requestedLine: 18.5,
    quote: { line: 20.5, over: 1.4, under: 2.75, bookmakersUsed: 1, market: FULL_MATCH },
    expectedMarket: FULL_MATCH,
    kind: "shots_total"
  });
  assert.equal(over205.tradable, true);
  assert.equal(over205.reason, null);
  assert.equal(over205.probabilityPct, 88.5, "ladder value, exactly as before");
  assert.ok(isLineOnModelScale(low, 20.5));

  // A real 17.5 board on a λ 28 block (ratio 0.625): 0.60 must not be an accidentally high bar.
  const high = block({ lines: { o18_5: 97.2 }, lambdaHome: 14, lambdaAway: 14, correlation: 0.05 });
  for (const side of ["over", "under"]) {
    const sel = repriceCandidateLine({
      block: high,
      side,
      requestedLine: 18.5,
      quote: { line: 17.5, over: 1.04, under: 9.5, bookmakersUsed: 1, market: FULL_MATCH },
      expectedMarket: FULL_MATCH,
      kind: "shots_total"
    });
    assert.equal(sel.tradable, true, `17.5 ${side}`);
    assert.equal(sel.reason, null, `17.5 ${side}`);
  }

  // High lines — Over and Under — are untouched by a lower bound on the ratio.
  for (const line of [27.5, 28.5, 29.5, 31.5]) {
    for (const side of ["over", "under"]) {
      const sel = repriceCandidateLine({
        block: liverpoolTotalShotsBlock(),
        side,
        requestedLine: 18.5,
        quote: { line, over: 2.0, under: 1.7, bookmakersUsed: 1, market: FULL_MATCH },
        expectedMarket: FULL_MATCH,
        kind: "shots_total"
      });
      assert.equal(sel.tradable, true, `${side} ${line}`);
      assert.equal(sel.probabilityLine, line);
    }
  }
});

test("line-scale guard is exact at the boundary and symmetric: ratio 0.60 accepted, just below rejected on both sides", () => {
  const twenty = block({ lines: {}, lambdaHome: 10, lambdaAway: 10, correlation: 0.05 }); // λ_total = 20
  assert.equal(MIN_LINE_TO_LAMBDA_RATIO, 0.6);
  assert.equal(isLineOnModelScale(twenty, 12), true, "12 / 20 = 0.60 exactly is on scale");
  assert.equal(isLineOnModelScale(twenty, 11.5), false, "11.5 / 20 = 0.575 is off scale");
  for (const side of ["over", "under"]) {
    const exact = repriceCandidateLine({
      block: twenty,
      side,
      requestedLine: 18.5,
      quote: { line: 12, over: 1.02, under: 12, bookmakersUsed: 1, market: FULL_MATCH },
      expectedMarket: FULL_MATCH,
      kind: "shots_total"
    });
    assert.equal(exact.reason === "line_off_model_scale", false, `exactly 0.60 (${side}) is never refused by the ratio`);
    const below = repriceCandidateLine({
      block: twenty,
      side,
      requestedLine: 18.5,
      quote: { line: 11.5, over: 1.02, under: 12, bookmakersUsed: 1, market: FULL_MATCH },
      expectedMarket: FULL_MATCH,
      kind: "shots_total"
    });
    assert.equal(below.tradable, false, side);
    assert.equal(below.reason, "line_off_model_scale", side);
  }
});

test("line-scale guard is skipped on a ladder-only block (no lambdas): the mass guard stays authoritative", () => {
  const ladderOnly = block({ lines: { o10_5: 97 } }); // lambdaHome = lambdaAway = 0 -> unusable
  assert.equal(isLineOnModelScale(ladderOnly, 10.5), true, "no lambdas -> no ratio -> not refused");
  assert.equal(isLineOnModelScale({ total: { o10_5: 97 } }, 10.5), true, "missing lambdas entirely");
  const sel = repriceCandidateLine({
    block: ladderOnly,
    side: "over",
    requestedLine: 10.5,
    quote: { line: 10.5, over: 1.05, under: 9, bookmakersUsed: 1, market: FULL_MATCH },
    expectedMarket: FULL_MATCH,
    kind: "shots_total"
  });
  assert.equal(sel.tradable, true, "97% / 3% is contestable and the ratio cannot be formed");
  assert.equal(sel.probabilityPct, 97);

  // ...while the mass guard still refuses a ladder-only line that is not contestable.
  const dead = repriceCandidateLine({
    block: block({ lines: { o10_5: 99.6 } }),
    side: "over",
    requestedLine: 10.5,
    quote: { line: 10.5, over: 1.01, under: 15, bookmakersUsed: 1, market: FULL_MATCH },
    expectedMarket: FULL_MATCH,
    kind: "shots_total"
  });
  assert.equal(dead.reason, "line_off_model_scale");
});

test("line-scale guard never reaches other kinds: the 1570355 board is priced as before under SOT / corners / cards / null", () => {
  const quote = { line: 10.5, over: 3.05, under: 1.27, bookmakersUsed: 1, market: FULL_MATCH };
  for (const kind of ["shots_on_target", "corners", "generic", null]) {
    assert.equal(isScaleGuardedKind(kind), false, String(kind));
    const open = repriceCandidateLine({
      block: fixture1570355TotalShotsBlock(),
      side: "over",
      requestedLine: 18.5,
      quote,
      expectedMarket: FULL_MATCH,
      kind
    });
    assert.equal(open.tradable, true, `kind=${kind}`);
    assert.equal(open.reason, null, `kind=${kind}`);
  }
});
