/** Typed mirror. Runtime: ./ConfidenceEngine.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, ConfidenceEngine as _mod } from "./ConfidenceEngine.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const ConfidenceEngine = { calculate, name: _mod.name as string };
