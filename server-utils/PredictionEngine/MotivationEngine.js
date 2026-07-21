import { clamp, result, neutral } from "./helpers.js";

/**
 * Motivation / table pressure proxies.
 * Uses optional homeMotivation/awayMotivation (0..1) or standings rank gap.
 * Rank path is directional: underdog slight boost, favourite slight damp when gap is large.
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

  const gap = Math.abs(rh - ra);
  // Closer ranks → mutual pressure; large gap → underdog lift / favourite damp.
  let home = 1;
  let away = 1;
  if (gap <= 3) {
    home = 1.02;
    away = 1.02;
  } else if (gap >= 8) {
    const homeUnderdog = rh > ra;
    home = homeUnderdog ? 1.025 : 0.985;
    away = homeUnderdog ? 0.985 : 1.025;
  }

  return result((home + away) / 2, 0.3, {
    home,
    away,
    rankHome: rh,
    rankAway: ra,
    gap,
    source: "standings_rank",
    available: true
  });
}

export const MotivationEngine = { calculate, name: "motivation" };
