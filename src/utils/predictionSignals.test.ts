import { describe, expect, test } from "vitest";
import type { PredictionRow } from "../types";
import { HIGH_CONFIDENCE_THRESHOLD } from "../constants/appConstants";
import { confidenceOf, expectedValueOf, isHighConfidenceRow, isValueRow } from "./predictionSignals";

/**
 * These helpers read a handful of optional fields, so the fixtures stay minimal
 * rather than spelling out a whole `PredictionRow` (and its required nested
 * shapes) for every case.
 */
function row(partial: Record<string, unknown>): PredictionRow {
  return partial as unknown as PredictionRow;
}

describe("confidenceOf", () => {
  test("returns the recommendation confidence when it is a finite number", () => {
    expect(confidenceOf(row({ recommended: { confidence: 72 } }))).toBe(72);
  });

  test("returns 0 when the row carries no recommendation", () => {
    expect(confidenceOf(row({}))).toBe(0);
  });

  test("returns 0 when the confidence is not a usable number", () => {
    expect(confidenceOf(row({ recommended: { confidence: Number.NaN } }))).toBe(0);
  });
});

describe("expectedValueOf", () => {
  test("prefers the value bet edge over the engine estimate", () => {
    expect(expectedValueOf(row({ valueBet: { ev: 4.2 }, valueEngine: { expectedValue: 1.1 } }))).toBe(4.2);
  });

  test("falls back to the value engine estimate", () => {
    expect(expectedValueOf(row({ valueEngine: { expectedValue: 1.1 } }))).toBe(1.1);
  });

  test("returns 0 when neither source has a number", () => {
    expect(expectedValueOf(row({}))).toBe(0);
  });
});

describe("isValueRow", () => {
  test("is true when the value engine flagged the row even at a non-positive edge", () => {
    expect(isValueRow(row({ valueBet: { detected: true, ev: -1 } }))).toBe(true);
  });

  test("is true on a positive edge alone", () => {
    expect(isValueRow(row({ valueEngine: { expectedValue: 0.4 } }))).toBe(true);
  });

  test("is false at a zero edge", () => {
    expect(isValueRow(row({ valueBet: { ev: 0 } }))).toBe(false);
  });
});

describe("isHighConfidenceRow", () => {
  test("includes rows exactly at the shared threshold", () => {
    expect(isHighConfidenceRow(row({ recommended: { confidence: HIGH_CONFIDENCE_THRESHOLD } }))).toBe(true);
  });

  test("excludes rows just under the threshold", () => {
    expect(isHighConfidenceRow(row({ recommended: { confidence: HIGH_CONFIDENCE_THRESHOLD - 0.1 } }))).toBe(false);
  });

  test("excludes rows without a recommendation", () => {
    expect(isHighConfidenceRow(row({}))).toBe(false);
  });
});
