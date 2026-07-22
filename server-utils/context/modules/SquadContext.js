/**
 * Module 4 — Squad availability.
 * Injuries/suspensions weighted by severity + lineup confirmation.
 * Reads engineCtx.injuries (teamId,type,reason), home/awayLineup.
 */
import { contextResult, neutralResult, clamp, isNum } from "../ContextTypes.js";
import { softTilt } from "./_shared.js";

export const id = "squad";
export const name = "Squad";

/** Severity weight per absence type (suspended > injured > doubtful). */
function severity(entry) {
  const t = String(entry?.type || entry?.reason || "").toLowerCase();
  if (t.includes("suspend") || t.includes("red card")) return 1.0;
  if (t.includes("doubt") || t.includes("question") || t.includes("knock")) return 0.4;
  if (t.includes("injur") || t) return 0.75;
  return 0.6;
}

export function calculate(ctx) {
  const injuries = Array.isArray(ctx?.injuries) ? ctx.injuries : null;
  const homeLineup = ctx?.homeLineup || null;
  const awayLineup = ctx?.awayLineup || null;
  const homeId = ctx?.homeTeamId != null ? String(ctx.homeTeamId) : null;
  const awayId = ctx?.awayTeamId != null ? String(ctx.awayTeamId) : null;

  const haveInjuries = injuries && injuries.length > 0 && homeId && awayId;
  const haveLineups = Boolean(homeLineup || awayLineup);

  if (!haveInjuries && !haveLineups) {
    return neutralResult(id, name, "no_squad_data");
  }

  let homeBurden = 0;
  let awayBurden = 0;
  let homeCount = 0;
  let awayCount = 0;
  if (haveInjuries) {
    for (const e of injuries) {
      const tid = e?.teamId != null ? String(e.teamId) : null;
      const w = severity(e);
      if (tid === homeId) {
        homeBurden += w;
        homeCount += 1;
      } else if (tid === awayId) {
        awayBurden += w;
        awayCount += 1;
      }
    }
  }

  // Missing-key-players from lineup (when confirmed lineups available).
  const homeMissing = Number(homeLineup?.missingKeyPlayers) || 0;
  const awayMissing = Number(awayLineup?.missingKeyPlayers) || 0;
  homeBurden += homeMissing * 0.9;
  awayBurden += awayMissing * 0.9;

  // More absences on a side → tilt AWAY from that side.
  const tilt = softTilt(awayBurden - homeBurden, 2.2) * 0.7;
  // Heavy combined absences slightly reduce pace (disrupted attacks).
  const pace = -clamp((homeBurden + awayBurden) / 12, 0, 1) * 0.3;

  const confirmed =
    (homeLineup?.confirmed ? 1 : 0) + (awayLineup?.confirmed ? 1 : 0);
  const confidence = clamp(
    (haveInjuries ? 0.4 : 0) + confirmed * 0.25 + Math.min(0.2, (homeCount + awayCount) * 0.03),
    0,
    1
  );

  const reason =
    Math.abs(homeBurden - awayBurden) < 0.8
      ? "Squad availability comparable"
      : homeBurden > awayBurden
      ? "Home side more depleted"
      : "Away side more depleted";

  return {
    ...contextResult(id, name, {
      tilt: clamp(tilt, -1, 1),
      pace: clamp(pace, -1, 1),
      confidence,
      reason,
      details: {
        homeBurden: Math.round(homeBurden * 100) / 100,
        awayBurden: Math.round(awayBurden * 100) / 100,
        homeCount,
        awayCount,
        homeLineupConfirmed: Boolean(homeLineup?.confirmed),
        awayLineupConfirmed: Boolean(awayLineup?.confirmed)
      }
    })
  };
}

export const SquadContext = { id, name, calculate };
export default SquadContext;
