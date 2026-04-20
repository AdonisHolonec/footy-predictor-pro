/** Actual 1X2 label from final score. */
export function actual1x2FromScore(home, away) {
  const h = Number(home);
  const a = Number(away);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  if (h > a) return "1";
  if (h === a) return "X";
  return "2";
}

/** Multiclass Brier score for one row (probabilities as fractions summing ~1). */
export function brier1x2(p1, pX, p2, actual) {
  const o1 = actual === "1" ? 1 : 0;
  const oX = actual === "X" ? 1 : 0;
  const o2 = actual === "2" ? 1 : 0;
  return (p1 - o1) ** 2 + (pX - oX) ** 2 + (p2 - o2) ** 2;
}

export function logLoss1x2(p1, pX, p2, actual) {
  const eps = 1e-6;
  const p =
    actual === "1" ? Math.max(eps, Math.min(1 - eps, p1)) : actual === "X" ? Math.max(eps, Math.min(1 - eps, pX)) : Math.max(eps, Math.min(1 - eps, p2));
  return -Math.log(p);
}

export function bucketConfidence(conf) {
  const c = Number(conf) || 0;
  if (c >= 80) return "80+";
  if (c >= 65) return "65-79";
  if (c >= 50) return "50-64";
  if (c >= 35) return "35-49";
  return "0-34";
}

/**
 * Expected Calibration Error: media ponderată a |avgConfidence − accuracy| per bucket.
 * Calibrare ideală => ECE ≈ 0. Orice > 5% indică bias sistemic de încredere.
 *
 * @param {Array<{n:number, avgConfidence:number, accuracy1x2:number}>} calibrationBuckets
 * @returns {number|null}
 */
export function expectedCalibrationError(calibrationBuckets) {
  if (!Array.isArray(calibrationBuckets) || calibrationBuckets.length === 0) return null;
  let totalN = 0;
  let weighted = 0;
  for (const b of calibrationBuckets) {
    const n = Number(b?.n) || 0;
    if (n <= 0) continue;
    const avgConf = Number(b?.avgConfidence) || 0;
    const acc = Number(b?.accuracy1x2) || 0;
    weighted += n * Math.abs(avgConf - acc);
    totalN += n;
  }
  if (totalN === 0) return null;
  return Number((weighted / totalN).toFixed(3));
}
