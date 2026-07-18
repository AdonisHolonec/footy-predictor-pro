/**
 * Prior weights for Feature Importance Engine (contribution attribution).
 * Used only for explainability / ML storage — does not change λ or picks.
 *
 * Resolution: DEFAULT → env manual → auto-calibration overlay (skips env-locked keys).
 */

import { getFeatureImportanceManualLocks } from "../calibration/manualLocks.js";
import { getRuntimeOverlay } from "../calibration/overlayRuntime.js";
import { mergeWithAutoOverlay } from "../calibration/mergeWeights.js";

export const FEATURE_IMPORTANCE_KEYS = Object.freeze([
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
]);

/** Relative priors — renormalized per match after activation. */
export const DEFAULT_FEATURE_IMPORTANCE_PRIORS = Object.freeze({
  attack: 0.22,
  defense: 0.18,
  form: 0.16,
  standings: 0.1,
  h2h: 0.07,
  referee: 0.05,
  odds: 0.12,
  restDays: 0.04,
  weather: 0.03,
  injuries: 0.1
});

export const FEATURE_IMPORTANCE_LABELS = Object.freeze({
  attack: "Attack",
  defense: "Defense",
  form: "Form",
  standings: "Standings",
  h2h: "H2H",
  referee: "Referee",
  odds: "Odds",
  restDays: "Rest Days",
  weather: "Weather",
  injuries: "Injuries"
});

function envNum(key, fallback) {
  const raw = typeof process !== "undefined" ? process.env?.[key] : undefined;
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getFeatureImportancePriors() {
  const d = DEFAULT_FEATURE_IMPORTANCE_PRIORS;
  const manual = {
    attack: envNum("FI_PRIOR_ATTACK", d.attack),
    defense: envNum("FI_PRIOR_DEFENSE", d.defense),
    form: envNum("FI_PRIOR_FORM", d.form),
    standings: envNum("FI_PRIOR_STANDINGS", d.standings),
    h2h: envNum("FI_PRIOR_H2H", d.h2h),
    referee: envNum("FI_PRIOR_REFEREE", d.referee),
    odds: envNum("FI_PRIOR_ODDS", d.odds),
    restDays: envNum("FI_PRIOR_REST_DAYS", d.restDays),
    weather: envNum("FI_PRIOR_WEATHER", d.weather),
    injuries: envNum("FI_PRIOR_INJURIES", d.injuries)
  };
  return mergeWithAutoOverlay(
    manual,
    getRuntimeOverlay("feature_importance"),
    getFeatureImportanceManualLocks()
  );
}
