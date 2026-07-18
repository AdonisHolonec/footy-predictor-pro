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

export {
  buildFeatureImportance,
  featureImportanceToMlVector,
  FeatureImportanceEngine
} from "./FeatureImportanceEngine.js";

export {
  FEATURE_IMPORTANCE_KEYS,
  FEATURE_IMPORTANCE_LABELS,
  getFeatureImportancePriors
} from "./featureImportanceWeights.js";
