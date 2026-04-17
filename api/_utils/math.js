// api/_utils/math.js

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
      Math.pow(lambda1, i - k) / factorial(i - k) *
      Math.pow(lambda2, j - k) / factorial(j - k) *
      Math.pow(shared, k) / factorial(k);
    sum += term;
  }

  return Math.exp(-(lambda1 + lambda2 + shared)) * sum;
}

function samplePoisson(lambda) {
  const L = Math.exp(-Math.max(0, lambda));
  let p = 1;
  let k = 0;
  do {
    k += 1;
    p *= Math.random();
  } while (p > L && k < 20);
  return Math.max(0, k - 1);
}

function monteCarloProbs(lambdaHome, lambdaAway, lambdaShared = 0.12, samples = 2200) {
  let p1 = 0, pX = 0, p2 = 0;
  let pGG = 0, pO25 = 0, pU35 = 0, pO15 = 0;

  const shared = clamp(lambdaShared, 0, Math.min(lambdaHome, lambdaAway, 1.25));
  const lambda1 = Math.max(0.05, lambdaHome - shared);
  const lambda2 = Math.max(0.05, lambdaAway - shared);

  for (let s = 0; s < samples; s++) {
    const w = samplePoisson(shared);
    const h = samplePoisson(lambda1) + w;
    const a = samplePoisson(lambda2) + w;
    const t = h + a;

    if (h > a) p1 += 1;
    else if (h === a) pX += 1;
    else p2 += 1;

    if (h > 0 && a > 0) pGG += 1;
    if (t > 2.5) pO25 += 1;
    if (t <= 3.5) pU35 += 1;
    if (t > 1.5) pO15 += 1;
  }

  return {
    p1: (p1 / samples) * 100,
    pX: (pX / samples) * 100,
    p2: (p2 / samples) * 100,
    pGG: (pGG / samples) * 100,
    pO25: (pO25 / samples) * 100,
    pU35: (pU35 / samples) * 100,
    pO15: (pO15 / samples) * 100
  };
}

export function computeMatchProbs(lambdaHome, lambdaAway, seed = 0, options = {}) {
  const correlation = clamp(Number(options?.correlation ?? 0.12), 0, 0.45);
  const samples = Math.max(800, Math.min(Number(options?.samples ?? 2200), 7000));
  let p1 = 0, pX = 0, p2 = 0;
  let pO25 = 0, pU25 = 0;
  let pGG = 0, pNGG = 0;
  let pU35 = 0, pO35 = 0;
  let pO15 = 0;

  // Stocăm separat cel mai probabil scor pentru fiecare deznodământ
  let maxProb1 = -1, bestScore1 = "1-0";
  let maxProbX = -1, bestScoreX = "0-0";
  let maxProb2 = -1, bestScore2 = "0-1";

  // Analitic: Bivariate Poisson pe grilă 0-7 (mai robust pe tails)
  for (let i = 0; i <= 7; i++) {
    for (let j = 0; j <= 7; j++) {
      const prob = bivariatePoissonP(i, j, lambdaHome, lambdaAway, correlation);
      
      // 1X2 & Separare scor corect logic
      if (i > j) {
        p1 += prob;
        if (prob > maxProb1) { maxProb1 = prob; bestScore1 = `${i}-${j}`; }
      } else if (i === j) {
        pX += prob;
        if (prob > maxProbX) { maxProbX = prob; bestScoreX = `${i}-${j}`; }
      } else {
        p2 += prob;
        if (prob > maxProb2) { maxProb2 = prob; bestScore2 = `${i}-${j}`; }
      }

      // Sub/Peste 2.5
      if (i + j > 2.5) pO25 += prob;
      else pU25 += prob;

      // Sub/Peste 3.5
      if (i + j > 3.5) pO35 += prob;
      else pU35 += prob;

      // Peste 1.5
      if (i + j > 1.5) pO15 += prob;

      // Ambele marchează (GG)
      if (i > 0 && j > 0) pGG += prob;
      else pNGG += prob;
    }
  }

  // FILTRU LOGIC: Alegem scorul care corespunde cu cel mai probabil rezultat 1X2
  let finalBestScore = bestScore1;
  if (pX >= p1 && pX >= p2) finalBestScore = bestScoreX;
  else if (p2 > p1 && p2 > pX) finalBestScore = bestScore2;

  // Monte Carlo blend pentru piețe non-standard și stabilitate
  const mc = monteCarloProbs(lambdaHome, lambdaAway, correlation, samples);
  const blend = (analyticalPct, mcPct) => (analyticalPct * 0.65) + (mcPct * 0.35);

  const p1Pct = blend(p1 * 100, mc.p1);
  const pXPct = blend(pX * 100, mc.pX);
  const p2Pct = blend(p2 * 100, mc.p2);
  const pGGPct = blend(pGG * 100, mc.pGG);
  const pO25Pct = blend(pO25 * 100, mc.pO25);
  const pU35Pct = blend(pU35 * 100, mc.pU35);
  const pO15Pct = blend(pO15 * 100, mc.pO15);

  return {
    probs: {
      p1: clamp(p1Pct, 0, 100),
      pX: clamp(pXPct, 0, 100),
      p2: clamp(p2Pct, 0, 100),
      pGG: clamp(pGGPct, 0, 100),
      pO25: clamp(pO25Pct, 0, 100),
      pU35: clamp(pU35Pct, 0, 100),
      pO15: clamp(pO15Pct, 0, 100)
    },
    bestScore: finalBestScore,
    pU35: clamp(pU35Pct, 0, 100),
    modelMeta: {
      method: "bivariate-poisson+monte-carlo",
      correlation,
      samples
    }
  };
}

export function syntheticLambdas(teamHomeId, teamAwayId) {
  const h = (teamHomeId * 137 + teamAwayId * 43) % 100;
  const a = (teamAwayId * 137 + teamHomeId * 43) % 100;
  return {
    lambdaHome: clampLambda(0.8 + (h / 100) * 1.5),
    lambdaAway: clampLambda(0.7 + (a / 100) * 1.3)
  };
}

export function lambdasFromTeamStats(homeStats, awayStats) {
  const lambdaHome = clampLambda(((homeStats.gf + awayStats.ga) / 2) * 1.06);
  const lambdaAway = clampLambda(((awayStats.gf + homeStats.ga) / 2) * 0.94);
  return { lambdaHome, lambdaAway };
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
  for (let char of recent) {
    if (char === 'W') pts += 3;
    else if (char === 'D') pts += 1;
  }
  
  const maxPts = recent.length * 3;
  const formRatio = pts / maxPts; 
  return 0.8 + (formRatio * 0.4); 
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

export function advancedLambdas(homeStats, awayStats, homeFormMulti, awayFormMulti) {
  let rawLambdaHome = (homeStats.gfHome + awayStats.gaAway) / 2;
  let rawLambdaAway = (awayStats.gfAway + homeStats.gaHome) / 2;
  
  let lambdaHome = clampLambda(rawLambdaHome * homeFormMulti * 1.05);
  let lambdaAway = clampLambda(rawLambdaAway * awayFormMulti * 0.95);
  
  return { lambdaHome, lambdaAway };
}