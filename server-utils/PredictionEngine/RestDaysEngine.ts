/** Typed mirror. Runtime: ./RestDaysEngine.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, RestDaysEngine as _mod } from "./RestDaysEngine.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const RestDaysEngine = { calculate, name: _mod.name as string };
