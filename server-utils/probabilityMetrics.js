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
