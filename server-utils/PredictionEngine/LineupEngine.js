import { clamp, result, neutral } from "./helpers.js";

/**
 * Lineup confirmation / missing key players.
 * Neutral until lineups are populated on PredictionContext.
 */
export function calculate(ctx) {
  const homeL = ctx.homeLineup;
  const awayL = ctx.awayLineup;
  if (!homeL && !awayL) {
    return neutral({ reason: "lineups_not_provided", extensionPoint: true });
  }

  function sideFactor(lineup) {
    if (!lineup) return 1;
    let f = 1;
    if (lineup.confirmed === false) f *= 0.98;
    const missing = Number(lineup.missingKeyPlayers) || 0;
    f *= clamp(1 - missing * 0.025, 0.9, 1.05);
    return f;
  }

  const home = sideFactor(homeL);
  const away = sideFactor(awayL);
  const conf = (homeL?.confirmed || awayL?.confirmed) ? 0.55 : 0.35;
  return result((home + away) / 2, conf, {
    home,
    away,
    homeFormation: homeL?.formation || null,
    awayFormation: awayL?.formation || null,
    available: true
  });
}

export const LineupEngine = { calculate, name: "lineup" };
