/**
 * Context Intelligence Layer — aggregator.
 *
 * Runs the implemented context modules against engineCtx, combines their
 * tilt/pace signals into λ multipliers bounded by ±maxInfluence, and
 * exposes the diagnostics Stage03 attaches to the fixture for the admin
 * dashboard.
 */

import {
  CONTEXT_MODULE_IDS,
  CONTEXT_VERSION,
  clamp,
  toDisplayScore,
  neutralResult
} from "./ContextTypes.js";
import {
  isContextEngineEnabled,
  isLambdaApplyEnabled,
  isModuleEnabled,
  getMaxInfluence,
  getModuleWeight
} from "./ContextWeights.js";
import MomentumContext from "./modules/MomentumContext.js";
import MotivationContext from "./modules/MotivationContext.js";
import FatigueContext from "./modules/FatigueContext.js";
import SquadContext from "./modules/SquadContext.js";
import TacticalContext from "./modules/TacticalContext.js";
import RefereeContext from "./modules/RefereeContext.js";
import WeatherContext from "./modules/WeatherContext.js";

const REGISTRY = [
  MomentumContext,
  MotivationContext,
  FatigueContext,
  SquadContext,
  TacticalContext,
  RefereeContext,
  WeatherContext
];

/** Ids declared in ContextTypes.CONTEXT_MODULE_IDS with no module implementation yet. */
export const UNIMPLEMENTED_MODULE_IDS = Object.freeze(
  CONTEXT_MODULE_IDS.filter((id) => !REGISTRY.some((mod) => mod.id === id))
);

function runModule(mod, engineCtx) {
  const start = Date.now();
  try {
    const r = mod.calculate(engineCtx);
    if (!r || typeof r !== "object") return null;
    return { ...r, executionTime: Date.now() - start };
  } catch {
    return null;
  }
}

function neutralContextResult(maxInfluence, meta) {
  return {
    overallScore: 50,
    overallConfidence: 0,
    overallStability: 1,
    overallRisk: 1,
    homeMultiplier: 1,
    awayMultiplier: 1,
    maxInfluence,
    appliedToLambda: false,
    modules: [],
    reasons: [],
    meta
  };
}

/**
 * Run every enabled, implemented context module against engineCtx and
 * aggregate their tilt/pace into bounded λ multipliers.
 * @param {object} engineCtx
 * @returns {import("./ContextTypes.js").ContextResult}
 */
export function evaluateContext(engineCtx) {
  const maxInfluence = getMaxInfluence();
  const engineEnabled = isContextEngineEnabled();
  const meta = {
    version: CONTEXT_VERSION,
    engineEnabled,
    implementedModules: REGISTRY.map((mod) => mod.id),
    unimplementedModules: UNIMPLEMENTED_MODULE_IDS
  };

  if (!engineEnabled) return neutralContextResult(maxInfluence, meta);

  const modules = [];
  for (const mod of REGISTRY) {
    if (!isModuleEnabled(mod.id)) continue;
    const weight = getModuleWeight(mod.id);
    const result = runModule(mod, engineCtx) || neutralResult(mod.id, mod.name, "module_error");
    modules.push({ ...result, weight });
  }

  let sumBaseWeight = 0;
  let sumEffWeight = 0;
  let tiltAcc = 0;
  let paceAcc = 0;
  for (const m of modules) {
    sumBaseWeight += m.weight;
    const eff = m.missingData ? 0 : m.weight * m.confidence;
    sumEffWeight += eff;
    tiltAcc += eff * m.tilt;
    paceAcc += eff * m.pace;
  }

  const weightedTilt = sumEffWeight > 0 ? clamp(tiltAcc / sumEffWeight, -1, 1) : 0;
  const weightedPace = sumEffWeight > 0 ? clamp(paceAcc / sumEffWeight, -1, 1) : 0;
  const overallConfidence = sumBaseWeight > 0 ? clamp(sumEffWeight / sumBaseWeight, 0, 1) : 0;

  // Agreement proxy: weighted spread of each module's tilt around the
  // aggregate — tight spread (modules pulling the same way) reads as stable.
  const active = modules.filter((m) => !m.missingData);
  let overallStability = 1;
  if (active.length >= 2) {
    let varAcc = 0;
    let varW = 0;
    for (const m of active) {
      const w = m.weight * m.confidence;
      varAcc += w * (m.tilt - weightedTilt) ** 2;
      varW += w;
    }
    const variance = varW > 0 ? varAcc / varW : 0;
    overallStability = clamp(1 - Math.sqrt(variance), 0, 1);
  }

  const overallRisk = clamp(1 - (overallConfidence * 0.5 + overallStability * 0.5), 0, 1);

  // pace pulls both lambdas the same direction; tilt pulls them apart.
  const homeSignal = clamp((weightedTilt + weightedPace) / 2, -1, 1);
  const awaySignal = clamp((-weightedTilt + weightedPace) / 2, -1, 1);

  const reasons = modules
    .filter((m) => !m.missingData)
    .map((m) => ({ reason: m.reason, magnitude: Math.abs(m.tilt * m.weight) + Math.abs(m.pace * m.weight) }))
    .filter((r) => r.reason && r.magnitude > 0.02)
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 3)
    .map((r) => r.reason);

  return {
    overallScore: toDisplayScore(weightedTilt),
    overallConfidence,
    overallStability,
    overallRisk,
    homeMultiplier: 1 + homeSignal * maxInfluence,
    awayMultiplier: 1 + awaySignal * maxInfluence,
    maxInfluence,
    appliedToLambda: isLambdaApplyEnabled(),
    modules,
    reasons,
    meta
  };
}

/**
 * Evaluate context and, if enabled, apply the bounded nudge to a λ pair.
 * Always returns lambdas (nudged or not) alongside the diagnostics.
 */
export function applyContextToLambdas(engineCtx, lambdaHome, lambdaAway) {
  const contextResult = evaluateContext(engineCtx || {});
  if (!contextResult.appliedToLambda) {
    return { lambdaHome, lambdaAway, contextResult };
  }
  return {
    lambdaHome: lambdaHome * contextResult.homeMultiplier,
    lambdaAway: lambdaAway * contextResult.awayMultiplier,
    contextResult
  };
}

export default { evaluateContext, applyContextToLambdas, UNIMPLEMENTED_MODULE_IDS };
