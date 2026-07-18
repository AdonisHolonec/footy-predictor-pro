/** Typed mirror. Runtime: ./RecentMatches.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, RecentMatches as _mod } from "./RecentMatches.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const RecentMatches = { calculate, name: _mod.name as string };
