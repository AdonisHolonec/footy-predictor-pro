/**
 * Type-only mirror of ModelInterface.js for editors / future TS trainers.
 * Runtime remains the .js implementation.
 */

export type ModelFamily =
  | "xgboost"
  | "catboost"
  | "random_forest"
  | "lightgbm"
  | "neural_net"
  | "stacker_lr"
  | "isotonic"
  | "other";

export type ModelTask = "1x2" | "o25" | "gg" | "value" | "multi";
export type ModelStatus = "planned" | "training" | "candidate" | "active" | "retired" | "failed";

export interface ModelPredictInput {
  features: Record<string, number>;
  featureNames?: string[];
  leagueId?: number | null;
}

export interface ModelPredictOutput {
  probs1x2: { p1: number; pX: number; p2: number } | null;
  pO25?: number | null;
  pGG?: number | null;
  modelKey: string;
  modelVersion: string;
  family: ModelFamily;
}

export interface TrainingDatasetLike {
  featureSchemaVersion: string;
  examples: Array<Record<string, unknown>>;
  featureNames: string[];
}
