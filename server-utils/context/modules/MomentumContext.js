/**
 * Module 1 — Momentum.
 * Recent form, recent goals/xG, home/away scoring streaks with exponential decay.
 * Reads engineCtx.hFormMulti/aFormMulti, home/awayRecentMatches, xgHome/xgAway.
 */
import { contextResult, neutralResult, clamp, isNum } from "../ContextTypes.js";
import { decayMean, softTilt } from "./_shared.js";

export const id = "momentum";
export const name = "Momentum";

export function calculate(ctx) {
  const hForm = Number(ctx?.hFormMulti);
  const aForm = Number(ctx?.aFormMulti);
  const homeRecent = Array.isArray(ctx?.homeRecentMatches)
    ? ctx.homeRecentMatches.map((m) => Number(m?.goalsFor)).filter(isNum)
    : [];
  const awayRecent = Array.isArray(ctx?.awayRecentMatches)
    ? ctx.awayRecentMatches.map((m) => Number(m?.goalsFor)).filter(isNum)
    : [];
  const xgH = Number(ctx?.xgHome);
  const xgA = Number(ctx?.xgAway);

  const haveForm = isNum(hForm) && isNum(aForm);
  const haveRecent = homeRecent.length >= 2 && awayRecent.length >= 2;
  const haveXg = isNum(xgH) && isNum(xgA);

  if (!haveForm && !haveRecent && !haveXg) {
    return neutralResult(id, name, "no_form_or_recent_data");
  }

  let tiltAcc = 0;
  let tiltW = 0;
  let paceAcc = 0;
  let paceW = 0;

  if (haveForm) {
    // Form multipliers hover ~0.9..1.1; difference drives directional tilt.
    tiltAcc += softTilt(hForm - aForm, 0.12) * 0.5;
    tiltW += 0.5;
  }
  if (haveRecent) {
    const hMean = decayMean(homeRecent, 3);
    const aMean = decayMean(awayRecent, 3);
    if (isNum(hMean) && isNum(aMean)) {
      tiltAcc += softTilt(hMean - aMean, 1.1) * 0.35;
      tiltW += 0.35;
      // Both scoring freely → pace up; both dry → pace down.
      paceAcc += softTilt((hMean + aMean) / 2 - 1.35, 0.9);
      paceW += 1;
    }
  }
  if (haveXg) {
    tiltAcc += softTilt(xgH - xgA, 0.8) * 0.15;
    tiltW += 0.15;
    paceAcc += softTilt((xgH + xgA) - 2.7, 1.1);
    paceW += 1;
  }

  const tilt = tiltW > 0 ? tiltAcc / tiltW : 0;
  const pace = paceW > 0 ? paceAcc / paceW : 0;

  // Confidence scales with how many independent signals were present + depth.
  const depth = Math.min(1, (homeRecent.length + awayRecent.length) / 10);
  const coverage = (haveForm ? 0.4 : 0) + (haveRecent ? 0.4 : 0) + (haveXg ? 0.2 : 0);
  const confidence = clamp(coverage * (0.6 + 0.4 * depth), 0, 1);

  const dir = tilt > 0.05 ? "home" : tilt < -0.05 ? "away" : "balanced";
  const reason =
    dir === "balanced"
      ? "Momentum evenly matched"
      : `Momentum favours the ${dir} side`;

  return {
    ...contextResult(id, name, {
      tilt,
      pace: clamp(pace, -1, 1),
      confidence,
      reason,
      details: {
        hFormMulti: isNum(hForm) ? hForm : null,
        aFormMulti: isNum(aForm) ? aForm : null,
        homeRecentDecayMean: haveRecent ? decayMean(homeRecent, 3) : null,
        awayRecentDecayMean: haveRecent ? decayMean(awayRecent, 3) : null,
        xgHome: haveXg ? xgH : null,
        xgAway: haveXg ? xgA : null,
        signals: { haveForm, haveRecent, haveXg }
      }
    })
  };
}

export const MomentumContext = { id, name, calculate };
export default MomentumContext;
