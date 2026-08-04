import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRecommendedValidation, settleCardMarkets, deriveCardMarketPicks } from "../server-utils/cardMarketSettlement.js";

test("resolveRecommendedValidation grades a Corners pick against corner totals, not goals scored", () => {
  // 4 goals total but only 6 corners — a naive goals-based grader would call "Over 7.5" a
  // loss here purely by coincidence of the score; the real corners total (9) makes it a win.
  const win = resolveRecommendedValidation({
    pick: "Over 7.5",
    family: "Corners",
    status: "FT",
    score: { home: 2, away: 2 },
    marketTotals: { cornersTotal: 9 }
  });
  assert.equal(win, "win");

  const loss = resolveRecommendedValidation({
    pick: "Over 7.5",
    family: "Corners",
    status: "FT",
    score: { home: 2, away: 2 },
    marketTotals: { cornersTotal: 6 }
  });
  assert.equal(loss, "loss");
});

test("resolveRecommendedValidation returns pending for Corners when no corner total is available yet", () => {
  const out = resolveRecommendedValidation({
    pick: "Under 12.5",
    family: "Corners",
    status: "FT",
    score: { home: 1, away: 0 },
    marketTotals: { cornersTotal: null }
  });
  assert.equal(out, "pending");
});

test("resolveRecommendedValidation infers Corners from a non-goals line when family is missing (legacy rows)", () => {
  // No family persisted (rows written before this fix) — 7.5/12.5 aren't goals lines
  // (goals O/U in this codebase is always 1.5/2.5/3.5), so it must be Corners.
  const out = resolveRecommendedValidation({
    pick: "Over 10.5",
    family: undefined,
    status: "FT",
    score: { home: 1, away: 1 },
    marketTotals: { cornersTotal: 11 }
  });
  assert.equal(out, "win");
});

test("resolveRecommendedValidation still grades goals picks against goals scored (regression, unaffected by the fix)", () => {
  const overWin = resolveRecommendedValidation({
    pick: "Peste 2.5",
    family: "Over/Under",
    status: "FT",
    score: { home: 2, away: 1 },
    marketTotals: {}
  });
  assert.equal(overWin, "win");

  const underLoss = resolveRecommendedValidation({
    pick: "Sub 2.5",
    family: "Over/Under",
    status: "FT",
    score: { home: 2, away: 1 },
    marketTotals: {}
  });
  assert.equal(underLoss, "loss");
});

test("resolveRecommendedValidation grades 1X2/Double Chance/BTTS as before (regression)", () => {
  const score = { home: 2, away: 0 };
  assert.equal(resolveRecommendedValidation({ pick: "1", family: "1X2", status: "FT", score }), "win");
  assert.equal(resolveRecommendedValidation({ pick: "X2", family: "Double Chance", status: "FT", score }), "loss");
  assert.equal(resolveRecommendedValidation({ pick: "GG", family: "BTTS", status: "FT", score }), "loss");
});

test("resolveRecommendedValidation always returns pending for Cards (no cards totals tracked yet)", () => {
  const out = resolveRecommendedValidation({
    pick: "Cards Over 4.5",
    family: "Cards",
    status: "FT",
    score: { home: 1, away: 1 },
    marketTotals: { cornersTotal: 9 }
  });
  assert.equal(out, "pending");
});

test("resolveRecommendedValidation returns pending for any family before the match is final", () => {
  const out = resolveRecommendedValidation({
    pick: "Over 7.5",
    family: "Corners",
    status: "NS",
    score: { home: null, away: null },
    marketTotals: { cornersTotal: 9 }
  });
  assert.equal(out, "pending");
});

test("deriveCardMarketPicks threads recommended.family through for settlement to consume", () => {
  const picks = deriveCardMarketPicks({
    recommended: { pick: "Over 7.5", family: "Corners" },
    probs: { p1: 40, pX: 30, p2: 30 }
  });
  assert.equal(picks.recommended.family, "Corners");
});

test("settleCardMarkets settles a Corners recommendation via the market-aware path end to end", () => {
  const picks = deriveCardMarketPicks({
    recommended: { pick: "Over 7.5", family: "Corners" },
    probs: { p1: 40, pX: 30, p2: 30 }
  });
  const out = settleCardMarkets({
    status: "FT",
    score: { home: 1, away: 0 },
    picks,
    marketTotals: { cornersTotal: 9 }
  });
  assert.equal(out.recommended, "win");
});
