/** Actual 1X2 label from final score. */
export function actual1x2FromScore(home, away) {
  const h = Number(home);
  const a = Number(away);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  if (h > a) return "1";
  if (h === a) return "X";
  return "2";
}

/** Binary over label: total goals > line (e.g. 2.5). */
export function actualOverFromScore(home, away, line) {
  const h = Number(home);
  const a = Number(away);
  const L = Number(line);
  if (!Number.isFinite(h) || !Number.isFinite(a) || !Number.isFinite(L)) return null;
  return h + a > L ? 1 : 0;
}

/** Binary under label: total goals ≤ line (e.g. 3.5 → under). */
export function actualUnderFromScore(home, away, line) {
  const over = actualOverFromScore(home, away, line);
  return over == null ? null : over === 1 ? 0 : 1;
}

/** Both teams to score. */
export function actualBttsFromScore(home, away) {
  const h = Number(home);
  const a = Number(away);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  return h > 0 && a > 0 ? 1 : 0;
}

/**
 * Side-market probs as fractions from payload (pre-side-cal preferred).
 * @returns {{ pO15: number, pO25: number, pU35: number, pGG: number } | null}
 */
export function extractSideMarketProbs(payload) {
  const ev = payload?.evaluation || {};
  const rawSide = ev.rawSideMarketsPct;
  const calSide = ev.calibratedSideMarketsPct;
  const probs = payload?.probs || {};
  const src = rawSide && typeof rawSide === "object" ? rawSide : probs;
  const toFrac = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return n > 1.5 ? n / 100 : n;
  };
  const pO15 = toFrac(src.pO15);
  const pO25 = toFrac(src.pO25);
  const pU35 = toFrac(src.pU35 ?? (Number.isFinite(Number(src.pO35)) ? 100 - Number(src.pO35) : null));
  const pGG = toFrac(src.pGG);
  if ([pO15, pO25, pU35, pGG].every((x) => x == null)) {
    if (calSide && typeof calSide === "object") {
      const cO15 = toFrac(calSide.pO15);
      const cO25 = toFrac(calSide.pO25);
      const cU35 = toFrac(calSide.pU35);
      const cGG = toFrac(calSide.pGG);
      if ([cO15, cO25, cU35, cGG].some((x) => x != null)) {
        return { pO15: cO15, pO25: cO25, pU35: cU35, pGG: cGG };
      }
    }
    return null;
  }
  return { pO15, pO25, pU35, pGG };
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
    actual === "1"
      ? Math.max(eps, Math.min(1 - eps, p1))
      : actual === "X"
        ? Math.max(eps, Math.min(1 - eps, pX))
        : Math.max(eps, Math.min(1 - eps, p2));
  return -Math.log(p);
}

/** Binary Brier / log-loss for a single market. */
export function brierBinary(p, y) {
  const pp = Math.max(0, Math.min(1, Number(p)));
  const yy = Number(y) ? 1 : 0;
  if (!Number.isFinite(pp)) return null;
  return (pp - yy) ** 2;
}

export function logLossBinary(p, y) {
  const eps = 1e-6;
  const pp = Math.max(eps, Math.min(1 - eps, Number(p)));
  const yy = Number(y) ? 1 : 0;
  if (!Number.isFinite(pp)) return null;
  return -(yy * Math.log(pp) + (1 - yy) * Math.log(1 - pp));
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
