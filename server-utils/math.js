export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Clamp final λ. Păstrăm min=0.2 (Poisson numeric stabil) şi extindem max la 4.5
 * (atac mare × apărare slabă × home advantage legitim poate produce ~4.2, nu 3.5).
 */
export function clampLambda(x) {
  return clamp(x, 0.2, 4.5);
}

/** Clamp pentru un singur factor atac/apărare înainte de combinare. */
function clampFactor(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 1;
  return clamp(n, 0.25, 3.2);
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

/**
 * P(X ≤ n) pentru o variabilă Poisson(λ). Calculat stabil recursiv (fără factorial direct pe n mare).
 * `n` trebuie să fie întreg ≥ 0.
 */
export function poissonCDF(n, lambda) {
  const lam = Math.max(0, Number(lambda) || 0);
  if (lam === 0) return 1;
  const nn = Math.max(0, Math.floor(n));
  let term = Math.exp(-lam); // P(X=0)
  let sum = term;
  for (let k = 1; k <= nn; k++) {
    term *= lam / k;
    sum += term;
  }
  return Math.min(1, sum);
}

/**
 * P(X > linia .5) pentru o piaţă Over/Under stil 8.5 / 9.5 / 10.5 cornere.
 * `line` poate fi orice zecimal .5 sau întreg; rezultatul e P(X ≥ ceil(line+ε)).
 * Ex: line=8.5 → P(X ≥ 9) = 1 - P(X ≤ 8).
 */
export function poissonOverLine(line, lambda) {
  const l = Number(line);
  if (!Number.isFinite(l) || l < 0) return 0;
  const threshold = Math.floor(l); // ex 8.5 → 8, Over 8.5 înseamnă ≥9
  return 1 - poissonCDF(threshold, lambda);
}

/**
 * P(H+A > line) under bivariate Poisson (shared λ), for corners/SOT totals with correlation.
 * Falls back to independent Poisson(λh+λa) when correlation ≤ 0.
 */
export function poissonOverLineCorrelated(line, lambdaHome, lambdaAway, correlation = 0.08) {
  const l = Number(line);
  const lh = Math.max(0.01, Number(lambdaHome) || 0);
  const la = Math.max(0.01, Number(lambdaAway) || 0);
  if (!Number.isFinite(l) || l < 0) return 0;
  const corr = clamp(Number(correlation) || 0, 0, 0.4);
  if (corr <= 0) return poissonOverLine(l, lh + la);

  const maxN = Math.min(
    40,
    Math.max(8, Math.ceil(Math.max(lh, la, l) + 6 * Math.sqrt(Math.max(lh, la, 0.3)) + 2))
  );
  let mass = 0;
  let pOver = 0;
  for (let i = 0; i <= maxN; i++) {
    for (let j = 0; j <= maxN; j++) {
      const p = bivariatePoissonP(i, j, lh, la, corr);
      mass += p;
      if (i + j > l) pOver += p;
    }
  }
  return mass > 0 ? pOver / mass : poissonOverLine(l, lh + la);
}

/**
 * Reweight scoreline PMF so 1X2 margins match fused/calibrated targets, keeping
 * relative mass within each outcome bucket. Used to rebuild coherent O/U + BTTS.
 * @param {{ cells?: Array<{home:number,away:number,prob:number}>, cdf?: number[] }} pmf
 * @param {{ p1: number, pX: number, p2: number }} target - fractions (0..1) or percent (0..100)
 */
export function reweightPmfTo1x2(pmf, target = {}) {
  const cells = Array.isArray(pmf?.cells) ? pmf.cells : null;
  if (!cells?.length) return pmf;

  const toFrac = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return n > 1 ? n / 100 : n;
  };
  let t1 = toFrac(target.p1);
  let tX = toFrac(target.pX);
  let t2 = toFrac(target.p2);
  if (t1 == null || tX == null || t2 == null) return pmf;
  const tSum = t1 + tX + t2;
  if (!(tSum > 0)) return pmf;
  t1 /= tSum;
  tX /= tSum;
  t2 /= tSum;

  let m1 = 0;
  let mX = 0;
  let m2 = 0;
  for (const c of cells) {
    const p = Number(c.prob) || 0;
    if (c.home > c.away) m1 += p;
    else if (c.home === c.away) mX += p;
    else m2 += p;
  }
  if (!(m1 > 0) || !(mX > 0) || !(m2 > 0)) return pmf;

  const s1 = t1 / m1;
  const sX = tX / mX;
  const s2 = t2 / m2;
  const next = cells.map((c) => {
    const scale = c.home > c.away ? s1 : c.home === c.away ? sX : s2;
    return { home: c.home, away: c.away, prob: (Number(c.prob) || 0) * scale };
  });
  let mass = 0;
  for (const c of next) mass += c.prob;
  if (!(mass > 0)) return pmf;
  const inv = 1 / mass;
  for (const c of next) c.prob *= inv;

  const cdf = new Array(next.length);
  let run = 0;
  for (let i = 0; i < next.length; i++) {
    run += next[i].prob;
    cdf[i] = run;
  }
  cdf[cdf.length - 1] = 1;

  return {
    ...pmf,
    cells: next,
    cdf,
    mass: 1,
    reweightedTo1x2: true
  };
}

/**
 * Bivariate Poisson (Karlis-Ntzoufras) pentru corelaţia goalurilor prin shared component.
 * Folosit în afara zonei low-score; acolo aplicăm şi corecţia Dixon-Coles τ.
 */
export function bivariatePoissonP(i, j, lambdaHome, lambdaAway, lambdaShared = 0.12) {
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
 * Dixon-Coles τ corection pentru celulele low-score (0-0, 0-1, 1-0, 1-1).
 * Empiric, ρ tipic în [-0.20, -0.05]; negativ înseamnă că Poisson pur subestimează egalurile.
 * Valoarea este clampată pentru a garanta τ ≥ 0 chiar şi pentru λ mari.
 */
export function dcTau(i, j, lambdaHome, lambdaAway, rho) {
  if (!Number.isFinite(rho) || rho === 0) return 1;
  if (i === 0 && j === 0) return Math.max(0, 1 - lambdaHome * lambdaAway * rho);
  if (i === 0 && j === 1) return Math.max(0, 1 + lambdaHome * rho);
  if (i === 1 && j === 0) return Math.max(0, 1 + lambdaAway * rho);
  if (i === 1 && j === 1) return Math.max(0, 1 - rho);
  return 1;
}

/**
 * Discrete joint score PMF used by analytic probs + Monte Carlo sampling.
 * Returns renormalized cells `{ home, away, prob }` sorted for CDF sampling.
 */
export function buildMatchScorePmf(lambdaHome, lambdaAway, options = {}) {
  const correlation = clamp(Number(options?.correlation ?? 0.12), 0, 0.45);
  const rho = clamp(Number(options?.rho ?? -0.11), -0.25, 0.1);
  const tailTarget = Math.max(1e-6, Number(options?.tailTarget ?? 1e-4));
  const lh = clampLambda(Number(lambdaHome) || 1.2);
  const la = clampLambda(Number(lambdaAway) || 1.1);

  let maxN = Math.min(
    25,
    Math.max(7, Math.ceil(Math.max(lh, la, 0.5) + 5 * Math.sqrt(Math.max(lh, la, 0.3))))
  );

  function build(gridN) {
    const cells = [];
    let mass = 0;
    for (let i = 0; i <= gridN; i++) {
      for (let j = 0; j <= gridN; j++) {
        const base = bivariatePoissonP(i, j, lh, la, correlation);
        const tau = dcTau(i, j, lh, la, rho);
        const prob = base * tau;
        if (prob <= 0) continue;
        cells.push({ home: i, away: j, prob });
        mass += prob;
      }
    }
    return { cells, mass };
  }

  let { cells, mass } = build(maxN);
  let guard = 0;
  while (mass < 1 - tailTarget && maxN < 25 && guard < 6) {
    maxN += 2;
    ({ cells, mass } = build(maxN));
    guard += 1;
  }

  if (!(mass > 0)) {
    return {
      cells: [{ home: 1, away: 0, prob: 1 }],
      cdf: [1],
      gridMax: maxN,
      mass: 1,
      correlation,
      rho,
      lambdaHome: lh,
      lambdaAway: la
    };
  }

  const inv = 1 / mass;
  for (const c of cells) c.prob *= inv;
  const cdf = new Array(cells.length);
  let run = 0;
  for (let i = 0; i < cells.length; i++) {
    run += cells[i].prob;
    cdf[i] = run;
  }
  cdf[cdf.length - 1] = 1;

  return {
    cells,
    cdf,
    gridMax: maxN,
    mass: 1,
    correlation,
    rho,
    lambdaHome: lh,
    lambdaAway: la
  };
}

/**
 * Adaptive grid + DC low-score correction + tail redistribution. Deterministic.
 *
 * @param {number} lambdaHome
 * @param {number} lambdaAway
 * @param {number} _fixtureId - neutilizat, păstrat pentru backward compat
 * @param {object} [options]
 * @param {number} [options.correlation=0.12] - shared λ pentru Bivariate Poisson
 * @param {number} [options.rho=-0.11]         - ρ Dixon-Coles (low-score correction)
 * @param {number} [options.tailTarget=1e-4]
 */
export function computeMatchProbs(lambdaHome, lambdaAway, _fixtureId = 0, options = {}) {
  // Single shared score PMF (also reused by Monte Carlo when returned as `.pmf`).
  const pmf =
    options.pmf && Array.isArray(options.pmf.cells) && Array.isArray(options.pmf.cdf)
      ? options.pmf
      : buildMatchScorePmf(lambdaHome, lambdaAway, options);

  const correlation = Number(pmf.correlation);
  const rho = Number(pmf.rho);
  const maxN = Number(pmf.gridMax) || 0;

  let p1 = 0;
  let pX = 0;
  let p2 = 0;
  let pO25 = 0;
  let pGG = 0;
  let pU35 = 0;
  let pO15 = 0;
  let pO05 = 0;
  let maxProb1 = -1;
  let maxProbX = -1;
  let maxProb2 = -1;
  let bestScore1 = "1-0";
  let bestScoreX = "0-0";
  let bestScore2 = "0-1";

  const cells = pmf.cells || [];
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k];
    const i = c.home;
    const j = c.away;
    const prob = c.prob || 0;
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
    if (i + j > 0.5) pO05 += prob;
    if (i > 0 && j > 0) pGG += prob;
  }

  const norm = p1 + pX + p2;
  const p1Pct = norm > 0 ? (p1 / norm) * 100 : 0;
  const pXPct = norm > 0 ? (pX / norm) * 100 : 0;
  const p2Pct = norm > 0 ? (p2 / norm) * 100 : 0;

  let finalBestScore = bestScore1;
  let finalBestScoreProb = maxProb1;
  if (pX >= p1 && pX >= p2) {
    finalBestScore = bestScoreX;
    finalBestScoreProb = maxProbX;
  } else if (p2 > p1 && p2 > pX) {
    finalBestScore = bestScore2;
    finalBestScoreProb = maxProb2;
  }

  return {
    probs: {
      p1: clamp(p1Pct, 0, 100),
      pX: clamp(pXPct, 0, 100),
      p2: clamp(p2Pct, 0, 100),
      pGG: clamp(pGG * 100, 0, 100),
      pO25: clamp(pO25 * 100, 0, 100),
      pU35: clamp(pU35 * 100, 0, 100),
      pO15: clamp(pO15 * 100, 0, 100),
      pO05: clamp(pO05 * 100, 0, 100)
    },
    bestScore: finalBestScore,
    bestScoreProb: clamp((finalBestScoreProb || 0) * 100, 0, 100),
    pU35: clamp(pU35 * 100, 0, 100),
    pmf,
    modelMeta: {
      method: correlation > 0 ? "bivariate-poisson-dc-analytic" : "poisson-dc-analytic",
      correlation,
      rho,
      gridMax: maxN,
      massCaptured: 1,
      sharedPmf: true
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
 * Shrinkage bayesian către media ligii. Rezolvă sezonul timpuriu şi echipele nou-promovate:
 * o echipă cu 2 meciuri jucate nu va mai propaga un atac=3.5/meci drept "real".
 *
 * @param {number} observed - valoarea raportată (medie gf sau ga per meci)
 * @param {number} played   - meciuri jucate în acel split (home/away/total)
 * @param {number} prior    - media ligii pentru acel split
 * @param {number} [k=6]    - pseudo-count (cât de mult credem priorul)
 */
export function applyBayesianShrinkage(observed, played, prior, k = 6) {
  const obs = Number(observed);
  const pri = Number(prior);
  const n = Math.max(0, Number(played) || 0);
  if (!Number.isFinite(obs) || obs <= 0) return Number.isFinite(pri) && pri > 0 ? pri : 0;
  if (!Number.isFinite(pri) || pri <= 0) return obs;
  const kk = Math.max(1, Number(k) || 6);
  return (n * obs + kk * pri) / (n + kk);
}

/**
 * Attack/defense strengths (Dixon-Coles multiplicative) cu shrinkage bayesian,
 * home/away advantage (per ligă), formă cu decay şi plafoane realiste.
 *
 * Backward-compatible: fără options produce acelaşi λ ca înainte (approx.),
 * dar cu clamp per-factor şi plafon λ mai larg.
 *
 * @param {object} hStats - {gfHome, gaHome, gfAway, gaAway, played?}
 * @param {object} aStats - {gfHome, gaHome, gfAway, gaAway, played?}
 * @param {number} hFormMulti
 * @param {number} aFormMulti
 * @param {object} [options]
 * @param {number} [options.leagueAvgGoals=1.35]  - per-side average (~ total/2)
 * @param {number} [options.leagueAvgHome]         - optional per-side split: goluri/meci acasă
 * @param {number} [options.leagueAvgAway]         - optional per-side split: goluri/meci deplasare
 * @param {number} [options.homeAdv=1.06]
 * @param {number} [options.awayAdv=0.96]
 * @param {number} [options.timeDecay=1]
 * @param {number} [options.shrinkageK=6]
 * @param {number} [options.homePlayed]
 * @param {number} [options.awayPlayed]
 */
export function strengthRatingsLambdas(hStats, aStats, hFormMulti, aFormMulti, options = {}) {
  const leagueAvg = Number(options.leagueAvgGoals) || 1.35;
  // A venue split counts only when BOTH sides are present (see combine.js).
  const splitHome = Number(options.leagueAvgHome);
  const splitAway = Number(options.leagueAvgAway);
  const hasVenueSplit = splitHome > 0 && splitAway > 0;
  const leagueAvgHome = hasVenueSplit ? splitHome : leagueAvg;
  const leagueAvgAway = hasVenueSplit ? splitAway : leagueAvg;
  const homeAdv = Number(options.homeAdv) || 1.06;
  const awayAdv = Number(options.awayAdv) || 0.96;
  const timeDecay = typeof options.timeDecay === "number" ? clamp(options.timeDecay, 0.85, 1.05) : 1;
  const shrinkageK = Math.max(1, Number(options.shrinkageK) || 6);

  const homePlayed = Number(options.homePlayed ?? hStats?.played);
  const awayPlayed = Number(options.awayPlayed ?? aStats?.played);
  const shrinkHome = Number.isFinite(homePlayed) && homePlayed > 0;
  const shrinkAway = Number.isFinite(awayPlayed) && awayPlayed > 0;

  const eps = 0.28;
  const rawAtkH = Math.max(eps, Number(hStats.gfHome) || eps);
  const rawDefH = Math.max(eps, Number(hStats.gaHome) || eps);
  const rawAtkA = Math.max(eps, Number(aStats.gfAway) || eps);
  const rawDefA = Math.max(eps, Number(aStats.gaAway) || eps);

  const atkH = clampFactor(
    shrinkHome ? applyBayesianShrinkage(rawAtkH, homePlayed, leagueAvgHome, shrinkageK) : rawAtkH
  );
  const defH = clampFactor(
    shrinkHome ? applyBayesianShrinkage(rawDefH, homePlayed, leagueAvgHome, shrinkageK) : rawDefH
  );
  const atkA = clampFactor(
    shrinkAway ? applyBayesianShrinkage(rawAtkA, awayPlayed, leagueAvgAway, shrinkageK) : rawAtkA
  );
  const defA = clampFactor(
    shrinkAway ? applyBayesianShrinkage(rawDefA, awayPlayed, leagueAvgAway, shrinkageK) : rawDefA
  );

  // Banda pentru formă îngustată: ±10% (vs. ±20% anterior) pentru a nu amplifica zgomotul WDL.
  const hf = clamp(Number(hFormMulti) || 1, 0.9, 1.1) * timeDecay;
  const af = clamp(Number(aFormMulti) || 1, 0.9, 1.1) * timeDecay;

  // Dixon-Coles multiplicativ: λ_home = leagueAvgHome × (atk_home / leagueAvg) × (def_away / leagueAvg) × form.
  // Home advantage enters exactly once: a supplied venue split (leagueAvgHome/Away)
  // already carries it, so homeAdv / awayAdv multiply only when no split is given
  // (same rule as PredictionEngine/combine.js — the two must stay aligned).
  const homeAdvFactor = hasVenueSplit ? 1 : homeAdv;
  const awayAdvFactor = hasVenueSplit ? 1 : awayAdv;
  const lambdaHome = clampLambda(
    leagueAvgHome * (atkH / leagueAvg) * (defA / leagueAvg) * homeAdvFactor * hf
  );
  const lambdaAway = clampLambda(
    leagueAvgAway * (atkA / leagueAvg) * (defH / leagueAvg) * awayAdvFactor * af
  );

  return {
    lambdaHome,
    lambdaAway,
    strengthMeta: {
      leagueAvg,
      leagueAvgHome,
      leagueAvgAway,
      homeAdv,
      awayAdv,
      homeAdvApplied: !hasVenueSplit,
      atkH,
      defH,
      atkA,
      defA,
      timeDecay,
      shrinkageK,
      homePlayed: shrinkHome ? homePlayed : null,
      awayPlayed: shrinkAway ? awayPlayed : null
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

/** API-Football poate returna `response` ca obiect sau ca array cu un singur element. */
export function normalizeTeamStatisticsPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const r = payload.response;
  if (Array.isArray(r) && r.length > 0) {
    return { ...payload, response: r[0] };
  }
  return payload;
}

/**
 * Formă cu decay exponenţial + ponderare după margine şi plafon îngust.
 * W/D/L sunt convertite în puncte (3/1/0), iar rezultatele mai recente primesc greutate mai mare.
 * Multiplicatorul rezultat e în [0.88, 1.12] — suficient pentru semnal, fără amplificarea zgomotului.
 */
export function extractFormMultiplier(formString) {
  if (!formString || typeof formString !== "string") return 1.0;
  const recent = formString.slice(-6).toUpperCase();
  if (recent.length === 0) return 1.0;
  let weightedPts = 0;
  let weightSum = 0;
  // cel mai recent meci = primul din stânga după slice(-N); indexăm invers pentru decay
  for (let i = 0; i < recent.length; i++) {
    const char = recent[recent.length - 1 - i];
    const w = Math.pow(0.85, i); // half-life ≈ 4 meciuri
    let pts;
    if (char === "W") pts = 3;
    else if (char === "D") pts = 1;
    else if (char === "L") pts = 0;
    else continue;
    weightedPts += pts * w;
    weightSum += 3 * w;
  }
  if (weightSum <= 0) return 1.0;
  const ratio = weightedPts / weightSum; // 0..1
  // scale: 0.88 .. 1.12 centrat pe 1.0 pentru ratio=0.5
  return Number((0.88 + ratio * 0.24).toFixed(4));
}

export function extractAdvancedGoalsAverages(teamStatsPayload) {
  try {
    const payload = normalizeTeamStatisticsPayload(teamStatsPayload);
    const r = payload?.response;
    const goals = r?.goals;
    if (!goals) return null;
    const gfTotal = Number(goals.for?.average?.total) || 0;
    const gaTotal = Number(goals.against?.average?.total) || 0;
    const gfHome = Number(goals.for?.average?.home) || gfTotal;
    const gaHome = Number(goals.against?.average?.home) || gaTotal;
    const gfAway = Number(goals.for?.average?.away) || gfTotal;
    const gaAway = Number(goals.against?.average?.away) || gaTotal;
    if (gfTotal === 0 && gaTotal === 0) return null;

    // Meciuri jucate pentru shrinkage bayesian. API-Football returnează în fixtures.played.
    const fixtures = r?.fixtures || {};
    const playedTotal = Number(fixtures.played?.total) || 0;
    const playedHome = Number(fixtures.played?.home) || 0;
    const playedAway = Number(fixtures.played?.away) || 0;

    // Clean sheet / failed to score, ca rate (count / meciuri jucate pe acel venue).
    // Opţionale — null când lipsesc din payload sau nu avem suficiente meciuri jucate,
    // apelanţii trebuie să trateze null ca "indisponibil", nu ca 0.
    const cleanSheet = r?.clean_sheet;
    const failedToScore = r?.failed_to_score;
    const rateOrNull = (count, played) => {
      const c = Number(count);
      if (!Number.isFinite(c) || !(played > 0)) return null;
      return Math.max(0, Math.min(1, c / played));
    };
    const cleanSheetRateHome = rateOrNull(cleanSheet?.home, playedHome);
    const cleanSheetRateAway = rateOrNull(cleanSheet?.away, playedAway);
    const failedToScoreRateHome = rateOrNull(failedToScore?.home, playedHome);
    const failedToScoreRateAway = rateOrNull(failedToScore?.away, playedAway);

    return {
      gfHome,
      gaHome,
      gfAway,
      gaAway,
      played: playedTotal,
      playedHome,
      playedAway,
      cleanSheetRateHome,
      cleanSheetRateAway,
      failedToScoreRateHome,
      failedToScoreRateAway
    };
  } catch {
    return null;
  }
}

/**
 * Empirical BTTS estimate from clean-sheet / failed-to-score rates (each 0..1).
 * Combines each side's own scoring record with the opponent's defensive record
 * as two independent estimates of "this team fails to score," then averages
 * them — deliberately simple, no amplification. Returns null if any input is
 * missing/out of range; callers must fall back to the existing value unchanged.
 * @param {{cleanSheetRateHome:number, cleanSheetRateAway:number,
 *   failedToScoreRateHome:number, failedToScoreRateAway:number}} rates
 * @returns {number|null} 0..1
 */
export function computeEmpiricalBttsRate({
  cleanSheetRateHome,
  cleanSheetRateAway,
  failedToScoreRateHome,
  failedToScoreRateAway
} = {}) {
  const csH = Number(cleanSheetRateHome);
  const csA = Number(cleanSheetRateAway);
  const ftsH = Number(failedToScoreRateHome);
  const ftsA = Number(failedToScoreRateAway);
  if (![csH, csA, ftsH, ftsA].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  const pHomeFailsToScore = (ftsH + csA) / 2;
  const pAwayFailsToScore = (ftsA + csH) / 2;
  return (1 - pHomeFailsToScore) * (1 - pAwayFailsToScore);
}

/**
 * Blends an already-computed BTTS/GG probability (Poisson + any calibration
 * already applied) with the conservative empirical estimate above. Fixed
 * 85% Poisson / 15% empirical weighting, hardcoded on purpose — no env, no
 * config, no runtime tuning. If the empirical rate can't be computed (missing
 * stats), returns the input unchanged — exact existing behaviour.
 * @param {number} poissonPGG already-computed pGG, percent scale (0-100)
 * @param {object} rates same shape as computeEmpiricalBttsRate's argument
 * @returns {number}
 */
export function blendBttsWithEmpirical(poissonPGG, rates) {
  const base = Number(poissonPGG);
  if (!Number.isFinite(base)) return poissonPGG;
  const empirical = computeEmpiricalBttsRate(rates);
  if (empirical == null) return poissonPGG;
  const blended = base * 0.85 + empirical * 100 * 0.15;
  return Math.max(0, Math.min(100, blended));
}

/** @deprecated Use strengthRatingsLambdas — kept for backward imports in tests */
export function advancedLambdas(homeStats, awayStats, homeFormMulti, awayFormMulti) {
  const s = strengthRatingsLambdas(homeStats, awayStats, homeFormMulti, awayFormMulti);
  return { lambdaHome: s.lambdaHome, lambdaAway: s.lambdaAway };
}

/**
 * Baseline: aproximativ 46% din golurile unui meci cad în prima repriză
 * (statistic pe ligile europene top-5 ultimii 3 sezoane). Folosit când lipseşte
 * distribuţia pe minute în payload-ul /teams/statistics.
 */
export const FIRST_HALF_GOALS_BASELINE = 0.46;

/**
 * Extrage fracţia de goluri (pentru / împotriva) care cad în prima repriză (min 0-45).
 * `/teams/statistics` returnează `goals.{for,against}.minute.{"0-15","16-30","31-45",...}`
 * cu sub-obiect `{total, percentage}`. Însumăm totalurile FH vs. SH şi returnăm fracţia.
 *
 * Include şi bucketele de prelungiri ("91-105", "106-120") în bucla SH dacă există.
 *
 * @returns {{fhFractionFor: number, fhFractionAgainst: number, sample: {fh: number, sh: number}} | null}
 */
export function extractFirstHalfFractions(teamStatsPayload) {
  try {
    const payload = normalizeTeamStatisticsPayload(teamStatsPayload);
    const goals = payload?.response?.goals;
    if (!goals) return null;

    const FH_KEYS = ["0-15", "16-30", "31-45"];
    const SH_KEYS = ["46-60", "61-75", "76-90", "91-105", "106-120"];

    const sumSide = (side) => {
      const m = goals[side]?.minute || {};
      let fh = 0;
      let sh = 0;
      for (const k of FH_KEYS) fh += Number(m[k]?.total) || 0;
      for (const k of SH_KEYS) sh += Number(m[k]?.total) || 0;
      const total = fh + sh;
      if (total <= 0) return null;
      return { fh: fh / total, sh: sh / total, count: total };
    };

    const forSide = sumSide("for");
    const againstSide = sumSide("against");
    if (!forSide && !againstSide) return null;

    // fallback pe side-ul care lipseşte: folosim baseline-ul
    const fhFractionFor = forSide ? forSide.fh : FIRST_HALF_GOALS_BASELINE;
    const fhFractionAgainst = againstSide ? againstSide.fh : FIRST_HALF_GOALS_BASELINE;

    return {
      fhFractionFor,
      fhFractionAgainst,
      sample: {
        fh: (forSide?.count || 0) + (againstSide?.count || 0),
        sh: 0 // informativ; putem omite
      }
    };
  } catch {
    return null;
  }
}

/**
 * Derivă λ pentru prima repriză pornind de la λ-urile full match şi fracţiile FH extrase.
 *
 * Pentru fiecare echipă, λ_FH ≈ λ_full × mixScale, unde:
 *   mixScale = (fhFraction_for_self + fhFraction_against_opponent) / 2
 *
 * De ce media: echipa care marchează FH des (hot starter) + apărare slabă a adversarului FH →
 * scor FH probabil mare. Dacă oricare lipseşte, ajustăm cu FIRST_HALF_GOALS_BASELINE.
 *
 * Clampat în [0.08, 2.5] — FH goluri mai rare decât full, dar nu sub pragul numeric de stabilitate Poisson.
 */
export function deriveFirstHalfLambdas({
  lambdaHomeFull,
  lambdaAwayFull,
  fhFractionsHome,
  fhFractionsAway
}) {
  const baseline = FIRST_HALF_GOALS_BASELINE;
  const fhForH = fhFractionsHome?.fhFractionFor ?? baseline;
  const fhAgainstA = fhFractionsAway?.fhFractionAgainst ?? baseline;
  const fhForA = fhFractionsAway?.fhFractionFor ?? baseline;
  const fhAgainstH = fhFractionsHome?.fhFractionAgainst ?? baseline;

  const scaleHome = (fhForH + fhAgainstA) / 2;
  const scaleAway = (fhForA + fhAgainstH) / 2;

  const lambdaHomeFH = clamp(
    (Number(lambdaHomeFull) || 0) * scaleHome,
    0.08,
    2.5
  );
  const lambdaAwayFH = clamp(
    (Number(lambdaAwayFull) || 0) * scaleAway,
    0.08,
    2.5
  );

  return {
    lambdaHomeFH,
    lambdaAwayFH,
    meta: {
      scaleHome: Number(scaleHome.toFixed(4)),
      scaleAway: Number(scaleAway.toFixed(4)),
      fhFractionForHome: Number(fhForH.toFixed(4)),
      fhFractionAgainstHome: Number(fhAgainstH.toFixed(4)),
      fhFractionForAway: Number(fhForA.toFixed(4)),
      fhFractionAgainstAway: Number(fhAgainstA.toFixed(4)),
      baselineUsed:
        fhFractionsHome === null ||
        fhFractionsAway === null ||
        (fhForH === baseline && fhAgainstH === baseline) ||
        (fhForA === baseline && fhAgainstA === baseline)
    }
  };
}
