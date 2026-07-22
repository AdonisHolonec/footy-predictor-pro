/**
 * Context module base weights + global tuning knobs.
 *
 * Every weight and flag is env-configurable so modules can be tuned or
 * disabled in production without a code change:
 *
 *   CONTEXT_ENGINE_ENABLED        master switch (default "1")
 *   CONTEXT_APPLY_TO_LAMBDA       apply the λ nudge (default "1")
 *   CONTEXT_MAX_INFLUENCE         max ± λ multiplier, e.g. 0.05 (default 0.05)
 *   CONTEXT_WEIGHT_<ID>           base weight override per module
 *   CONTEXT_MODULE_<ID>           per-module enable flag (default "1")
 *
 * Weights are relative; the aggregator normalises by the sum of the
 * *effective* weights (base × confidence × availability), so absolute
 * magnitudes only matter in ratio.
 */

import { CONTEXT_MODULE_IDS } from "./ContextTypes.js";

/** Relative influence of each module on the aggregate context signal. */
export const DEFAULT_CONTEXT_WEIGHTS = Object.freeze({
  momentum: 1.0,
  motivation: 0.7,
  fatigue: 0.6,
  squad: 0.8,
  tactical: 0.4,
  referee: 0.25,
  weather: 0.3,
  market: 0.5,
  psychology: 0.45,
  league: 0.35,
  h2h: 0.5
});

export const DEFAULT_MAX_INFLUENCE = 0.05;

function envRaw(name) {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

function envNum(name, fallback) {
  const raw = envRaw(name);
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envFlag(name, fallback = true) {
  const raw = envRaw(name);
  if (raw === undefined || raw === "") return fallback;
  const v = String(raw).toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/** Master engine switch. */
export function isContextEngineEnabled() {
  return envFlag("CONTEXT_ENGINE_ENABLED", true);
}

/** Whether the aggregate nudge is applied to λ (diagnostics still computed when false). */
export function isLambdaApplyEnabled() {
  return envFlag("CONTEXT_APPLY_TO_LAMBDA", true);
}

/** Per-module feature flag. */
export function isModuleEnabled(id) {
  const key = `CONTEXT_MODULE_${String(id).toUpperCase()}`;
  return envFlag(key, true);
}

/** Configured maximum ± λ influence, clamped to a sane hard ceiling of 15%. */
export function getMaxInfluence() {
  const v = envNum("CONTEXT_MAX_INFLUENCE", DEFAULT_MAX_INFLUENCE);
  return Math.max(0, Math.min(0.15, v));
}

/** Resolve base weight for a module (env override → default). */
export function getModuleWeight(id) {
  const key = `CONTEXT_WEIGHT_${String(id).toUpperCase()}`;
  const fallback = DEFAULT_CONTEXT_WEIGHTS[id] ?? 0.3;
  return Math.max(0, envNum(key, fallback));
}

/** Full weight map for all known modules (post env-resolution). */
export function getContextWeights() {
  const out = {};
  for (const id of CONTEXT_MODULE_IDS) out[id] = getModuleWeight(id);
  return out;
}

export default {
  DEFAULT_CONTEXT_WEIGHTS,
  DEFAULT_MAX_INFLUENCE,
  isContextEngineEnabled,
  isLambdaApplyEnabled,
  isModuleEnabled,
  getMaxInfluence,
  getModuleWeight,
  getContextWeights
};
