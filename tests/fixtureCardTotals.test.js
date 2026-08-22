import test from "node:test";
import assert from "node:assert/strict";

import {
  cardsFromCounts,
  parseSideCards,
  computeCardTotals
} from "../server-utils/fixtureCardTotals.js";
import { attachCardMarketsToPayload } from "../server-utils/cardMarketSettlement.js";

/** Shape of one side of a real /fixtures/statistics response. */
function statsBlock({ yellow, red, corners = 5 }) {
  return [
    { type: "Corner Kicks", value: corners },
    { type: "Yellow Cards", value: yellow },
    { type: "Red Cards", value: red }
  ];
}

// -------------------- cardsFromCounts: the yellow-anchor rule --------------------

test("cardsFromCounts: null red alongside a known yellow is a real zero", () => {
  // The live payload shape: a match with bookings but no dismissals reports
  // Yellow Cards = 2 and Red Cards = null.
  const r = cardsFromCounts(2, null);
  assert.deepEqual(r, { yellow: 2, red: 0, count: 2, points: 2 });
});

test("cardsFromCounts: null yellow means the block is unpopulated → UNKNOWN, not zero", () => {
  assert.equal(cardsFromCounts(null, null), null);
  assert.equal(cardsFromCounts(undefined, undefined), null);
  // Even a red-only reading cannot rescue it: without yellow we cannot tell an
  // empty block from a genuinely card-free match.
  assert.equal(cardsFromCounts(null, 1), null);
});

test("cardsFromCounts: an explicit zero yellow is production data, not missing", () => {
  assert.deepEqual(cardsFromCounts(0, null), { yellow: 0, red: 0, count: 0, points: 0 });
  assert.deepEqual(cardsFromCounts(0, 0), { yellow: 0, red: 0, count: 0, points: 0 });
});

test("cardsFromCounts: count and points are distinct quantities", () => {
  // 3 yellows + 1 red = 4 physical cards, but 5 weighted points (red counts double).
  const r = cardsFromCounts(3, 1);
  assert.equal(r.count, 4);
  assert.equal(r.points, 5);
});

test("cardsFromCounts: non-numeric input is rejected rather than coerced", () => {
  assert.equal(cardsFromCounts("abc", 0), null);
  assert.equal(cardsFromCounts(2, "abc"), null);
});

// -------------------- parseSideCards --------------------

test("parseSideCards reads Yellow/Red from a statistics block", () => {
  assert.deepEqual(parseSideCards(statsBlock({ yellow: 2, red: null })), {
    yellow: 2,
    red: 0,
    count: 2,
    points: 2
  });
});

test("parseSideCards: fully-null block → null (the uncovered-fixture payload)", () => {
  const emptyBlock = [
    { type: "Corner Kicks", value: null },
    { type: "Yellow Cards", value: null },
    { type: "Red Cards", value: null }
  ];
  assert.equal(parseSideCards(emptyBlock), null);
});

test("parseSideCards: absent rows and invalid payloads → null", () => {
  assert.equal(parseSideCards([{ type: "Corner Kicks", value: 5 }]), null);
  assert.equal(parseSideCards([]), null);
  assert.equal(parseSideCards(null), null);
  assert.equal(parseSideCards(undefined), null);
});

test("parseSideCards accepts numeric strings from the provider", () => {
  const block = [
    { type: "Yellow Cards", value: "3" },
    { type: "Red Cards", value: "1" }
  ];
  assert.deepEqual(parseSideCards(block), { yellow: 3, red: 1, count: 4, points: 5 });
});

// -------------------- computeCardTotals --------------------

test("computeCardTotals sums both sides in both units", () => {
  // Home 2Y/0R, away 3Y/1R → 6 cards, 7 points.
  const out = computeCardTotals(
    statsBlock({ yellow: 2, red: null }),
    statsBlock({ yellow: 3, red: 1 })
  );
  assert.deepEqual(out, { cardsTotal: 6, cardsPoints: 7 });
});

test("computeCardTotals requires BOTH sides — a half-known match stays unknown", () => {
  const known = statsBlock({ yellow: 2, red: null });
  const unknown = [
    { type: "Yellow Cards", value: null },
    { type: "Red Cards", value: null }
  ];
  assert.deepEqual(computeCardTotals(known, unknown), { cardsTotal: null, cardsPoints: null });
  assert.deepEqual(computeCardTotals(unknown, known), { cardsTotal: null, cardsPoints: null });
});

test("computeCardTotals: a genuine card-free match settles as zero, not unknown", () => {
  const out = computeCardTotals(
    statsBlock({ yellow: 0, red: null }),
    statsBlock({ yellow: 0, red: null })
  );
  assert.deepEqual(out, { cardsTotal: 0, cardsPoints: 0 });
});

// -------------------- persistence (Increment A') --------------------

test("attachCardMarketsToPayload persists cardsTotal/cardsPoints into marketResults", () => {
  const out = attachCardMarketsToPayload(
    { recommended: { pick: "Cards Under 3.5", family: "Cards" } },
    {
      status: "FT",
      score: { home: 1, away: 2 },
      marketTotals: { cardsTotal: 6, cardsPoints: 7 }
    }
  );
  assert.equal(out.marketResults.cardsTotal, 6);
  assert.equal(out.marketResults.cardsPoints, 7);
});

test("recorded card totals now settle the Cards family (D8)", () => {
  // This is the change the earlier increment deferred: the total was captured then,
  // and grading arrives here. Same fixture, inverted expectation — 6 cards LOSES an
  // Under 3.5, and it is graded against cardsTotal (6), not cardsPoints (7).
  const out = attachCardMarketsToPayload(
    { recommended: { pick: "Cards Under 3.5", family: "Cards" } },
    {
      status: "FT",
      score: { home: 1, away: 2 },
      marketTotals: { cardsTotal: 6, cardsPoints: 7 }
    }
  );
  assert.equal(out.cardMarketValidations.recommended, "loss");
  // The totals are still recorded verbatim — grading did not consume or alter them.
  assert.equal(out.marketResults.cardsTotal, 6);
  assert.equal(out.marketResults.cardsPoints, 7);
});

test("a Cards pick with no recorded total stays pending, not lost", () => {
  const out = attachCardMarketsToPayload(
    { recommended: { pick: "Cards Under 3.5", family: "Cards" } },
    { status: "FT", score: { home: 1, away: 2 }, marketTotals: {} }
  );
  assert.equal(out.cardMarketValidations.recommended, "pending");
});

test("card totals already on the payload survive when no fresh totals arrive", () => {
  const out = attachCardMarketsToPayload(
    {
      recommended: { pick: "Peste 2.5", family: "Over/Under" },
      marketResults: { cardsTotal: 4, cardsPoints: 5 }
    },
    { status: "FT", score: { home: 2, away: 1 }, marketTotals: {} }
  );
  assert.equal(out.marketResults.cardsTotal, 4);
  assert.equal(out.marketResults.cardsPoints, 5);
});

test("card totals alone are enough to write marketResults", () => {
  // Guard regression: the persistence branch used to fire only for corners/shots/HT,
  // so a fixture whose only new information was its card count wrote nothing.
  const out = attachCardMarketsToPayload(
    { recommended: { pick: "1", family: "1X2" } },
    { status: "FT", score: { home: 2, away: 1 }, marketTotals: { cardsTotal: 3, cardsPoints: 3 } }
  );
  assert.equal(out.marketResults.cardsTotal, 3);
});

test("an unknown card total is not written as zero", () => {
  const out = attachCardMarketsToPayload(
    { recommended: { pick: "1", family: "1X2" } },
    {
      status: "FT",
      score: { home: 2, away: 1 },
      marketTotals: { cornersTotal: 9, cardsTotal: null, cardsPoints: null }
    }
  );
  assert.equal(out.marketResults.cardsTotal, null);
  assert.equal(out.marketResults.cardsPoints, null);
});
