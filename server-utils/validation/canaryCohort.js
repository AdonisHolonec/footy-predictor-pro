/**
 * Canary checkpoint measurement — cohort construction and metrics.
 *
 * MEASUREMENT ONLY. Nothing here runs in the prediction path; this module sits
 * beside WalkForward.js / StackerWalkForward.js / TipClvReport.js, which are
 * likewise offline. It reads persisted rows and computes numbers. It never
 * fits, tunes, promotes or writes anything.
 *
 * The question it exists to answer, at 100 and again at 200 settled post-fix
 * rows: how do model-only, market-only and the published 0.20 blend compare on
 * the SAME fixtures — and does the historical "more disagreement with the
 * market -> worse model" pattern still hold after the venue-normalisation fixes.
 *
 * ERA DISCIPLINE. Era C is the post-#217 cohort. Nothing in the schema records
 * which code version produced a row, so era membership is established two ways
 * and BOTH are reported:
 *
 *   1. temporal   - historyMeta.generatedAt >= the era boundary. `generatedAt`
 *                   and never `updated_at`: a settlement sync rewrites
 *                   updated_at and would silently migrate rows between eras.
 *   2. structural - the persisted strengthMeta reconciles with the post-#217
 *                   venue denominators (atk/leagueAvgHome) and not with the old
 *                   ones (atk/leagueAvg). Independent of every clock and of
 *                   deploy timing.
 *
 * A row is era-C only when the temporal test passes. The structural test is
 * computed alongside so a disagreement is visible rather than assumed away —
 * see classifyEra().
 */

import { isRecommendedSlotExcluded } from "../recommendedMarketValidity.js";

/** Metric definitions travel with the numbers, so an old report stays readable. */
export const METRICS_VERSION = "canary-cohort-v1";

/**
 * Era boundaries as UTC instants (merge time of the PR that defines the era).
 * Overridable by the caller so a future era does not require an edit here.
 */
export const ERA_BOUNDARIES = Object.freeze({
  /** #211 removed the duplicated home-advantage factor. */
  B_START: "2026-08-28T19:30:33Z",
  /** #217 corrected venue normalisation on the active modular path. */
  C_START: "2026-08-31T11:56:50Z"
});

export const CHECKPOINT = Object.freeze({
  INSUFFICIENT: "INSUFFICIENT SAMPLE — NO DECISION",
  CANARY: "CANARY CHECKPOINT",
  FULL: "FULL POST-FIX AUDIT"
});

/** Pre-registered thresholds. Not a promotion rule — only a reporting mode. */
export const CHECKPOINT_THRESHOLDS = Object.freeze({ canary: 100, full: 200 });

export function checkpointStatus(n) {
  const count = Number(n);
  if (!Number.isFinite(count) || count < CHECKPOINT_THRESHOLDS.canary) return CHECKPOINT.INSUFFICIENT;
  if (count < CHECKPOINT_THRESHOLDS.full) return CHECKPOINT.CANARY;
  return CHECKPOINT.FULL;
}

/*
  Number(null) === 0 and Number("") === 0, both finite. Left to Number() alone a
  missing score becomes 0-0 (a "draw"), and a missing blend weight becomes 0
  (market-only) — two silent, plausible-looking corruptions. Absence is rejected
  before the coercion, never after it.
*/
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 1X2 outcome from a final score. Null when either side is missing. */
export function outcomeFromScore(home, away) {
  const h = num(home);
  const a = num(away);
  if (h == null || a == null) return null;
  return h > a ? "1" : h < a ? "2" : "X";
}

/** A probability triple normalised to sum 1. Null when it carries no mass. */
export function normaliseTriple(triple) {
  if (!triple) return null;
  const p1 = num(triple.p1);
  const pX = num(triple.pX);
  const p2 = num(triple.p2);
  if (p1 == null || pX == null || p2 == null) return null;
  const s = p1 + pX + p2;
  // Percentages and fractions both land here; only the ratio matters.
  if (!(s > 0)) return null;
  return { p1: p1 / s, pX: pX / s, p2: p2 / s };
}

export const probOf = (t, outcome) => (outcome === "1" ? t.p1 : outcome === "2" ? t.p2 : t.pX);
export const argmaxOutcome = (t) => (t.p1 >= t.pX && t.p1 >= t.p2 ? "1" : t.p2 >= t.pX ? "2" : "X");
export const brier = (t, actual) =>
  ["1", "X", "2"].reduce((s, o) => s + (probOf(t, o) - (o === actual ? 1 : 0)) ** 2, 0);
export const logLoss = (t, actual) => -Math.log(Math.max(1e-12, probOf(t, actual)));
export const isHit = (t, actual) => (argmaxOutcome(t) === actual ? 1 : 0);

/**
 * Blend a model triple toward the market.
 *
 * `weight` is the MODEL share, matching MODEL_MARKET_BLEND_WEIGHT: 0.20 means
 * 20% model / 80% market. Getting this backwards silently inverts the canary,
 * so it is asserted in the tests.
 */
export function blendTriples(model, market, weight) {
  const w = num(weight);
  if (!model || !market || w == null || w < 0 || w > 1) return null;
  return normaliseTriple({
    p1: w * model.p1 + (1 - w) * market.p1,
    pX: w * model.pX + (1 - w) * market.pX,
    p2: w * model.p2 + (1 - w) * market.p2
  });
}

/**
 * Structural era test: does the persisted strengthMeta reconcile with the
 * post-#217 venue denominators?
 *
 * Post-#217 each lambda side divides by its OWN venue baseline, so an exactly
 * league-average side yields a factor of 1. Pre-#217 it divided by the
 * venue-neutral leagueAvg, inflating the home ratio by leagueAvgHome/leagueAvg
 * (~1.12 in production). Reconstructing baseLambdaHome under both and asking
 * which leaves the residual form factor inside its clamp band separates them
 * without reference to any timestamp.
 *
 * @returns {"post217"|"pre217"|"unknown"} "unknown" when there is no venue
 *   split or a field is missing — with no split both formulas coincide and the
 *   test genuinely cannot discriminate.
 */
export function venueFormulaEra(strengthMeta, weights = {}) {
  const sm = strengthMeta;
  if (!sm || typeof sm !== "object") return "unknown";
  const leagueAvg = num(sm.leagueAvg);
  const avgHome = num(sm.leagueAvgHome);
  const avgAway = num(sm.leagueAvgAway);
  const atkH = num(sm.atkH);
  const defA = num(sm.defA);
  const base = num(sm.baseLambdaHome);
  if ([leagueAvg, avgHome, avgAway, atkH, defA, base].some((v) => v == null || v <= 0)) return "unknown";
  // Without a real split the two formulas are identical — do not guess.
  if (Math.abs(avgHome - leagueAvg) < 1e-9) return "unknown";

  const wAtk = num(weights.attack) ?? 1;
  const wDef = num(weights.defense) ?? 1;
  const post = avgHome * Math.pow(atkH / avgHome, wAtk) * Math.pow(defA / avgHome, wDef);
  const pre = avgHome * Math.pow(atkH / leagueAvg, wAtk) * Math.pow(defA / leagueAvg, wDef);
  // The unexplained remainder is form^w_form; form is clamped to [0.9, 1.1] and
  // timeDecay to [0.85, 1.05], so a plausible residual sits inside this band.
  const plausible = (r) => Number.isFinite(r) && r >= 0.85 && r <= 1.2;
  const postOk = plausible(base / post);
  const preOk = plausible(base / pre);
  if (postOk && !preOk) return "post217";
  if (preOk && !postOk) return "pre217";
  return "unknown";
}

/**
 * Temporal era for one row, from `generatedAt` only.
 * @returns {"A"|"B"|"C"|"unknown"}
 */
export function eraFromGeneratedAt(generatedAt, boundaries = ERA_BOUNDARIES) {
  if (!generatedAt) return "unknown";
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return "unknown";
  if (t < Date.parse(boundaries.B_START)) return "A";
  if (t < Date.parse(boundaries.C_START)) return "B";
  return "C";
}

/** Both era tests for one row, kept separate so disagreement stays visible. */
export function classifyEra(row, opts = {}) {
  const temporal = eraFromGeneratedAt(row?.generatedAt, opts.boundaries || ERA_BOUNDARIES);
  const structural = venueFormulaEra(row?.strengthMeta, opts.weights || {});
  return {
    temporal,
    structural,
    // Only a POSITIVE structural contradiction counts; "unknown" is silence.
    conflict: temporal === "C" && structural === "pre217"
  };
}

export const EXCLUSION_REASONS = Object.freeze({
  WRONG_ERA: "wrong_era",
  ERA_CONFLICT: "era_conflict",
  NOT_SETTLED: "not_settled",
  NO_SCORE: "incomplete_score",
  POST_KICKOFF: "generated_after_kickoff",
  NO_ODDS: "missing_market_odds",
  NO_MODEL_TRIPLE: "missing_model_triple",
  NO_PUBLISHED_TRIPLE: "missing_published_triple"
});

const SETTLED_STATUSES = new Set(["FT", "AET", "PEN"]);

/**
 * Build the clean era-C 1X2 cohort.
 *
 * Recommendation validity is deliberately NOT an exclusion. #215 excludes an
 * invalid RECOMMENDED slot from RECOMMENDATION performance; the 1X2 triple on
 * the same row is untouched by it, and dropping the fixture would let a
 * recommendation defect bias a model metric. The flag is carried through as a
 * counter so a recommendation cohort can be derived without a second pass.
 *
 * @param {Array<object>} rows
 * @param {{era?:string, boundaries?:object, weights?:object, marketProbs:Function}} opts
 */
export function buildCohort(rows, opts = {}) {
  const era = opts.era || "C";
  const marketProbs = opts.marketProbs;
  if (typeof marketProbs !== "function") {
    throw new TypeError("buildCohort requires opts.marketProbs — the de-vig function is not duplicated here");
  }
  const kept = [];
  const excluded = [];
  const bump = (reason, row) => excluded.push({ reason, fixture_id: row?.fixture_id ?? null });

  for (const row of rows || []) {
    const eras = classifyEra(row, opts);
    if (eras.temporal !== era) {
      bump(EXCLUSION_REASONS.WRONG_ERA, row);
      continue;
    }
    if (eras.conflict) {
      bump(EXCLUSION_REASONS.ERA_CONFLICT, row);
      continue;
    }
    if (!SETTLED_STATUSES.has(String(row.match_status))) {
      bump(EXCLUSION_REASONS.NOT_SETTLED, row);
      continue;
    }
    const actual = outcomeFromScore(row.score_home, row.score_away);
    if (!actual) {
      bump(EXCLUSION_REASONS.NO_SCORE, row);
      continue;
    }
    // Leakage guard: a prediction written after kickoff is not a prediction.
    const gen = Date.parse(row.generatedAt);
    const ko = Date.parse(row.kickoff_at);
    if (!(Number.isFinite(gen) && Number.isFinite(ko) && gen < ko)) {
      bump(EXCLUSION_REASONS.POST_KICKOFF, row);
      continue;
    }
    const market = marketProbs(row);
    if (!market) {
      bump(EXCLUSION_REASONS.NO_ODDS, row);
      continue;
    }
    const model = normaliseTriple(row.rawPoisson);
    if (!model) {
      bump(EXCLUSION_REASONS.NO_MODEL_TRIPLE, row);
      continue;
    }
    const published = normaliseTriple({ p1: row.prob_1, pX: row.prob_x, p2: row.prob_2 });
    if (!published) {
      bump(EXCLUSION_REASONS.NO_PUBLISHED_TRIPLE, row);
      continue;
    }
    kept.push({
      fixture_id: row.fixture_id,
      league_id: row.league_id,
      league_name: row.league_name,
      kickoff_at: row.kickoff_at,
      generatedAt: row.generatedAt,
      actual,
      model,
      market,
      published,
      pick: row.pick_1x2 ?? null,
      lambdaHome: num(row.lambdas?.home),
      lambdaAway: num(row.lambdas?.away),
      recommendationExcluded: isRecommendedSlotExcluded(row),
      structuralEra: eras.structural
    });
  }

  const byReason = {};
  for (const e of excluded) byReason[e.reason] = (byReason[e.reason] || 0) + 1;
  return { rows: kept, excluded, exclusionCounts: byReason, total: (rows || []).length };
}

/** Expected calibration error over equal-width confidence bins. */
export function expectedCalibrationError(pairs, bins = 10) {
  if (!pairs.length) return null;
  const buckets = Array.from({ length: bins }, () => ({ n: 0, conf: 0, hit: 0 }));
  for (const { triple, actual } of pairs) {
    const conf = probOf(triple, argmaxOutcome(triple));
    const i = Math.min(bins - 1, Math.max(0, Math.floor(conf * bins)));
    buckets[i].n += 1;
    buckets[i].conf += conf;
    buckets[i].hit += isHit(triple, actual);
  }
  const n = pairs.length;
  return buckets
    .filter((b) => b.n > 0)
    .reduce((s, b) => s + (b.n / n) * Math.abs(b.conf / b.n - b.hit / b.n), 0);
}

/** Reliability table: predicted confidence vs empirical frequency. */
export function reliabilityBuckets(pairs, bins = 10) {
  const buckets = Array.from({ length: bins }, (_, i) => ({
    lo: i / bins,
    hi: (i + 1) / bins,
    n: 0,
    meanConfidence: 0,
    empiricalFrequency: 0
  }));
  for (const { triple, actual } of pairs) {
    const conf = probOf(triple, argmaxOutcome(triple));
    const i = Math.min(bins - 1, Math.max(0, Math.floor(conf * bins)));
    buckets[i].n += 1;
    buckets[i].meanConfidence += conf;
    buckets[i].empiricalFrequency += isHit(triple, actual);
  }
  for (const b of buckets) {
    if (b.n) {
      b.meanConfidence /= b.n;
      b.empiricalFrequency /= b.n;
    } else {
      b.meanConfidence = null;
      b.empiricalFrequency = null;
    }
  }
  return buckets;
}

/** Brier / log-loss / accuracy / ECE plus the distribution of one arm. */
export function summariseArm(pairs) {
  const n = pairs.length;
  if (!n) return null;
  let brierSum = 0;
  let logLossSum = 0;
  let hits = 0;
  let mp1 = 0;
  let mpX = 0;
  let mp2 = 0;
  const picks = { 1: 0, X: 0, 2: 0 };
  for (const { triple, actual } of pairs) {
    brierSum += brier(triple, actual);
    logLossSum += logLoss(triple, actual);
    hits += isHit(triple, actual);
    mp1 += triple.p1;
    mpX += triple.pX;
    mp2 += triple.p2;
    picks[argmaxOutcome(triple)] += 1;
  }
  return {
    n,
    brier: brierSum / n,
    logLoss: logLossSum / n,
    accuracy: hits / n,
    ece: expectedCalibrationError(pairs),
    meanProb: { home: mp1 / n, draw: mpX / n, away: mp2 / n },
    pickRate: { home: picks["1"] / n, draw: picks.X / n, away: picks["2"] / n }
  };
}

/** |P(home)_model - P(home)_market| buckets, in percentage points. */
export const DISAGREEMENT_BUCKETS = Object.freeze([
  [0, 5],
  [5, 10],
  [10, 15],
  [15, 20],
  [20, Infinity]
]);

export function disagreementTable(cohort, blendWeight) {
  return DISAGREEMENT_BUCKETS.map(([lo, hi]) => {
    const sub = cohort.filter((r) => {
      const d = 100 * Math.abs(r.model.p1 - r.market.p1);
      return d >= lo && d < hi;
    });
    const arm = (key) => summariseArm(sub.map((r) => ({ triple: r[key], actual: r.actual })));
    const blended = summariseArm(
      sub.map((r) => ({ triple: blendTriples(r.model, r.market, blendWeight), actual: r.actual }))
    );
    return {
      lo,
      hi: hi === Infinity ? null : hi,
      n: sub.length,
      model: arm("model"),
      market: arm("market"),
      blend: blended
    };
  });
}

/**
 * The full checkpoint result. Pure: same rows in, same numbers out.
 *
 * `blendWeight` is the MODEL share and is recorded in provenance; it is read
 * from the caller and never inferred, so a checkpoint can never silently
 * measure a weight production is not running.
 */
export function runCheckpoint(cohortResult, opts = {}) {
  const blendWeight = num(opts.blendWeight);
  if (blendWeight == null) throw new TypeError("runCheckpoint requires opts.blendWeight (the MODEL share)");
  const rows = cohortResult.rows;
  const pairsFor = (key) => rows.map((r) => ({ triple: r[key], actual: r.actual }));
  const blendPairs = rows.map((r) => ({
    triple: blendTriples(r.model, r.market, blendWeight),
    actual: r.actual
  }));

  const outcomes = { home: 0, draw: 0, away: 0 };
  for (const r of rows) {
    if (r.actual === "1") outcomes.home += 1;
    else if (r.actual === "X") outcomes.draw += 1;
    else outcomes.away += 1;
  }
  const n = rows.length || 1;
  const meanLambda = (key) => {
    const vals = rows.map((r) => r[key]).filter((v) => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };

  return {
    metricsVersion: METRICS_VERSION,
    status: checkpointStatus(rows.length),
    sampleSize: rows.length,
    excludedCount: cohortResult.excluded.length,
    exclusionCounts: cohortResult.exclusionCounts,
    rowsConsidered: cohortResult.total,
    blendWeight,
    recommendationExcludedCount: rows.filter((r) => r.recommendationExcluded).length,
    arms: {
      model: summariseArm(pairsFor("model")),
      market: summariseArm(pairsFor("market")),
      blend: summariseArm(blendPairs),
      published: summariseArm(pairsFor("published"))
    },
    outcomeRate: {
      home: outcomes.home / n,
      draw: outcomes.draw / n,
      away: outcomes.away / n
    },
    lambda: { home: meanLambda("lambdaHome"), away: meanLambda("lambdaAway") },
    disagreement: disagreementTable(rows, blendWeight),
    reliability: {
      model: reliabilityBuckets(pairsFor("model")),
      blend: reliabilityBuckets(blendPairs)
    }
  };
}

export default {
  METRICS_VERSION,
  ERA_BOUNDARIES,
  CHECKPOINT,
  CHECKPOINT_THRESHOLDS,
  checkpointStatus,
  outcomeFromScore,
  normaliseTriple,
  blendTriples,
  venueFormulaEra,
  eraFromGeneratedAt,
  classifyEra,
  buildCohort,
  summariseArm,
  disagreementTable,
  reliabilityBuckets,
  expectedCalibrationError,
  runCheckpoint
};
