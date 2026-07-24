/**
 * λ (lambda) blending helpers — combine Poisson-engine λ with rolling xG λ
 * ahead of probability generation. Consumed by Stage02–Stage09.
 */

import { clampLambda, computeMatchProbs } from "../math.js";
import { deriveXgLambdas } from "../xg/RollingXgModel.js";

/**
 * Blend strength λ toward rolling xG λ.
 * @param {number} lambdaHome
 * @param {number} lambdaAway
 * @param {number|null|undefined} xgHome
 * @param {number|null|undefined} xgAway
 * @param {number} weight 0..1 (expectedGoals weight)
 */
export function blendLambdasWithXg(lambdaHome, lambdaAway, xgHome, xgAway, weight = 0.2) {
  const w = Math.max(0, Math.min(1, Number(weight) || 0));
  const lh = Number(lambdaHome);
  const la = Number(lambdaAway);
  const xh = Number(xgHome);
  const xa = Number(xgAway);
  if (!(w > 0) || !Number.isFinite(lh) || !Number.isFinite(la) || !Number.isFinite(xh) || !Number.isFinite(xa)) {
    return {
      lambdaHome: Number.isFinite(lh) ? clampLambda(lh) : lh,
      lambdaAway: Number.isFinite(la) ? clampLambda(la) : la,
      applied: false,
      weight: w
    };
  }
  return {
    lambdaHome: clampLambda(lh * (1 - w) + xh * w),
    lambdaAway: clampLambda(la * (1 - w) + xa * w),
    applied: true,
    weight: w,
    xgHome: xh,
    xgAway: xa
  };
}

/**
 * Resolve rolling xG λ from market-rolling rows (safe null if unavailable).
 */
export function resolveFixtureXg({
  rollingHome,
  rollingAway,
  leagueAvg,
  homeAdv,
  awayAdv
} = {}) {
  try {
    return deriveXgLambdas({
      rollingHome,
      rollingAway,
      leagueBaseXg: leagueAvg,
      homeAdv,
      awayAdv
    });
  } catch {
    return null;
  }
}

/**
 * Build a Model-Lab `xg` source triple from xG λ (not a copy of Poisson).
 */
export function buildXgSourceProbs(xgHome, xgAway, options = {}) {
  if (!Number.isFinite(Number(xgHome)) || !Number.isFinite(Number(xgAway))) return null;
  const calc = computeMatchProbs(Number(xgHome), Number(xgAway), options.fixtureId || 0, {
    correlation: options.correlation,
    rho: options.rho
  });
  const p = calc?.probs;
  if (!p || !Number.isFinite(p.p1)) return null;
  return { p1: p.p1 / 100, pX: p.pX / 100, p2: p.p2 / 100 };
}
