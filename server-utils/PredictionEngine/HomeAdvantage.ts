/** Typed mirror. Runtime: ./HomeAdvantage.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, HomeAdvantage as _mod } from "./HomeAdvantage.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const HomeAdvantage = { calculate, name: _mod.name as string };
