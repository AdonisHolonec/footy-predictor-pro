/** Typed mirror. Runtime: ./StandingsEngine.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, StandingsEngine as _mod } from "./StandingsEngine.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const StandingsEngine = { calculate, name: _mod.name as string };
