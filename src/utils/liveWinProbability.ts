import type { PredictionRow } from "../types";
import { isFixtureInPlay } from "./appUtils";

/**
 * Live Win Probability — deterministic in-play 1X2 recompute, client-side only.
 *
 * Conditions the pre-match Poisson model on the live state: the remaining-time
 * goals for each side follow Poisson(λ · remainingFraction) with the SAME λs
 * PredictorV3 already computed at predict time (row.lambdas), added on top of
 * the current score. Additive-only: never touches row.probs, recommended, or
 * any engine output — same contract as confidenceEngine.liveAdjustment.
 *
 * Independent Poisson (no Dixon–Coles rho) is a deliberate simplification for
 * the remaining-time conditional; the small low-score correlation it ignores
 * is far below what the known score already pins down mid-match.
 */
export type LiveWinProbability = {
  /** Percentages 0–100, normalized to sum to exactly 100. */
  p1: number;
  pX: number;
  p2: number;
  minute: number;
  /** Fraction of regulation time left (0..1); 0 during stoppage time. */
  remainingFraction: number;
};

/** One live-probability snapshot per observed minute — the sparkline's data point. */
export type LiveWinHistoryPoint = {
  minute: number;
  p1: number;
  pX: number;
  p2: number;
};

/** Poll cadence is ~75s, so one point per minute; 120 covers 90' + stoppage comfortably. */
export const MAX_LIVE_WIN_HISTORY_POINTS = 120;

/**
 * Immutable append for the in-memory sparkline history: a repeated minute
 * replaces the previous snapshot (latest poll wins), and length is capped by
 * dropping the oldest points. No persistence — per-mount, like momentum history.
 */
export function appendLiveWinHistory(
  history: LiveWinHistoryPoint[],
  point: LiveWinHistoryPoint,
  max = MAX_LIVE_WIN_HISTORY_POINTS
): LiveWinHistoryPoint[] {
  const last = history[history.length - 1];
  const next = last && last.minute === point.minute ? [...history.slice(0, -1), point] : [...history, point];
  return next.length > max ? next.slice(next.length - max) : next;
}

const REGULATION_MINUTES = 90;
/** Truncation for the remaining-goals grid; residual mass is renormalized away. */
const MAX_REMAINING_GOALS = 10;
/** Beyond-regulation phases where "outcome at 90'" 1X2 semantics no longer hold. */
const BEYOND_REGULATION_STATUSES = new Set(["ET", "BT", "P"]);

function poissonPmf(lambda: number, maxK: number): number[] {
  const pmf = new Array<number>(maxK + 1);
  pmf[0] = Math.exp(-lambda);
  for (let k = 1; k <= maxK; k++) {
    pmf[k] = (pmf[k - 1] * lambda) / k;
  }
  return pmf;
}

export function deriveLiveWinProbability(
  row: Pick<PredictionRow, "status" | "score" | "lambdas">
): LiveWinProbability | null {
  if (!isFixtureInPlay(row.status)) return null;
  const status = String(row.status ?? "")
    .trim()
    .toUpperCase();
  if (BEYOND_REGULATION_STATUSES.has(status)) return null;

  const lambdaHome = Number(row.lambdas?.home);
  const lambdaAway = Number(row.lambdas?.away);
  if (!Number.isFinite(lambdaHome) || !Number.isFinite(lambdaAway) || lambdaHome <= 0 || lambdaAway <= 0) {
    return null;
  }

  const scoreHome = row.score?.home;
  const scoreAway = row.score?.away;
  const minute = row.score?.minute;
  if (typeof scoreHome !== "number" || typeof scoreAway !== "number") return null;
  if (typeof minute !== "number" || !Number.isFinite(minute) || minute < 0) return null;

  const remainingFraction =
    Math.max(0, REGULATION_MINUTES - Math.min(minute, REGULATION_MINUTES)) / REGULATION_MINUTES;
  const pmfHome = poissonPmf(lambdaHome * remainingFraction, MAX_REMAINING_GOALS);
  const pmfAway = poissonPmf(lambdaAway * remainingFraction, MAX_REMAINING_GOALS);

  let p1 = 0;
  let pX = 0;
  let p2 = 0;
  for (let j = 0; j <= MAX_REMAINING_GOALS; j++) {
    for (let k = 0; k <= MAX_REMAINING_GOALS; k++) {
      const p = pmfHome[j] * pmfAway[k];
      const goalDiff = scoreHome + j - (scoreAway + k);
      if (goalDiff > 0) p1 += p;
      else if (goalDiff < 0) p2 += p;
      else pX += p;
    }
  }

  const total = p1 + pX + p2;
  if (!(total > 0)) return null;
  return {
    p1: (p1 / total) * 100,
    pX: (pX / total) * 100,
    p2: (p2 / total) * 100,
    minute,
    remainingFraction
  };
}
