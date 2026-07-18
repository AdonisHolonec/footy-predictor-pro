/**
 * Feature engineering — transforms, leakage guards, split helpers.
 * Offline-only utilities. No model training.
 */

import { FEATURE_SCHEMA_VERSION } from "../featureCatalog.js";

/** Columns that must never appear as inputs when predicting pre-match (leakage). */
export const LEAKAGE_COLUMNS = Object.freeze([
  "label_1x2",
  "label_gg",
  "label_over25",
  "result_1x2",
  "result_gg",
  "result_o25",
  "ft_home",
  "ft_away",
  "goals_home",
  "goals_away",
  "settled_at",
  "actual_score"
]);

/**
 * Drop leakage / label keys from a feature vector.
 * @param {Record<string, number|string|boolean|null>} vector
 */
export function stripLeakage(vector = {}) {
  const out = { ...vector };
  for (const k of LEAKAGE_COLUMNS) {
    if (k in out) delete out[k];
  }
  return out;
}

/**
 * Clip numeric features to [lo, hi] (robustness for tree / NN inputs).
 * @param {Record<string, number>} vector
 * @param {Record<string, [number, number]>} bounds
 */
export function clipFeatures(vector = {}, bounds = {}) {
  const out = { ...vector };
  for (const [k, pair] of Object.entries(bounds)) {
    if (!(k in out)) continue;
    const [lo, hi] = pair;
    const v = Number(out[k]);
    if (!Number.isFinite(v)) {
      out[k] = 0;
      continue;
    }
    out[k] = Math.min(hi, Math.max(lo, v));
  }
  return out;
}

/** Default safe bounds for fs-v1 continuous features. */
export const DEFAULT_CLIP_BOUNDS = Object.freeze({
  poisson_log_ratio_1X: [-5, 5],
  poisson_log_ratio_2X: [-5, 5],
  market_log_ratio_1X: [-5, 5],
  market_log_ratio_2X: [-5, 5],
  elo_spread_norm: [-3, 3],
  data_quality_centered: [-1, 1],
  log_home_adv: [-2, 2],
  rho: [-0.5, 0.5],
  p1: [0, 1],
  pX: [0, 1],
  p2: [0, 1],
  pO25: [0, 1],
  pGG: [0, 1],
  lambda_home: [0, 6],
  lambda_away: [0, 6],
  odds_home: [1.01, 50],
  odds_draw: [1.01, 50],
  odds_away: [1.01, 50],
  recommended_confidence: [0, 1],
  value_ev: [-1, 2],
  value_kelly: [0, 1],
  confidence_engine_overall: [0, 1]
});

/**
 * Standardize using mean/std maps (fitted offline; applied here only).
 * @param {Record<string, number>} vector
 * @param {{ mean: Record<string, number>, std: Record<string, number> }} stats
 */
export function standardize(vector = {}, stats = { mean: {}, std: {} }) {
  const out = {};
  for (const [k, v] of Object.entries(vector)) {
    const m = Number(stats.mean?.[k] ?? 0);
    const s = Number(stats.std?.[k] ?? 1);
    const denom = Math.abs(s) < 1e-9 ? 1 : s;
    out[k] = (Number(v) - m) / denom;
  }
  return out;
}

/**
 * Time-based train/valid/test split by kickoff (no random shuffle — avoids leakage).
 * @param {{ meta?: { kickoffAt?: string }, kickoffAt?: string }[]} examples
 * @param {{ trainEnd: string, validEnd: string }} cuts ISO date strings
 */
export function assignTimeSplits(examples = [], cuts = { trainEnd: "", validEnd: "" }) {
  const trainEnd = new Date(cuts.trainEnd).getTime();
  const validEnd = new Date(cuts.validEnd).getTime();
  return examples.map((ex) => {
    const t = new Date(ex.meta?.kickoffAt || ex.kickoffAt || 0).getTime();
    let split = "holdout";
    if (Number.isFinite(t) && t <= trainEnd) split = "train";
    else if (Number.isFinite(t) && t <= validEnd) split = "valid";
    else if (Number.isFinite(t)) split = "test";
    return { ...ex, split };
  });
}

/**
 * Pipeline: strip leakage → clip → optional standardize.
 * @param {Record<string, number>} vector
 * @param {{ standardizeStats?: object }} opts
 */
export function engineerFeatures(vector, opts = {}) {
  let v = stripLeakage(vector);
  v = clipFeatures(v, DEFAULT_CLIP_BOUNDS);
  if (opts.standardizeStats) {
    v = standardize(v, opts.standardizeStats);
  }
  return {
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    vector: v,
    names: Object.keys(v)
  };
}
