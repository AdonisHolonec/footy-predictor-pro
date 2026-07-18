/**
 * Editable weights for the independent Confidence Engine.
 *
 * IMPORTANT: These weights ONLY affect the `confidenceEngine` explanatory block attached to a
 * prediction row. They never touch λ_home/λ_away, the Poisson pick probabilities, or
 * `recommended.confidence` — those remain fully owned by the prediction pipeline
 * (`server-utils/prediction/*`). This file exists purely to score "how much/what kind of
 * context did we have" for a match, independent of which side the model favors.
 *
 * Defaults are chosen so they sum conceptually to 1.0; the engine re-normalizes at runtime
 * in case env overrides push the sum away from 1.0.
 */

export const DEFAULT_CONFIDENCE_WEIGHTS = {
  attack: 0.16,
  defense: 0.16,
  form: 0.12,
  standings: 0.12,
  h2h: 0.08,
  restDays: 0.06,
  referee: 0.05,
  injuries: 0.07,
  oddsConsensus: 0.1,
  teamStatistics: 0.08
};

function envNum(key, fallback) {
  const raw = typeof process !== "undefined" ? process.env?.[key] : undefined;
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Load Confidence Engine weights with optional `CONFIDENCE_WEIGHT_*` env overrides. */
export function getConfidenceWeights() {
  const d = DEFAULT_CONFIDENCE_WEIGHTS;
  return {
    attack: envNum("CONFIDENCE_WEIGHT_ATTACK", d.attack),
    defense: envNum("CONFIDENCE_WEIGHT_DEFENSE", d.defense),
    form: envNum("CONFIDENCE_WEIGHT_FORM", d.form),
    standings: envNum("CONFIDENCE_WEIGHT_STANDINGS", d.standings),
    h2h: envNum("CONFIDENCE_WEIGHT_H2H", d.h2h),
    restDays: envNum("CONFIDENCE_WEIGHT_REST_DAYS", d.restDays),
    referee: envNum("CONFIDENCE_WEIGHT_REFEREE", d.referee),
    injuries: envNum("CONFIDENCE_WEIGHT_INJURIES", d.injuries),
    oddsConsensus: envNum("CONFIDENCE_WEIGHT_ODDS_CONSENSUS", d.oddsConsensus),
    teamStatistics: envNum("CONFIDENCE_WEIGHT_TEAM_STATISTICS", d.teamStatistics)
  };
}

/** Normalizes a weights map so its values sum to 1 (falls back to equal split if sum is 0). */
export function normalizeConfidenceWeights(weights) {
  const keys = Object.keys(DEFAULT_CONFIDENCE_WEIGHTS);
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
