import { extractFormMultiplier } from "../math.js";
import { result } from "./helpers.js";

export function calculate(ctx) {
  const home =
    typeof ctx.hFormMulti === "number" ? ctx.hFormMulti : extractFormMultiplier(ctx.formHome);
  const away =
    typeof ctx.aFormMulti === "number" ? ctx.aFormMulti : extractFormMultiplier(ctx.formAway);
  const hasForm = Boolean(ctx.formHome || ctx.formAway || ctx.hFormMulti != null || ctx.aFormMulti != null);

  return result((home + away) / 2, hasForm ? 0.75 : 0.4, { home, away, available: hasForm });
}

export const FormEngine = { calculate, name: "form" };
