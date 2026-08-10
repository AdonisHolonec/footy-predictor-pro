import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveCardMarketPicks,
  evaluateOuLine,
  resolveRecommendedValidation,
  settleCardMarkets,
  validationFromOu
} from "../server-utils/cardMarketSettlement.js";

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

/**
 * Data integrity: an absent official total is NOT zero.
 *
 * evaluateOuLine used to run the total through Number() before checking it, and
 * Number(null) is 0 — so a fixture whose corners statistic never arrived was
 * graded as if it had finished with zero corners, turning "Over 7.5" into a
 * confident LOSS built from data that does not exist.
 *
 * A real zero is still a real result. These cases pin the difference.
 */

test("an absent total is ungraded, not zero", () => {
  for (const missing of [null, undefined, ""]) {
    assert.equal(evaluateOuLine("over", 7.5, missing), null, `${String(missing)} must be ungraded`);
    assert.equal(evaluateOuLine("under", 7.5, missing), null, `${String(missing)} must be ungraded`);
  }
});

test("an official zero settles normally", () => {
  // Nil-nil, no corners, no shots on target: rare, but a real result.
  assert.equal(evaluateOuLine("over", 0.5, 0), false);
  assert.equal(evaluateOuLine("under", 0.5, 0), true);
  assert.equal(evaluateOuLine("over", 1.5, 0), false);
  assert.equal(evaluateOuLine("under", 1.5, 0), true);
  assert.equal(evaluateOuLine("over", 7.5, 0), false);
  assert.equal(evaluateOuLine("under", 7.5, 0), true);
});

test("positive totals behave exactly as before", () => {
  assert.equal(evaluateOuLine("over", 7.5, 18), true);
  assert.equal(evaluateOuLine("under", 7.5, 18), false);
  assert.equal(evaluateOuLine("under", 10.5, 7), true);
  assert.equal(evaluateOuLine("over", 10.5, 7), false);
  assert.equal(evaluateOuLine("over", 2.5, 3), true);
  // Numeric strings are still accepted, as they always were.
  assert.equal(evaluateOuLine("over", 2.5, "3"), true);
  assert.equal(evaluateOuLine("over", 2.5, "0"), false);
});

test("a missing corners total holds the market pending instead of losing it", () => {
  const pending = validationFromOu("FT", "over", 7.5, null);
  assert.equal(pending, "pending", "a statistic that never arrived cannot lose a bet");

  const zero = validationFromOu("FT", "over", 7.5, 0);
  assert.equal(zero, "loss", "an official zero is a real result");
});

test("settleCardMarkets holds corners and shots pending when their totals are absent", () => {
  const picks = {
    recommended: null,
    goals: { side: "over", line: 2.5 },
    corners: { side: "over", line: 7.5 },
    shots: { side: "over", line: 10.5 }
  };

  // Explicit nulls, not just absent keys: `Number(undefined)` was already NaN
  // and handled, but `Number(null)` is 0 — and null is exactly what a JSON
  // payload or a Supabase column carries when the statistic never arrived.
  const missing = settleCardMarkets({
    status: "FT",
    score: { home: 2, away: 2 },
    picks,
    marketTotals: { cornersTotal: null, shotsOnTargetTotal: null }
  });

  const absentKeys = settleCardMarkets({ status: "FT", score: { home: 2, away: 2 }, picks, marketTotals: {} });
  assert.equal(absentKeys.corners, "pending");
  assert.equal(absentKeys.shots, "pending");

  assert.equal(missing.goals, "win", "goals settle from the score, which is present");
  assert.equal(missing.corners, "pending", "no corners statistic means no verdict");
  assert.equal(missing.shots, "pending", "no shots statistic means no verdict");

  const present = settleCardMarkets({
    status: "FT",
    score: { home: 2, away: 2 },
    picks,
    marketTotals: { cornersTotal: 0, shotsOnTargetTotal: 0 }
  });

  assert.equal(present.corners, "loss", "an official zero settles the market");
  assert.equal(present.shots, "loss", "an official zero settles the market");
});

test("a market pending for want of a statistic settles once it arrives", () => {
  const picks = { recommended: null, goals: null, corners: { side: "over", line: 7.5 }, shots: null };
  const args = { status: "FT", score: { home: 1, away: 1 }, picks };

  assert.equal(settleCardMarkets({ ...args, marketTotals: {} }).corners, "pending");
  assert.equal(settleCardMarkets({ ...args, marketTotals: { cornersTotal: 11 } }).corners, "win");
});
