import { extractFormMultiplier } from "../math.js";

/** Form multiplier from W/D/L string (delegates to math.extractFormMultiplier). */
export function computeFormEngine(ctx) {
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
