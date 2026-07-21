import { clamp, leagueAvgFromContext, result, neutral } from "./helpers.js";

export function calculate(ctx) {
  const stats = ctx.refereeStats;
  if (!stats || !Number.isFinite(Number(stats.avgGoals))) {
    // Cards-only referee sample still usable for cards markets / mild λ nudge.
    if (stats && Number.isFinite(Number(stats.avgCards)) && Number(stats.avgCards) > 0) {
      const cardsBase = Math.max(2, Number(ctx.leagueParams?.cardsAvgTotal ?? ctx.leagueParams?.cards) || 4.2);
      const cardsBoost = clamp(Number(stats.avgCards) / cardsBase, 0.88, 1.12);
      return result(cardsBoost, 0.35, {
        home: cardsBoost,
        away: cardsBoost,
        available: true,
        refereeName: ctx.refereeName || stats.name,
        avgCards: stats.avgCards,
        cardsBoost,
        reason: "cards_only_referee"
      });
    }
    return neutral({ refereeName: ctx.refereeName, reason: "no_referee_stats" });
  }

  const leagueTotalAvg = leagueAvgFromContext(ctx) * 2;
  const boost = clamp(Number(stats.avgGoals) / leagueTotalAvg, 0.92, 1.08);
  const cardsBase = Math.max(2, Number(ctx.leagueParams?.cardsAvgTotal ?? ctx.leagueParams?.cards) || 4.2);
  const cardsBoost = Number.isFinite(Number(stats.avgCards)) && Number(stats.avgCards) > 0
    ? clamp(Number(stats.avgCards) / cardsBase, 0.88, 1.12)
    : boost;

  return result(boost, 0.5, {
    home: boost,
    away: boost,
    available: true,
    refereeName: ctx.refereeName || stats.name,
    avgGoals: stats.avgGoals,
    avgCards: Number.isFinite(Number(stats.avgCards)) ? Number(stats.avgCards) : undefined,
    cardsBoost
  });
}

export const RefereeEngine = { calculate, name: "referee" };
