/**
 * Weights for the independent Confidence Engine only.
 * Never affects λ, Poisson probs, or recommended.confidence.
 */

export const DEFAULT_CONFIDENCE_WEIGHTS = {
  attack: 0.14,
  defense: 0.14,
  form: 0.1,
  recentMatches: 0.08,
  standings: 0.1,
  referee: 0.05,
  injuries: 0.06,
  lineups: 0.05,
  restDays: 0.06,
  homeAdvantage: 0.06,
  oddsConsensus: 0.09,
  h2h: 0.07
};

/** Ordered dimension keys (UI + docs). */
export const CONFIDENCE_DIMENSION_KEYS = Object.freeze(Object.keys(DEFAULT_CONFIDENCE_WEIGHTS));

function envNum(key, fallback) {
  const raw = typeof process !== "undefined" ? process.env?.[key] : undefined;
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getConfidenceWeights() {
  const d = DEFAULT_CONFIDENCE_WEIGHTS;
  return {
    attack: envNum("CONFIDENCE_WEIGHT_ATTACK", d.attack),
    defense: envNum("CONFIDENCE_WEIGHT_DEFENSE", d.defense),
    form: envNum("CONFIDENCE_WEIGHT_FORM", d.form),
    recentMatches: envNum("CONFIDENCE_WEIGHT_RECENT_MATCHES", d.recentMatches),
    standings: envNum("CONFIDENCE_WEIGHT_STANDINGS", d.standings),
    referee: envNum("CONFIDENCE_WEIGHT_REFEREE", d.referee),
    injuries: envNum("CONFIDENCE_WEIGHT_INJURIES", d.injuries),
    lineups: envNum("CONFIDENCE_WEIGHT_LINEUPS", d.lineups),
    restDays: envNum("CONFIDENCE_WEIGHT_REST_DAYS", d.restDays),
    homeAdvantage: envNum("CONFIDENCE_WEIGHT_HOME_ADVANTAGE", d.homeAdvantage),
    oddsConsensus: envNum("CONFIDENCE_WEIGHT_ODDS_CONSENSUS", d.oddsConsensus),
    h2h: envNum("CONFIDENCE_WEIGHT_H2H", d.h2h)
  };
}

export function normalizeConfidenceWeights(weights) {
  const keys = CONFIDENCE_DIMENSION_KEYS;
  const sum = keys.reduce((acc, k) => acc + (Number(weights?.[k]) || 0), 0);
  const out = {};
  if (sum <= 0) {
    const even = 1 / keys.length;
    for (const k of keys) out[k] = even;
    return out;
  }
  for (const k of keys) out[k] = (Number(weights?.[k]) || 0) / sum;
  return out;
}

/** Map overall 0-100 → category label. */
export function confidenceCategory(overall) {
  const n = Number(overall);
  if (!Number.isFinite(n)) return "Very Low";
  if (n >= 80) return "Very High";
  if (n >= 65) return "High";
  if (n >= 50) return "Medium";
  if (n >= 35) return "Low";
  return "Very Low";
}
