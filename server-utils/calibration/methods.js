/**
 * Probability calibration methods (binary, per-outcome).
 *
 * Implements Platt scaling, Temperature scaling, and Beta calibration to sit
 * alongside the existing Isotonic (PAV) calibration. Each method fits a monotone
 * mapping raw prob → calibrated prob and can be materialized into piecewise-linear
 * (xPoints, yPoints) so the existing storage + runtime apply path is reused as-is.
 */

const EPS = 1e-6;

export function clamp01(x) {
  return Math.max(EPS, Math.min(1 - EPS, Number(x)));
}

export function sigmoid(z) {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

export function logit(p) {
  const x = clamp01(p);
  return Math.log(x / (1 - x));
}

function cleanSamples(samples) {
  return (Array.isArray(samples) ? samples : []).filter(
    (s) => Number.isFinite(s?.x) && Number.isFinite(s?.y)
  );
}

/**
 * Generic regularized logistic-regression fit via gradient descent.
 * @param {number[][]} X rows of features (no intercept column)
 * @param {number[]} y binary targets
 * @returns {{ w:number[], b:number }}
 */
export function fitLogisticGD(X, y, { epochs = 300, lr = 0.1, l2 = 1e-4 } = {}) {
  const n = X.length;
  const dim = n ? X[0].length : 0;
  const w = new Array(dim).fill(0);
  let b = 0;
  if (!n) return { w, b };
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gw = new Array(dim).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let d = 0; d < dim; d++) z += w[d] * X[i][d];
      const p = sigmoid(z);
      const err = p - y[i];
      for (let d = 0; d < dim; d++) gw[d] += err * X[i][d];
      gb += err;
    }
    for (let d = 0; d < dim; d++) w[d] -= lr * (gw[d] / n + l2 * w[d]);
    b -= lr * (gb / n);
  }
  return { w, b };
}

// -------------------- Platt scaling --------------------
// Calibrated = sigmoid(a·logit(x) + b). a>0 keeps monotonic.
export function fitPlatt(samples) {
  const s = cleanSamples(samples);
  if (!s.length) return { a: 1, b: 0 };
  const X = s.map((p) => [logit(p.x)]);
  const y = s.map((p) => (p.y >= 0.5 ? 1 : 0));
  const { w, b } = fitLogisticGD(X, y, { epochs: 400, lr: 0.15, l2: 1e-4 });
  return { a: w[0], b };
}

export function applyPlatt(x, params) {
  return sigmoid((params?.a ?? 1) * logit(x) + (params?.b ?? 0));
}

// -------------------- Temperature scaling --------------------
// Calibrated = sigmoid(logit(x) / T). Single scalar T>0 minimizing log-loss.
export function fitTemperature(samples) {
  const s = cleanSamples(samples);
  if (!s.length) return { t: 1 };
  const logits = s.map((p) => logit(p.x));
  const y = s.map((p) => (p.y >= 0.5 ? 1 : 0));
  const loss = (T) => {
    if (T <= 0) return Infinity;
    let l = 0;
    for (let i = 0; i < logits.length; i++) {
      const p = clamp01(sigmoid(logits[i] / T));
      l += y[i] ? -Math.log(p) : -Math.log(1 - p);
    }
    return l / logits.length;
  };
  // Coarse grid then local refine.
  let best = 1;
  let bestLoss = Infinity;
  for (let T = 0.4; T <= 3.0; T += 0.05) {
    const l = loss(T);
    if (l < bestLoss) {
      bestLoss = l;
      best = T;
    }
  }
  for (let T = best - 0.05; T <= best + 0.05; T += 0.005) {
    const l = loss(T);
    if (l < bestLoss) {
      bestLoss = l;
      best = T;
    }
  }
  return { t: Number(best.toFixed(3)) };
}

export function applyTemperature(x, params) {
  const T = params?.t && params.t > 0 ? params.t : 1;
  return sigmoid(logit(x) / T);
}

// -------------------- Beta calibration --------------------
// Kull et al. (2017): calibrated = sigmoid(a·ln(x) − b·ln(1−x) + c).
export function fitBeta(samples) {
  const s = cleanSamples(samples);
  if (!s.length) return { a: 1, b: 1, c: 0 };
  const X = s.map((p) => {
    const x = clamp01(p.x);
    return [Math.log(x), -Math.log(1 - x)];
  });
  const y = s.map((p) => (p.y >= 0.5 ? 1 : 0));
  const { w, b } = fitLogisticGD(X, y, { epochs: 500, lr: 0.1, l2: 1e-4 });
  // Enforce non-negative shape params for monotonicity/stability.
  return { a: Math.max(0, w[0]), b: Math.max(0, w[1]), c: b };
}

export function applyBeta(x, params) {
  const xx = clamp01(x);
  const a = params?.a ?? 1;
  const b = params?.b ?? 1;
  const c = params?.c ?? 0;
  return sigmoid(a * Math.log(xx) - b * Math.log(1 - xx) + c);
}

// -------------------- Method registry --------------------
export const CALIBRATION_METHODS = {
  platt: { fit: fitPlatt, apply: applyPlatt },
  temperature: { fit: fitTemperature, apply: applyTemperature },
  beta: { fit: fitBeta, apply: applyBeta }
};

/**
 * Materialize any calibration function into monotone (xPoints, yPoints) so the
 * existing isotonic apply/storage path can serve it unchanged.
 */
export function curveToPoints(applyFn, params, steps = 50) {
  const xPoints = [];
  const yPoints = [];
  let prevY = 0;
  for (let i = 0; i <= steps; i++) {
    const x = i / steps;
    const xc = Math.max(0.001, Math.min(0.999, x));
    let y = applyFn(xc, params);
    if (!Number.isFinite(y)) y = xc;
    // Enforce non-decreasing to satisfy the interpolator's assumptions.
    y = Math.max(prevY, Math.max(0, Math.min(1, y)));
    prevY = y;
    xPoints.push(Number(xc.toFixed(4)));
    yPoints.push(Number(y.toFixed(4)));
  }
  return { xPoints, yPoints };
}
