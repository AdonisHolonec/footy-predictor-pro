import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractSamplesFromHistory,
  computeReliabilityBuckets,
  computeEce,
  computeBrier1x2,
  fitGlobalConfidenceDeltas
} from "../server-utils/calibration/AutoCalibrationEngine.js";

/**
 * AutoCalibration calibrates the 1X2 prediction: lambda is a 1X2-shaped model
 * and the match result is its only unbiased, always-available label. (Its
 * overlays reach further than 1X2 — lambda feeds the whole Poisson grid and the
 * ConfidenceEngine too; see the contract note in AutoCalibrationEngine.js.)
 * These tests pin the target: it must come from the raw Poisson triple and the
 * final score, never from the recommended market's confidence or settlement.
 */

/** A finished fixture. The model's triple is home-favourite unless overridden. */
function row(overrides = {}) {
  const { p1 = 65, pX = 20, p2 = 15, contributions, ...rest } = overrides;
  return {
    fixture_id: 1,
    league_id: 39,
    score_home: 2,
    score_away: 0, // actual = "1"
    match_status: "FT",
    validation: "win",
    recommended_pick: "1",
    recommended_confidence: 70,
    raw_payload: {
      evaluation: { rawPoissonProbs1x2Pct: { p1, pX, p2 } },
      featureImportance: { contributions: contributions ?? { attack: 0.3, defense: 0.2, form: 0.15 } }
    },
    ...rest
  };
}
const one = (o) => extractSamplesFromHistory([row(o)])[0];

/* -- the target itself ---------------------------------------------------- */

test("[1] 1X2 recommendation, 1X2 hit -> won=true", () => {
  const s = one({ recommended_pick: "1", validation: "win", score_home: 2, score_away: 0 });
  assert.equal(s.selection, "1");
  assert.equal(s.won, true);
  assert.equal(s.pickProb, 0.65);
});

test("[2] 1X2 recommendation, 1X2 miss -> won=false", () => {
  const s = one({ recommended_pick: "1", validation: "loss", score_home: 0, score_away: 2 });
  assert.equal(s.actual, "2");
  assert.equal(s.selection, "1", "the model still selected home");
  assert.equal(s.won, false);
});

test("[3][4][5][6] a recommended-market WIN can never make a lost 1X2 prediction a success", () => {
  // Every one of these settled as a recommendation win while the model's 1X2
  // pick (home, 65%) lost 0-2. This is the 358-row production shape.
  for (const pick of ["Shots Over 10.5", "SOT Over 7.5", "Over 7.5", "Over 2.5", "1X", "GG"]) {
    const s = one({ recommended_pick: pick, validation: "win", recommended_confidence: 100, score_home: 0, score_away: 2 });
    assert.equal(s.won, false, `${pick} must not win the 1X2 calibration`);
    assert.equal(s.pickProb, 0.65, `${pick}: probability must be the 1X2 triple, not the recommendation's 100%`);
    assert.equal(s.selection, "1");
  }
});

test("[7] a recommended-market LOSS does not spoil a correct 1X2 prediction", () => {
  const s = one({ recommended_pick: "Corners Over 9.5", validation: "loss", score_home: 2, score_away: 0 });
  assert.equal(s.won, true);
  assert.equal(s.pickProb, 0.65);
});

test("[12] pickProb always comes from the 1X2 triple, whatever the recommendation says", () => {
  for (const confidence of [0, 1, 50, 92, 100]) {
    const s = one({ recommended_pick: "Shots Over 10.5", recommended_confidence: confidence });
    assert.equal(s.pickProb, 0.65, `confidence ${confidence} must not reach pickProb`);
  }
  assert.equal(one({ p1: 40, pX: 35, p2: 25 }).pickProb, 0.4);
  assert.equal(one({ p1: 20, pX: 30, p2: 50 }).pickProb, 0.5);
});

test("the selection follows the model, and ties use the project convention (1 > 2 > X)", () => {
  assert.equal(one({ p1: 20, pX: 30, p2: 50 }).selection, "2");
  assert.equal(one({ p1: 20, pX: 50, p2: 30 }).selection, "X");
  assert.equal(one({ p1: 40, pX: 40, p2: 20 }).selection, "1", "1 wins a tie with X");
  assert.equal(one({ p1: 40, pX: 20, p2: 40 }).selection, "1", "1 wins a tie with 2");
  assert.equal(one({ p1: 20, pX: 40, p2: 40 }).selection, "2", "2 wins a tie with X");
});

/* -- settlement states are no longer targets ------------------------------ */

test("[9][10][11] push / half_win / half_loss / pending are settlement states, not calibration misses", () => {
  for (const validation of ["push", "half_win", "half_loss", "pending", null]) {
    const hit = one({ validation, score_home: 2, score_away: 0 });
    assert.equal(hit.won, true, `${validation}: a correct 1X2 prediction stays correct`);
    const miss = one({ validation, score_home: 0, score_away: 2 });
    assert.equal(miss.won, false, `${validation}: a wrong 1X2 prediction stays wrong`);
  }
});

test("[15][16] settlement and stored prediction fields are read, never rewritten", () => {
  const input = row({ recommended_pick: "Shots Over 10.5", validation: "win", score_home: 0, score_away: 2 });
  const before = JSON.parse(JSON.stringify(input));
  const s = extractSamplesFromHistory([input])[0];
  assert.deepEqual(input, before, "the source row must not be mutated");
  assert.equal(s.recommendedValidation, "win");
  assert.equal(s.recommendedPick, "Shots Over 10.5");
  assert.equal(s.won, false, "and it does not decide the target");
});

test("a row without a usable 1X2 triple never enters the sample", () => {
  assert.equal(extractSamplesFromHistory([{ ...row(), raw_payload: {} }]).length, 0);
  assert.equal(extractSamplesFromHistory([{ ...row(), raw_payload: { evaluation: {} } }]).length, 0);
});

test("PRE-EXISTING, documented: a NULL score is read as 0-0 by actual1x2FromScore", () => {
  /*
    `Number(null)` is 0 and `Number.isFinite(0)` is true, so
    actual1x2FromScore(null, null) returns "X" rather than null, and such a row
    would be admitted as a draw. This is NOT introduced here and is NOT reachable
    through the engine: loadSettledHistory filters `score_home != null &&
    score_away != null` before extraction (AutoCalibrationEngine.js:405), and
    every other caller of actual1x2FromScore filters the same way. Pinned so the
    guard upstream is never removed silently, and so the behaviour is a decision
    rather than a surprise.
  */
  const admitted = extractSamplesFromHistory([row({ score_home: null, score_away: null })]);
  assert.equal(admitted.length, 1);
  assert.equal(admitted[0].actual, "X", "reads as a 0-0 draw — upstream must filter it");
});

/* -- [8] eligibility: invalid recommendations are NOT excluded, deliberately -- */

test("[8] an invalid recommended market does not remove the row's 1X2 observation", () => {
  const s = one({ recommended_market_valid: false, recommended_pick: "Shots Over 10.5", validation: "win", score_home: 0, score_away: 2 });
  assert.ok(s, "the row is still a valid 1X2 sample");
  assert.equal(s.won, false, "and its target is the 1X2 outcome, so the malformed win cannot leak in");
  assert.equal(s.pickProb, 0.65);
});

/* -- [13][14] the fitted metrics inherit the same target ------------------ */

test("[13][14] ECE, reliability buckets and fitted deltas all use the 1X2 target", () => {
  // 10 fixtures: the model says home 90%, and home wins 5 of 10 — a textbook
  // overconfident model, while every recommendation "won".
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const homeWon = i < 5;
    rows.push(row({
      fixture_id: i,
      p1: 90, pX: 6, p2: 4,
      score_home: homeWon ? 2 : 0,
      score_away: homeWon ? 0 : 2,
      recommended_pick: "Shots Over 10.5",
      recommended_confidence: 100,
      validation: "win"
    }));
  }
  const samples = extractSamplesFromHistory(rows);
  assert.equal(samples.length, 10);
  assert.equal(samples.filter((s) => s.won).length, 5, "5 of 10, not 10 of 10");

  const buckets = computeReliabilityBuckets(samples);
  const top = buckets.find((b) => b.lo === 0.9);
  assert.equal(top.n, 10);
  assert.equal(top.avgPredicted, 0.9);
  assert.equal(top.hitRate, 0.5, "the reliability diagram sees the real 1X2 hit rate");
  assert.ok(Math.abs(computeEce(buckets) - 0.4) < 1e-6, "ECE reflects the 0.9 vs 0.5 gap");

  const glob = fitGlobalConfidenceDeltas(samples, { keys: ["oddsConsensus"] });
  assert.equal(glob.hitRate, 0.5);
  assert.equal(glob.avgPredicted, 0.9);
  assert.equal(glob.overconfidence, 0.4, "overconfidence is measured against the 1X2 outcome");
  assert.ok(glob.deltas.oddsConsensus < 0, "an overconfident model must be shrunk, not boosted");

  assert.ok(computeBrier1x2(samples) > 0, "Brier is unchanged in kind - triple vs one-hot outcome");
});

test("the same fixtures under the OLD semantics would have looked perfectly calibrated", () => {
  // Documents the defect: recommendation confidence 100% with a recommendation
  // win yields hitRate 1.0 against avgPredicted 1.0 - gap zero - while the 1X2
  // prediction was wrong half the time.
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const homeWon = i < 5;
    rows.push(row({ fixture_id: i, p1: 90, pX: 6, p2: 4, score_home: homeWon ? 2 : 0, score_away: homeWon ? 0 : 2, recommended_pick: "Shots Over 10.5", recommended_confidence: 100, validation: "win" }));
  }
  const legacy = rows.map((r) => ({ pickProb: 1, won: r.validation === "win" }));
  assert.equal(computeEce(computeReliabilityBuckets(legacy)), 0, "the old target reported perfect calibration");
  const now = computeEce(computeReliabilityBuckets(extractSamplesFromHistory(rows)));
  assert.ok(now > 0.3, `the 1X2 target reports the real miscalibration (${now})`);
});
