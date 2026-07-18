/** Typed mirror. Runtime: ./AwayStrength.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, AwayStrength as _mod } from "./AwayStrength.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const AwayStrength = { calculate, name: _mod.name as string };
