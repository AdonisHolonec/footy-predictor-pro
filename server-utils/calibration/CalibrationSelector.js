/**
 * Calibration method selector.
 *
 * Evaluates Isotonic (kept), Platt, Temperature, and Beta calibration on the same
 * per-outcome samples via k-fold cross-validation, then picks the method with the
 * best validation log-loss (tie-break: ECE, then Brier). The winner is refit on all
 * samples and materialized into monotone (xPoints, yPoints) so the existing storage
 * and runtime apply path serve it unchanged.
 */

import { fitIsotonicPav, applyIsotonicMap } from "../isotonicCalibration.js";
import { CALIBRATION_METHODS, curveToPoints, clamp01 } from "./methods.js";
import { timeOrderedExpandingFolds } from "../validation/WalkForward.js";

function resolveCvMode(explicit) {
  if (explicit === "random" || explicit === "time") return explicit;
  const env = String(process.env.CALIB_CV_MODE || "time").toLowerCase();
  return env === "random" ? "random" : "time";
}

/*
  Isotonic (PAV) is non-parametric: at the sample sizes this project actually
  fits (329–910 per outcome over 29 nightly runs, 157 for the one league map) it
  produces saturated tail bins and loses to every parametric method — it ranked
  last on 5/7 outcomes at n=910 and on 7/7 at n=157, and on outcome X it was worse
  than applying no calibration at all. Below this floor it is INELIGIBLE for
  selection. It is still evaluated and reported in `ranking` (with
  `eligible: false`) so the evidence stays inspectable; Platt / temperature / beta
  are never gated. 2000 is ~2.2x the largest sample ever fitted here; revisit with
  evidence, override via CALIB_ISOTONIC_MIN_SAMPLES.
*/
export const DEFAULT_ISOTONIC_MIN_SAMPLES = 2000;

/**
 * Precedence: explicit option > CALIB_ISOTONIC_MIN_SAMPLES env > default.
 * A blank value is "unset" (falls through); a present-but-invalid value
 * (non-numeric, negative, Infinity) falls back to the default — never to 0,
 * because 0 would silently disable the guard.
 */
export function resolveIsotonicMinSamples(explicit) {
  for (const raw of [explicit, process.env.CALIB_ISOTONIC_MIN_SAMPLES]) {
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_ISOTONIC_MIN_SAMPLES;
  }
  return DEFAULT_ISOTONIC_MIN_SAMPLES;
}

/** Only isotonic is sample-gated; every other method is always eligible. */
export function isMethodEligible(method, n, isotonicMinSamples) {
  if (method !== "isotonic") return true;
  return n >= resolveIsotonicMinSamples(isotonicMinSamples);
}

function binLabel(s) {
  return s.y >= 0.5 ? 1 : 0;
}

export function logLoss(p, y) {
  const pc = clamp01(p);
  return y ? -Math.log(pc) : -Math.log(1 - pc);
}

export function brier(p, y) {
  return (p - y) ** 2;
}

/** Binary Expected Calibration Error over `bins` equal-width probability buckets. */
export function expectedCalibrationErrorBinary(pairs, bins = 10) {
  const buckets = Array.from({ length: bins }, () => ({ n: 0, sumP: 0, sumY: 0 }));
  for (const { p, y } of pairs) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(p * bins)));
    const b = buckets[idx];
    b.n += 1;
    b.sumP += p;
    b.sumY += y;
  }
  const total = pairs.length || 1;
  let ece = 0;
  for (const b of buckets) {
    if (!b.n) continue;
    ece += (b.n / total) * Math.abs(b.sumP / b.n - b.sumY / b.n);
  }
  return ece;
}

/** Deterministic shuffle (mulberry32) so CV folds are stable across runs. */
function shuffleIndices(n, seed = 42) {
  const idx = Array.from({ length: n }, (_, i) => i);
  let t = seed >>> 0;
  const rnd = () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = idx[i];
    idx[i] = idx[j];
    idx[j] = tmp;
  }
  return idx;
}

function kFolds(n, k, seed = 42) {
  const idx = shuffleIndices(n, seed);
  const folds = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) folds[i % k].push(idx[i]);
  return folds;
}

/** Fit one method on train samples → an apply(x) function. */
function fitMethod(method, trainSamples) {
  if (method === "isotonic") {
    const fitted = fitIsotonicPav(trainSamples);
    return (x) => applyIsotonicMap(x, fitted.xPoints, fitted.yPoints);
  }
  if (method === "none") {
    return (x) => clamp01(x);
  }
  const impl = CALIBRATION_METHODS[method];
  const params = impl.fit(trainSamples);
  return (x) => impl.apply(x, params);
}

const METHODS = ["isotonic", "platt", "temperature", "beta"];

function scorePairs(pairs) {
  return {
    logLoss: Number(mean(pairs.map((q) => logLoss(q.p, q.y))).toFixed(5)),
    ece: Number(expectedCalibrationErrorBinary(pairs).toFixed(5)),
    brier: Number(mean(pairs.map((q) => brier(q.p, q.y))).toFixed(5)),
    valN: pairs.length
  };
}

/**
 * Cross-validated evaluation of all methods on per-outcome samples ({x, y[, kickoffAt]}).
 * Default cvMode=time (expanding chronological folds). Set CALIB_CV_MODE=random for legacy.
 * @returns {{ ranking: Array, best: string, baseline: object, n: number, cvMode: string }}
 */
export function evaluateCalibrationMethods(samples, { folds = 4, seed = 42, cvMode, isotonicMinSamples } = {}) {
  const s = (Array.isArray(samples) ? samples : []).filter(
    (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)
  );
  const n = s.length;
  const isoMin = resolveIsotonicMinSamples(isotonicMinSamples);
  const results = {};
  let mode = resolveCvMode(cvMode);
  const hasKickoff = s.some((p) => p?.kickoffAt != null || p?.kickoff_at != null || p?.kickoff != null);
  if (mode === "time" && !hasKickoff) mode = "random";

  /** @type {Array<{ train: any[], test: any[] }>} */
  let windows = [];
  if (mode === "time") {
    windows = timeOrderedExpandingFolds(s, folds).map((w) => ({ train: w.train, test: w.test }));
  }
  if (!windows.length) {
    mode = "random";
    const usableFolds = Math.max(2, Math.min(folds, Math.floor(n / 20) || 2));
    const foldIdx = kFolds(n, usableFolds, seed);
    for (let f = 0; f < usableFolds; f++) {
      const valSet = new Set(foldIdx[f]);
      windows.push({
        train: s.filter((_, i) => !valSet.has(i)),
        test: foldIdx[f].map((i) => s[i])
      });
    }
  }

  const baselinePairs = [];
  for (const w of windows) {
    for (const p of w.test) baselinePairs.push({ p: clamp01(p.x), y: binLabel(p) });
  }
  const baseline = scorePairs(baselinePairs);

  for (const method of METHODS) {
    const valPairs = [];
    let failed = false;
    for (const w of windows) {
      if (w.train.length < 10 || w.test.length === 0) continue;
      let applyFn;
      try {
        applyFn = fitMethod(method, w.train);
      } catch {
        failed = true;
        break;
      }
      for (const p of w.test) valPairs.push({ p: clamp01(applyFn(p.x)), y: binLabel(p) });
    }
    if (failed || valPairs.length === 0) {
      results[method] = { method, logLoss: Infinity, ece: Infinity, brier: Infinity, valN: 0 };
      continue;
    }
    results[method] = { method, ...scorePairs(valPairs) };
  }

  // Eligibility is reported on every entry (never by omission): an ineligible
  // isotonic still shows its CV scores so the decision stays inspectable.
  for (const r of Object.values(results)) {
    r.eligible = isMethodEligible(r.method, n, isoMin);
    r.ineligibleReason = r.eligible ? null : `insufficient_samples_for_isotonic:${n}<${isoMin}`;
  }

  const ranking = Object.values(results).sort(
    (a, b) => a.logLoss - b.logLoss || a.ece - b.ece || a.brier - b.brier
  );
  const best = ranking.find((r) => r.eligible)?.method || "platt";
  return { ranking, best, baseline, n, cvMode: mode, isotonicMinSamples: isoMin };
}

/**
 * Identity (no-op) calibration curve — used when every fitted method hurts CV log-loss.
 */
function identityCurve() {
  return {
    xPoints: [0.001, 0.25, 0.5, 0.75, 0.999],
    yPoints: [0.001, 0.25, 0.5, 0.75, 0.999]
  };
}

/**
 * Select the best calibration method and return a ready-to-store curve.
 * Guards: needs enough samples; winner must beat the uncalibrated baseline on
 * CV log-loss, else falls back to identity (`none`).
 * @returns {{ method, xPoints, yPoints, ranking, baseline, n, reason? }}
 */
export function selectBestCalibration(
  samples,
  { minSamples = 40, folds = 4, seed = 42, cvMode, isotonicMinSamples } = {}
) {
  const s = (Array.isArray(samples) ? samples : []).filter(
    (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)
  );
  if (s.length < minSamples) {
    // Too few samples to select anything: serve the identity curve (a no-op map)
    // rather than an isotonic fit — the one method the sample guard exists for.
    const id = identityCurve();
    return {
      method: "none",
      xPoints: id.xPoints,
      yPoints: id.yPoints,
      ranking: [],
      baseline: null,
      reason: "insufficient_samples",
      n: s.length
    };
  }

  const evalResult = evaluateCalibrationMethods(s, { folds, seed, cvMode, isotonicMinSamples });
  const baselineLL = evalResult.baseline?.logLoss ?? Infinity;

  // Prefer the best ELIGIBLE method that beats (or ties) the uncalibrated baseline.
  // An ineligible isotonic is skipped, never re-scored: the next method in the
  // same ranking wins, or the identity curve if none beats the baseline.
  let chosen =
    evalResult.ranking.find(
      (r) => r.eligible && Number.isFinite(r.logLoss) && r.logLoss <= baselineLL + 1e-4
    )?.method || null;

  if (!chosen) {
    const id = identityCurve();
    return {
      method: "none",
      xPoints: id.xPoints,
      yPoints: id.yPoints,
      ranking: evalResult.ranking,
      baseline: evalResult.baseline,
      reason: "no_method_beats_baseline",
      n: s.length
    };
  }

  // Refit chosen method on ALL samples and export to points.
  let xPoints;
  let yPoints;
  if (chosen === "isotonic") {
    const fitted = fitIsotonicPav(s);
    xPoints = fitted.xPoints;
    yPoints = fitted.yPoints;
  } else {
    const impl = CALIBRATION_METHODS[chosen];
    const params = impl.fit(s);
    const curve = curveToPoints((x) => impl.apply(x, params), params);
    xPoints = curve.xPoints;
    yPoints = curve.yPoints;
  }

  return {
    method: chosen,
    xPoints,
    yPoints,
    ranking: evalResult.ranking,
    baseline: evalResult.baseline,
    n: s.length
  };
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export const CalibrationSelector = {
  evaluateCalibrationMethods,
  selectBestCalibration,
  expectedCalibrationErrorBinary,
  logLoss,
  brier
};
export default CalibrationSelector;
