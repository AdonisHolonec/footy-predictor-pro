/**
 * Module 2 — Motivation.
 * Title race / promotion / relegation / European qualification / must-win,
 * inferred from standings (rank, points, played) + season phase.
 * Reads engineCtx.homeStandingsRow / awayStandingsRow.
 */
import { contextResult, neutralResult, clamp, isNum } from "../ContextTypes.js";
import { softTilt } from "./_shared.js";

export const id = "motivation";
export const name = "Motivation";

function rowInfo(row) {
  if (!row) return null;
  const rank = Number(row.rank);
  const played = Number(row.all?.played);
  const points = Number(row.all?.points);
  if (!isNum(rank)) return null;
  return { rank, played: isNum(played) ? played : null, points: isNum(points) ? points : null };
}

export function calculate(ctx) {
  const h = rowInfo(ctx?.homeStandingsRow);
  const a = rowInfo(ctx?.awayStandingsRow);
  if (!h || !a) return neutralResult(id, name, "standings_unavailable");

  const gap = Math.abs(h.rank - a.rank);
  const played = Math.max(h.played || 0, a.played || 0);
  // Season phase: 0 early → 1 run-in. Motivation matters more late.
  const phase = clamp(played / 34, 0, 1);

  // Table zones (best-effort without total-teams count): top ranks = title/UCL
  // chase, high rank numbers = relegation fight. Both raise stakes.
  const homeStakes = zoneStakes(h.rank);
  const awayStakes = zoneStakes(a.rank);

  // Large gap → underdog lifts, favourite slightly relaxes (upset pressure).
  let tilt = 0;
  if (gap >= 8) {
    const homeUnderdog = h.rank > a.rank;
    tilt = softTilt(homeUnderdog ? 1 : -1, 2) * 0.4;
  } else if (gap <= 2) {
    tilt = 0; // tight race: mutual pressure, no directional edge
  }
  // Stakes asymmetry nudges the more-motivated side.
  tilt += softTilt(homeStakes - awayStakes, 1.5) * 0.4;
  tilt = clamp(tilt * (0.5 + 0.5 * phase), -1, 1);

  const bothHighStakes = homeStakes > 0.6 && awayStakes > 0.6;
  const confidence = clamp((0.3 + 0.4 * phase) * (0.7 + 0.3 * Math.min(1, gap / 10)), 0, 1);
  const reason = bothHighStakes
    ? "Both sides have plenty to play for"
    : gap >= 8
    ? "Motivation edge to the underdog"
    : "Motivation roughly balanced";

  return {
    ...contextResult(id, name, {
      tilt,
      pace: 0,
      confidence,
      reason,
      details: {
        rankHome: h.rank,
        rankAway: a.rank,
        gap,
        played,
        seasonPhase: Math.round(phase * 100) / 100,
        homeStakes: Math.round(homeStakes * 100) / 100,
        awayStakes: Math.round(awayStakes * 100) / 100
      }
    })
  };
}

/** Heuristic 0..1 stakes from rank alone (title/UCL top, relegation bottom). */
function zoneStakes(rank) {
  if (!isNum(rank)) return 0.3;
  if (rank <= 4) return 0.85;
  if (rank <= 7) return 0.65;
  if (rank >= 16) return 0.8;
  if (rank >= 13) return 0.6;
  return 0.35;
}

export const MotivationContext = { id, name, calculate };
export default MotivationContext;
