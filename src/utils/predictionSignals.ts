import type { PredictionRow } from "../types";
import { HIGH_CONFIDENCE_THRESHOLD } from "../constants/appConstants";

/**
 * The two signals the dashboard filters, sorts and counts by. They used to be
 * re-implemented in each consumer (HomeSection's shortlist, the derived-list
 * hook's filters), which let a chip's count disagree with the list it filtered.
 * One definition, read everywhere.
 */

/** Recommendation confidence as a number, 0 when the row carries no usable value. */
export function confidenceOf(row: PredictionRow): number {
  const confidence = Number(row.recommended?.confidence);
  return Number.isFinite(confidence) ? confidence : 0;
}

/** Expected value (%) as a number, 0 when the row carries no usable value. */
export function expectedValueOf(row: PredictionRow): number {
  const ev = Number(row.valueBet?.ev ?? row.valueEngine?.expectedValue);
  return Number.isFinite(ev) ? ev : 0;
}

/** True when the value engine flagged the row, or its edge is positive. */
export function isValueRow(row: PredictionRow): boolean {
  return Boolean(row.valueBet?.detected) || expectedValueOf(row) > 0;
}

/** True when the recommendation clears the shared high-confidence bar. */
export function isHighConfidenceRow(row: PredictionRow): boolean {
  return confidenceOf(row) >= HIGH_CONFIDENCE_THRESHOLD;
}
