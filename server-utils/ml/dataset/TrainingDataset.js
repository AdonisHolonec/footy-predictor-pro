/**
 * Training dataset structure — schema + builders from prediction history.
 * Does not train models. Produces rows suitable for ml_training_examples.
 */

import { FEATURE_SCHEMA_VERSION } from "../featureCatalog.js";
import { extractFeatureMap, extractFeatureBatch } from "../features/FeatureExtractor.js";
import { engineerFeatures, assignTimeSplits } from "../engineering/FeatureEngineering.js";

export const DATASET_SCHEMA = Object.freeze({
  version: FEATURE_SCHEMA_VERSION,
  primaryKey: ["fixture_id", "model_version", "feature_schema_version"],
  columns: {
    fixture_id: "bigint",
    league_id: "int",
    kickoff_at: "timestamptz",
    model_version: "text",
    feature_schema_version: "text",
    label_1x2: "text|null (1|X|2)",
    label_gg: "bool|null",
    label_over25: "bool|null",
    features: "jsonb",
    feature_names: "text[]",
    split: "train|valid|test|holdout|null"
  },
  tasks: {
    "1x2": { target: "label_1x2", type: "multiclass", classes: ["1", "X", "2"] },
    o25: { target: "label_over25", type: "binary" },
    gg: { target: "label_gg", type: "binary" }
  }
});

/**
 * Build one training example dict from a history/predict row.
 * @param {object} row
 * @param {{ engineer?: boolean, standardizeStats?: object }} opts
 */
export function buildTrainingExample(row, opts = {}) {
  const extracted = extractFeatureMap(row);
  const engineered = opts.engineer
    ? engineerFeatures(extracted.vector, { standardizeStats: opts.standardizeStats })
    : { vector: extracted.vector, names: extracted.names, featureSchemaVersion: FEATURE_SCHEMA_VERSION };

  return {
    fixture_id: extracted.meta.fixtureId,
    league_id: extracted.meta.leagueId ?? null,
    kickoff_at: extracted.meta.kickoffAt ?? null,
    model_version: extracted.meta.modelVersion || "unknown",
    feature_schema_version: FEATURE_SCHEMA_VERSION,
    label_1x2: extracted.labels.label_1x2,
    label_gg: extracted.labels.label_gg,
    label_over25: extracted.labels.label_over25,
    features: engineered.vector,
    feature_names: engineered.names,
    split: null,
    source_meta: {
      extractedAt: new Date().toISOString(),
      schema: DATASET_SCHEMA.version
    }
  };
}

/**
 * Build a dataset object (in-memory) from history rows.
 * @param {object[]} rows
 * @param {{ engineer?: boolean, timeCuts?: { trainEnd: string, validEnd: string }, labeledOnly?: boolean }} opts
 */
export function buildTrainingDataset(rows = [], opts = {}) {
  let examples = rows.map((r) => buildTrainingExample(r, opts));
  if (opts.labeledOnly) {
    examples = examples.filter((e) => e.label_1x2 === "1" || e.label_1x2 === "X" || e.label_1x2 === "2");
  }
  if (opts.timeCuts) {
    examples = assignTimeSplits(
      examples.map((e) => ({ ...e, meta: { kickoffAt: e.kickoff_at } })),
      opts.timeCuts
    ).map(({ meta, ...rest }) => rest);
  }

  const labeled = examples.filter((e) => e.label_1x2);
  return {
    schema: DATASET_SCHEMA,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    count: examples.length,
    labeledCount: labeled.length,
    featureNames: examples[0]?.feature_names || [],
    examples,
    summary: summarizeDataset(examples)
  };
}

function summarizeDataset(examples = []) {
  const byLabel = { "1": 0, X: 0, "2": 0, unlabeled: 0 };
  const bySplit = { train: 0, valid: 0, test: 0, holdout: 0, unset: 0 };
  for (const e of examples) {
    if (e.label_1x2 === "1" || e.label_1x2 === "X" || e.label_1x2 === "2") byLabel[e.label_1x2] += 1;
    else byLabel.unlabeled += 1;
    const s = e.split || "unset";
    if (s in bySplit) bySplit[s] += 1;
    else bySplit.unset += 1;
  }
  return { byLabel, bySplit };
}

/**
 * Convert dataset examples to dense matrix helpers (for future Python/JS trainers).
 * @param {object} dataset - from buildTrainingDataset
 * @param {"1x2"|"o25"|"gg"} task
 */
export function toMatrix(dataset, task = "1x2") {
  const names = dataset.featureNames || [];
  const rows = [];
  const y = [];
  for (const ex of dataset.examples || []) {
    if (task === "1x2" && !ex.label_1x2) continue;
    if (task === "o25" && ex.label_over25 == null) continue;
    if (task === "gg" && ex.label_gg == null) continue;
    rows.push(names.map((n) => Number(ex.features?.[n] ?? 0)));
    if (task === "1x2") y.push(ex.label_1x2);
    else if (task === "o25") y.push(ex.label_over25 ? 1 : 0);
    else y.push(ex.label_gg ? 1 : 0);
  }
  return { X: rows, y, featureNames: names, task };
}

/** Re-export batch extract for dataset pipelines. */
export { extractFeatureBatch };
