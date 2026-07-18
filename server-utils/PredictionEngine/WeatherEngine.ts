/** Typed mirror. Runtime: ./WeatherEngine.js */
import type { ModuleResult, PredictionContext } from "./types.js";
import { calculate as _calculate, WeatherEngine as _mod } from "./WeatherEngine.js";
export function calculate(ctx: PredictionContext): ModuleResult {
  return _calculate(ctx);
}
export const WeatherEngine = { calculate, name: _mod.name as string };
