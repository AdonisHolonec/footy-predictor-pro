/**
 * Monte Carlo match simulation.
 * Samples from the bivariate Poisson + Dixon–Coles score PMF (same model as computeMatchProbs).
 *
 * Default: 10_000 simulations per match.
 */

import { buildMatchScorePmf, clamp } from "../math.js";

export const DEFAULT_MONTE_CARLO_SIMS = 10_000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromFixture(fixtureId, lambdaHome, lambdaAway) {
  const id = Number(fixtureId);
  const base = Number.isFinite(id) ? id : 0;
  const lh = Math.round((Number(lambdaHome) || 0) * 1000);
  const la = Math.round((Number(lambdaAway) || 0) * 1000);
  return (base * 10007 + lh * 97 + la * 13 + 0x9e3779b9) >>> 0;
}

function resolveSimCount(n) {
  const env = typeof process !== "undefined" ? Number(process.env?.MONTE_CARLO_SIMS) : NaN;
  const raw = Number.isFinite(n) ? n : Number.isFinite(env) ? env : DEFAULT_MONTE_CARLO_SIMS;
  return Math.max(1000, Math.min(50_000, Math.floor(raw)));
}

function percentileSorted(sorted, p) {
  if (!sorted.length) return 0;
  const idx = clamp((sorted.length - 1) * p, 0, sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function sampleScore(pmf, u) {
  const cdf = pmf.cdf;
  // Binary search first cdf[i] >= u
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < u) lo = mid + 1;
    else hi = mid;
  }
  return pmf.cells[lo];
}

function buildGoalHistogram(counts, maxGoal) {
  const out = [];
  for (let g = 0; g <= maxGoal; g++) {
    const count = counts[g] || 0;
    out.push({
      goals: g,
      count,
      pct: round2((count / Math.max(1, counts._n || 1)) * 100)
    });
  }
  return out;
}

function wilsonInterval(successes, n, z = 1.96) {
  if (n <= 0) return { low: 0, high: 0 };
  const phat = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  return {
    low: round2(Math.max(0, ((centre - margin) / denom) * 100)),
    high: round2(Math.min(100, ((centre + margin) / denom) * 100))
  };
}

/**
 * Run Monte Carlo simulations for a match.
 *
 * @param {number} lambdaHome
 * @param {number} lambdaAway
 * @param {{ simulations?: number, seed?: number, fixtureId?: number, correlation?: number, rho?: number, topScores?: number, ciLevel?: number }} [options]
 */
export function runMonteCarloSimulation(lambdaHome, lambdaAway, options = {}) {
  const simulations = resolveSimCount(options.simulations);
  const topScores = Math.max(5, Math.min(25, Number(options.topScores) || 10));
  const ciLevel = Number(options.ciLevel) === 0.9 ? 0.9 : 0.95;
  const z = ciLevel === 0.9 ? 1.645 : 1.96;
  const alpha = 1 - ciLevel;
  const seed =
    options.seed != null
      ? Number(options.seed) >>> 0
      : seedFromFixture(options.fixtureId, lambdaHome, lambdaAway);

  const pmf = buildMatchScorePmf(lambdaHome, lambdaAway, {
    correlation: options.correlation,
    rho: options.rho
  });
  const rand = mulberry32(seed);

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let btts = 0;
  let over05 = 0;
  let over15 = 0;
  let over25 = 0;
  let under35 = 0;

  const homeGoals = new Array(simulations);
  const awayGoals = new Array(simulations);
  const totalGoals = new Array(simulations);
  const homeHist = Object.create(null);
  const awayHist = Object.create(null);
  const totalHist = Object.create(null);
  const scoreCounts = Object.create(null);
  let maxHome = 0;
  let maxAway = 0;
  let maxTotal = 0;

  for (let s = 0; s < simulations; s++) {
    const cell = sampleScore(pmf, rand());
    const h = cell.home;
    const a = cell.away;
    const t = h + a;
    homeGoals[s] = h;
    awayGoals[s] = a;
    totalGoals[s] = t;

    homeHist[h] = (homeHist[h] || 0) + 1;
    awayHist[a] = (awayHist[a] || 0) + 1;
    totalHist[t] = (totalHist[t] || 0) + 1;
    const key = `${h}-${a}`;
    scoreCounts[key] = (scoreCounts[key] || 0) + 1;

    if (h > a) wins += 1;
    else if (h === a) draws += 1;
    else losses += 1;
    if (h > 0 && a > 0) btts += 1;
    if (t > 0.5) over05 += 1;
    if (t > 1.5) over15 += 1;
    if (t > 2.5) over25 += 1;
    if (t <= 3.5) under35 += 1;

    if (h > maxHome) maxHome = h;
    if (a > maxAway) maxAway = a;
    if (t > maxTotal) maxTotal = t;
  }

  homeHist._n = simulations;
  awayHist._n = simulations;
  totalHist._n = simulations;

  const homeSorted = homeGoals.slice().sort((a, b) => a - b);
  const awaySorted = awayGoals.slice().sort((a, b) => a - b);
  const totalSorted = totalGoals.slice().sort((a, b) => a - b);

  const probabilityDistribution = {
    p1: round2((wins / simulations) * 100),
    pX: round2((draws / simulations) * 100),
    p2: round2((losses / simulations) * 100),
    pGG: round2((btts / simulations) * 100),
    pNGG: round2(((simulations - btts) / simulations) * 100),
    pO05: round2((over05 / simulations) * 100),
    pO15: round2((over15 / simulations) * 100),
    pO25: round2((over25 / simulations) * 100),
    pU25: round2(((simulations - over25) / simulations) * 100),
    pU35: round2((under35 / simulations) * 100)
  };

  const expectedGoalsDistribution = {
    home: {
      mean: round3(mean(homeGoals)),
      median: round2(percentileSorted(homeSorted, 0.5)),
      p05: round2(percentileSorted(homeSorted, 0.05)),
      p95: round2(percentileSorted(homeSorted, 0.95)),
      histogram: buildGoalHistogram(homeHist, maxHome)
    },
    away: {
      mean: round3(mean(awayGoals)),
      median: round2(percentileSorted(awaySorted, 0.5)),
      p05: round2(percentileSorted(awaySorted, 0.05)),
      p95: round2(percentileSorted(awaySorted, 0.95)),
      histogram: buildGoalHistogram(awayHist, maxAway)
    },
    total: {
      mean: round3(mean(totalGoals)),
      median: round2(percentileSorted(totalSorted, 0.5)),
      p05: round2(percentileSorted(totalSorted, 0.05)),
      p95: round2(percentileSorted(totalSorted, 0.95)),
      histogram: buildGoalHistogram(totalHist, maxTotal)
    }
  };

  const scoreDistribution = Object.entries(scoreCounts)
    .map(([score, count]) => ({
      score,
      count,
      pct: round2((count / simulations) * 100)
    }))
    .sort((a, b) => b.count - a.count || a.score.localeCompare(b.score));

  const mostLikelyScores = scoreDistribution.slice(0, topScores);

  const goalDistribution = expectedGoalsDistribution.total.histogram;

  const confidenceInterval = {
    level: ciLevel,
    method: "percentile_goals_wilson_markets",
    homeGoals: {
      low: round2(percentileSorted(homeSorted, alpha / 2)),
      high: round2(percentileSorted(homeSorted, 1 - alpha / 2))
    },
    awayGoals: {
      low: round2(percentileSorted(awaySorted, alpha / 2)),
      high: round2(percentileSorted(awaySorted, 1 - alpha / 2))
    },
    totalGoals: {
      low: round2(percentileSorted(totalSorted, alpha / 2)),
      high: round2(percentileSorted(totalSorted, 1 - alpha / 2))
    },
    markets: {
      p1: wilsonInterval(wins, simulations, z),
      pX: wilsonInterval(draws, simulations, z),
      p2: wilsonInterval(losses, simulations, z),
      pGG: wilsonInterval(btts, simulations, z),
      pO25: wilsonInterval(over25, simulations, z)
    }
  };

  // Compact histogram payloads for UI charts
  const histogram = {
    totalGoals: goalDistribution,
    homeGoals: expectedGoalsDistribution.home.histogram,
    awayGoals: expectedGoalsDistribution.away.histogram,
    scores: mostLikelyScores.map((s) => ({
      label: s.score,
      count: s.count,
      pct: s.pct
    }))
  };

  return {
    version: "mc-v1",
    simulations,
    seed,
    lambdas: {
      home: round3(pmf.lambdaHome),
      away: round3(pmf.lambdaAway)
    },
    model: {
      method: "bivariate-poisson-dc-monte-carlo",
      correlation: pmf.correlation,
      rho: pmf.rho,
      gridMax: pmf.gridMax
    },
    probabilityDistribution,
    expectedGoalsDistribution,
    scoreDistribution: scoreDistribution.slice(0, 40),
    mostLikelyScores,
    goalDistribution,
    confidenceInterval,
    histogram,
    summary: {
      mostLikelyScore: mostLikelyScores[0]?.score || null,
      mostLikelyScorePct: mostLikelyScores[0]?.pct || 0,
      expectedGoalsHome: expectedGoalsDistribution.home.mean,
      expectedGoalsAway: expectedGoalsDistribution.away.mean,
      expectedGoalsTotal: expectedGoalsDistribution.total.mean,
      ci95TotalGoals: confidenceInterval.totalGoals
    }
  };
}

export default runMonteCarloSimulation;
