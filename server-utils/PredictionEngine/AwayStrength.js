import { clamp, leagueAvgFromContext, result, neutral } from "./helpers.js";

/**
 * Away-side relative strength: away attack vs home defense split.
 * Neutral contribution unless PREDICT_WEIGHT_AWAY_STRENGTH > 0 and blend enabled.
 */
export function calculate(ctx) {
  if (!ctx?.hStats || !ctx?.aStats) return neutral({ reason: "missing_stats" });

  const leagueAvg = leagueAvgFromContext(ctx);
  const atkAway = Number(ctx.aStats.gfAway) || leagueAvg;
  const defHome = Number(ctx.hStats.gaHome) || leagueAvg;
  const home = clamp(1 + 0.04 * ((defHome / leagueAvg) - 1), 0.88, 1.12);
  const away = clamp(1 + 0.04 * ((atkAway / leagueAvg) - 1), 0.88, 1.12);

  return result((home + away) / 2, 0.55, {
    home,
    away,
    atkAway,
    defHome,
    leagueAvg,
    available: true
  });
}

export const AwayStrength = { calculate, name: "awayStrength" };
