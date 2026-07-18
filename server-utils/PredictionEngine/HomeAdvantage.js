import { result } from "./helpers.js";

export function calculate(ctx) {
  const homeAdv = Number(ctx.leagueParams?.homeAdv) || 1.06;
  const awayAdv = Number(ctx.leagueParams?.awayAdv) || 0.96;
  return result((homeAdv + awayAdv) / 2, 0.9, { homeAdv, awayAdv, home: homeAdv, away: awayAdv });
}

export const HomeAdvantage = { calculate, name: "homeAdvantage" };
