/** Typed mirror. Runtime: ./RecommendationEngine.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, RecommendationEngine as _mod } from "./RecommendationEngine.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const RecommendationEngine = { calculate, name: _mod.name as string };
