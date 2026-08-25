import test from "node:test";
import assert from "node:assert/strict";

import {
  RISK_CONTEXT_SELECT,
  computeRiskContext,
  estimateRollingDrawdown,
  legacyRiskRowFromPayload
} from "../server-utils/pipeline/predictHelpers.js";

/**
 * D9c — loadRiskContext reads the promoted columns instead of raw_payload.
 *
 * The claim worth proving is that avgDist and cooldownCap did not move. So most
 * of what follows runs the SAME `computeRiskContext` over the document shape and
 * the column shape and asserts the results are deeply equal; a test that only
 * drove the column path would prove the new code self-consistent and nothing
 * else.
 *
 * The exception is the NULL rule, which is a DELIBERATE change and is asserted
 * directly. The old filter used the global `isFinite`, which coerces —
 * `isFinite(null)` is `isFinite(0)`, true — so a missing probability would have
 * been averaged in as a real 0%. Columns make that reachable, so it is rejected
 * explicitly here.
 */

/** A stored row after D9c: promoted columns, plus the document they replaced. */
function storedRow({ p1, pX, p2, kelly = null, type = null, ...rest }) {
  return {
    prob_1: p1,
    prob_x: pX,
    prob_2: p2,
    validation: "pending",
    odds_home: 2,
    odds_draw: 3,
    odds_away: 4,
    value_bet_validation: null,
    value_bet_kelly: kelly,
    value_bet_type: type,
    raw_payload: {
      probs: { p1, pX, p2 },
      valueBet: { kelly, type }
    },
    ...rest
  };
}

const bothWays = (rows) => ({
  fromColumns: computeRiskContext(rows),
  fromPayload: computeRiskContext(rows.map(legacyRiskRowFromPayload))
});

/* ------------------------------------------------------------------ */
/* J + L — the projection                                              */
/* ------------------------------------------------------------------ */

test("[J] the risk-context projection contains no raw_payload and no wildcard", () => {
  assert.ok(!RISK_CONTEXT_SELECT.includes("raw_payload"));
  assert.ok(!RISK_CONTEXT_SELECT.includes("*"));
  for (const column of [
    "prob_1",
    "prob_x",
    "prob_2",
    "validation",
    "odds_home",
    "odds_draw",
    "odds_away",
    "value_bet_validation",
    "value_bet_kelly",
    "value_bet_type"
  ]) {
    assert.ok(RISK_CONTEXT_SELECT.includes(column), `${column} missing from the projection`);
  }
});

/* ------------------------------------------------------------------ */
/* B + C — avgDist NULL safety, the one deliberate behaviour change    */
/* ------------------------------------------------------------------ */

test("[C] a real ZERO probability is included — 0% is a prediction", () => {
  // The whole reason NULL is rejected by identity rather than by falsiness.
  const ctx = computeRiskContext([storedRow({ p1: 0, pX: 50, p2: 50 })]);
  assert.deepEqual(ctx.avgDist, { p1: 0, pX: 50, p2: 50 });
});

test("[B] ONE NULL probability excludes the row", () => {
  for (const missing of ["prob_1", "prob_x", "prob_2"]) {
    const row = storedRow({ p1: 50, pX: 30, p2: 20 });
    row[missing] = null;
    assert.equal(computeRiskContext([row]).avgDist, null, missing);
  }
});

test("[B] TWO NULL probabilities exclude the row", () => {
  assert.equal(computeRiskContext([storedRow({ p1: 50, pX: null, p2: null })]).avgDist, null);
});

test("[B] ALL NULL excludes the row", () => {
  assert.equal(computeRiskContext([storedRow({ p1: null, pX: null, p2: null })]).avgDist, null);
});

test("[B] undefined and empty string are excluded too, not coerced to 0", () => {
  for (const absent of [undefined, ""]) {
    const row = storedRow({ p1: 50, pX: 30, p2: 20 });
    row.prob_x = absent;
    assert.equal(computeRiskContext([row]).avgDist, null, String(absent));
  }
});

test("[B] a NULL row does not drag the mean of its neighbours down", () => {
  /*
    This is the regression the explicit NULL check exists to prevent. Under the
    old `isFinite` filter a NULL would have entered as 0 and pulled p1 from 60 to
    40 — a 20-point move against Stage07's 24-point drift threshold.
  */
  const rows = [
    storedRow({ p1: 50, pX: 30, p2: 20 }),
    storedRow({ p1: null, pX: null, p2: null }),
    storedRow({ p1: 70, pX: 20, p2: 10 })
  ];
  assert.deepEqual(computeRiskContext(rows).avgDist, { p1: 60, pX: 25, p2: 15 });
});

test("[B] no usable row leaves avgDist null rather than inventing a distribution", () => {
  assert.equal(computeRiskContext([]).avgDist, null);
  assert.equal(computeRiskContext([{ validation: "pending" }]).avgDist, null);
});

test("[A] a numeric column arriving as a STRING still averages correctly", () => {
  // PostgREST may serialise `numeric` as a string.
  const asStrings = {
    ...storedRow({ p1: 50, pX: 30, p2: 20 }),
    prob_1: "50",
    prob_x: "30",
    prob_2: "20"
  };
  assert.deepEqual(computeRiskContext([asStrings]).avgDist, { p1: 50, pX: 30, p2: 20 });
});

/* ------------------------------------------------------------------ */
/* G — avgDist parity, columns vs document                             */
/* ------------------------------------------------------------------ */

test("[G] avgDist is identical from columns and from the document", () => {
  const rows = [
    storedRow({ p1: 43.21739130434783, pX: 28.5, p2: 28.28260869565217 }),
    storedRow({ p1: 60, pX: 25, p2: 15 }),
    storedRow({ p1: 20, pX: 30, p2: 50 })
  ];
  const { fromColumns, fromPayload } = bothWays(rows);
  assert.deepEqual(fromColumns, fromPayload);
  // Full float precision survives, so Stage07's drift comparison cannot move.
  assert.equal(fromColumns.avgDist.p1, fromPayload.avgDist.p1);
});

/* ------------------------------------------------------------------ */
/* D + E — kelly and type semantics                                    */
/* ------------------------------------------------------------------ */

const settled = (kelly, type, extra = {}) =>
  storedRow({ p1: 50, pX: 30, p2: 20, kelly, type, validation: "loss", ...extra });

test("[D] a NULL kelly skips the row, exactly as a missing one always did", () => {
  assert.equal(estimateRollingDrawdown([settled(null, "1")]), 0);
});

test("[D] a kelly of ZERO also skips — pre-existing, and preserved", () => {
  /*
    `Number(kelly) || 0` collapses NULL and 0 alike, and `!stake` then skips.
    272 production rows carry a genuine kelly of 0 and have always been skipped
    this way. Pinned so the read-path switch cannot be blamed for it later.
  */
  assert.equal(estimateRollingDrawdown([settled(0, "1")]), 0);
});

test("[D] a real kelly produces a real drawdown", () => {
  // stake = min(2/100, 0.03) = 0.02; a loss moves pnl to -0.02, so maxDd = 0.02.
  assert.equal(estimateRollingDrawdown([settled(2, "1")]), 0.02);
});

test("[D] kelly is clamped at 0.03, not rounded", () => {
  assert.equal(estimateRollingDrawdown([settled(10, "1")]), 0.03);
});

test("[E] type selects the odds branch verbatim — no normalisation", () => {
  // odds_home 2, odds_draw 3, odds_away 4. Zeroing the other branches to 1 makes
  // the selected odd observable: only the chosen one passes the `odd > 1` guard.
  assert.equal(
    estimateRollingDrawdown([settled(2, "1", { odds_home: 2, odds_draw: 1, odds_away: 1 })]),
    0.02
  );
  assert.equal(
    estimateRollingDrawdown([settled(2, "X", { odds_home: 1, odds_draw: 3, odds_away: 1 })]),
    0.02
  );
  assert.equal(
    estimateRollingDrawdown([settled(2, "2", { odds_home: 1, odds_draw: 1, odds_away: 4 })]),
    0.02
  );
  // And the branch NOT taken is genuinely skipped by the guard.
  assert.equal(
    estimateRollingDrawdown([settled(2, "1", { odds_home: 1, odds_draw: 3, odds_away: 4 })]),
    0
  );
});

test("[E] whitespace is NOT trimmed at read time — the comparison stays exact", () => {
  /*
    The column is trimmed at WRITE time; this function must not trim again, which
    would be a second normalisation nobody asked for. " 1" therefore takes the
    away branch, exactly as the document path always did. Measured across all 916
    production rows: 0 values need trimming and 0 rows take a different branch, so
    this is latent, not live.
  */
  for (const padded of [" 1", "1 ", "X ", " X"]) {
    assert.equal(
      estimateRollingDrawdown([settled(2, padded, { odds_home: 1, odds_draw: 1, odds_away: 4 })]),
      0.02,
      padded
    );
  }
});

test("[E] a special market type is priced at the AWAY odds — separate follow-up, not fixed here", () => {
  /*
    The odds ternary has no final guard, so anything that is not "1" or "X" is
    priced at the away odds — including "Peste 3.5" and "Cards Under 3.5", which
    are not 1X2 selections at all. PRE-EXISTING and deliberately preserved by
    D9c; recorded as SEPARATE FOLLOW-UP: VALUE-BET ODDS TYPE FALLTHROUGH.
  */
  for (const type of ["Peste 3.5", "Cards Under 3.5", "X2", "1X", "Correct Score 0-0"]) {
    assert.equal(
      estimateRollingDrawdown([settled(2, type, { odds_home: 1, odds_draw: 1, odds_away: 4 })]),
      0.02,
      type
    );
  }
});

test("[D] a NULL type is neither 1 nor X, so it takes the away branch", () => {
  assert.equal(
    estimateRollingDrawdown([settled(2, null, { odds_home: 1, odds_draw: 1, odds_away: 4 })]),
    0.02
  );
});

/* ------------------------------------------------------------------ */
/* H + I — drawdown and cooldownCap parity                             */
/* ------------------------------------------------------------------ */

test("[H] drawdown is identical from columns and from the document", () => {
  const rows = [settled(2, "1"), settled(2.5, "X"), settled(1.2, "2")];
  const fromColumns = estimateRollingDrawdown(rows);
  const fromPayload = estimateRollingDrawdown(rows.map(legacyRiskRowFromPayload));
  assert.equal(fromColumns, fromPayload);
  assert.ok(fromColumns > 0, "the fixture must actually exercise the drawdown");
});

test("[I] cooldownCap thresholds are unchanged: >=3 -> 1.5, >=2 -> 2.0, else 3", () => {
  // Each losing row at the 0.03 clamp contributes 0.03 of drawdown.
  const losers = (n) => Array.from({ length: n }, () => settled(10, "1"));
  assert.equal(computeRiskContext(losers(1)).cooldownCap, 3);
  assert.equal(computeRiskContext(losers(67)).cooldownCap, 2.0);
  /*
    110, not 100. Accumulating -0.03 a hundred times lands at 2.9999999999999996,
    just under the >= 3 threshold — the boundary is floating-point, and pinning
    it here stops a future reader from "correcting" 110 back to 100.
  */
  assert.equal(computeRiskContext(losers(110)).cooldownCap, 1.5);
});

test("[I] cooldownCap is identical from columns and from the document", () => {
  const rows = Array.from({ length: 80 }, () => settled(10, "1"));
  const { fromColumns, fromPayload } = bothWays(rows);
  assert.equal(fromColumns.cooldownCap, fromPayload.cooldownCap);
  assert.deepEqual(fromColumns, fromPayload);
});

test("[I] only win/loss rows count toward the drawdown", () => {
  assert.equal(computeRiskContext([{ ...settled(10, "1"), validation: "pending" }]).cooldownCap, 3);
});

/* ------------------------------------------------------------------ */
/* value_bet_validation — the fallback D9c removes                     */
/* ------------------------------------------------------------------ */

test("the value-bet column decides the outcome, with validation as the fallback", () => {
  const viaColumn = { ...settled(10, "1"), validation: "win", value_bet_validation: "loss" };
  assert.equal(estimateRollingDrawdown([viaColumn]), 0.03);
  const viaValidation = { ...settled(10, "1"), validation: "loss", value_bet_validation: null };
  assert.equal(estimateRollingDrawdown([viaValidation]), 0.03);
});

test("dropping the payload fallback changes nothing for the shape production has", () => {
  /*
    D9c removes `?? payload.value_bet_validation`. Measured on all 916 production
    rows: 374 have a NULL column and the payload rescues 0 of them.
  */
  const row = { ...settled(10, "1"), validation: "loss", value_bet_validation: null };
  row.raw_payload = { probs: { p1: 50, pX: 30, p2: 20 }, valueBet: { kelly: 10, type: "1" } };
  assert.equal(
    estimateRollingDrawdown([row]),
    estimateRollingDrawdown([legacyRiskRowFromPayload(row)])
  );
});

/* ------------------------------------------------------------------ */
/* F — whole-context parity                                            */
/* ------------------------------------------------------------------ */

test("[F] the whole risk context is identical across a mixed population", () => {
  const rows = [
    storedRow({ p1: 50, pX: 30, p2: 20, kelly: 2, type: "1", validation: "loss" }),
    storedRow({ p1: 70, pX: 20, p2: 10, kelly: 0, type: null, validation: "win" }),
    storedRow({ p1: 33.3, pX: 33.3, p2: 33.4, kelly: 1.75, type: "X", validation: "loss" }),
    storedRow({ p1: 20, pX: 30, p2: 50, kelly: 3, type: "Peste 3.5", validation: "loss" }),
    storedRow({ p1: 60, pX: 25, p2: 15, kelly: null, type: "2", validation: "pending" })
  ];
  const { fromColumns, fromPayload } = bothWays(rows);
  assert.deepEqual(fromColumns, fromPayload);
  assert.ok(fromColumns.avgDist, "the fixture must produce a distribution");
});

test("[F] an empty population returns the documented default shape", () => {
  assert.deepEqual(computeRiskContext([]), { avgDist: null, cooldownCap: 3 });
  assert.deepEqual(computeRiskContext(null), { avgDist: null, cooldownCap: 3 });
});
