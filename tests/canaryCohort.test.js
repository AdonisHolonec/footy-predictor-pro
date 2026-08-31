import test from "node:test";
import assert from "node:assert/strict";

import {
  CHECKPOINT,
  ERA_BOUNDARIES,
  EXCLUSION_REASONS,
  blendTriples,
  buildCohort,
  checkpointStatus,
  classifyEra,
  eraFromGeneratedAt,
  expectedCalibrationError,
  normaliseTriple,
  outcomeFromScore,
  runCheckpoint,
  summariseArm,
  venueFormulaEra
} from "../server-utils/validation/canaryCohort.js";

/**
 * Canary checkpoint tooling.
 *
 * This module is measurement-only, so the tests protect the things that would
 * silently corrupt a measurement rather than crash it: era leakage, a flipped
 * blend weight, an outcome mapped to the wrong side, and a threshold that
 * reports the wrong checkpoint mode.
 *
 * Every row here is synthetic.
 */

const IN_C = "2026-08-31T12:00:00.000Z"; // after ERA_BOUNDARIES.C_START
const IN_B = "2026-08-29T12:00:00.000Z";
const IN_A = "2026-08-01T12:00:00.000Z";
const KICKOFF = "2026-09-01T18:00:00+00:00";

/** Even market so the de-vig is trivial and the arithmetic stays checkable. */
const evenMarket = () => normaliseTriple({ p1: 1, pX: 1, p2: 1 });

function row(over = {}) {
  return {
    fixture_id: 1,
    league_id: 39,
    league_name: "Example",
    kickoff_at: KICKOFF,
    generatedAt: IN_C,
    match_status: "FT",
    score_home: 2,
    score_away: 1,
    prob_1: 45,
    prob_x: 27,
    prob_2: 28,
    pick_1x2: "1",
    odds_home: 2,
    odds_draw: 3,
    odds_away: 4,
    recommended_market_valid: true,
    rawPoisson: { p1: 50, pX: 25, p2: 25 },
    lambdas: { home: 1.5, away: 1.2 },
    ...over
  };
}

const build = (rows, opts = {}) => buildCohort(rows, { marketProbs: evenMarket, ...opts });

// ---------------------------------------------------------------------------
// era discipline
// ---------------------------------------------------------------------------
test("generatedAt maps to the right era and updated_at is never consulted", () => {
  assert.equal(eraFromGeneratedAt(IN_A), "A");
  assert.equal(eraFromGeneratedAt(IN_B), "B");
  assert.equal(eraFromGeneratedAt(IN_C), "C");
  assert.equal(eraFromGeneratedAt(ERA_BOUNDARIES.C_START), "C", "the boundary instant belongs to C");
  assert.equal(eraFromGeneratedAt(null), "unknown");
  assert.equal(eraFromGeneratedAt("not a date"), "unknown");
});

test("mixed-era rows are excluded — only era C survives", () => {
  const res = build([
    row({ fixture_id: 1, generatedAt: IN_A }),
    row({ fixture_id: 2, generatedAt: IN_B }),
    row({ fixture_id: 3, generatedAt: IN_C }),
    row({ fixture_id: 4, generatedAt: null })
  ]);
  assert.deepEqual(res.rows.map((r) => r.fixture_id), [3]);
  assert.equal(res.exclusionCounts[EXCLUSION_REASONS.WRONG_ERA], 3);
});

test("an era-C row contradicted by the venue formula is excluded, not silently kept", () => {
  // Pre-#217 shape: baseLambdaHome reconciles with /leagueAvg, not /leagueAvgHome.
  const leagueAvg = 1.435;
  const avgHome = 1.6259;
  const avgAway = 1.2441;
  const atkH = avgHome;
  const defA = avgHome;
  const preBase = avgHome * (atkH / leagueAvg) * (defA / leagueAvg);
  const strengthMeta = {
    leagueAvg,
    leagueAvgHome: avgHome,
    leagueAvgAway: avgAway,
    atkH,
    defA,
    baseLambdaHome: preBase
  };

  assert.equal(venueFormulaEra(strengthMeta), "pre217");
  const cls = classifyEra({ generatedAt: IN_C, strengthMeta });
  assert.equal(cls.temporal, "C");
  assert.equal(cls.conflict, true);

  const res = build([row({ strengthMeta })]);
  assert.equal(res.rows.length, 0);
  assert.equal(res.exclusionCounts[EXCLUSION_REASONS.ERA_CONFLICT], 1);
});

test("a post-#217 row is confirmed structurally and kept", () => {
  const leagueAvg = 1.435;
  const avgHome = 1.6259;
  const atkH = avgHome;
  const defA = avgHome;
  const strengthMeta = {
    leagueAvg,
    leagueAvgHome: avgHome,
    leagueAvgAway: 1.2441,
    atkH,
    defA,
    baseLambdaHome: avgHome * (atkH / avgHome) * (defA / avgHome)
  };
  assert.equal(venueFormulaEra(strengthMeta), "post217");
  const res = build([row({ strengthMeta })]);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].structuralEra, "post217");
});

test("without a venue split the structural test reports unknown rather than guessing", () => {
  const sm = { leagueAvg: 1.4, leagueAvgHome: 1.4, leagueAvgAway: 1.4, atkH: 1.4, defA: 1.4, baseLambdaHome: 1.4 };
  assert.equal(venueFormulaEra(sm), "unknown");
  // unknown must NOT exclude the row — silence is not a contradiction.
  assert.equal(build([row({ strengthMeta: sm })]).rows.length, 1);
});

// ---------------------------------------------------------------------------
// exclusions
// ---------------------------------------------------------------------------
test("incomplete settlements are excluded", () => {
  const res = build([
    row({ fixture_id: 1, match_status: "NS" }),
    row({ fixture_id: 2, match_status: "FT", score_home: null }),
    row({ fixture_id: 3, match_status: "FT", score_away: undefined }),
    row({ fixture_id: 4 })
  ]);
  assert.deepEqual(res.rows.map((r) => r.fixture_id), [4]);
  assert.equal(res.exclusionCounts[EXCLUSION_REASONS.NOT_SETTLED], 1);
  assert.equal(res.exclusionCounts[EXCLUSION_REASONS.NO_SCORE], 2);
});

test("a prediction generated after kickoff is excluded as leakage", () => {
  const res = build([row({ generatedAt: "2026-09-01T19:00:00.000Z" })]);
  assert.equal(res.rows.length, 0);
  assert.equal(res.exclusionCounts[EXCLUSION_REASONS.POST_KICKOFF], 1);
});

test("missing odds and missing triples are excluded with distinct reasons", () => {
  const res = buildCohort(
    [
      row({ fixture_id: 1, odds_home: 1 }),
      row({ fixture_id: 2, rawPoisson: null }),
      row({ fixture_id: 3, prob_1: 0, prob_x: 0, prob_2: 0 }),
      row({ fixture_id: 4 })
    ],
    { marketProbs: (r) => (Number(r.odds_home) > 1 ? evenMarket() : null) }
  );
  assert.deepEqual(res.rows.map((r) => r.fixture_id), [4]);
  assert.equal(res.exclusionCounts[EXCLUSION_REASONS.NO_ODDS], 1);
  assert.equal(res.exclusionCounts[EXCLUSION_REASONS.NO_MODEL_TRIPLE], 1);
  assert.equal(res.exclusionCounts[EXCLUSION_REASONS.NO_PUBLISHED_TRIPLE], 1);
});

test("an invalid RECOMMENDED slot is carried, never dropped from the 1X2 cohort", () => {
  // #215 excludes an invalid recommended market from RECOMMENDATION stats. The
  // 1X2 triple on the same row is unaffected, so dropping the fixture here would
  // let a recommendation defect bias a model metric.
  const res = build([row({ fixture_id: 1, recommended_market_valid: false }), row({ fixture_id: 2 })]);
  assert.equal(res.rows.length, 2, "both rows stay in the 1X2 cohort");
  assert.equal(res.rows[0].recommendationExcluded, true);
  assert.equal(res.rows[1].recommendationExcluded, false);
  const report = runCheckpoint(res, { blendWeight: 0.2 });
  assert.equal(report.recommendationExcludedCount, 1, "but it is counted so a recommendation cohort can be derived");
});

test("a valid settled 1X2 row is retained with the outcome mapped correctly", () => {
  const res = build([
    row({ fixture_id: 1, score_home: 2, score_away: 1 }),
    row({ fixture_id: 2, score_home: 0, score_away: 0 }),
    row({ fixture_id: 3, score_home: 0, score_away: 3 })
  ]);
  assert.deepEqual(res.rows.map((r) => r.actual), ["1", "X", "2"]);
});

test("outcomeFromScore never maps a draw or an away win to home", () => {
  assert.equal(outcomeFromScore(1, 0), "1");
  assert.equal(outcomeFromScore(1, 1), "X");
  assert.equal(outcomeFromScore(0, 1), "2");
  assert.equal(outcomeFromScore(null, 1), null);
  assert.equal(outcomeFromScore(1, null), null);
});

// ---------------------------------------------------------------------------
// blend weight
// ---------------------------------------------------------------------------
test("blend 0.20 is the MODEL share, not the market share", () => {
  const model = normaliseTriple({ p1: 100, pX: 0, p2: 0 });
  const market = normaliseTriple({ p1: 0, pX: 0, p2: 100 });
  const blended = blendTriples(model, market, 0.2);
  // 0.2 model + 0.8 market => P(home)=0.2, P(away)=0.8. Reversed would be 0.8/0.2.
  assert.ok(Math.abs(blended.p1 - 0.2) < 1e-12, `P(home) should be 0.20, got ${blended.p1}`);
  assert.ok(Math.abs(blended.p2 - 0.8) < 1e-12, `P(away) should be 0.80, got ${blended.p2}`);
});

test("blend arithmetic is exact on a mixed triple and stays normalised", () => {
  const model = normaliseTriple({ p1: 60, pX: 20, p2: 20 });
  const market = normaliseTriple({ p1: 40, pX: 30, p2: 30 });
  const b = blendTriples(model, market, 0.2);
  assert.ok(Math.abs(b.p1 - (0.2 * 0.6 + 0.8 * 0.4)) < 1e-12);
  assert.ok(Math.abs(b.pX - (0.2 * 0.2 + 0.8 * 0.3)) < 1e-12);
  assert.ok(Math.abs(b.p1 + b.pX + b.p2 - 1) < 1e-12);
});

test("an out-of-range or missing blend weight yields null rather than a wrong number", () => {
  const m = evenMarket();
  assert.equal(blendTriples(m, m, -0.1), null);
  assert.equal(blendTriples(m, m, 1.5), null);
  assert.equal(blendTriples(m, m, null), null);
  assert.equal(blendTriples(null, m, 0.2), null);
});

test("runCheckpoint refuses to invent a blend weight", () => {
  assert.throws(() => runCheckpoint({ rows: [], excluded: [], exclusionCounts: {}, total: 0 }, {}), TypeError);
});

// ---------------------------------------------------------------------------
// checkpoint thresholds
// ---------------------------------------------------------------------------
test("sample size selects the checkpoint mode at exactly the pre-registered thresholds", () => {
  assert.equal(checkpointStatus(0), CHECKPOINT.INSUFFICIENT);
  assert.equal(checkpointStatus(99), CHECKPOINT.INSUFFICIENT);
  assert.equal(checkpointStatus(100), CHECKPOINT.CANARY);
  assert.equal(checkpointStatus(199), CHECKPOINT.CANARY);
  assert.equal(checkpointStatus(200), CHECKPOINT.FULL);
  assert.equal(checkpointStatus(1000), CHECKPOINT.FULL);
  assert.equal(checkpointStatus(NaN), CHECKPOINT.INSUFFICIENT);
});

test("the report carries the status its own sample size earns", () => {
  const make = (n) => build(Array.from({ length: n }, (_, i) => row({ fixture_id: i + 1 })));
  assert.equal(runCheckpoint(make(99), { blendWeight: 0.2 }).status, CHECKPOINT.INSUFFICIENT);
  assert.equal(runCheckpoint(make(100), { blendWeight: 0.2 }).status, CHECKPOINT.CANARY);
  assert.equal(runCheckpoint(make(200), { blendWeight: 0.2 }).status, CHECKPOINT.FULL);
});

// ---------------------------------------------------------------------------
// metric correctness and determinism
// ---------------------------------------------------------------------------
test("Brier, log loss and accuracy match hand-computed values", () => {
  const triple = normaliseTriple({ p1: 50, pX: 25, p2: 25 });
  const s = summariseArm([{ triple, actual: "1" }]);
  // Brier = (0.5-1)^2 + 0.25^2 + 0.25^2 = 0.375 ; logLoss = -ln(0.5)
  assert.ok(Math.abs(s.brier - 0.375) < 1e-12);
  assert.ok(Math.abs(s.logLoss - Math.log(2)) < 1e-12);
  assert.equal(s.accuracy, 1);
  const miss = summariseArm([{ triple, actual: "2" }]);
  assert.equal(miss.accuracy, 0);
});

test("a confident-but-wrong set is flagged by ECE and a confident-and-right set is not", () => {
  const confident = normaliseTriple({ p1: 90, pX: 5, p2: 5 });
  const allWrong = Array.from({ length: 10 }, () => ({ triple: confident, actual: "2" }));
  assert.ok(expectedCalibrationError(allWrong) > 0.8, "90% confidence with 0% hit rate is badly calibrated");
  const allRight = Array.from({ length: 10 }, () => ({ triple: confident, actual: "1" }));
  assert.ok(expectedCalibrationError(allRight) < 0.11, "90% confidence with 100% hit rate is close");
});

test("metrics are deterministic — the same rows produce byte-identical output", () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    row({
      fixture_id: i + 1,
      score_home: i % 3,
      score_away: (i + 1) % 3,
      prob_1: 40 + (i % 7),
      prob_x: 30,
      prob_2: 30 - (i % 7),
      rawPoisson: { p1: 45 + (i % 5), pX: 27, p2: 28 - (i % 5) }
    })
  );
  const a = JSON.stringify(runCheckpoint(build(rows), { blendWeight: 0.2 }));
  const b = JSON.stringify(runCheckpoint(build(rows), { blendWeight: 0.2 }));
  assert.equal(a, b);
  // Row ORDER must not change the aggregate materially. Exact equality would be
  // the wrong assertion: floating-point summation is not associative, so a
  // reversed cohort legitimately differs in the last ULP.
  const c = runCheckpoint(build([...rows].reverse()), { blendWeight: 0.2 });
  assert.ok(
    Math.abs(JSON.parse(a).arms.model.brier - c.arms.model.brier) < 1e-12,
    "row order must not move the aggregate beyond floating-point noise"
  );
});

test("disagreement buckets partition the cohort exactly once", () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    row({ fixture_id: i + 1, rawPoisson: { p1: 10 + 2.5 * i, pX: 30, p2: 60 - 2.5 * i } })
  );
  const report = runCheckpoint(build(rows), { blendWeight: 0.2 });
  const summed = report.disagreement.reduce((s, b) => s + b.n, 0);
  assert.equal(summed, report.sampleSize, "every row lands in exactly one bucket");
});

test("provenance-critical fields are present on every report", () => {
  const report = runCheckpoint(build([row()]), { blendWeight: 0.2 });
  assert.equal(report.metricsVersion, "canary-cohort-v1");
  assert.equal(report.blendWeight, 0.2);
  assert.equal(typeof report.sampleSize, "number");
  assert.equal(typeof report.excludedCount, "number");
  assert.equal(typeof report.rowsConsidered, "number");
});

test("buildCohort refuses to invent a de-vig function", () => {
  assert.throws(() => buildCohort([row()], {}), TypeError);
});
