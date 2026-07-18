import type { ModuleScore, PredictionContext } from "./types.js";

/** Home/away advantage multipliers from league parameters. */
export function computeHomeAdvantage(ctx: PredictionContext): ModuleScore {
  const homeAdv = Number(ctx.leagueParams?.homeAdv) || 1.06;
  const awayAdv = Number(ctx.leagueParams?.awayAdv) || 0.96;

  return {
    score: (homeAdv + awayAdv) / 2,
    detail: { homeAdv, awayAdv }
  };
}
