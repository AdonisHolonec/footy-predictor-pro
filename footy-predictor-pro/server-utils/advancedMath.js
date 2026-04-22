export const calculateSyntheticXG = (statistics) => {
  if (!statistics || !Array.isArray(statistics) || statistics.length === 0) return 0;
  let shotsInsideBox = 0, shotsOutsideBox = 0, corners = 0, penalties = 0;
  statistics.forEach((stat) => {
    const val = (stat.value === null || stat.value === undefined) ? 0 : Number(stat.value);
    const safeVal = Number.isNaN(val) ? 0 : val;
    switch (stat.type) {
      case "Shots insidebox": shotsInsideBox = safeVal; break;
      case "Shots outsidebox": shotsOutsideBox = safeVal; break;
      case "Corner Kicks": corners = safeVal; break;
      case "Penalty Kicks":
      case "Penalties":
      case "Penalty Kicks - Scored":
      case "Penalties Scored": penalties = safeVal; break;
    }
  });
  // ponderi revizuite: corner real ≈ 0.015 xG/execuţie (era 0.03 — 2× supraestimare)
  const xG = (shotsInsideBox * 0.14) + (shotsOutsideBox * 0.035) + (corners * 0.015) + (penalties * 0.76);
  return Number(xG.toFixed(2));
};

export const calculateWeightedXG = (xGHistory) => {
  if (!xGHistory || xGHistory.length === 0) return 0;
  if (xGHistory.length < 3) return xGHistory.reduce((a, b) => a + b, 0) / xGHistory.length;
  const recent2 = xGHistory.slice(-2);
  const avgRecent = recent2.reduce((a, b) => a + b, 0) / 2;
  const avgTotal = xGHistory.reduce((a, b) => a + b, 0) / xGHistory.length;
  return Number(((avgTotal * 0.4) + (avgRecent * 0.6)).toFixed(2));
};

const factorial = (n) => { if (n === 0 || n === 1) return 1; let result = 1; for (let i = 2; i <= n; i++) result *= i; return result; };
export const getPoissonProbability = (lambda, k) => { if (lambda <= 0) return k === 0 ? 1 : 0; return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k); };
export const calculateEV = (probability, odds) => Number((((probability * odds) - 1) * 100).toFixed(2));
export const calculateKellyQuarter = (probability, odds, isHighConfidence = true) => {
  const q = 1 - probability; const b = odds - 1; if (b <= 0) return 0;
  const kellyFull = ((b * probability) - q) / b; if (kellyFull <= 0) return 0;
  const fraction = isHighConfidence ? 0.25 : 0.15;
  return Math.min(Number(((kellyFull * fraction) * 100).toFixed(2)), 3.00);
};

/**
 * Stake ensemble cu o SINGURĂ ajustare netă faţă de Kelly-quarter (evită compounding-ul
 * multi-factorial care deforma Kelly optim). Scalarul final e clampat în [0.7, 1.15]:
 * - data quality slabă -> down
 * - market gap mare (modelul diverge mult de piaţă) -> down
 * - EV / confidence puternice -> up (limitat)
 */
export const calculateEnsembleStake = ({
  probability,
  odds,
  confidencePct = 50,
  marketVolatility = 0.5,
  marketGapPct = 0,
  dataQuality = 0.75
}) => {
  const baseKelly = calculateKellyQuarter(probability, odds, confidencePct >= 65);
  const evPct = calculateEV(probability, odds);

  // scor normalizat: positiv = bullish, negativ = bearish
  const confScore = (Math.min(Math.max(Number(confidencePct) || 0, 30), 90) - 55) / 100;    // [-0.25, 0.35]
  const evScore = Math.min(Math.max(Number(evPct) || 0, -5), 20) / 200;                      // [-0.025, 0.1]
  const dqScore = (Math.min(Math.max(Number(dataQuality) || 0.5, 0.3), 1) - 0.6) / 2;        // [-0.15, 0.2]
  const gapPenalty = -Math.min(Math.max(Number(marketGapPct) || 0, 0), 20) / 100;            // [-0.2, 0]
  const volPenalty = -Math.min(Math.max(Number(marketVolatility) || 0, 0), 1) * 0.1;         // [-0.1, 0]

  const adjustment = 1 + confScore + evScore + dqScore + gapPenalty + volPenalty;
  const clamped = Math.max(0.7, Math.min(1.15, adjustment));
  const ensemble = baseKelly * clamped;
  const capped = Math.min(Math.max(0, ensemble), 3);

  return {
    stakePct: Number(capped.toFixed(2)),
    components: {
      baseKelly: Number(baseKelly.toFixed(2)),
      adjustment: Number(clamped.toFixed(3)),
      confScore: Number(confScore.toFixed(3)),
      evScore: Number(evScore.toFixed(3)),
      dqScore: Number(dqScore.toFixed(3)),
      gapPenalty: Number(gapPenalty.toFixed(3)),
      volPenalty: Number(volPenalty.toFixed(3))
    }
  };
};

export const isValueBet = (probability, odds, threshold = 1.10) => {
  const ev = probability * odds;
  return ev >= threshold && odds >= 1.45 && probability >= 0.25;
};

export const adjustLambdaByEfficiency = (actualGoals, xG, confidence = 0.5) => {
  if (!xG || xG <= 0) return actualGoals;
  const safeConfidence = Math.max(0.1, Math.min(0.9, Number(confidence) || 0.5));
  return Number(((actualGoals * (1 - safeConfidence)) + (xG * safeConfidence)).toFixed(3));
};

/**
 * Single-team scoring intensity from goal-rate inputs (NOT shot-based xG).
 * @deprecated Old name implied "xG"; use expectedIntensityFromGoalRates.
 */
export function expectedIntensityFromGoalRates({
  teamAttack,
  opponentDefense,
  leagueBase = 1.35,
  formMultiplier = 1,
  venueBoost = 1
}) {
  const atk = Math.max(0.2, Number(teamAttack) || leagueBase);
  const def = Math.max(0.2, Number(opponentDefense) || leagueBase);
  const fm = Math.max(0.75, Math.min(1.35, Number(formMultiplier) || 1));
  const vb = Math.max(0.85, Math.min(1.2, Number(venueBoost) || 1));
  const beta0 = Math.log(Math.max(0.2, leagueBase));
  const intensity = Math.exp(beta0 + 0.88 * Math.log(atk) - 0.67 * Math.log(def));
  return Number((intensity * fm * vb).toFixed(3));
}

/** @deprecated Use expectedIntensityFromGoalRates */
export const calculateDynamicXG = expectedIntensityFromGoalRates;

/**
 * Margin removal PROPORTIONAL (fallback / comparaţie). Amplifică long-shot bias.
 * Preferă {@link shinImpliedProbs} când ai 3-way clar.
 */
export const removeBookmakerMargin = (homeOdd, drawOdd, awayOdd) => {
  const h = Number(homeOdd), d = Number(drawOdd), a = Number(awayOdd);
  if (!Number.isFinite(h) || !Number.isFinite(d) || !Number.isFinite(a) || h <= 1 || d <= 1 || a <= 1) return null;
  const invH = 1 / h, invD = 1 / d, invA = 1 / a;
  const sum = invH + invD + invA; if (sum <= 0) return null;
  return { p1: invH / sum, pX: invD / sum, p2: invA / sum };
};

/**
 * Shin (1993) method for de-biasing 3-way bookmaker odds. Rezolvă ecuația pentru z ∈ [0, 0.1]
 * (proporţia de "insider traders") prin bisecţie, apoi extrage probabilitățile reale.
 * Empiric reduce log-loss-ul cu ~1-2% faţă de metoda proporţională pentru 1X2.
 *
 * @returns {{p1:number, pX:number, p2:number, z:number} | null}
 */
export function shinImpliedProbs(homeOdd, drawOdd, awayOdd) {
  const h = Number(homeOdd), d = Number(drawOdd), a = Number(awayOdd);
  if (!Number.isFinite(h) || !Number.isFinite(d) || !Number.isFinite(a) || h <= 1 || d <= 1 || a <= 1) return null;
  const inv = [1 / h, 1 / d, 1 / a];
  const s = inv[0] + inv[1] + inv[2];
  if (s <= 1.0) {
    // Pieţele fără overround — fallback proporţional.
    return { p1: inv[0] / s, pX: inv[1] / s, p2: inv[2] / s, z: 0 };
  }

  // Shin (1993): Σ p_i = 1 cu p_i = [sqrt(z² + 4(1-z)q_i²/s) - z] / [2(1-z)].
  // Înmulțind cu 2(1-z) şi reducând: Σ sqrt(z² + 4(1-z)q_i²/s) = 2 + z.
  // Rezolvăm f(z) = Σ sqrt(...) - (2 + z) = 0 prin bisecţie pe z ∈ [0, 0.3].
  const f = (z) => {
    const oneMinus = 1 - z;
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      sum += Math.sqrt(z * z + (4 * oneMinus * inv[i] * inv[i]) / s);
    }
    return sum - (2 + z);
  };

  let lo = 0;
  let hi = 0.3;
  let fLo = f(lo);
  let fHi = f(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) {
    return removeBookmakerMargin(h, d, a);
  }
  // dacă semnele nu se schimbă, fallback proporţional
  if (fLo * fHi > 0) {
    return removeBookmakerMargin(h, d, a);
  }
  for (let iter = 0; iter < 60; iter++) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (!Number.isFinite(fMid)) break;
    if (Math.abs(fMid) < 1e-10) {
      lo = mid;
      hi = mid;
      break;
    }
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  const z = (lo + hi) / 2;

  const pOf = (i) =>
    (Math.sqrt(z * z + (4 * (1 - z) * inv[i] * inv[i]) / s) - z) / (2 * (1 - z));
  const p1 = pOf(0);
  const pX = pOf(1);
  const p2 = pOf(2);
  const total = p1 + pX + p2;
  if (!Number.isFinite(total) || total <= 0) return removeBookmakerMargin(h, d, a);
  return {
    p1: p1 / total,
    pX: pX / total,
    p2: p2 / total,
    z
  };
}

export const blendModelWithMarket = ({ model, market, modelWeight = 0.7 }) => {
  if (!model) return null;
  if (!market) return model;
  const w = Math.max(0.35, Math.min(0.9, Number(modelWeight) || 0.7));
  const p1 = (model.p1 * w) + (market.p1 * (1 - w));
  const pX = (model.pX * w) + (market.pX * (1 - w));
  const p2 = (model.p2 * w) + (market.p2 * (1 - w));
  const total = p1 + pX + p2;
  if (!Number.isFinite(total) || total <= 0) return model;
  return { p1: p1 / total, pX: pX / total, p2: p2 / total };
};

export const evaluateNoBetZone = ({ edge, evPct, confidencePct, marketGapPct }) => {
  const reasons = [];
  if ((edge || 0) < 1.10) reasons.push("edge_too_small");
  if ((evPct || 0) < 1.25) reasons.push("low_ev");
  if ((confidencePct || 0) < 46) reasons.push("low_confidence");
  if ((marketGapPct || 0) > 16) reasons.push("market_disagrees");
  return { allowBet: reasons.length === 0, reasons };
};
