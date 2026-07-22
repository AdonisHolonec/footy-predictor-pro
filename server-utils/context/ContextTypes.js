/**
 * Context Intelligence Layer — shared contracts (runtime).
 *
 * The Context Engine runs inside Stage02 (after feature extraction, before
 * Stage03 λ generation). Each context module consumes ONLY data already
 * present on engineCtx (no re-fetching) and returns a ContextModuleResult.
 *
 * A module signal has two orthogonal axes so it can nudge λ without touching
 * probabilities downstream:
 *   - tilt : -1..+1  home-vs-away directional pull (+ favours home)
 *   - pace : -1..+1  total-goals pull (+ = more goals, - = fewer)
 * plus a 0..100 display `score` (50 = neutral) for dashboards.
 *
 * @typedef {Object} ContextModuleResult
 * @property {string} id            stable module id (e.g. "momentum")
 * @property {string} name          human label
 * @property {number} score         0..100 display score (50 neutral)
 * @property {number} tilt          -1..1 home(+)/away(-) directional signal
 * @property {number} pace          -1..1 fewer(-)/more(+) total goals signal
 * @property {number} confidence    0..1 module self-confidence
 * @property {string} reason        short human explanation
 * @property {boolean} missingData  true when the module had no usable input
 * @property {number} executionTime ms spent in calculate()
 * @property {number} weight        base weight (from ContextWeights)
 * @property {Object} details       opaque diagnostics for admin dashboard
 *
 * @typedef {Object} ContextModule
 * @property {string} id
 * @property {string} name
 * @property {(ctx: Object) => ContextModuleResult} calculate
 *
 * @typedef {Object} ContextResult
 * @property {number} overallScore      0..100 aggregate (50 neutral)
 * @property {number} overallConfidence 0..1
 * @property {number} overallStability  0..1 (1 = modules agree)
 * @property {number} overallRisk       0..1 (1 = high risk / low trust)
 * @property {number} homeMultiplier    λ_home multiplier, bounded ±maxInfluence
 * @property {number} awayMultiplier    λ_away multiplier, bounded ±maxInfluence
 * @property {number} maxInfluence      configured cap (e.g. 0.05)
 * @property {boolean} appliedToLambda  whether the nudge is active
 * @property {ContextModuleResult[]} modules
 * @property {string[]} reasons         top human reasons
 * @property {Object} meta
 */

export const CONTEXT_VERSION = "ctx-v1";

/** Canonical module ids, in registry order. */
export const CONTEXT_MODULE_IDS = Object.freeze([
  "momentum",
  "motivation",
  "fatigue",
  "squad",
  "tactical",
  "referee",
  "weather",
  "market",
  "psychology",
  "league",
  "h2h"
]);

export function clamp(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

export function isNum(n) {
  return Number.isFinite(Number(n));
}

/** tilt/pace in [-1,1] → 0..100 display score (50 neutral). */
export function toDisplayScore(tilt) {
  return Math.round((50 + clamp(tilt, -1, 1) * 50) * 10) / 10;
}

/**
 * Standard module-result factory. Missing/failed modules should call
 * `neutralResult` so the aggregator can down-weight them cleanly.
 */
export function contextResult(id, name, { tilt = 0, pace = 0, confidence = 0, reason = "", missingData = false, details = {} } = {}) {
  const t = clamp(tilt, -1, 1);
  const p = clamp(pace, -1, 1);
  return {
    id,
    name,
    tilt: t,
    pace: p,
    score: toDisplayScore(t),
    confidence: clamp(confidence, 0, 1),
    reason: String(reason || ""),
    missingData: Boolean(missingData),
    executionTime: 0,
    weight: 0,
    details: details && typeof details === "object" ? details : {}
  };
}

export function neutralResult(id, name, reason = "neutral_no_data") {
  return contextResult(id, name, { tilt: 0, pace: 0, confidence: 0, reason, missingData: true });
}

export default { CONTEXT_VERSION, CONTEXT_MODULE_IDS, clamp, isNum, toDisplayScore, contextResult, neutralResult };
