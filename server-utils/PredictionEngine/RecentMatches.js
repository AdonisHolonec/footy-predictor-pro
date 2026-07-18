import { clamp, leagueAvgFromContext, result, neutral } from "./helpers.js";

function intensityFactor(matches, leagueAvg) {
  if (!matches || matches.length === 0) return 1.0;
  const slice = matches.slice(0, 5);
  let gf = 0;
  for (const m of slice) gf += Number(m.goalsFor) || 0;
  const n = slice.length;
  const atkTrend = gf / n / leagueAvg;
  return clamp(0.7 * atkTrend + 0.3, 0.88, 1.12);
}

export function calculate(ctx) {
  const homeMatches = ctx.homeRecentMatches;
  const awayMatches = ctx.awayRecentMatches;
  if ((!homeMatches || homeMatches.length === 0) && (!awayMatches || awayMatches.length === 0)) {
    return neutral({ reason: "no_recent_matches" });
  }
  const leagueAvg = leagueAvgFromContext(ctx);
  const home = intensityFactor(homeMatches, leagueAvg);
  const away = intensityFactor(awayMatches, leagueAvg);
  return result((home + away) / 2, 0.6, { home, away, available: true });
}

export const RecentMatches = { calculate, name: "recentMatches" };
