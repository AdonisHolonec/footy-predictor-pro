/**
 * PredictionEngine weights.
 * Optional modules default to modularBlend=0 → numeric parity with strength-ratings.
 */

export const DEFAULT_PREDICTION_WEIGHTS = Object.freeze({
  attack: 1.0,
  defense: 1.0,
  form: 1.0,
  homeAdvantage: 1.0,
  awayStrength: 0.0,
  standings: 0.15,
  h2h: 0.1,
  referee: 0.05,
  restDays: 0.08,
  recentMatches: 0.12,
  injuries: 0.0,
  lineup: 0.0,
  odds: 0.0,
  motivation: 0.0,
  weather: 0.0,
  expectedGoals: 0.0,
  poissonCorrelation: 0.12,
  modularBlend: 0
});

function envNum(key, fallback) {
  const raw = typeof process !== "undefined" ? process.env?.[key] : undefined;
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getPredictionWeights() {
  const d = DEFAULT_PREDICTION_WEIGHTS;
  return {
    attack: envNum("PREDICT_WEIGHT_ATTACK", d.attack),
    defense: envNum("PREDICT_WEIGHT_DEFENSE", d.defense),
    form: envNum("PREDICT_WEIGHT_FORM", d.form),
    homeAdvantage: envNum("PREDICT_WEIGHT_HOME_ADVANTAGE", d.homeAdvantage),
    awayStrength: envNum("PREDICT_WEIGHT_AWAY_STRENGTH", d.awayStrength),
    standings: envNum("PREDICT_WEIGHT_STANDINGS", d.standings),
    h2h: envNum("PREDICT_WEIGHT_H2H", d.h2h),
    referee: envNum("PREDICT_WEIGHT_REFEREE", d.referee),
    restDays: envNum("PREDICT_WEIGHT_REST_DAYS", d.restDays),
    recentMatches: envNum("PREDICT_WEIGHT_RECENT_MATCHES", d.recentMatches),
    injuries: envNum("PREDICT_WEIGHT_INJURIES", d.injuries),
    lineup: envNum("PREDICT_WEIGHT_LINEUP", d.lineup),
    odds: envNum("PREDICT_WEIGHT_ODDS", d.odds),
    motivation: envNum("PREDICT_WEIGHT_MOTIVATION", d.motivation),
    weather: envNum("PREDICT_WEIGHT_WEATHER", d.weather),
    expectedGoals: envNum("PREDICT_WEIGHT_EXPECTED_GOALS", d.expectedGoals),
    poissonCorrelation: envNum("PREDICT_WEIGHT_POISSON_CORRELATION", d.poissonCorrelation),
    modularBlend: envNum("PREDICT_WEIGHT_MODULAR_BLEND", d.modularBlend)
  };
}
