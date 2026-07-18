/**
 * Prediction history database access for ML pipelines.
 * Reads from predictions_history; optional write to ml_training_examples.
 * Does not change online predict behavior.
 */

import { getSupabaseAdmin } from "../../supabaseAdmin.js";
import { buildTrainingExample } from "../dataset/TrainingDataset.js";
import { FEATURE_SCHEMA_VERSION } from "../featureCatalog.js";

const HISTORY_TABLE = "predictions_history";
const TRAINING_TABLE = "ml_training_examples";
const REGISTRY_TABLE = "ml_model_registry";

const HISTORY_SELECT = [
  "fixture_id",
  "league_id",
  "kickoff_at",
  "model_version",
  "odds_home",
  "odds_draw",
  "odds_away",
  "score_home",
  "score_away",
  "match_status",
  "validation",
  "recommended_pick",
  "recommended_confidence",
  "raw_payload"
].join(", ");

/**
 * Fetch settled (or all) prediction history rows for dataset building.
 * @param {{ days?: number, leagueId?: number, settledOnly?: boolean, limit?: number }} opts
 */
export async function fetchPredictionHistory(opts = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, error: "supabase_unavailable", rows: [] };

  const days = Math.max(1, Math.min(Number(opts.days) || 180, 720));
  const limit = Math.max(1, Math.min(Number(opts.limit) || 5000, 20000));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  let q = supabase
    .from(HISTORY_TABLE)
    .select(HISTORY_SELECT)
    .gte("kickoff_at", since)
    .order("kickoff_at", { ascending: false })
    .limit(limit);

  if (opts.leagueId != null) q = q.eq("league_id", Number(opts.leagueId));
  if (opts.settledOnly !== false) {
    q = q.in("match_status", ["FT", "AET", "PEN"]);
  }

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message, rows: [] };
  return { ok: true, rows: data || [], days, limit };
}

/**
 * Upsert engineered training examples derived from history rows.
 * Offline / cron use only — not wired into /api/predict.
 * @param {object[]} historyRows
 * @param {{ engineer?: boolean }} opts
 */
export async function upsertTrainingExamples(historyRows = [], opts = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, error: "supabase_unavailable", upserted: 0 };

  const examples = historyRows.map((r) => {
    const ex = buildTrainingExample(r, { engineer: opts.engineer !== false });
    return {
      fixture_id: Number(ex.fixture_id),
      league_id: ex.league_id != null ? Number(ex.league_id) : null,
      kickoff_at: ex.kickoff_at,
      model_version: ex.model_version,
      feature_schema_version: ex.feature_schema_version || FEATURE_SCHEMA_VERSION,
      label_1x2: ex.label_1x2,
      label_gg: ex.label_gg,
      label_over25: ex.label_over25,
      features: ex.features,
      feature_names: ex.feature_names,
      split: ex.split,
      source_row: { fixture_id: ex.fixture_id },
      updated_at: new Date().toISOString()
    };
  }).filter((e) => Number.isFinite(e.fixture_id));

  if (examples.length === 0) return { ok: true, upserted: 0 };

  const { error } = await supabase.from(TRAINING_TABLE).upsert(examples, {
    onConflict: "fixture_id,model_version,feature_schema_version"
  });
  if (error) return { ok: false, error: error.message, upserted: 0 };
  return { ok: true, upserted: examples.length };
}

/**
 * List planned / registered model metadata.
 */
export async function listModelRegistry() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, error: "supabase_unavailable", models: [] };
  const { data, error } = await supabase
    .from(REGISTRY_TABLE)
    .select("model_key, family, task, feature_schema_version, model_version, status, metrics_json, notes, updated_at")
    .order("family", { ascending: true });
  if (error) return { ok: false, error: error.message, models: [] };
  return { ok: true, models: data || [] };
}

export { HISTORY_TABLE, TRAINING_TABLE, REGISTRY_TABLE };
