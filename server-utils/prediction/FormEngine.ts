import { extractFormMultiplier } from "../math.js";
import type { ModuleScore, PredictionContext } from "./types.js";

/** Form multiplier from W/D/L string (delegates to math.extractFormMultiplier). */
export function computeFormEngine(ctx: PredictionContext): ModuleScore {
  const home =
    typeof ctx.hFormMulti === "number"
      ? ctx.hFormMulti
      : extractFormMultiplier(ctx.formHome);
  const away =
    typeof ctx.aFormMulti === "number"
      ? ctx.aFormMulti
      : extractFormMultiplier(ctx.formAway);

  return {
    score: (home + away) / 2,
    detail: { home, away }
  };
}
