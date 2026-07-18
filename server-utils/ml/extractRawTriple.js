/**
 * Train/serve-aligned 1X2 triple extractor (normalized fractions summing to 1).
 *
 * Serve applies calibration maps to raw Poisson `pRaw`. Training must therefore
 * prefer `evaluation.rawPoissonProbs1x2Pct` over final `modelProbs1x2Pct`.
 *
 * Rollback (legacy skew): PREDICT_TRAIN_USE_FINAL_PROBS=1
 */

function tryTriple(t, scaleHint) {
  if (!t) return null;
  let p1 = Number(t.p1);
  let pX = Number(t.pX);
  let p2 = Number(t.p2);
  if (![p1, pX, p2].every(Number.isFinite)) return null;
  if (scaleHint === "pct" || p1 + pX + p2 > 1.5) {
    p1 /= 100;
    pX /= 100;
    p2 /= 100;
  }
  const s = p1 + pX + p2;
  if (!(s > 0)) return null;
  return { p1: p1 / s, pX: pX / s, p2: p2 / s };
}

/**
 * @param {object} payload prediction row raw_payload
 * @returns {{ p1: number, pX: number, p2: number } | null}
 */
export function extractRawTriple(payload) {
  const ev = payload?.evaluation || {};
  const useFinal = String(process.env.PREDICT_TRAIN_USE_FINAL_PROBS || "") === "1";

  if (useFinal) {
    return (
      tryTriple(ev.modelProbs1x2Pct, "pct") ||
      tryTriple(ev.rawPoissonProbs1x2Pct, "pct") ||
      tryTriple(payload?.probs, "auto")
    );
  }

  return (
    tryTriple(ev.rawPoissonProbs1x2Pct, "pct") ||
    tryTriple(ev.modelProbs1x2Pct, "pct") ||
    tryTriple(payload?.probs, "auto")
  );
}

/** @deprecated alias — AutoCalibrationEngine historical name */
export const extractPredictedTriple = extractRawTriple;

export default { extractRawTriple, extractPredictedTriple };
