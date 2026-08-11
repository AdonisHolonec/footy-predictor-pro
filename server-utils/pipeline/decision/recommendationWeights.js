/**
 * Eligibility thresholds for the Recommendation Selector (selectRecommendation.js).
 *
 * Aug 2026 — this file used to also carry the *ranking* weights: a composite
 * commercial score (0.72 confidence + 0.20 EV + 0.05 bookmaker-count + 0.03 market
 * diversity) minus hard-coded penalties on Over 1.5 / Under 3.5. An audit showed
 * that score could — and did — rank a 38% selection above a 49% one, and a 55%
 * selection above a 71% one, because the EV term saturated at +20% EV and was worth
 * 20 of 100 points (≈ 27.8 percentage points of probability).
 *
 * Product rule now: Recommended is the selection with the highest chance of winning,
 * full stop. The ranking weights are therefore deleted rather than retuned — no
 * weighting of a commercial factor is safe when the rule is "highest probability
 * wins". EV/value optimisation lives exclusively in the Value Engine (Best Value).
 *
 * What remains here is eligibility only: the probability floor a candidate must
 * clear before it is allowed to compete on probability at all. The odds floor is
 * MIN_DISPLAY_ODDS (predictionDisplayGate.js), shared with every other surface.
 */

export const DEFAULT_RECOMMENDATION_WEIGHTS = Object.freeze({
  /** Never recommend a pick below coin-flip probability. */
  minProbabilityPct: 50
});

export function getRecommendationWeights(overrides = {}) {
  return { ...DEFAULT_RECOMMENDATION_WEIGHTS, ...(overrides || {}) };
}

export default { DEFAULT_RECOMMENDATION_WEIGHTS, getRecommendationWeights };
