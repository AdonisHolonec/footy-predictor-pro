import type { ModuleScore, PredictionContext, RecentMatch } from "./types.js";
import { clamp, leagueAvgFromContext } from "./_helpers.js";

function intensityFactor(matches: RecentMatch[] | undefined, leagueAvg: number): number {
  if (!matches || matches.length === 0) return 1.0;
  const slice = matches.slice(0, 5);
  let gf = 0;
  for (const m of slice) {
    gf += Number(m.goalsFor) || 0;
  }
  const n = slice.length;
  const atkTrend = gf / n / leagueAvg;
  return clamp(0.7 * atkTrend + 0.3, 0.88, 1.12);
}

/** Recent match intensity / goals trend; neutral 1.0 when data missing. */
export function computeRecentMatches(ctx: PredictionContext): ModuleScore {
  const homeMatches = ctx.homeRecentMatches;
  const awayMatches = ctx.awayRecentMatches;

  if ((!homeMatches || homeMatches.length === 0) && (!awayMatches || awayMatches.length === 0)) {
    return { score: 1.0, detail: { home: 1.0, away: 1.0, available: false } };
  }

  const leagueAvg = leagueAvgFromContext(ctx);
  const home = intensityFactor(homeMatches, leagueAvg);
  const away = intensityFactor(awayMatches, leagueAvg);

  return {
    score: (home + away) / 2,
    detail: { home, away, available: true }
  };
}
