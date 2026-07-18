/**
 * Detect manually configured weight keys (env overrides).
 * Auto Calibration must never overwrite these — overlays skip locked keys.
 */

function envSet(key) {
  if (typeof process === "undefined") return false;
  const v = process.env?.[key];
  return v !== undefined && String(v).trim() !== "";
}

function camelToEnvSuffix(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase();
}

/** Confidence: CONFIDENCE_WEIGHT_ATTACK … */
export function getConfidenceManualLocks() {
  const keys = [
    "attack",
    "defense",
    "form",
    "recentMatches",
    "standings",
    "referee",
    "injuries",
    "lineups",
    "restDays",
    "homeAdvantage",
    "oddsConsensus",
    "h2h"
  ];
  return keys.filter((k) => envSet(`CONFIDENCE_WEIGHT_${camelToEnvSuffix(k)}`));
}

/** Feature importance priors: FI_PRIOR_ATTACK … */
export function getFeatureImportanceManualLocks() {
  const keys = [
    "attack",
    "defense",
    "form",
    "standings",
    "h2h",
    "referee",
    "odds",
    "restDays",
    "weather",
    "injuries"
  ];
  return keys.filter((k) => envSet(`FI_PRIOR_${camelToEnvSuffix(k)}`));
}

/** Prediction engine: PREDICT_WEIGHT_ATTACK … */
export function getPredictionManualLocks() {
  const keys = [
    "attack",
    "defense",
    "form",
    "homeAdvantage",
    "awayStrength",
    "standings",
    "h2h",
    "referee",
    "restDays",
    "recentMatches",
    "injuries",
    "lineup",
    "odds",
    "motivation",
    "weather",
    "expectedGoals",
    "poissonCorrelation",
    "modularBlend"
  ];
  return keys.filter((k) => envSet(`PREDICT_WEIGHT_${camelToEnvSuffix(k)}`));
}

/** Value engine: VALUE_* style locks if present (optional). */
export function getValueManualLocks() {
  const map = {
    positiveEvPct: "VALUE_POSITIVE_EV_PCT",
    minEdge: "VALUE_MIN_EDGE",
    kellyFraction: "VALUE_KELLY_FRACTION",
    kellyCapPct: "VALUE_KELLY_CAP_PCT"
  };
  return Object.entries(map)
    .filter(([, envKey]) => envSet(envKey))
    .map(([k]) => k);
}

export function locksForKind(kind) {
  if (kind === "confidence") return getConfidenceManualLocks();
  if (kind === "feature_importance") return getFeatureImportanceManualLocks();
  if (kind === "prediction") return getPredictionManualLocks();
  if (kind === "value") return getValueManualLocks();
  return [];
}
