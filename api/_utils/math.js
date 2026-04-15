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

export function computeMatchProbs(lambdaHome, lambdaAway, seed = 0) {
  let p1 = 0, pX = 0, p2 = 0;
  let pO25 = 0, pU25 = 0;
  let pGG = 0, pNGG = 0;
  let pU35 = 0, pO35 = 0;
  let pO15 = 0;

  // Stocăm separat cel mai probabil scor pentru fiecare deznodământ
  let maxProb1 = -1, bestScore1 = "1-0";
  let maxProbX = -1, bestScoreX = "0-0";
  let maxProb2 = -1, bestScore2 = "0-1";

  // Calculăm pe o grilă de scoruri de la 0-0 la 6-6
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 6; j++) {
      const prob = poissonP(i, lambdaHome) * poissonP(j, lambdaAway);
      
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

  return {
    probs: {
      p1: clamp(p1 * 100, 0, 100),
      pX: clamp(pX * 100, 0, 100),
      p2: clamp(p2 * 100, 0, 100),
      pGG: clamp(pGG * 100, 0, 100),
      pO25: clamp(pO25 * 100, 0, 100),
      pU35: clamp(pU35 * 100, 0, 100),
      pO15: clamp(pO15 * 100, 0, 100)
    },
    bestScore: finalBestScore,
    pU35: clamp(pU35 * 100, 0, 100)
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