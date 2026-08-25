import test from "node:test";
import assert from "node:assert/strict";

import {
  METRICS_SELECT,
  computeMetrics,
  resolveRowFromPayload
} from "../server-utils/backtest/metricsReducer.js";

/**
 * D9b-4 — /api/backtest?view=metrics reads promoted columns instead of the
 * document.
 *
 * The endpoint publishes Brier, log-loss and ECE. The only claim worth making
 * about this change is that those numbers did not move, so most of what follows
 * runs the SAME reducer over the payload shape and the column shape and asserts
 * the two results are deeply equal. A test that only exercised the column path
 * would prove the new code self-consistent and nothing else.
 */

/** A row as it is stored: document plus the columns the backfill populated. */
function storedRow({ p1, pX, p2, method = "modular-engine", dq = 0.8, pick = "1", ...rest }) {
  return {
    league_id: 39,
    score_home: 2,
    score_away: 1,
    match_status: "FT",
    model_version: "v1",
    recommended_confidence: 72,
    // columns — what the endpoint reads now
    prob_1: p1,
    prob_x: pX,
    prob_2: p2,
    model_method: method,
    model_data_quality: dq,
    pick_1x2: pick,
    // document — what it read before
    raw_payload: {
      evaluation: { modelProbs1x2Pct: { p1, pX, p2 }, recommended1x2: pick },
      modelMeta: { method, dataQuality: dq }
    },
    ...rest
  };
}

const bothWays = (rows) => ({
  fromColumns: computeMetrics(rows),
  fromPayload: computeMetrics(rows.map(resolveRowFromPayload))
});

test("the query no longer selects raw_payload", () => {
  assert.ok(!METRICS_SELECT.includes("raw_payload"));
  assert.ok(!METRICS_SELECT.includes("*"), "a wildcard would drag the document back in");
  for (const column of [
    "prob_1",
    "prob_x",
    "prob_2",
    "model_method",
    "model_data_quality",
    "pick_1x2",
    "model_version",
    "recommended_confidence"
  ]) {
    assert.ok(METRICS_SELECT.includes(column), `${column} missing from the projection`);
  }
});

test("columns and payload produce identical metrics", () => {
  const rows = [
    storedRow({ p1: 43.21739130434783, pX: 28.5, p2: 28.28260869565217 }),
    storedRow({ p1: 60, pX: 25, p2: 15, method: "standings", dq: 0.6, pick: "2" }),
    storedRow({ p1: 20, pX: 30, p2: 50, method: "uefa_league_prior", dq: 0.4, pick: "X" })
  ];
  const { fromColumns, fromPayload } = bothWays(rows);
  assert.deepEqual(fromColumns, fromPayload);
  assert.equal(fromColumns.nProb, 3);
  assert.equal(typeof fromColumns.brier1x2, "number");
});

test("full float precision survives, so the published Brier cannot drift", () => {
  const rows = [storedRow({ p1: 37.36928211809955, pX: 25.640971687182663, p2: 36.98974619471779 })];
  const { fromColumns, fromPayload } = bothWays(rows);
  assert.equal(fromColumns.brier1x2, fromPayload.brier1x2);
  assert.equal(fromColumns.logLoss1x2, fromPayload.logLoss1x2);
});

test("a numeric column arriving as a STRING is still identical", () => {
  // PostgREST may serialise `numeric` as a string; untreated that is NaN.
  const row = storedRow({ p1: 43.5, pX: 28.5, p2: 28 });
  const asStrings = {
    ...row,
    prob_1: "43.5",
    prob_x: "28.5",
    prob_2: "28",
    model_data_quality: "0.8",
    recommended_confidence: "72"
  };
  assert.deepEqual(computeMetrics([asStrings]), computeMetrics([row]));
});

test("a row with no usable triple is excluded from nProb, exactly as before", () => {
  /*
    The `s < 0.1` guard is how such rows have always dropped out. NULL columns
    reach it as 0, so they behave identically to a missing document field —
    which is what makes NULL safe to read here.
  */
  const nulled = storedRow({ p1: null, pX: null, p2: null });
  nulled.raw_payload = {};
  const { fromColumns, fromPayload } = bothWays([nulled]);
  assert.deepEqual(fromColumns, fromPayload);
  assert.equal(fromColumns.nProb, 0);
  assert.equal(fromColumns.nRows, 1, "it is still counted as scanned");
  assert.equal(fromColumns.brier1x2, null);
});

test("missing metadata keeps its historical defaults", () => {
  const row = storedRow({ p1: 50, pX: 30, p2: 20, method: null, dq: null });
  row.raw_payload = {
    evaluation: { modelProbs1x2Pct: { p1: 50, pX: 30, p2: 20 }, recommended1x2: "1" }
  };
  const { fromColumns, fromPayload } = bothWays([row]);
  assert.deepEqual(fromColumns, fromPayload);
  // "unknown", not ""; and dataQuality 0 buckets low rather than vanishing.
  assert.ok(fromColumns.byMethod.some((m) => m.key === "unknown"));
  assert.ok(fromColumns.byDataQuality.some((m) => m.key === "low"));
});

test("a pick that is not 1/X/2 leaves calibration untouched", () => {
  const row = storedRow({ p1: 50, pX: 30, p2: 20, pick: null });
  // Same metadata on both sides, so the only difference under test is the pick.
  row.raw_payload = {
    evaluation: { modelProbs1x2Pct: { p1: 50, pX: 30, p2: 20 } },
    modelMeta: { method: "modular-engine", dataQuality: 0.8 }
  };
  const { fromColumns, fromPayload } = bothWays([row]);
  assert.deepEqual(fromColumns, fromPayload);
  assert.deepEqual(fromColumns.calibration1x2, []);
  assert.equal(fromColumns.nProb, 1, "the row still scores, it just does not calibrate");
});

test("a legacy triple that does not sum to 100 is normalised, not rejected", () => {
  // Production has such rows; the reducer divides by the observed sum, as before.
  const row = storedRow({ p1: 68.58710903533867, pX: 22.5, p2: 8.439293 });
  const { fromColumns, fromPayload } = bothWays([row]);
  assert.deepEqual(fromColumns, fromPayload);
  assert.equal(fromColumns.nProb, 1);
});

test("an unscoreable row is skipped by both paths", () => {
  const noScore = storedRow({ p1: 50, pX: 30, p2: 20 });
  delete noScore.score_home;
  const { fromColumns, fromPayload } = bothWays([noScore]);
  assert.deepEqual(fromColumns, fromPayload);
  assert.equal(fromColumns.nProb, 0);
});

test("a NULL score is still scored as 0 — pre-existing, and unchanged here", () => {
  /*
    `actual1x2FromScore` coerces with Number(), and Number(null) is a finite 0,
    so a half-recorded score reads as 0 rather than dropping out. That is not
    something D9b-4 introduces or fixes: the score columns were always columns.
    It is pinned so the read-path switch cannot be blamed for it later.
  */
  const halfScore = storedRow({ p1: 50, pX: 30, p2: 20 });
  halfScore.score_home = null;
  const { fromColumns, fromPayload } = bothWays([halfScore]);
  assert.deepEqual(fromColumns, fromPayload);
  assert.equal(fromColumns.nProb, 1, "0-1 reads as an away win");
});

test("grouping keys and calibration match across a mixed population", () => {
  const rows = [
    storedRow({ p1: 70, pX: 20, p2: 10, pick: "1" }),
    storedRow({ p1: 20, pX: 20, p2: 60, pick: "2", method: "standings", dq: 0.9 }),
    storedRow({ p1: 33, pX: 34, p2: 33, pick: "X", method: null, dq: 0.5 }),
    storedRow({ p1: 55, pX: 25, p2: 20, pick: "1", dq: 0.56 })
  ];
  const { fromColumns, fromPayload } = bothWays(rows);
  assert.deepEqual(fromColumns.byMethod, fromPayload.byMethod);
  assert.deepEqual(fromColumns.byLeague, fromPayload.byLeague);
  assert.deepEqual(fromColumns.byDataQuality, fromPayload.byDataQuality);
  assert.deepEqual(fromColumns.byModelVersion, fromPayload.byModelVersion);
  assert.deepEqual(fromColumns.calibration1x2, fromPayload.calibration1x2);
  assert.equal(fromColumns.ece1x2, fromPayload.ece1x2);
});

test("an empty population returns the same empty shape as before", () => {
  const out = computeMetrics([]);
  assert.equal(out.nRows, 0);
  assert.equal(out.nProb, 0);
  assert.equal(out.brier1x2, null);
  assert.equal(out.logLoss1x2, null);
  assert.deepEqual(out.byMethod, []);
  assert.deepEqual(out.calibration1x2, []);
});
