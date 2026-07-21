/** Typed mirror of FeatureImportanceEngine.js */

export interface FeatureImportanceItem {
  key: string;
  label: string;
  contribution: number;
  activation: number;
  prior: number;
}

export interface FeatureImportanceResult {
  schemaVersion: string;
  contributions: Record<string, number>;
  items: FeatureImportanceItem[];
  total: number;
  topFeatures: string[];
  method: string;
}

export declare function buildFeatureImportance(...args: any[]): FeatureImportanceResult;
export declare function featureImportanceToMlVector(...args: any[]): any;
export declare const FeatureImportanceEngine: any;

export {
  FEATURE_IMPORTANCE_KEYS,
  FEATURE_IMPORTANCE_LABELS,
  getFeatureImportancePriors
} from "./featureImportanceWeights.js";
