import { clamp, result, neutral } from "./helpers.js";

/**
 * Injuries impact. Neutral until /injuries is wired into PredictionContext.injuries.
 * Weight default 0 — safe for production parity.
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
  for (const inj of list) {
    const tid = String(inj.teamId ?? "");
    if (tid === homeId) homeCount += 1;
    else if (tid === awayId) awayCount += 1;
  }

  const home = clamp(1 - homeCount * 0.02, 0.9, 1.05);
  const away = clamp(1 - awayCount * 0.02, 0.9, 1.05);
  return result((home + away) / 2, 0.45, {
    home,
    away,
    homeCount,
    awayCount,
    available: true
  });
}

export const InjuriesEngine = { calculate, name: "injuries" };
