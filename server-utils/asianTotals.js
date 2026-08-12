/**
 * Asian Over/Under totals — line semantics, settlement and outcome distribution.
 *
 * THE single evaluator for O/U settlement across Recommended, card markets,
 * history settlement and the Global Special Bet (no parallel evaluators):
 *
 *   integer lines (.0)   — push exists:      actual == line  =>  stake returned
 *   half lines    (.5)   — no push:          strict over/under, unchanged
 *   quarter lines (.25/.75) — 50/50 split over the two neighbouring components:
 *       10.25 = half stake at 10.0 + half stake at 10.5
 *       10.75 = half stake at 10.5 + half stake at 11.0
 *
 * Outcomes: win · loss · push · half_win · half_loss. A "half_win" settles half
 * the stake at the odds and pushes the other half ((odds+1)/2 per unit); a
 * "half_loss" loses half and pushes half (0.5 per unit).
 *
 * Probability uses the SAME discrete distribution the model already has
 * (Variant B of the audit): the Poisson/bivariate-Poisson functions in math.js,
 * read ONLY at .5 boundaries where they are discretely exact —
 *     P(X <= k) = 1 - P_over(k + 0.5)
 *     P(X == k) = P_over(k - 0.5) - P_over(k + 0.5)
 * so Under 9 / 9.25 / 9.5 / 9.75 can never again share one Math.floor()'d
 * probability. No new model, no re-fit: the existing ladder is preferred when
 * it carries the needed boundary, the block's own lambdas price it otherwise.
 *
 * Pure and deterministic: no I/O, no clock, no randomness.
 */

import { poissonOverLine, poissonOverLineCorrelated } from "./math.js";

export const ASIAN_OUTCOMES = Object.freeze(["win", "loss", "push", "half_win", "half_loss"]);

/** Quarter of a unit — exact in binary floating point, safe to compare on. */
function quarters(line) {
  const n = Number(line);
  if (!Number.isFinite(n) || n < 0) return null;
  const q = Math.round(n * 4);
  if (Math.abs(n * 4 - q) > 1e-9) return null; // finer than quarter — unsupported
  return q;
}

/** True when the line is a quarter line (.25 / .75). */
export function isQuarterLine(line) {
  const q = quarters(line);
  return q != null && q % 2 === 1;
}

/**
 * The component lines a stake on `line` actually rides on.
 *   10 → [10] · 10.5 → [10.5] · 10.25 → [10, 10.5] · 10.75 → [10.5, 11]
 * Returns null for lines that are not integer/half/quarter.
 */
export function splitAsianLine(line) {
  const q = quarters(line);
  if (q == null) return null;
  const n = q / 4;
  if (q % 2 === 0) return [n]; // integer or half
  return [n - 0.25, n + 0.25]; // quarter: the two neighbouring components
}

/** Settle one component (integer or half line): "win" | "loss" | "push". */
function settleComponent(side, componentLine, actual) {
  if (actual === componentLine) return "push"; // only reachable on integer components
  if (side === "over") return actual > componentLine ? "win" : "loss";
  return actual < componentLine ? "win" : "loss";
}

/**
 * Settle an Asian O/U selection against the observed total.
 *
 * @param {"over"|"under"} side
 * @param {number} line integer / half / quarter — exactly as the book quotes it
 * @param {number} actual observed total (integer count)
 * @returns {"win"|"loss"|"push"|"half_win"|"half_loss"|null} null when inputs
 *   are unusable (unknown side, non-finite numbers, unsupported line step)
 */
export function settleOuAsian(side, line, actual) {
  const s = String(side).toLowerCase();
  if (s !== "over" && s !== "under") return null;
  const total = Number(actual);
  if (!Number.isFinite(total)) return null;
  const components = splitAsianLine(line);
  if (!components) return null;

  const outcomes = components.map((c) => settleComponent(s, c, total));
  if (outcomes.length === 1) return outcomes[0];

  const [a, b] = outcomes;
  if (a === b) return a; // win+win or loss+loss
  // The only mixed combinations a 0.25-split can produce are push+win / push+loss.
  if (a === "push" || b === "push") {
    return a === "win" || b === "win" ? "half_win" : "half_loss";
  }
  // win+loss is impossible for components 0.5 apart; guard anyway.
  return null;
}

/**
 * Payout per 1 unit stake for a settled outcome at decimal odds.
 *   win → odds · push → 1 · loss → 0 · half_win → (odds+1)/2 · half_loss → 0.5
 */
export function payoutMultiplier(outcome, odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o <= 1) return null;
  switch (outcome) {
    case "win":
      return o;
    case "push":
      return 1;
    case "loss":
      return 0;
    case "half_win":
      return (o + 1) / 2;
    case "half_loss":
      return 0.5;
    default:
      return null;
  }
}

/**
 * P(X > k + 0.5) from the market block — ladder first (the .5 boundaries are
 * exactly what buildPoissonMarketBlock precomputed), analytic on the block's
 * own lambdas otherwise. Returns a fraction, or null when neither source can
 * answer.
 */
function pOverHalfBoundary(block, halfLine) {
  const key = `o${String(halfLine).replace(".", "_")}`;
  const fromLadder = Number(block?.total?.[key]);
  if (Number.isFinite(fromLadder)) return { p: fromLadder / 100, source: "ladder" };

  const lh = Number(block?.lambdaHome);
  const la = Number(block?.lambdaAway);
  if (!Number.isFinite(lh) || !Number.isFinite(la) || lh + la <= 0) return null;
  const corr = Number(block?.correlation);
  const p =
    Number.isFinite(corr) && corr > 0
      ? poissonOverLineCorrelated(halfLine, lh, la, corr)
      : poissonOverLine(halfLine, lh + la);
  return Number.isFinite(p) ? { p, source: "analytic" } : null;
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/**
 * Full outcome distribution for one Asian O/U selection, from the SAME discrete
 * distribution the model already uses.
 *
 * @param {{ total?: Record<string, number>, lambdaHome?: number,
 *   lambdaAway?: number, correlation?: number }|null|undefined} block
 * @param {"over"|"under"} side
 * @param {number} line integer / half / quarter, exactly as quoted
 * @returns {{ pWin: number, pPush: number, pHalfWin: number, pHalfLoss: number,
 *   pLoss: number, source: "ladder"|"analytic"|"mixed" } | null}
 *   fractions summing to 1; null when the model cannot price this line
 */
export function asianOuDistribution(block, side, line) {
  const s = String(side).toLowerCase();
  if (s !== "over" && s !== "under") return null;
  const q = quarters(line);
  if (q == null || !block) return null;
  const n = q / 4;
  const frac = q % 4; // 0 = integer, 1 = .25, 2 = .5, 3 = .75

  const boundaries = [];
  const boundary = (halfLine) => {
    const b = pOverHalfBoundary(block, halfLine);
    if (!b) return null;
    boundaries.push(b.source);
    return b.p;
  };
  const zero = { pWin: 0, pPush: 0, pHalfWin: 0, pHalfLoss: 0, pLoss: 0 };
  let dist;

  if (frac === 2) {
    // Half line — no push, exactly today's semantics.
    const pOver = boundary(n);
    if (pOver == null) return null;
    dist = { ...zero, pWin: s === "over" ? pOver : 1 - pOver };
    dist.pLoss = 1 - dist.pWin;
  } else if (frac === 0) {
    // Integer line L: pPush = P(X == L).
    const below = boundary(n - 0.5); // P(X > L-1) = P(X >= L)
    const above = boundary(n + 0.5); // P(X > L)
    if (below == null || above == null) return null;
    const pEq = clamp01(below - above);
    if (s === "over") dist = { ...zero, pWin: above, pPush: pEq, pLoss: clamp01(1 - below) };
    else dist = { ...zero, pWin: clamp01(1 - below), pPush: pEq, pLoss: above };
  } else {
    // Quarter line: components at intLine (integer) and halfLine (.5).
    // .25 → int below (N),   half above (N.5): half result lands on X == N.
    // .75 → half below (N.5), int above (N+1): half result lands on X == N+1.
    const intLine = frac === 1 ? n - 0.25 : n + 0.25;
    const lo = boundary(intLine - 0.5); // P(X >= intLine)
    const hi = boundary(intLine + 0.5); // P(X > intLine)
    if (lo == null || hi == null) return null;
    const pEq = clamp01(lo - hi); // P(X == intLine) — the half-result mass
    if (s === "over") {
      // Over wins fully above the integer, loses fully below it.
      dist =
        frac === 1
          ? { ...zero, pWin: hi, pHalfLoss: pEq, pLoss: clamp01(1 - lo) }
          : { ...zero, pWin: hi, pHalfWin: pEq, pLoss: clamp01(1 - lo) };
    } else {
      dist =
        frac === 1
          ? { ...zero, pWin: clamp01(1 - lo), pHalfWin: pEq, pLoss: hi }
          : { ...zero, pWin: clamp01(1 - lo), pHalfLoss: pEq, pLoss: hi };
    }
  }

  const source = boundaries.every((b) => b === boundaries[0]) ? boundaries[0] : "mixed";
  return { ...dist, source };
}

/**
 * Expected value (%) of 1 unit at decimal odds under an Asian outcome
 * distribution:  EV = pWin·(o−1) + pHalfWin·(o−1)/2 − pHalfLoss·0.5 − pLoss.
 * Push contributes 0 (stake returned).
 */
export function asianExpectedValuePct(dist, odds) {
  const o = Number(odds);
  if (!dist || !Number.isFinite(o) || o <= 1) return null;
  const ev =
    dist.pWin * (o - 1) + dist.pHalfWin * ((o - 1) / 2) - dist.pHalfLoss * 0.5 - dist.pLoss * 1;
  return Number.isFinite(ev) ? ev * 100 : null;
}

export default {
  ASIAN_OUTCOMES,
  isQuarterLine,
  splitAsianLine,
  settleOuAsian,
  payoutMultiplier,
  asianOuDistribution,
  asianExpectedValuePct
};
