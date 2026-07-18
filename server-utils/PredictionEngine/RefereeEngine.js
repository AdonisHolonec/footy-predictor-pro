import { clamp, leagueAvgFromContext, result, neutral } from "./helpers.js";

export function calculate(ctx) {
  const stats = ctx.refereeStats;
  if (!stats || !Number.isFinite(Number(stats.avgGoals))) {
    return neutral({ refereeName: ctx.refereeName, reason: "no_referee_stats" });
  }

  const leagueTotalAvg = leagueAvgFromContext(ctx) * 2;
  const boost = clamp(Number(stats.avgGoals) / leagueTotalAvg, 0.92, 1.08);

  return result(boost, 0.5, {
    home: boost,
    away: boost,
    available: true,
    refereeName: ctx.refereeName || stats.name,
    avgGoals: stats.avgGoals
  });
}

export const RefereeEngine = { calculate, name: "referee" };
