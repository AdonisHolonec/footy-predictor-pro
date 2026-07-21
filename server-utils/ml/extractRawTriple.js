/**
 * Train/serve-aligned 1X2 triple extractors (normalized fractions summing to 1).
 *
 * - extractRawTriple: raw Poisson for calibration fitting (Stage06 input).
 * - extractStackerModelTriple: calibrated triple for stacker features (Stage07 input).
 *
 * Rollback (legacy skew): PREDICT_TRAIN_USE_FINAL_PROBS=1
 */

import {
  applyCalibratedTriple,
  pickCalibrationMapForLeague
} from "../isotonicCalibration.js";

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

/**
 * Stacker train features must match Stage07 serve: calibrated 1X2 (not raw Poisson).
 * Prefer stored calibratedProbs; else replay Stage06 maps on raw; else raw.
 *
 * @param {object} payload
 * @param {object|null} allMaps - loadCalibrationMaps() result
 * @param {number|string|null} leagueId
 * @returns {{ p1: number, pX: number, p2: number } | null}
 */
export function extractStackerModelTriple(payload, allMaps = null, leagueId = null) {
  const ev = payload?.evaluation || {};
  const stored = tryTriple(ev.calibratedProbs1x2Pct, "pct");
  if (stored) return stored;

  const raw = extractRawTriple(payload);
  if (!raw) return null;

  const maps = pickCalibrationMapForLeague(allMaps, leagueId);
  if (maps && (maps["1"] || maps["X"] || maps["2"])) {
    const cal = applyCalibratedTriple(raw, maps);
    if (cal && Number.isFinite(cal.p1)) {
      return { p1: cal.p1, pX: cal.pX, p2: cal.p2 };
    }
  }
  return raw;
}

/** @deprecated alias — AutoCalibrationEngine historical name */
export const extractPredictedTriple = extractRawTriple;

export default { extractRawTriple, extractPredictedTriple, extractStackerModelTriple };
