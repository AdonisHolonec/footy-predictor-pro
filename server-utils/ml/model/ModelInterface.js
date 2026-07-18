/**
 * Model interface — contract for future trainers / inference adapters.
 * NO training or inference is implemented here. Stubs only.
 */

import { FEATURE_SCHEMA_VERSION } from "../featureCatalog.js";

/** @typedef {"xgboost"|"catboost"|"random_forest"|"lightgbm"|"neural_net"|"stacker_lr"|"isotonic"|"other"} ModelFamily */
/** @typedef {"1x2"|"o25"|"gg"|"value"|"multi"} ModelTask */
/** @typedef {"planned"|"training"|"candidate"|"active"|"retired"|"failed"} ModelStatus */

/**
 * @typedef {object} ModelPredictInput
 * @property {Record<string, number>} features
 * @property {string[]} [featureNames]
 * @property {number|null} [leagueId]
 */

/**
 * @typedef {object} ModelPredictOutput
 * @property {{ p1: number, pX: number, p2: number }|null} probs1x2
 * @property {number|null} [pO25]
 * @property {number|null} [pGG]
 * @property {string} modelKey
 * @property {string} modelVersion
 * @property {ModelFamily} family
 */

/**
 * Abstract model adapter. Subclasses override fit/predict/save/load.
 * Online predict path must NOT call these until a model is explicitly activated.
 */
export class ModelInterface {
  /**
   * @param {{ modelKey: string, family: ModelFamily, task?: ModelTask, featureSchemaVersion?: string, modelVersion?: string }} cfg
   */
  constructor(cfg) {
    this.modelKey = cfg.modelKey;
    this.family = cfg.family;
    this.task = cfg.task || "1x2";
    this.featureSchemaVersion = cfg.featureSchemaVersion || FEATURE_SCHEMA_VERSION;
    this.modelVersion = cfg.modelVersion || "untrained";
    this.status = /** @type {ModelStatus} */ ("planned");
    this.metrics = null;
  }

  /** @returns {Promise<{ ok: false, error: string }>} */
  async fit(_dataset) {
    return {
      ok: false,
      error: `${this.family} fit() not implemented — scaffolding only (see ML_READY.md)`
    };
  }

  /** @param {ModelPredictInput} _input @returns {Promise<ModelPredictOutput|null>} */
  async predict(_input) {
    return null;
  }

  /** @returns {Promise<{ ok: false, error: string }>} */
  async save(_uri) {
    return { ok: false, error: "save() not implemented — scaffolding only" };
  }

  /** @returns {Promise<{ ok: false, error: string }>} */
  async load(_uri) {
    return { ok: false, error: "load() not implemented — scaffolding only" };
  }

  toRegistryRow() {
    return {
      model_key: this.modelKey,
      family: this.family,
      task: this.task,
      feature_schema_version: this.featureSchemaVersion,
      model_version: this.modelVersion,
      status: this.status,
      metrics_json: this.metrics,
      notes: "Scaffold adapter — no trained weights"
    };
  }
}

/** Planned family stubs (no algorithms). */
export class XGBoostModel extends ModelInterface {
  constructor(opts = {}) {
    super({ modelKey: opts.modelKey || "planned_xgboost_1x2", family: "xgboost", ...opts });
  }
}

export class CatBoostModel extends ModelInterface {
  constructor(opts = {}) {
    super({ modelKey: opts.modelKey || "planned_catboost_1x2", family: "catboost", ...opts });
  }
}

export class RandomForestModel extends ModelInterface {
  constructor(opts = {}) {
    super({ modelKey: opts.modelKey || "planned_rf_1x2", family: "random_forest", ...opts });
  }
}

export class LightGBMModel extends ModelInterface {
  constructor(opts = {}) {
    super({ modelKey: opts.modelKey || "planned_lightgbm_1x2", family: "lightgbm", ...opts });
  }
}

export class NeuralNetModel extends ModelInterface {
  constructor(opts = {}) {
    super({ modelKey: opts.modelKey || "planned_nn_1x2", family: "neural_net", ...opts });
  }
}

const FAMILY_CTOR = {
  xgboost: XGBoostModel,
  catboost: CatBoostModel,
  random_forest: RandomForestModel,
  lightgbm: LightGBMModel,
  neural_net: NeuralNetModel
};

/**
 * Factory for planned model adapters.
 * @param {ModelFamily} family
 * @param {object} [opts]
 */
export function createModel(family, opts = {}) {
  const Ctor = FAMILY_CTOR[family];
  if (!Ctor) throw new Error(`Unknown model family: ${family}`);
  return new Ctor(opts);
}

/** List of future families documented in ML_READY.md */
export const FUTURE_MODEL_FAMILIES = Object.freeze([
  "xgboost",
  "catboost",
  "random_forest",
  "lightgbm",
  "neural_net"
]);
