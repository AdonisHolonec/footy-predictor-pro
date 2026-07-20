/**
 * Chronological walk-forward validation helpers.
 * Never mixes future kickoffs into the training fold.
 */

function toMs(v) {
  if (v == null) return NaN;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/** Stable sort by kickoff ascending (missing kickoffs go last). */
export function sortByKickoff(samples) {
  return (Array.isArray(samples) ? samples : [])
    .map((s, i) => ({ s, i, t: toMs(s?.kickoffAt ?? s?.kickoff_at ?? s?.kickoff) }))
    .sort((a, b) => {
      const aMissing = !Number.isFinite(a.t);
      const bMissing = !Number.isFinite(b.t);
      if (aMissing && bMissing) return a.i - b.i;
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (a.t !== b.t) return a.t - b.t;
      return a.i - b.i;
    })
    .map((x) => x.s);
}

/**
 * Yield chronological train/test windows.
 * @param {object[]} samples sorted or unsorted
 * @param {{ mode?: "expanding"|"rolling", minTrain?: number, testSize?: number, step?: number, embargo?: number }} opts
 */
export function* iterWalkForwardWindows(samples, opts = {}) {
  const sorted = sortByKickoff(samples).filter((s) => Number.isFinite(toMs(s?.kickoffAt ?? s?.kickoff_at ?? s?.kickoff)));
  const mode = opts.mode === "rolling" ? "rolling" : "expanding";
  const minTrain = Math.max(10, Number(opts.minTrain) || 40);
  const testSize = Math.max(5, Number(opts.testSize) || 20);
  const step = Math.max(1, Number(opts.step) || testSize);
  const embargo = Math.max(0, Number(opts.embargo) || 0);
  const n = sorted.length;
  if (n < minTrain + testSize) return;

  for (let testStart = minTrain; testStart + testSize <= n; testStart += step) {
    const testEnd = testStart + testSize;
    const trainEnd = Math.max(0, testStart - embargo);
    if (trainEnd < minTrain) continue;
    const train =
      mode === "rolling"
        ? sorted.slice(Math.max(0, trainEnd - minTrain), trainEnd)
        : sorted.slice(0, trainEnd);
    const test = sorted.slice(testStart, testEnd);
    if (train.length < minTrain || test.length < 1) continue;
    // Invariant: last train kickoff < first test kickoff
    const trainLast = toMs(train[train.length - 1]?.kickoffAt ?? train[train.length - 1]?.kickoff_at);
    const testFirst = toMs(test[0]?.kickoffAt ?? test[0]?.kickoff_at);
    if (Number.isFinite(trainLast) && Number.isFinite(testFirst) && trainLast >= testFirst) continue;
    yield { train, test, trainEnd, testStart, testEnd };
  }
}

function mean(nums) {
  const a = nums.filter((n) => Number.isFinite(n));
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Aggregate walk-forward fold metrics + simple bootstrap CIs on fold means.
 * @param {Array<{ logLoss?: number, brier?: number, accuracy?: number, ece?: number, roi?: number }>} foldMetrics
 */
export function aggregateWalkForwardMetrics(foldMetrics) {
  const folds = Array.isArray(foldMetrics) ? foldMetrics : [];
  const pick = (key) => folds.map((f) => Number(f?.[key])).filter((n) => Number.isFinite(n));
  const summarize = (vals) => {
    if (!vals.length) return { mean: null, ci80: [null, null], n: 0 };
    const sorted = [...vals].sort((a, b) => a - b);
    return {
      mean: Number(mean(vals).toFixed(6)),
      ci80: [Number(percentile(sorted, 10).toFixed(6)), Number(percentile(sorted, 90).toFixed(6))],
      n: vals.length
    };
  };
  return {
    windows: folds.length,
    logLoss: summarize(pick("logLoss")),
    brier: summarize(pick("brier")),
    accuracy: summarize(pick("accuracy")),
    ece: summarize(pick("ece")),
    roi: summarize(pick("roi"))
  };
}

/**
 * Run walk-forward: fitFn(train) → model; scoreFn(model, test) → metrics object.
 */
export function evaluateWalkForward(samples, fitFn, scoreFn, opts = {}) {
  const foldMetrics = [];
  for (const win of iterWalkForwardWindows(samples, opts)) {
    const model = fitFn(win.train);
    const metrics = scoreFn(model, win.test);
    if (metrics && typeof metrics === "object") foldMetrics.push(metrics);
  }
  return {
    ...aggregateWalkForwardMetrics(foldMetrics),
    folds: foldMetrics
  };
}

/**
 * Time-ordered k folds for calibration CV (contiguous blocks, no shuffle).
 * Fold i validates on block i; trains on all earlier blocks only (expanding).
 */
export function timeOrderedExpandingFolds(samples, folds = 4) {
  const sorted = sortByKickoff(samples);
  const n = sorted.length;
  const k = Math.max(2, Math.min(folds, Math.floor(n / 20) || 2));
  if (n < k * 5) return [];
  const block = Math.floor(n / k);
  const out = [];
  for (let f = 1; f < k; f++) {
    const testStart = f * block;
    const testEnd = f === k - 1 ? n : (f + 1) * block;
    const train = sorted.slice(0, testStart);
    const test = sorted.slice(testStart, testEnd);
    if (train.length >= 10 && test.length >= 5) out.push({ train, test, fold: f });
  }
  return out;
}
