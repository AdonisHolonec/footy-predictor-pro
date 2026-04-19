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
  const xG = (shotsInsideBox * 0.15) + (shotsOutsideBox * 0.03) + (corners * 0.03) + (penalties * 0.76);
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

export const calculateEnsembleStake = ({ probability, odds, confidencePct = 50, marketVolatility = 0.5 }) => {
  const baseKelly = calculateKellyQuarter(probability, odds, confidencePct >= 65);
  const evPct = calculateEV(probability, odds);
  const confidenceBoost = Math.max(0.75, Math.min(1.25, confidencePct / 70));
  const volatilityPenalty = Math.max(0.7, Math.min(1, 1 - (marketVolatility * 0.35)));
  const evBoost = Math.max(0.8, Math.min(1.35, 1 + (evPct / 100)));
  const ensemble = baseKelly * confidenceBoost * volatilityPenalty * evBoost;
  const capped = Math.min(Math.max(0, ensemble), 3);
  return {
    stakePct: Number(capped.toFixed(2)),
    components: {
      baseKelly: Number(baseKelly.toFixed(2)),
      confidenceBoost: Number(confidenceBoost.toFixed(2)),
      volatilityPenalty: Number(volatilityPenalty.toFixed(2)),
      evBoost: Number(evBoost.toFixed(2))
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

export const removeBookmakerMargin = (homeOdd, drawOdd, awayOdd) => {
  const h = Number(homeOdd), d = Number(drawOdd), a = Number(awayOdd);
  if (!Number.isFinite(h) || !Number.isFinite(d) || !Number.isFinite(a) || h <= 1 || d <= 1 || a <= 1) return null;
  const invH = 1 / h, invD = 1 / d, invA = 1 / a;
  const sum = invH + invD + invA; if (sum <= 0) return null;
  return { p1: invH / sum, pX: invD / sum, p2: invA / sum };
};

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
