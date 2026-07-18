/** Typed mirror. Runtime: ./AttackStrength.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, AttackStrength as _mod } from "./AttackStrength.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const AttackStrength = { calculate, name: _mod.name as string };
