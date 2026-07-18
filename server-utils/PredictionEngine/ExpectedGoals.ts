/** Typed mirror. Runtime: ./ExpectedGoals.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, ExpectedGoals as _mod } from "./ExpectedGoals.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const ExpectedGoals = { calculate, name: _mod.name as string };
