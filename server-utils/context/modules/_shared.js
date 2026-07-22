/** Small numeric helpers shared by context modules (no fetching, pure). */

import { clamp, isNum } from "../ContextTypes.js";

/** Exponentially-decayed weighted mean of a series (index 0 = most recent). */
export function decayMean(series, halfLife = 3) {
  const arr = Array.isArray(series) ? series.map(Number).filter(isNum) : [];
  if (!arr.length) return null;
  const lambda = Math.log(2) / Math.max(1, halfLife);
  let num = 0;
  let den = 0;
  for (let i = 0; i < arr.length; i++) {
    const w = Math.exp(-lambda * i);
    num += w * arr[i];
    den += w;
  }
  return den > 0 ? num / den : null;
}

/** Days between two ISO dates (a - b), or null. */
export function daysBetween(a, b) {
  const da = a ? new Date(a).getTime() : NaN;
  const db = b ? new Date(b).getTime() : NaN;
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return (da - db) / 86400000;
}

/** Smooth a raw difference into a bounded tilt using a soft saturation. */
export function softTilt(diff, scale = 1) {
  const x = Number(diff) / (scale || 1);
  if (!Number.isFinite(x)) return 0;
  return clamp(Math.tanh(x), -1, 1);
}

export function leagueAvg(ctx) {
  const lp = ctx?.leagueParams || {};
  return Number(lp.leagueAvg ?? lp.leagueAvgGoals) || 1.35;
}

export { clamp, isNum };
