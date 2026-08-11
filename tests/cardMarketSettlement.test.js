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

/* ------------------------------------------------------- Total Shots settlement */

/**
 * Total Shots became recommendable in the probability-first increment, so it must also be
 * gradeable. It settles against the match's combined shot count — never against goals
 * scored, and never against shots on target, which is a different market with its own total.
 */
const shotsArgs = { family: "Shots", status: "FT", score: { home: 1, away: 1 } };

test("Total Shots Over 22.5 is a win at 23 shots and a loss at 22", () => {
  assert.equal(
    resolveRecommendedValidation({ ...shotsArgs, pick: "Shots Over 22.5", marketTotals: { shotsTotal: 23 } }),
    "win"
  );
  assert.equal(
    resolveRecommendedValidation({ ...shotsArgs, pick: "Shots Over 22.5", marketTotals: { shotsTotal: 22 } }),
    "loss"
  );
});

test("Total Shots Under 24.5 is a win at 24 shots and a loss at 25", () => {
  assert.equal(
    resolveRecommendedValidation({ ...shotsArgs, pick: "Shots Under 24.5", marketTotals: { shotsTotal: 24 } }),
    "win"
  );
  assert.equal(
    resolveRecommendedValidation({ ...shotsArgs, pick: "Shots Under 24.5", marketTotals: { shotsTotal: 25 } }),
    "loss"
  );
});

test("Total Shots stays pending when the shots total is missing — never assumed to be zero", () => {
  for (const marketTotals of [{}, { shotsTotal: null }, { shotsTotal: undefined }, { cornersTotal: 11 }]) {
    assert.equal(
      resolveRecommendedValidation({ ...shotsArgs, pick: "Shots Over 22.5", marketTotals }),
      "pending",
      `missing shotsTotal must not grade (${JSON.stringify(marketTotals)})`
    );
  }
});

test("Total Shots is never graded against goals scored or against shots on target", () => {
  // 1-1 (2 goals) with 23 shots but only 5 on target. A goals-based grader would call
  // "Over 22.5" a loss; an SOT-based grader would too. Only the shots total makes it a win.
  const args = { ...shotsArgs, pick: "Shots Over 22.5" };
  assert.equal(
    resolveRecommendedValidation({ ...args, marketTotals: { shotsTotal: 23, shotsOnTargetTotal: 5, cornersTotal: 4 } }),
    "win"
  );
  // Without its own total it must abstain, even when other totals are present.
  assert.equal(
    resolveRecommendedValidation({ ...args, marketTotals: { shotsOnTargetTotal: 5, cornersTotal: 4 } }),
    "pending"
  );
});

test("Shots on Target still grades against its own total and is unaffected by shotsTotal", () => {
  const sot = { family: "Shots on Target", status: "FT", score: { home: 1, away: 1 } };
  assert.equal(
    resolveRecommendedValidation({ ...sot, pick: "SOT Over 8.5", marketTotals: { shotsOnTargetTotal: 9 } }),
    "win"
  );
  assert.equal(
    resolveRecommendedValidation({ ...sot, pick: "SOT Over 8.5", marketTotals: { shotsOnTargetTotal: 8 } }),
    "loss"
  );
  assert.equal(
    resolveRecommendedValidation({ ...sot, pick: "SOT Under 8.5", marketTotals: { shotsOnTargetTotal: 8 } }),
    "win"
  );
  // A big total-shots count must not leak into the SOT verdict.
  assert.equal(
    resolveRecommendedValidation({ ...sot, pick: "SOT Over 8.5", marketTotals: { shotsTotal: 30 } }),
    "pending"
  );
});

test("Goals, Cards and Corners grading is unchanged by the shots branches", () => {
  const base = { status: "FT", score: { home: 2, away: 1 } };
  // Goals: 3 scored, graded against the score as before.
  assert.equal(resolveRecommendedValidation({ ...base, pick: "Peste 2.5", family: "Over/Under" }), "win");
  assert.equal(resolveRecommendedValidation({ ...base, pick: "Sub 2.5", family: "Over/Under" }), "loss");
  assert.equal(resolveRecommendedValidation({ ...base, pick: "1", family: "1X2" }), "win");
  // Cards still abstain — no cards totals tracked.
  assert.equal(
    resolveRecommendedValidation({ ...base, pick: "Cards Over 3.5", family: "Cards", marketTotals: { shotsTotal: 30 } }),
    "pending"
  );
  // Corners still grade against cornersTotal only.
  assert.equal(
    resolveRecommendedValidation({
      ...base,
      pick: "Over 7.5",
      family: "Corners",
      marketTotals: { cornersTotal: 9, shotsTotal: 30 }
    }),
    "win"
  );
  assert.equal(
    resolveRecommendedValidation({ ...base, pick: "Over 7.5", family: "Corners", marketTotals: { shotsTotal: 30 } }),
    "pending"
  );
});

test("end-to-end: a Recommended Total Shots pick settles through attachCardMarketsToPayload", async () => {
  const { attachCardMarketsToPayload } = await import("../server-utils/cardMarketSettlement.js");
  const prediction = {
    status: "FT",
    score: { home: 1, away: 1 },
    recommended: { pick: "Shots Over 22.5", family: "Shots", confidence: 84, odd: 1.4 }
  };

  const settled = attachCardMarketsToPayload(prediction, {
    status: "FT",
    score: { home: 1, away: 1 },
    marketTotals: { shotsTotal: 23 }
  });
  assert.equal(settled.cardMarketValidations.recommended, "win");
  assert.equal(settled.marketResults.shotsTotal, 23, "the total is persisted onto the payload");

  const lost = attachCardMarketsToPayload(prediction, {
    status: "FT",
    score: { home: 1, away: 1 },
    marketTotals: { shotsTotal: 22 }
  });
  assert.equal(lost.cardMarketValidations.recommended, "loss");

  const unknown = attachCardMarketsToPayload(prediction, {
    status: "FT",
    score: { home: 1, away: 1 },
    marketTotals: {}
  });
  assert.equal(unknown.cardMarketValidations.recommended, "pending");

  // A total already on the payload is reused when the caller supplies none.
  const fromPayload = attachCardMarketsToPayload(
    { ...prediction, marketResults: { shotsTotal: 30 } },
    { status: "FT", score: { home: 1, away: 1 } }
  );
  assert.equal(fromPayload.cardMarketValidations.recommended, "win");
});

/* --------------------------------------- settleability registry stays honest */

/**
 * SETTLEABLE_VALUE_FAMILIES (server-utils/value/valueMarkets.js) decides which families may
 * enter Recommended / Alternative / Best Value. If it ever claims a family is settleable
 * that resolveRecommendedValidation cannot actually grade, the app would recommend bets it
 * can never score. This test is the interlock between the two.
 */
test("every family marked settleable can actually be graded, and every unsettleable one cannot", async () => {
  const { SETTLEABLE_VALUE_FAMILIES } = await import("../server-utils/value/valueMarkets.js");
  const FT = { status: "FT", score: { home: 2, away: 1 } };

  // A representative gradeable pick per family, with the totals that family needs.
  const probes = {
    "1X2": { pick: "1", marketTotals: {} },
    "Double Chance": { pick: "1X", marketTotals: {} },
    BTTS: { pick: "GG", marketTotals: {} },
    "Over/Under": { pick: "Peste 2.5", marketTotals: {} },
    Corners: { pick: "Over 7.5", marketTotals: { cornersTotal: 9 } },
    Shots: { pick: "Shots Over 22.5", marketTotals: { shotsTotal: 23 } },
    "Shots on Target": { pick: "SOT Over 8.5", marketTotals: { shotsOnTargetTotal: 9 } },
    Cards: { pick: "Cards Under 5.5", marketTotals: { cornersTotal: 9, shotsTotal: 23, shotsOnTargetTotal: 9 } },
    "Correct Score": {
      pick: "Correct Score 2-1",
      marketTotals: { cornersTotal: 9, shotsTotal: 23, shotsOnTargetTotal: 9 }
    }
  };

  for (const [family, declaredSettleable] of Object.entries(SETTLEABLE_VALUE_FAMILIES)) {
    const probe = probes[family];
    assert.ok(probe, `add a settlement probe for the "${family}" family`);
    const verdict = resolveRecommendedValidation({ ...FT, family, ...probe });
    if (declaredSettleable) {
      assert.notEqual(
        verdict,
        "pending",
        `"${family}" is declared settleable but resolveRecommendedValidation cannot grade it`
      );
    } else {
      assert.equal(
        verdict,
        "pending",
        `"${family}" is declared unsettleable but grading returned "${verdict}" — flip the registry`
      );
    }
  }
});
