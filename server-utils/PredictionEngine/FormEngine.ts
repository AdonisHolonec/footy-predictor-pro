/** Typed mirror. Runtime: ./FormEngine.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, FormEngine as _mod } from "./FormEngine.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const FormEngine = { calculate, name: _mod.name as string };
