/** Typed mirror. Runtime: ./MotivationEngine.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, MotivationEngine as _mod } from "./MotivationEngine.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const MotivationEngine = { calculate, name: _mod.name as string };
