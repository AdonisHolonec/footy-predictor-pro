/** Typed mirror. Runtime: ./DefenseStrength.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, DefenseStrength as _mod } from "./DefenseStrength.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const DefenseStrength = { calculate, name: _mod.name as string };
