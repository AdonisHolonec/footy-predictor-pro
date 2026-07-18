/** Typed mirror. Runtime: ./OddsEngine.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, OddsEngine as _mod } from "./OddsEngine.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const OddsEngine = { calculate, name: _mod.name as string };
