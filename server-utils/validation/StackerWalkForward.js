/**
 * Chronological walk-forward (out-of-sample) evaluation for the softmax stacker.
 *
 * Production weights are still fit on the full sample set (unchanged elsewhere) —
 * this only measures, honestly, how the stacker would have performed on data it
 * never trained on. Mirrors the pattern CalibrationSelector.js already uses for
 * calibration method selection: time-ordered expanding folds, refit per fold.
 */

import { timeOrderedExpandingFolds, aggregateWalkForwardMetrics } from "./WalkForward.js";
import { trainSoftmax, computeStackerMetrics } from "../mlStacker.js";

const MIN_FOLD_TRAIN = 50;
const MIN_FOLD_TEST = 15;

/**
 * @param {object[]} samples - each needs { x, y, actual, poissonProbs, kickoffAt }
 * @param {number} nFeatures
 * @param {{ folds?: number, epochs?: number, lr?: number, l2?: number, batch?: number }} [opts]
 * @returns {{ ok: boolean, reason?: string, foldsRun?: number, windows?: number,
 *   logLoss?: object, brier?: object, accuracy?: object }}
 */
export function evaluateStackerWalkForward(samples, nFeatures, opts = {}) {
  const folds = Math.max(2, Number(opts.folds) || 3);
  const trainOpts = {
    epochs: opts.epochs,
    lr: opts.lr,
    l2: opts.l2,
    batch: opts.batch
  };

  const windows = timeOrderedExpandingFolds(samples, folds);
  if (!windows.length) {
    return { ok: false, reason: "insufficient_samples", foldsRun: 0 };
  }

  const foldMetrics = [];
  for (const w of windows) {
    if (w.train.length < MIN_FOLD_TRAIN || w.test.length < MIN_FOLD_TEST) continue;
    const weights = trainSoftmax(
      w.train.map((s) => ({ ...s })),
      nFeatures,
      trainOpts
    );
    const scored = computeStackerMetrics(w.test, weights);
    foldMetrics.push({
      n: scored.n,
      logLoss: scored.logLossStk,
      brier: scored.brierStk,
      accuracy: scored.accuracyStk / 100
    });
  }

  if (!foldMetrics.length) {
    return { ok: false, reason: "no_valid_folds", foldsRun: 0 };
  }

  return {
    ok: true,
    foldsRun: foldMetrics.length,
    ...aggregateWalkForwardMetrics(foldMetrics)
  };
}

export default { evaluateStackerWalkForward };
