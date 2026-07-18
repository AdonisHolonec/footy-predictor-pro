/** Typed mirror of `confidenceWeights.js` — kept in sync manually (not imported at runtime). */

export interface ConfidenceWeights {
  attack: number;
  defense: number;
  form: number;
  standings: number;
  h2h: number;
  restDays: number;
  referee: number;
  injuries: number;
  oddsConsensus: number;
  teamStatistics: number;
}

export const DEFAULT_CONFIDENCE_WEIGHTS: ConfidenceWeights = {
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

function envNum(key: string, fallback: number): number {
  const raw = typeof process !== "undefined" ? process.env?.[key] : undefined;
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Load Confidence Engine weights with optional `CONFIDENCE_WEIGHT_*` env overrides. */
export function getConfidenceWeights(): ConfidenceWeights {
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
export function normalizeConfidenceWeights(weights: Partial<ConfidenceWeights>): ConfidenceWeights {
  const keys = Object.keys(DEFAULT_CONFIDENCE_WEIGHTS) as Array<keyof ConfidenceWeights>;
  const sum = keys.reduce((acc, k) => acc + (Number(weights?.[k]) || 0), 0);
  const out = {} as ConfidenceWeights;
  if (sum <= 0) {
    const even = 1 / keys.length;
    for (const k of keys) out[k] = even;
    return out;
  }
  for (const k of keys) out[k] = (Number(weights?.[k]) || 0) / sum;
  return out;
}
