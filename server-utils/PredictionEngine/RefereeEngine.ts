/** Typed mirror. Runtime: ./RefereeEngine.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, RefereeEngine as _mod } from "./RefereeEngine.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const RefereeEngine = { calculate, name: _mod.name as string };
