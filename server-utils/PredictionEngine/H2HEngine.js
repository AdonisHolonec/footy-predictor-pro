import { clamp, leagueAvgFromContext, result, neutral } from "./helpers.js";

export function calculate(ctx) {
  const fixtures = ctx.h2hFixtures;
  if (!fixtures || fixtures.length === 0) return neutral({ reason: "no_h2h" });

  const homeId = String(ctx.homeTeamId ?? "");
  let homeGoals = 0;
  let awayGoals = 0;
  let count = 0;

  for (const f of fixtures) {
    const gh = Number(f.goals?.home);
    const ga = Number(f.goals?.away);
    if (!Number.isFinite(gh) || !Number.isFinite(ga)) continue;
    const hId = String(f.teams?.home?.id ?? "");
    if (hId === homeId) {
      homeGoals += gh;
      awayGoals += ga;
    } else {
      homeGoals += ga;
      awayGoals += gh;
    }
    count += 1;
  }

  if (count === 0) return neutral({ reason: "h2h_unscored" });

  const leagueAvg = leagueAvgFromContext(ctx);
  const avgHome = homeGoals / count;
  const avgAway = awayGoals / count;
  const home = clamp(avgHome / leagueAvg, 0.85, 1.15);
  const away = clamp(avgAway / leagueAvg, 0.85, 1.15);

  return result((home + away) / 2, Math.min(0.85, 0.4 + count * 0.05), {
    home,
    away,
    count,
    avgHome,
    avgAway,
    available: true
  });
}

export const H2HEngine = { calculate, name: "h2h" };
