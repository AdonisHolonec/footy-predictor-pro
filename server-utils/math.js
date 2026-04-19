export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
export function clampLambda(x) {
  return clamp(x, 0.2, 3.5);
}
export function factorial(n) {
  if (n === 0 || n === 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
export function poissonP(k, lambda) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function bivariatePoissonP(i, j, lambdaHome, lambdaAway, lambdaShared = 0.12) {
  const shared = clamp(lambdaShared, 0, Math.min(lambdaHome, lambdaAway, 1.25));
  const lambda1 = Math.max(0.05, lambdaHome - shared);
  const lambda2 = Math.max(0.05, lambdaAway - shared);
  let sum = 0;
  const m = Math.min(i, j);
  for (let k = 0; k <= m; k++) {
    const term =
      (Math.pow(lambda1, i - k) / factorial(i - k)) *
      (Math.pow(lambda2, j - k) / factorial(j - k)) *
      (Math.pow(shared, k) / factorial(k));
    sum += term;
  }
  return Math.exp(-(lambda1 + lambda2 + shared)) * sum;
}

/**
 * Adaptive grid + tail mass redistribution so p1+pX+p2 ≈ 100% (deterministic, no Monte Carlo).
 */
export function computeMatchProbs(lambdaHome, lambdaAway, _fixtureId = 0, options = {}) {
  const correlation = clamp(Number(options?.correlation ?? 0.12), 0, 0.45);
  const tailTarget = Math.max(1e-6, Number(options?.tailTarget ?? 1e-4));

  let maxN = Math.min(
    25,
    Math.max(
      7,
      Math.ceil(Math.max(lambdaHome, lambdaAway, 0.5) + 5 * Math.sqrt(Math.max(lambdaHome, lambdaAway, 0.3)))
    )
  );

  function accumulate(gridN) {
    let p1 = 0;
    let pX = 0;
    let p2 = 0;
    let pO25 = 0;
    let pGG = 0;
    let pU35 = 0;
    let pO15 = 0;
    let mass = 0;
    let maxProb1 = -1;
    let maxProbX = -1;
    let maxProb2 = -1;
    let bestScore1 = "1-0";
    let bestScoreX = "0-0";
    let bestScore2 = "0-1";
    for (let i = 0; i <= gridN; i++) {
      for (let j = 0; j <= gridN; j++) {
        const prob = bivariatePoissonP(i, j, lambdaHome, lambdaAway, correlation);
        mass += prob;
        if (i > j) {
          p1 += prob;
          if (prob > maxProb1) {
            maxProb1 = prob;
            bestScore1 = `${i}-${j}`;
          }
        } else if (i === j) {
          pX += prob;
          if (prob > maxProbX) {
            maxProbX = prob;
            bestScoreX = `${i}-${j}`;
          }
        } else {
          p2 += prob;
          if (prob > maxProb2) {
            maxProb2 = prob;
            bestScore2 = `${i}-${j}`;
          }
        }
        if (i + j > 2.5) pO25 += prob;
        if (i + j <= 3.5) pU35 += prob;
        if (i + j > 1.5) pO15 += prob;
        if (i > 0 && j > 0) pGG += prob;
      }
    }
    return {
      p1,
      pX,
      p2,
      pO25,
      pGG,
      pU35,
      pO15,
      mass,
      bestScore1,
      bestScoreX,
      bestScore2,
      maxProb1,
      maxProbX,
      maxProb2
    };
  }

  let acc = accumulate(maxN);
  let guard = 0;
  while (acc.mass < 1 - tailTarget && maxN < 25 && guard < 6) {
    maxN += 2;
    acc = accumulate(maxN);
    guard += 1;
  }

  const lost = Math.max(0, 1 - acc.mass);
  const s12 = acc.p1 + acc.pX + acc.p2;
  if (lost > 1e-12 && s12 > 1e-15) {
    acc.p1 += lost * (acc.p1 / s12);
    acc.pX += lost * (acc.pX / s12);
    acc.p2 += lost * (acc.p2 / s12);
  } else if (lost > 1e-12) {
    const t = lost / 3;
    acc.p1 += t;
    acc.pX += t;
    acc.p2 += t;
  }

  const norm = acc.p1 + acc.pX + acc.p2;
  const p1Pct = norm > 0 ? (acc.p1 / norm) * 100 : 0;
  const pXPct = norm > 0 ? (acc.pX / norm) * 100 : 0;
  const p2Pct = norm > 0 ? (acc.p2 / norm) * 100 : 0;

  let finalBestScore = acc.bestScore1;
  if (acc.pX >= acc.p1 && acc.pX >= acc.p2) finalBestScore = acc.bestScoreX;
  else if (acc.p2 > acc.p1 && acc.p2 > acc.pX) finalBestScore = acc.bestScore2;

  return {
    probs: {
      p1: clamp(p1Pct, 0, 100),
      pX: clamp(pXPct, 0, 100),
      p2: clamp(p2Pct, 0, 100),
      pGG: clamp(acc.pGG * 100, 0, 100),
      pO25: clamp(acc.pO25 * 100, 0, 100),
      pU35: clamp(acc.pU35 * 100, 0, 100),
      pO15: clamp(acc.pO15 * 100, 0, 100)
    },
    bestScore: finalBestScore,
    pU35: clamp(acc.pU35 * 100, 0, 100),
    modelMeta: {
      method: "bivariate-poisson-analytic",
      correlation,
      gridMax: maxN,
      massCaptured: acc.mass
    }
  };
}

/** Deterministic pseudo-lambdas for tests only — not for production picks. */
export function syntheticLambdas(teamHomeId, teamAwayId) {
  const h = (teamHomeId * 137 + teamAwayId * 43) % 100;
  const a = (teamAwayId * 137 + teamHomeId * 43) % 100;
  return { lambdaHome: clampLambda(0.8 + (h / 100) * 1.5), lambdaAway: clampLambda(0.7 + (a / 100) * 1.3) };
}

export function lambdasFromTeamStats(homeStats, awayStats) {
  const lambdaHome = clampLambda(((homeStats.gf + awayStats.ga) / 2) * 1.06);
  const lambdaAway = clampLambda(((awayStats.gf + homeStats.ga) / 2) * 0.94);
  return { lambdaHome, lambdaAway };
}

/**
 * Attack/defense style strengths with home advantage; time decay on form multipliers.
 * Uses venue-split goals from team statistics (not a second copy of the same scalar “xG”).
 */
export function strengthRatingsLambdas(hStats, aStats, hFormMulti, aFormMulti, options = {}) {
  const leagueAvg = Number(options.leagueAvgGoals) || 1.35;
  const homeAdv = Number(options.homeAdv) || 1.06;
  const awayAdv = Number(options.awayAdv) || 0.96;
  const timeDecay = typeof options.timeDecay === "number" ? clamp(options.timeDecay, 0.85, 1.05) : 1;

  const eps = 0.28;
  const atkH = Math.max(eps, Number(hStats.gfHome) || eps);
  const defH = Math.max(eps, Number(hStats.gaHome) || eps);
  const atkA = Math.max(eps, Number(aStats.gfAway) || eps);
  const defA = Math.max(eps, Number(aStats.gaAway) || eps);

  const hf = Math.max(0.75, Math.min(1.2, Number(hFormMulti) || 1)) * timeDecay;
  const af = Math.max(0.75, Math.min(1.2, Number(aFormMulti) || 1)) * timeDecay;

  const lambdaHome = clampLambda(
    leagueAvg * (atkH / leagueAvg) * (defA / leagueAvg) * homeAdv * hf
  );
  const lambdaAway = clampLambda(
    leagueAvg * (atkA / leagueAvg) * (defH / leagueAvg) * awayAdv * af
  );

  return {
    lambdaHome,
    lambdaAway,
    strengthMeta: {
      leagueAvg,
      homeAdv,
      awayAdv,
      atkH,
      defH,
      atkA,
      defA,
      timeDecay
    }
  };
}

export function extractGoalsAverages(teamStatsPayload) {
  try {
    const goals = teamStatsPayload?.response?.goals;
    if (!goals) return null;
    const gf = Number(goals.for?.average?.total) || 0;
    const ga = Number(goals.against?.average?.total) || 0;
    if (gf === 0 && ga === 0) return null;
    return { gf, ga };
  } catch {
    return null;
  }
}

export function extractFormMultiplier(formString) {
  if (!formString) return 1.0;
  const recent = formString.slice(-5).toUpperCase();
  if (recent.length === 0) return 1.0;
  let pts = 0;
  for (const char of recent) {
    if (char === "W") pts += 3;
    else if (char === "D") pts += 1;
  }
  const maxPts = recent.length * 3;
  return 0.8 + (pts / maxPts) * 0.4;
}

export function extractAdvancedGoalsAverages(teamStatsPayload) {
  try {
    const goals = teamStatsPayload?.response?.goals;
    if (!goals) return null;
    const gfTotal = Number(goals.for?.average?.total) || 0;
    const gaTotal = Number(goals.against?.average?.total) || 0;
    const gfHome = Number(goals.for?.average?.home) || gfTotal;
    const gaHome = Number(goals.against?.average?.home) || gaTotal;
    const gfAway = Number(goals.for?.average?.away) || gfTotal;
    const gaAway = Number(goals.against?.average?.away) || gaTotal;
    if (gfTotal === 0 && gaTotal === 0) return null;
    return { gfHome, gaHome, gfAway, gaAway };
  } catch {
    return null;
  }
}

/** @deprecated Use strengthRatingsLambdas — kept for backward imports in tests */
export function advancedLambdas(homeStats, awayStats, homeFormMulti, awayFormMulti) {
  const s = strengthRatingsLambdas(homeStats, awayStats, homeFormMulti, awayFormMulti);
  return { lambdaHome: s.lambdaHome, lambdaAway: s.lambdaAway };
}
