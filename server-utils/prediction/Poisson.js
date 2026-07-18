import { computeMatchProbs } from "../math.js";

/** Wraps computeMatchProbs from math.js; returns score + full probability grid. */
export function computePoisson(lambdaHome, lambdaAway, fixtureId = 0, options = {}) {
  const result = computeMatchProbs(lambdaHome, lambdaAway, fixtureId, options);
  const p1 = Number(result.probs?.p1) || 0;
  const p2 = Number(result.probs?.p2) || 0;

  return {
    score: (p1 + p2) / 200,
    probs: result.probs,
    bestScore: result.bestScore,
    bestScoreProb: result.bestScoreProb,
    detail: result.modelMeta
  };
}
