import { clamp, result } from "./helpers.js";

/**
 * Pipeline confidence from module confidences + data completeness.
 * Independent of server-utils/confidence (UI explanation engine).
 * Does not alter λ — diagnostic score only (weight unused in combine).
 */
export function calculate(ctx) {
  const modules = ctx._moduleResults && typeof ctx._moduleResults === "object" ? ctx._moduleResults : {};
  const entries = Object.values(modules);
  if (entries.length === 0) {
    return result(0.5, 0.3, { overall: 0.5, available: false, reason: "no_modules" });
  }

  let sum = 0;
  let n = 0;
  let availableCount = 0;
  for (const m of entries) {
    const c = Number(m?.confidence);
    if (!Number.isFinite(c)) continue;
    sum += c;
    n += 1;
    if (m?.details?.available !== false) availableCount += 1;
  }

  const avgConf = n > 0 ? sum / n : 0.5;
  const coverage = entries.length > 0 ? availableCount / entries.length : 0;
  const overall = clamp(0.6 * avgConf + 0.4 * coverage, 0, 1);

  return result(overall, overall, {
    overall,
    avgModuleConfidence: avgConf,
    coverage,
    moduleCount: entries.length,
    availableCount,
    available: true
  });
}

export const ConfidenceEngine = { calculate, name: "confidence" };
