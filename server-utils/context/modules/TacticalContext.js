/**
 * Module 5 — Tactical matchup.
 * Playing-style proxies from scoring/conceding splits (attacking vs low-block)
 * and style compatibility → mostly a pace signal, small directional tilt.
 * Reads engineCtx.hStats / aStats / leagueParams. Kept low-weight to avoid
 * double-counting the main attack/defense modules.
 */
import { contextResult, neutralResult, clamp, isNum } from "../ContextTypes.js";
import { softTilt, leagueAvg } from "./_shared.js";

export const id = "tactical";
export const name = "Tactical Matchup";

export function calculate(ctx) {
  const h = ctx?.hStats;
  const a = ctx?.aStats;
  if (!h || !a) return neutralResult(id, name, "team_stats_unavailable");

  const avg = leagueAvg(ctx);
  const hAtk = Number(h.gfHome);
  const hDef = Number(h.gaHome);
  const aAtk = Number(a.gfAway);
  const aDef = Number(a.gaAway);
  if (![hAtk, hDef, aAtk, aDef].every(isNum)) {
    return neutralResult(id, name, "incomplete_splits");
  }

  // Style compatibility: attacking side vs leaky side → open game (pace up).
  const openness = (hAtk - avg) + (aDef - avg) + (aAtk - avg) + (hDef - avg);
  const pace = softTilt(openness, 2.4) * 0.6;

  // Small directional: attacker-vs-weak-defence mismatch each way.
  const homeEdge = (hAtk - avg) + (aDef - avg);
  const awayEdge = (aAtk - avg) + (hDef - avg);
  const tilt = softTilt(homeEdge - awayEdge, 2.2) * 0.25;

  const played = Math.min(Number(h.played) || 0, Number(a.played) || 0);
  const confidence = clamp(0.2 + Math.min(0.3, played / 40), 0, 0.55);

  const style =
    pace > 0.2 ? "open, attack-friendly matchup" : pace < -0.2 ? "cagey, low-block matchup" : "balanced styles";

  return {
    ...contextResult(id, name, {
      tilt: clamp(tilt, -1, 1),
      pace: clamp(pace, -1, 1),
      confidence,
      reason: `Tactical read: ${style}`,
      details: {
        homeAtk: hAtk,
        homeDef: hDef,
        awayAtk: aAtk,
        awayDef: aDef,
        leagueAvg: avg,
        opennessIndex: Math.round(openness * 100) / 100
      }
    })
  };
}

export const TacticalContext = { id, name, calculate };
export default TacticalContext;
