/**
 * Predictor V2 — canonical pipeline contract.
 *
 * Logical stages (enrichment modules feed λ inside PredictionEngine.build):
 *   Fetch → Cache → Features → Prediction Engine → Poisson → Elo → xG →
 *   Injuries → Weather → Referee → Lineups → Rest Days → Motivation →
 *   Calibration → Confidence → Recommendation → Feature Importance → Prediction
 *
 * Physical order in api/predict.js folds Injuries…Motivation into the engine
 * before Poisson (correct for λ), then runs Elo / xG blend / Calibration /
 * Confidence / Recommendation / Feature Importance as post-λ stages.
 */

import { clampLambda, computeMatchProbs } from "../math.js";
import { deriveXgLambdas } from "../xg/RollingXgModel.js";

export const PREDICTOR_V2_VERSION = "predictor-v2.1";

export const PIPELINE_STAGES = Object.freeze([
  "fetch",
  "cache",
  "features",
  "predictionEngine",
  "poisson",
  "elo",
  "xg",
  "injuries",
  "weather",
  "referee",
  "lineups",
  "restDays",
  "motivation",
  "calibration",
  "confidence",
  "recommendation",
  "featureImportance",
  "prediction"
]);

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

/**
 * Compact audit trace attached to modelMeta.pipeline.
 */
export function buildPipelineTrace(flags = {}) {
  const stages = {};
  for (const id of PIPELINE_STAGES) {
    const f = flags[id];
    stages[id] = {
      status: f?.status || (f?.ok === false ? "skipped" : f?.ok ? "ok" : "pending"),
      detail: f?.detail || null
    };
  }
  return {
    version: PREDICTOR_V2_VERSION,
    stages,
    summary: PIPELINE_STAGES.map((id) => `${id}:${stages[id].status}`).join(" → ")
  };
}

export const PredictorV2 = {
  version: PREDICTOR_V2_VERSION,
  stages: PIPELINE_STAGES,
  blendLambdasWithXg,
  resolveFixtureXg,
  buildXgSourceProbs,
  buildPipelineTrace
};

export default PredictorV2;
