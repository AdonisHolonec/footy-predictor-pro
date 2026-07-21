/**
 * Chronological CLV/hit-rate report for the Stage08 published tip (recommended + pOut).
 * Tips are frozen at publish time — fitFn is identity, so this is execution-quality
 * reporting (did we beat the closing line), not model validation. It reuses the
 * WalkForward chronological-fold machinery only to prevent lookahead when
 * aggregating performance over time, not to fit or validate a model.
 */

import {
  evaluateWalkForward,
  aggregateWalkForwardMetrics,
  sortByKickoff
} from "../validation/WalkForward.js";
import { extractTipEvents } from "../backtest/TipEvent.js";

function mean(nums) {
  const a = (nums || []).filter((n) => Number.isFinite(n));
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function sharpeFromReturns(returns) {
  const a = (returns || []).filter((n) => Number.isFinite(n));
  if (a.length < 2) return null;
  const m = mean(a);
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
  const sd = Math.sqrt(Math.max(0, v));
  if (!(sd > 0)) return null;
  return m / sd;
}

/** Score a fold of tip events (already settled). */
export function scoreTipFold(_model, testEvents) {
  const tips = Array.isArray(testEvents) ? testEvents : [];
  const settled = tips.filter((t) => t.settled && t.y != null);
  if (!settled.length) {
    return {
      n: 0,
      logLoss: null,
      brier: null,
      accuracy: null,
      roi: null,
      clv: null,
      clvBeatRate: null,
      sharpe: null,
      coverageClv: null
    };
  }

  const hits = settled.filter((t) => t.won === true).length;
  const returns = settled.map((t) => t.unitReturn).filter((n) => Number.isFinite(n));
  const withClv = settled.filter((t) => Number.isFinite(t.clvPct));
  const clvBeat = withClv.filter((t) => t.clvPct > 0).length;

  return {
    n: settled.length,
    logLoss: mean(settled.map((t) => t.logLoss)),
    brier: mean(settled.map((t) => t.brier)),
    accuracy: hits / settled.length,
    roi: mean(returns),
    clv: mean(withClv.map((t) => t.clvPct)),
    clvBeatRate: withClv.length ? clvBeat / withClv.length : null,
    sharpe: sharpeFromReturns(returns),
    coverageClv: withClv.length / settled.length
  };
}

/**
 * @param {object[]} historyRows - predictions_history rows
 * @param {object} [opts] - walk-forward window opts
 */
export function evaluateTipClvReport(historyRows, opts = {}) {
  const tipEvents = extractTipEvents(historyRows, { requireSettled: true });
  const sorted = sortByKickoff(tipEvents);
  const wf = evaluateWalkForward(
    sorted,
    () => ({ track: "published_tip" }),
    scoreTipFold,
    {
      mode: opts.mode || "expanding",
      minTrain: opts.minTrain || 40,
      testSize: opts.testSize || 20,
      step: opts.step || 20,
      embargo: opts.embargo || 0
    }
  );

  const overall = scoreTipFold(null, sorted);
  return {
    track: "published_tip",
    tips: sorted.length,
    overall,
    walkForward: {
      ...wf,
      // ensure CLV/Sharpe appear in aggregate
      ...aggregateWalkForwardMetrics(wf.folds || [])
    }
  };
}
