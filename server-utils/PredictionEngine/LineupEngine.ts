/** Typed mirror. Runtime: ./LineupEngine.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, LineupEngine as _mod } from "./LineupEngine.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const LineupEngine = { calculate, name: _mod.name as string };
