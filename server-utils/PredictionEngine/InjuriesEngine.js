import { clamp, result, neutral } from "./helpers.js";

/**
 * Severity weight per injury row (API type/reason when present).
 * Suspended / long-term outs hurt more than doubtful.
 */
function injurySeverity(entry) {
  const t = String(entry?.type || entry?.reason || "").toLowerCase();
  if (/suspend|red card|ban|sent off/.test(t)) return 0.03;
  if (/doubt|questionable|knock/.test(t)) return 0.01;
  if (/missing|injur|out|muscle|knee|hamstring|acl|fracture|surgery/.test(t)) return 0.025;
  return 0.02;
}

/**
 * Injuries impact. Neutral until /injuries is wired into PredictionContext.injuries.
 */
export function calculate(ctx) {
  const list = Array.isArray(ctx.injuries) ? ctx.injuries : null;
  if (!list || list.length === 0) {
    return neutral({ reason: "injuries_not_provided", extensionPoint: true });
  }

  const homeId = String(ctx.homeTeamId ?? "");
  const awayId = String(ctx.awayTeamId ?? "");
  let homeCount = 0;
  let awayCount = 0;
  let homeSeverity = 0;
  let awaySeverity = 0;
  for (const inj of list) {
    const tid = String(inj.teamId ?? "");
    const sev = injurySeverity(inj);
    if (tid === homeId) {
      homeCount += 1;
      homeSeverity += sev;
    } else if (tid === awayId) {
      awayCount += 1;
      awaySeverity += sev;
    }
  }

  const home = clamp(1 - homeSeverity, 0.88, 1.05);
  const away = clamp(1 - awaySeverity, 0.88, 1.05);
  return result((home + away) / 2, 0.45, {
    home,
    away,
    homeCount,
    awayCount,
    homeSeverity: Number(homeSeverity.toFixed(3)),
    awaySeverity: Number(awaySeverity.toFixed(3)),
    available: true
  });
}

export const InjuriesEngine = { calculate, name: "injuries" };
