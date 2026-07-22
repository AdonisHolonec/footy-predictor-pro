/**
 * Module 3 — Fatigue.
 * Fixture congestion, rest days, (proxy) travel, rotation risk.
 * Reads engineCtx.home/awayLastMatchDate, home/awayRecentMatches, fixtureDate.
 */
import { contextResult, neutralResult, clamp, isNum } from "../ContextTypes.js";
import { daysBetween, softTilt } from "./_shared.js";

export const id = "fatigue";
export const name = "Fatigue";

function restDays(fixtureDate, lastDate) {
  const d = daysBetween(fixtureDate, lastDate);
  return isNum(d) && d >= 0 ? d : null;
}

export function calculate(ctx) {
  const fixtureDate = ctx?.fixtureDate;
  const hRest = restDays(fixtureDate, ctx?.homeLastMatchDate);
  const aRest = restDays(fixtureDate, ctx?.awayLastMatchDate);

  if (!isNum(hRest) && !isNum(aRest)) {
    return neutralResult(id, name, "no_rest_data");
  }

  // Rest imbalance: fresher side gets a small directional lift.
  let tilt = 0;
  let confidence = 0.25;
  if (isNum(hRest) && isNum(aRest)) {
    tilt = softTilt(hRest - aRest, 4) * 0.6; // ~4 days diff → meaningful
    confidence = 0.55;
  }

  // Congestion: both short-rested → tempo/pace drops slightly.
  const minRest = Math.min(isNum(hRest) ? hRest : 99, isNum(aRest) ? aRest : 99);
  let pace = 0;
  if (minRest <= 3) pace = -clamp((4 - minRest) / 4, 0, 1) * 0.5;

  const congested =
    (isNum(hRest) && hRest <= 3) || (isNum(aRest) && aRest <= 3);
  const reason = congested
    ? "Congested schedule — fatigue in play"
    : isNum(hRest) && isNum(aRest)
    ? hRest > aRest + 1
      ? "Home side better rested"
      : aRest > hRest + 1
      ? "Away side better rested"
      : "Both sides similarly rested"
    : "Partial rest data";

  return {
    ...contextResult(id, name, {
      tilt: clamp(tilt, -1, 1),
      pace: clamp(pace, -1, 1),
      confidence,
      reason,
      details: {
        homeRestDays: isNum(hRest) ? Math.round(hRest * 10) / 10 : null,
        awayRestDays: isNum(aRest) ? Math.round(aRest * 10) / 10 : null,
        minRest: minRest === 99 ? null : minRest,
        congested
      }
    })
  };
}

export const FatigueContext = { id, name, calculate };
export default FatigueContext;
