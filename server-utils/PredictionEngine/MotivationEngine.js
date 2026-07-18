import { clamp, result, neutral } from "./helpers.js";

/**
 * Motivation / table pressure proxies.
 * Uses optional homeMotivation/awayMotivation (0..1) or standings rank gap.
 */
export function calculate(ctx) {
  if (ctx.homeMotivation != null || ctx.awayMotivation != null) {
    const hm = clamp(Number(ctx.homeMotivation) || 0.5, 0, 1);
    const am = clamp(Number(ctx.awayMotivation) || 0.5, 0, 1);
    const home = clamp(0.96 + hm * 0.08, 0.94, 1.06);
    const away = clamp(0.96 + am * 0.08, 0.94, 1.06);
    return result((home + away) / 2, 0.4, {
      home,
      away,
      source: "explicit",
      available: true
    });
  }

  const rh = Number(ctx.homeStandingsRow?.rank);
  const ra = Number(ctx.awayStandingsRow?.rank);
  if (!Number.isFinite(rh) || !Number.isFinite(ra)) {
    return neutral({ reason: "motivation_not_provided", extensionPoint: true });
  }

  // Mid-table / relegation / title race heuristic: closer ranks → slight uptick
  const gap = Math.abs(rh - ra);
  const pressure = gap <= 3 ? 1.02 : gap >= 10 ? 0.99 : 1.0;
  return result(pressure, 0.3, {
    home: pressure,
    away: pressure,
    rankHome: rh,
    rankAway: ra,
    source: "standings_rank",
    available: true
  });
}

export const MotivationEngine = { calculate, name: "motivation" };
