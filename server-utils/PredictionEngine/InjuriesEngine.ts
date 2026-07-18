/** Typed mirror. Runtime: ./InjuriesEngine.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, InjuriesEngine as _mod } from "./InjuriesEngine.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const InjuriesEngine = { calculate, name: _mod.name as string };
