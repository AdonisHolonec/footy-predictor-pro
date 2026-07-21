/**
 * Typed mirror of PredictionReason.js
 */

export type ReasonPolarity = "positive" | "negative" | "neutral" | "support";

export interface PredictionReason {
  code: string;
  label: string;
  value?: number | null;
  unit?: string | null;
  polarity?: ReasonPolarity;
  source: string;
  meta?: Record<string, unknown>;
}

export declare function createReason(...args: any[]): PredictionReason;
export declare function formatSignedPct(...args: any[]): string;
export declare function formatFixed(...args: any[]): string;
