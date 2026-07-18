/**
 * ML readiness barrel — scaffolding only (no online ML training).
 */

export {
  FEATURE_SCHEMA_VERSION,
  AVAILABLE_FEATURES,
  MISSING_FEATURES,
  availableFeatureNames,
  missingFeatureNames
} from "./featureCatalog.js";

export {
  coerceHistoryRow,
  extractStackerVector,
  extractFeatureMap,
  extractFeatureBatch
} from "./features/FeatureExtractor.js";

export {
  LEAKAGE_COLUMNS,
  DEFAULT_CLIP_BOUNDS,
  stripLeakage,
  clipFeatures,
  standardize,
  assignTimeSplits,
  engineerFeatures
} from "./engineering/FeatureEngineering.js";

export {
  DATASET_SCHEMA,
  buildTrainingExample,
  buildTrainingDataset,
  toMatrix
} from "./dataset/TrainingDataset.js";

export {
  ModelInterface,
  XGBoostModel,
  CatBoostModel,
  RandomForestModel,
  LightGBMModel,
  NeuralNetModel,
  createModel,
  FUTURE_MODEL_FAMILIES
} from "./model/ModelInterface.js";

export {
  fetchPredictionHistory,
  upsertTrainingExamples,
  listModelRegistry,
  HISTORY_TABLE,
  TRAINING_TABLE,
  REGISTRY_TABLE
} from "./history/PredictionHistoryStore.js";
