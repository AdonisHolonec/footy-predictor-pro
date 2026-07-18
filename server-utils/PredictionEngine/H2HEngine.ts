/** Typed mirror. Runtime: ./H2HEngine.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, H2HEngine as _mod } from "./H2HEngine.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const H2HEngine = { calculate, name: _mod.name as string };
