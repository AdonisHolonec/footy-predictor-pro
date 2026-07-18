import type { ModuleScore, PredictionContext } from "./types.js";
import { clamp, leagueAvgFromContext } from "./_helpers.js";

/** Standings-based strength from points-per-game and goal difference. */
export function computeStandingsEngine(ctx: PredictionContext): ModuleScore {
  const rowH = ctx.homeStandingsRow;
  const rowA = ctx.awayStandingsRow;
  if (!rowH || !rowA) {
    return { score: 1.0, detail: { home: 1.0, away: 1.0, available: false } };
  }

  const leagueAvg = leagueAvgFromContext(ctx);
  const phH = Math.max(1, Number(rowH.all?.played) || 1);
  const phA = Math.max(1, Number(rowA.all?.played) || 1);
  const ptsH = Number(rowH.all?.points) / phH;
  const ptsA = Number(rowA.all?.points) / phA;
  const gdH = (Number(rowH.all?.goals?.for) - Number(rowH.all?.goals?.against)) / phH;
  const gdA = (Number(rowA.all?.goals?.for) - Number(rowA.all?.goals?.against)) / phA;

  const avgPtsRate = 1.5;
  const home = clamp(1 + 0.05 * ((ptsH - avgPtsRate) / avgPtsRate) + 0.03 * (gdH / leagueAvg), 0.85, 1.15);
  const away = clamp(1 + 0.05 * ((ptsA - avgPtsRate) / avgPtsRate) + 0.03 * (gdA / leagueAvg), 0.85, 1.15);

  return {
    score: (home + away) / 2,
    detail: { home, away, ptsH, ptsA, gdH, gdA, available: true }
  };
}
