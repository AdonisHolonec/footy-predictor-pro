/**
 * Module 6 — Referee.
 * Cards / penalties / tempo / home tendency. When no referee is assigned or no
 * referee stats are present → neutral. Referee mainly affects discipline, so
 * its λ (goals) influence is deliberately tiny.
 * Reads engineCtx.refereeName, refereeStats, leagueParams.cards.
 */
import { contextResult, neutralResult, clamp, isNum } from "../ContextTypes.js";
import { softTilt } from "./_shared.js";

export const id = "referee";
export const name = "Referee";

export function calculate(ctx) {
  const refName = ctx?.refereeName;
  const stats = ctx?.refereeStats || null;
  if (!refName) return neutralResult(id, name, "referee_unassigned");

  const avgCards = Number(stats?.avgCards);
  const avgGoals = Number(stats?.avgGoals);
  const leagueCards = Number(ctx?.leagueParams?.cards);
  const homeTendency = Number(stats?.homeWinBias);

  // Without any referee stats we still acknowledge assignment but stay neutral.
  if (!isNum(avgCards) && !isNum(avgGoals) && !isNum(homeTendency)) {
    return {
      ...contextResult(id, name, {
        tilt: 0,
        pace: 0,
        confidence: 0.1,
        reason: `Referee assigned (${refName}) — no historical profile`,
        details: { refereeName: refName, hasProfile: false }
      })
    };
  }

  // Strict referee (more cards than league norm) slightly dampens tempo.
  let pace = 0;
  if (isNum(avgCards) && isNum(leagueCards) && leagueCards > 0) {
    pace = softTilt(leagueCards - avgCards, 1.5) * 0.2;
  }
  if (isNum(avgGoals)) {
    pace += softTilt(avgGoals - 2.6, 1.0) * 0.15;
  }
  const tilt = isNum(homeTendency) ? softTilt(homeTendency, 0.15) * 0.15 : 0;

  return {
    ...contextResult(id, name, {
      tilt: clamp(tilt, -1, 1),
      pace: clamp(pace, -1, 1),
      confidence: 0.3,
      reason: `Referee profile applied (${refName})`,
      details: {
        refereeName: refName,
        hasProfile: true,
        avgCards: isNum(avgCards) ? avgCards : null,
        avgGoals: isNum(avgGoals) ? avgGoals : null,
        leagueCards: isNum(leagueCards) ? leagueCards : null,
        homeTendency: isNum(homeTendency) ? homeTendency : null
      }
    })
  };
}

export const RefereeContext = { id, name, calculate };
export default RefereeContext;
