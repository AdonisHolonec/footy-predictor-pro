import { clamp, leagueAvgFromContext } from "./_helpers.js";

/** Referee tendency score from stats; neutral 1.0 when unavailable. */
export function computeRefereeEngine(ctx) {
  const stats = ctx.refereeStats;
  if (!stats || !Number.isFinite(Number(stats.avgGoals))) {
    return {
      score: 1.0,
      detail: { home: 1.0, away: 1.0, available: false, refereeName: ctx.refereeName }
    };
  }

  const leagueTotalAvg = leagueAvgFromContext(ctx) * 2;
  const boost = clamp(Number(stats.avgGoals) / leagueTotalAvg, 0.92, 1.08);

  return {
    score: boost,
    detail: {
      home: boost,
      away: boost,
      available: true,
      refereeName: ctx.refereeName || stats.name,
      avgGoals: stats.avgGoals
    }
  };
}
