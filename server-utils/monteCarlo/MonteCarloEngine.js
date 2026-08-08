/**
 * Exact match-distribution statistics from the bivariate Poisson + Dixon–Coles
 * score PMF (same model as computeMatchProbs).
 *
 * Previously this sampled scores from the PMF via a deterministically-seeded
 * PRNG ("Monte Carlo simulation") and reported sampling-noise confidence
 * intervals around numbers the PMF already knows exactly. Since the PMF is
 * fully known in closed form, every statistic below (market probabilities,
 * goal-count means/percentiles/histograms, most-likely scores) is computed
 * directly from it — exact, deterministic, and cheaper than resampling.
 *
 * What's still legitimately an "interval" here: `range.{homeGoals,awayGoals,
 * totalGoals}` is a genuine percentile range of the goals distribution itself
 * (football scorelines really do vary) — kept, just computed exactly instead
 * of sampled. What's dropped: any interval around the market probabilities
 * themselves (P(1), BTTS, etc.) — those are point values known exactly from
 * the PMF, so there is nothing left to report an interval around.
 */

import { buildMatchScorePmf } from "../math.js";

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

/** All market probabilities (%) in one pass over the PMF cells — exact. */
export function computeExactMarketProbabilities(pmf) {
  let p1 = 0;
  let pX = 0;
  let p2 = 0;
  let btts = 0;
  let over05 = 0;
  let over15 = 0;
  let over25 = 0;
  let under35 = 0;
  const cells = pmf?.cells || [];
  for (const c of cells) {
    const pr = c.prob || 0;
    if (c.home > c.away) p1 += pr;
    else if (c.home === c.away) pX += pr;
    else p2 += pr;
    if (c.home > 0 && c.away > 0) btts += pr;
    const t = c.home + c.away;
    if (t > 0.5) over05 += pr;
    if (t > 1.5) over15 += pr;
    if (t > 2.5) over25 += pr;
    if (t <= 3.5) under35 += pr;
  }
  const s = p1 + pX + p2;
  if (s > 0) {
    p1 /= s;
    pX /= s;
    p2 /= s;
  }
  return {
    p1: round2(p1 * 100),
    pX: round2(pX * 100),
    p2: round2(p2 * 100),
    pGG: round2(btts * 100),
    pNGG: round2((1 - btts) * 100),
    pO05: round2(over05 * 100),
    pO15: round2(over15 * 100),
    pO25: round2(over25 * 100),
    pU25: round2((1 - over25) * 100),
    pU35: round2(under35 * 100)
  };
}

/** Marginalize cells by a key function into a sorted [{value, prob}] distribution. */
function marginalize(cells, keyFn) {
  const map = new Map();
  for (const c of cells) {
    const k = keyFn(c);
    map.set(k, (map.get(k) || 0) + (c.prob || 0));
  }
  return [...map.entries()].map(([value, prob]) => ({ value: Number(value), prob })).sort((a, b) => a.value - b.value);
}

function marginalMean(marginal) {
  let s = 0;
  for (const { value, prob } of marginal) s += value * prob;
  return s;
}

/** Value at cumulative probability `p` in a sorted (ascending) marginal distribution. */
function marginalPercentile(marginal, p) {
  if (!marginal.length) return 0;
  let cum = 0;
  for (const { value, prob } of marginal) {
    cum += prob;
    if (cum >= p) return value;
  }
  return marginal[marginal.length - 1].value;
}

function marginalHistogram(marginal) {
  const maxV = marginal.length ? marginal[marginal.length - 1].value : 0;
  const byValue = new Map(marginal.map((m) => [m.value, m.prob]));
  const out = [];
  for (let v = 0; v <= maxV; v++) {
    const prob = byValue.get(v) || 0;
    out.push({ goals: v, pct: round2(prob * 100) });
  }
  return out;
}

function goalSideStats(marginal, ciLevel) {
  const alpha = 1 - ciLevel;
  return {
    mean: round3(marginalMean(marginal)),
    median: round2(marginalPercentile(marginal, 0.5)),
    p05: round2(marginalPercentile(marginal, 0.05)),
    p95: round2(marginalPercentile(marginal, 0.95)),
    histogram: marginalHistogram(marginal),
    _range: {
      low: round2(marginalPercentile(marginal, alpha / 2)),
      high: round2(marginalPercentile(marginal, 1 - alpha / 2))
    }
  };
}

/**
 * Exact match-distribution summary for a fixture's score PMF.
 *
 * @param {number} lambdaHome
 * @param {number} lambdaAway
 * @param {{ pmf?: object, correlation?: number, rho?: number, topScores?: number, ciLevel?: number }} [options]
 */
export function computeExactMatchDistribution(lambdaHome, lambdaAway, options = {}) {
  const topScores = Math.max(5, Math.min(25, Number(options.topScores) || 10));
  const ciLevel = Number(options.ciLevel) === 0.9 ? 0.9 : 0.95;

  const pmf =
    options.pmf && Array.isArray(options.pmf.cells)
      ? options.pmf
      : buildMatchScorePmf(lambdaHome, lambdaAway, {
          correlation: options.correlation,
          rho: options.rho
        });

  const probabilityDistribution = computeExactMarketProbabilities(pmf);

  const homeMarginal = marginalize(pmf.cells, (c) => c.home);
  const awayMarginal = marginalize(pmf.cells, (c) => c.away);
  const totalMarginal = marginalize(pmf.cells, (c) => c.home + c.away);

  const homeStats = goalSideStats(homeMarginal, ciLevel);
  const awayStats = goalSideStats(awayMarginal, ciLevel);
  const totalStats = goalSideStats(totalMarginal, ciLevel);

  const expectedGoalsDistribution = {
    home: { mean: homeStats.mean, median: homeStats.median, p05: homeStats.p05, p95: homeStats.p95, histogram: homeStats.histogram },
    away: { mean: awayStats.mean, median: awayStats.median, p05: awayStats.p05, p95: awayStats.p95, histogram: awayStats.histogram },
    total: { mean: totalStats.mean, median: totalStats.median, p05: totalStats.p05, p95: totalStats.p95, histogram: totalStats.histogram }
  };

  const scoreDistribution = pmf.cells
    .map((c) => ({ score: `${c.home}-${c.away}`, pct: round2((c.prob || 0) * 100) }))
    .sort((a, b) => b.pct - a.pct || a.score.localeCompare(b.score));

  const mostLikelyScores = scoreDistribution.slice(0, topScores);
  const goalDistribution = expectedGoalsDistribution.total.histogram;

  const range = {
    level: ciLevel,
    homeGoals: homeStats._range,
    awayGoals: awayStats._range,
    totalGoals: totalStats._range
  };

  const histogram = {
    totalGoals: goalDistribution,
    homeGoals: expectedGoalsDistribution.home.histogram,
    awayGoals: expectedGoalsDistribution.away.histogram,
    scores: mostLikelyScores.map((s) => ({ label: s.score, pct: s.pct }))
  };

  return {
    version: "exact-v1",
    lambdas: {
      home: round3(pmf.lambdaHome),
      away: round3(pmf.lambdaAway)
    },
    model: {
      method: "bivariate-poisson-dc-exact",
      correlation: pmf.correlation,
      rho: pmf.rho,
      gridMax: pmf.gridMax
    },
    probabilityDistribution,
    expectedGoalsDistribution,
    scoreDistribution: scoreDistribution.slice(0, 40),
    mostLikelyScores,
    goalDistribution,
    range,
    histogram,
    summary: {
      mostLikelyScore: mostLikelyScores[0]?.score || null,
      mostLikelyScorePct: mostLikelyScores[0]?.pct || 0,
      expectedGoalsHome: expectedGoalsDistribution.home.mean,
      expectedGoalsAway: expectedGoalsDistribution.away.mean,
      expectedGoalsTotal: expectedGoalsDistribution.total.mean,
      totalGoalsRange: range.totalGoals
    }
  };
}

export default computeExactMatchDistribution;
