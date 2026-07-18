/** Typed mirror. Runtime: ./PoissonEngine.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, PoissonEngine as _mod } from "./PoissonEngine.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const PoissonEngine = { calculate, name: _mod.name as string };
