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
 * Bivariate Poisson (Karlis-Ntzoufras) pentru corelaţia goalurilor prin shared component.
 * Folosit în afara zonei low-score; acolo aplicăm şi corecţia Dixon-Coles τ.
 */
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
 * Dixon-Coles τ corection pentru celulele low-score (0-0, 0-1, 1-0, 1-1).
 * Empiric, ρ tipic în [-0.20, -0.05]; negativ înseamnă că Poisson pur subestimează egalurile.
 * Valoarea este clampată pentru a garanta τ ≥ 0 chiar şi pentru λ mari.
 */
function dcTau(i, j, lambdaHome, lambdaAway, rho) {
  if (!Number.isFinite(rho) || rho === 0) return 1;
  if (i === 0 && j === 0) return Math.max(0, 1 - lambdaHome * lambdaAway * rho);
  if (i === 0 && j === 1) return Math.max(0, 1 + lambdaHome * rho);
  if (i === 1 && j === 0) return Math.max(0, 1 + lambdaAway * rho);
  if (i === 1 && j === 1) return Math.max(0, 1 - rho);
  return 1;
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
  const correlation = clamp(Number(options?.correlation ?? 0.12), 0, 0.45);
  const rho = clamp(Number(options?.rho ?? -0.11), -0.25, 0.1);
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
        const base = bivariatePoissonP(i, j, lambdaHome, lambdaAway, correlation);
        const tau = dcTau(i, j, lambdaHome, lambdaAway, rho);
        const prob = base * tau;
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

  // Re-normalizare globală: corecţia DC poate face mass ≠ 1 chiar pentru grid mare.
  if (acc.mass > 0 && Math.abs(acc.mass - 1) > 1e-9) {
    const k = 1 / acc.mass;
    acc.p1 *= k;
    acc.pX *= k;
    acc.p2 *= k;
    acc.pO25 *= k;
    acc.pGG *= k;
    acc.pU35 *= k;
    acc.pO15 *= k;
    acc.mass = 1;
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
      method: "bivariate-poisson-dc-analytic",
      correlation,
      rho,
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
  const leagueAvgHome = Number(options.leagueAvgHome) || leagueAvg;
  const leagueAvgAway = Number(options.leagueAvgAway) || leagueAvg;
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

  // Dixon-Coles multiplicativ: λ_home = leagueAvgHome × (atk_home / leagueAvg) × (def_away / leagueAvg) × homeAdv × form
  const lambdaHome = clampLambda(
    leagueAvgHome * (atkH / leagueAvg) * (defA / leagueAvg) * homeAdv * hf
  );
  const lambdaAway = clampLambda(
    leagueAvgAway * (atkA / leagueAvg) * (defH / leagueAvg) * awayAdv * af
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
    let pts = 0;
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

    return {
      gfHome,
      gaHome,
      gfAway,
      gaAway,
      played: playedTotal,
      playedHome,
      playedAway
    };
  } catch {
    return null;
  }
}

/** @deprecated Use strengthRatingsLambdas — kept for backward imports in tests */
export function advancedLambdas(homeStats, awayStats, homeFormMulti, awayFormMulti) {
  const s = strengthRatingsLambdas(homeStats, awayStats, homeFormMulti, awayFormMulti);
  return { lambdaHome: s.lambdaHome, lambdaAway: s.lambdaAway };
}
