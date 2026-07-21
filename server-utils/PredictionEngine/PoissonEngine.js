import { computeMatchProbs } from "../math.js";
import { getPredictionWeights } from "./weights.js";
import { result } from "./helpers.js";

/**
 * Poisson / Dixon–Coles probability grid from λ_home / λ_away.
 * Requires ctx.lambdaHome and ctx.lambdaAway (set by the combiner).
 */
export function calculate(ctx) {
  const lambdaHome = Number(ctx.lambdaHome);
  const lambdaAway = Number(ctx.lambdaAway);
  if (!Number.isFinite(lambdaHome) || !Number.isFinite(lambdaAway)) {
    return result(0, 0, { available: false, reason: "missing_lambdas" });
  }

  const weights = getPredictionWeights();
  const fixtureId = ctx.fixtureId ?? 0;
  const out = computeMatchProbs(lambdaHome, lambdaAway, fixtureId, {
    correlation: Number.isFinite(Number(ctx.poissonCorrelation))
      ? Number(ctx.poissonCorrelation)
      : weights.poissonCorrelation,
    rho: ctx.leagueParams?.rho ?? -0.11
  });

  const p1 = Number(out.probs?.p1) || 0;
  const p2 = Number(out.probs?.p2) || 0;

  return result((p1 + p2) / 200, 0.9, {
    probs: out.probs,
    bestScore: out.bestScore,
    bestScoreProb: out.bestScoreProb,
    modelMeta: out.modelMeta,
    lambdaHome,
    lambdaAway,
    available: true
  });
}

export const PoissonEngine = { calculate, name: "poisson" };
