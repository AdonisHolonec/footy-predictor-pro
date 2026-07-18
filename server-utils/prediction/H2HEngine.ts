import type { ModuleScore, PredictionContext } from "./types.js";
import { clamp, leagueAvgFromContext } from "./_helpers.js";

/** Head-to-head goal trend; neutral 1.0 when fixtures are missing. */
export function computeH2HEngine(ctx: PredictionContext): ModuleScore {
  const fixtures = ctx.h2hFixtures;
  if (!fixtures || fixtures.length === 0) {
    return { score: 1.0, detail: { home: 1.0, away: 1.0, available: false } };
  }

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

  if (count === 0) {
    return { score: 1.0, detail: { home: 1.0, away: 1.0, available: false } };
  }

  const leagueAvg = leagueAvgFromContext(ctx);
  const avgHome = homeGoals / count;
  const avgAway = awayGoals / count;
  const home = clamp(avgHome / leagueAvg, 0.85, 1.15);
  const away = clamp(avgAway / leagueAvg, 0.85, 1.15);

  return {
    score: (home + away) / 2,
    detail: { home, away, count, avgHome, avgAway, available: true }
  };
}
