/**
 * Referee cards — statistical analysis primitives.
 *
 * ANALYSIS ONLY. Nothing in this module is imported by the prediction pipeline, and
 * nothing here is a production multiplier. It exists to answer one question with numbers
 * instead of intuition: how much evidence does a referee need before their card average
 * is a signal rather than noise, and what should that average be compared against?
 *
 * Every function is pure, so the analysis is reproducible and testable. The I/O — pulling
 * fixtures and statistics — lives in the throwaway audit script that consumes this.
 *
 * UNIT: cardsTotal (raw yellow + red) throughout, matching the rolling averages and the
 * referee statistic. cardsPoints (2*red + yellow) is carried separately and never mixed in.
 */

const round3 = (v) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(3)));

/**
 * Strict numeric read: null/undefined/"" are ABSENT, not zero.
 *
 * `Number(null) === 0` and `Number("") === 0` are both finite, so a bare
 * `Number.isFinite(Number(x))` guard silently accepts a missing value as a real 0 — the
 * same defect this whole analysis exists to reason about. Every numeric entry point in
 * this module goes through here.
 *
 * @returns {number|null}
 */
function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Descriptive statistics for a list of numbers. Returns nulls rather than NaN when empty. */
export function describe(values) {
  const nums = (Array.isArray(values) ? values : []).map(num).filter((v) => v != null);
  const n = nums.length;
  if (!n) {
    return { n: 0, mean: null, median: null, sd: null, min: null, max: null, range: null };
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const mean = nums.reduce((a, b) => a + b, 0) / n;
  const mid = n / 2;
  const median = n % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  // Population SD: this describes the set we observed, it does not infer a wider population.
  const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return {
    n,
    mean: round3(mean),
    median: round3(median),
    sd: round3(sd),
    min: sorted[0],
    max: sorted[n - 1],
    range: round3(sorted[n - 1] - sorted[0])
  };
}

/**
 * Chronological order, deterministic under equal dates.
 *
 * Ties broken by fixtureId so the same input set always produces the same sequence —
 * required for the walk-forward backtest to be reproducible, and for "first half vs second
 * half" to mean the same thing on every run.
 */
export function sortObservations(observations) {
  return [...(Array.isArray(observations) ? observations : [])].sort((a, b) => {
    const da = new Date(a?.date || 0).getTime();
    const db = new Date(b?.date || 0).getTime();
    if (da !== db) return da - db;
    return Number(a?.fixtureId || 0) - Number(b?.fixtureId || 0);
  });
}

/**
 * Observations that carry a usable cardsTotal.
 *
 * UNKNOWN exclusion, applied once here so every downstream statistic inherits it: a
 * fixture whose card total was never observed is dropped, never coerced to 0. A real 0 is
 * a card-free match and is kept.
 */
export function validObservations(observations) {
  return (Array.isArray(observations) ? observations : []).filter((o) => {
    const v = num(o?.cardsTotal);
    return v != null && v >= 0;
  });
}

/**
 * League baseline from observed fixtures. Deliberately NOT read from leagueProfiles —
 * whether the configured value even means the same quantity is one of the things the
 * analysis has to establish.
 */
export function computeLeagueBaseline(observations) {
  const valid = validObservations(observations);
  return describe(valid.map((o) => Number(o.cardsTotal)));
}

/**
 * A referee's position relative to a baseline.
 *
 * `delta` is the interpretable quantity: "this referee shows 1.2 more cards per match than
 * this league normally does". `ratio` is reported for comparison only — a +1.0 delta means
 * something very different against a 3.2 baseline than against a 4.8 one, which is exactly
 * why the raw average alone cannot be compared across leagues.
 */
export function refereeDelta(refereeAvg, leagueAvg) {
  const r = num(refereeAvg);
  const l = num(leagueAvg);
  if (r == null || l == null) return { delta: null, ratio: null };
  return { delta: round3(r - l), ratio: l === 0 ? null : round3(r / l) };
}

/** Sample-size buckets used across the whole analysis. Order is fixed and meaningful. */
export const SAMPLE_BUCKETS = Object.freeze([
  { key: "n=1", min: 1, max: 1 },
  { key: "n=2", min: 2, max: 2 },
  { key: "n=3", min: 3, max: 3 },
  { key: "n=4", min: 4, max: 4 },
  { key: "n=5", min: 5, max: 5 },
  { key: "n=6-9", min: 6, max: 9 },
  { key: "n=10-14", min: 10, max: 14 },
  { key: "n>=15", min: 15, max: Infinity }
]);

export function bucketForSample(n) {
  const size = Number(n);
  if (!Number.isFinite(size) || size < 1) return null;
  return SAMPLE_BUCKETS.find((b) => size >= b.min && size <= b.max) || null;
}

/**
 * Group referees into sample buckets and describe the delta distribution inside each.
 *
 * Empty buckets are reported with refereeCount 0 rather than omitted — an absent bucket is
 * itself a finding ("no referee in this dataset has 15+ matches").
 *
 * @param {Array<{name: string, sampleSize: number, delta: number|null}>} referees
 */
export function bucketBySampleSize(referees) {
  const groups = new Map(SAMPLE_BUCKETS.map((b) => [b.key, []]));
  for (const ref of Array.isArray(referees) ? referees : []) {
    const bucket = bucketForSample(ref?.sampleSize);
    if (!bucket) continue;
    if (ref?.delta == null || !Number.isFinite(Number(ref.delta))) continue;
    groups.get(bucket.key).push(Number(ref.delta));
  }
  return SAMPLE_BUCKETS.map((b) => ({
    bucket: b.key,
    refereeCount: groups.get(b.key).length,
    delta: describe(groups.get(b.key))
  }));
}

/**
 * Shrink a referee average toward a baseline in proportion to how much evidence backs it.
 *
 *   shrunk = (n / (n + k)) * refereeAvg + (k / (n + k)) * leagueAvg
 *
 * k is the number of matches' worth of belief given to the league baseline: at n = k the
 * estimate sits exactly halfway. ANALYSIS ONLY — no k is chosen here, and this is not
 * wired into any engine.
 */
export function shrinkTowardBaseline(refereeAvg, leagueAvg, n, k) {
  const r = num(refereeAvg);
  const l = num(leagueAvg);
  const size = num(n);
  const strength = num(k);
  if (r == null || l == null) return null;
  if (size == null || size < 0) return null;
  if (strength == null || strength < 0) return null;
  if (size + strength === 0) return round3(l);
  return round3((size / (size + strength)) * r + (strength / (size + strength)) * l);
}

/**
 * Split a referee's chronological history in two, to ask whether the first half predicts
 * the second. The split point is the midpoint; with an odd count the extra match goes to
 * the first half so the second half is never the larger of the two.
 */
export function splitHalves(observations) {
  const sorted = sortObservations(validObservations(observations));
  const cut = Math.ceil(sorted.length / 2);
  return { first: sorted.slice(0, cut), second: sorted.slice(cut) };
}

/**
 * Out-of-sample stability: does a referee's early average survive into their later matches?
 *
 * Returns null when either half is below `minPerHalf` — a "stability" number computed from
 * one match against one match would be noise dressed as evidence.
 */
export function stabilityForReferee(observations, { minPerHalf = 3 } = {}) {
  const { first, second } = splitHalves(observations);
  if (first.length < minPerHalf || second.length < minPerHalf) return null;
  const firstAvg = describe(first.map((o) => Number(o.cardsTotal))).mean;
  const secondAvg = describe(second.map((o) => Number(o.cardsTotal))).mean;
  return {
    firstN: first.length,
    secondN: second.length,
    firstAvg,
    secondAvg,
    change: round3(secondAvg - firstAvg),
    absError: round3(Math.abs(secondAvg - firstAvg))
  };
}

/**
 * Walk-forward evaluation with NO temporal leakage.
 *
 * For each fixture in chronological order, every predictor may only use fixtures that
 * happened strictly BEFORE it — the referee's own prior matches and the league's prior
 * matches. The fixture being predicted never contributes to its own prediction, which is
 * the easiest way to manufacture a flattering backtest and the reason it is enforced
 * structurally here rather than by convention.
 *
 * Fixtures seen before the league has `minPriorLeague` matches of history are skipped:
 * there is nothing to predict from yet.
 *
 * @param {Array<{fixtureId, date, referee, cardsTotal}>} observations
 * @param {{ kValues?: number[], minPriorLeague?: number }} [opts]
 */
export function walkForwardEvaluate(observations, opts = {}) {
  const kValues = opts.kValues || [3, 5, 10];
  const minPriorLeague = opts.minPriorLeague ?? 10;
  const sorted = sortObservations(validObservations(observations));

  const errors = { league: [], refereeRaw: [] };
  for (const k of kValues) errors[`shrunk_k${k}`] = [];

  const priorByReferee = new Map();
  let leagueSum = 0;
  let leagueCount = 0;
  let skipped = 0;
  let refereeAvailable = 0;

  for (const obs of sorted) {
    const actual = Number(obs.cardsTotal);
    const refKey = String(obs.referee || "").trim();

    if (leagueCount >= minPriorLeague) {
      const leagueAvg = leagueSum / leagueCount;
      const prior = refKey ? priorByReferee.get(refKey) : null;
      const n = prior ? prior.count : 0;
      const refAvg = n > 0 ? prior.sum / n : null;

      errors.league.push(actual - leagueAvg);
      // With no prior history the referee predictor can only fall back to the league.
      // Recording that as the baseline's own value keeps the comparison honest instead of
      // quietly dropping the hard cases from the referee track.
      errors.refereeRaw.push(actual - (refAvg ?? leagueAvg));
      if (refAvg != null) refereeAvailable += 1;
      for (const k of kValues) {
        const shrunk = shrinkTowardBaseline(refAvg ?? leagueAvg, leagueAvg, n, k);
        errors[`shrunk_k${k}`].push(actual - shrunk);
      }
    } else {
      skipped += 1;
    }

    // State updates happen AFTER the prediction is scored — never before.
    leagueSum += actual;
    leagueCount += 1;
    if (refKey) {
      const prior = priorByReferee.get(refKey) || { sum: 0, count: 0 };
      prior.sum += actual;
      prior.count += 1;
      priorByReferee.set(refKey, prior);
    }
  }

  const scored = {};
  for (const [name, errs] of Object.entries(errors)) scored[name] = errorMetrics(errs);
  return {
    evaluated: errors.league.length,
    skippedWarmup: skipped,
    withRefereePrior: refereeAvailable,
    metrics: scored
  };
}

/** MAE / RMSE / bias over a list of (actual - predicted) errors. */
export function errorMetrics(errors) {
  const errs = (Array.isArray(errors) ? errors : [])
    .filter((e) => Number.isFinite(Number(e)))
    .map(Number);
  if (!errs.length) return { n: 0, mae: null, rmse: null, bias: null };
  const mae = errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length;
  const rmse = Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length);
  const bias = errs.reduce((a, e) => a + e, 0) / errs.length;
  return { n: errs.length, mae: round3(mae), rmse: round3(rmse), bias: round3(bias) };
}

/**
 * Compare the two card units over the same observations, so the difference between them
 * is quantified instead of assumed.
 */
export function compareUnits(observations) {
  const valid = validObservations(observations).filter((o) => num(o?.cardsPoints) != null);
  const totals = valid.map((o) => Number(o.cardsTotal));
  const points = valid.map((o) => Number(o.cardsPoints));
  const withRed = valid.filter((o) => Number(o.cardsPoints) > Number(o.cardsTotal)).length;
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    n: valid.length,
    cardsTotal: describe(totals),
    cardsPoints: describe(points),
    meanDifference: valid.length ? round3(mean(points) - mean(totals)) : null,
    fixturesWithRedCard: withRed,
    redCardRate: valid.length ? round3(withRed / valid.length) : null
  };
}

export default {
  describe,
  sortObservations,
  validObservations,
  computeLeagueBaseline,
  refereeDelta,
  SAMPLE_BUCKETS,
  bucketForSample,
  bucketBySampleSize,
  shrinkTowardBaseline,
  splitHalves,
  stabilityForReferee,
  walkForwardEvaluate,
  errorMetrics,
  compareUnits
};
