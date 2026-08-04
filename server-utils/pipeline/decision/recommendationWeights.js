/**
 * Tunable thresholds for the multi-market Recommendation Selector (selectRecommendation.js).
 * Mirrors the pattern used by ../../value/valueWeights.js — a single, overridable source
 * of truth so no magic number lives inline in the selection algorithm.
 */

export const DEFAULT_RECOMMENDATION_WEIGHTS = Object.freeze({
  /** Never recommend a pick below coin-flip probability. */
  minProbabilityPct: 50,
  /** Bookmaker consensus count that counts as "full" price-quality confidence. */
  qualityFullBookmakerCount: 6,
  /**
   * Composite score weights (re-normalized to sum to 1 at runtime). Recalibrated Aug 2026
   * after the v1 weights (confidence 0.55 / diversity 0.12) overcorrected — Over/Under
   * collapsed from 85% to 2.8% of picks while 1X2 rose to 60.7%, one dominant family
   * replacing another. A 570-fixture offline sweep across 4 weightings (0.55-0.72 confidence,
   * 0.12-0.03 diversity) found 1X2's share IDENTICAL — 60.7% — at every weighting: it isn't
   * a scoring-weight artifact. In the ~26% of fixtures where no candidate clears the 50%
   * probability floor, 1X2 wins every relaxed-fallback case too (151/151 in the sweep),
   * because "most likely of exactly three outcomes" is genuinely more defensible than an
   * equally-uncertain BTTS/Corners side — that's a property of match-winner markets, not a
   * bug. What the weight change actually buys: better balance *among* the other four
   * families and a meaningfully better realized edge (win rate vs. break-even odds went
   * from -7.3pp to +1.8pp in the replay) — confidence now carries the most weight of any
   * component, as intended, without giving diversity enough leverage to overrule it.
   */
  scoreWeights: Object.freeze({
    confidence: 0.72,
    expectedValue: 0.2,
    quality: 0.05,
    diversity: 0.03
  }),
  /**
   * Diversity bonus per market family, 0-1 scale — part of the composite score itself,
   * not a post-hoc tie-break, so a different family can outrank a higher raw-confidence
   * Over/Under candidate once the combined scores are close. Range compressed from the v1
   * [0, 1] spread to [0.35, 0.6] alongside the lower diversity weight above — together they
   * cut the diversity term's maximum swing roughly 7x (from up to ~12 score points to ~1.8),
   * so it can still resolve genuine near-ties toward variety but can never overrule a clear
   * confidence/EV leader.
   */
  familyDiversityBonus: Object.freeze({
    "Over/Under": 0.35,
    "1X2": 0.45,
    "Double Chance": 0.55,
    BTTS: 0.6,
    Corners: 0.6,
    Cards: 0.6,
    "Correct Score": 0.6
  })
});

function normalizeWeights(weights) {
  const sum = Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  const out = {};
  for (const [k, v] of Object.entries(weights)) out[k] = (Number(v) || 0) / sum;
  return out;
}

export function getRecommendationWeights(overrides = {}) {
  const base = { ...DEFAULT_RECOMMENDATION_WEIGHTS, ...(overrides || {}) };
  const scoreWeights = normalizeWeights({
    ...DEFAULT_RECOMMENDATION_WEIGHTS.scoreWeights,
    ...(overrides?.scoreWeights || {})
  });
  const familyDiversityBonus = {
    ...DEFAULT_RECOMMENDATION_WEIGHTS.familyDiversityBonus,
    ...(overrides?.familyDiversityBonus || {})
  };
  return { ...base, scoreWeights, familyDiversityBonus };
}

export default { DEFAULT_RECOMMENDATION_WEIGHTS, getRecommendationWeights };
