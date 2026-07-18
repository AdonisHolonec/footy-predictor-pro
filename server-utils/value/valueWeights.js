/**
 * Tunable thresholds for the Value Betting Engine.
 * Re-exported from the typed mirror `valueWeights.ts` (kept in sync manually).
 */

export const DEFAULT_VALUE_WEIGHTS = Object.freeze({
  /** EV% above this → Positive EV (green) and eligible for recommendation. */
  positiveEvPct: 1.25,
  /** EV% at or below this (but still ≥ 0) → Neutral (yellow). Below 0 → Negative (red). */
  neutralEvPct: 0,
  /** Minimum decimal odds to consider a market. */
  minOdds: 1.3,
  /** Minimum model probability (0–1) to consider a market. */
  minProbability: 0.2,
  /** Minimum raw edge (p × odds) required for a recommendable value bet. */
  minEdge: 1.1,
  /** Kelly fraction of full Kelly (quarter-Kelly by default). */
  kellyFraction: 0.25,
  /** Softer Kelly fraction when confidence is below the high-confidence bar. */
  kellyFractionSoft: 0.15,
  /** Confidence % at/above which we use the full kellyFraction. */
  highConfidencePct: 65,
  /** Hard cap on recommended stake % of bankroll. */
  kellyCapPct: 3,
  /** Value Score weights (re-normalized at runtime). */
  scoreWeights: Object.freeze({
    ev: 0.45,
    edge: 0.25,
    kelly: 0.2,
    confidence: 0.1
  })
});

export function getValueWeights(overrides = {}) {
  const base = { ...DEFAULT_VALUE_WEIGHTS, ...(overrides || {}) };
  const sw = { ...DEFAULT_VALUE_WEIGHTS.scoreWeights, ...(overrides?.scoreWeights || {}) };
  return { ...base, scoreWeights: sw };
}

export function normalizeScoreWeights(weights) {
  const w = weights || DEFAULT_VALUE_WEIGHTS.scoreWeights;
  const sum = Object.values(w).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  const out = {};
  for (const [k, v] of Object.entries(w)) {
    out[k] = (Number(v) || 0) / sum;
  }
  return out;
}
