/**
 * Typed mirror of PredictionExplanation.js
 */

import type { PredictionReason } from "./PredictionReason.js";

export interface PredictionExplanationResult {
  pick: string;
  confidence: number | null;
  reasons: PredictionReason[];
  formHome: string | null;
  formAway: string | null;
  expectedGoals: number | null;
  /** Flat labels for quick UI / audit. */
  reasoning: string[];
}

export declare function buildPredictionExplanation(...args: unknown[]): PredictionExplanationResult;
export declare const PredictionExplanation: unknown;
