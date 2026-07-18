/**
 * Persist feature importance rows for ML (service_role).
 * Failures are non-fatal — predict must not break.
 */

import { getSupabaseAdmin } from "../supabaseAdmin.js";
import { FeatureImportanceEngine } from "./FeatureImportanceEngine.js";

const TABLE = "prediction_feature_importance";

/**
 * @param {object[]} predictions - prediction rows that include featureImportance
 */
export async function persistFeatureImportanceRows(predictions = []) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !Array.isArray(predictions) || predictions.length === 0) {
    return { ok: false, upserted: 0 };
  }

  const rows = [];
  for (const p of predictions) {
    const fi = p.featureImportance;
    if (!fi?.contributions) continue;
    const fixtureId = Number(p.id);
    if (!Number.isFinite(fixtureId)) continue;
    rows.push({
      fixture_id: fixtureId,
      model_version: String(p.modelVersion || p.modelMeta?.modelVersion || "unknown"),
      schema_version: fi.schemaVersion || FeatureImportanceEngine.SCHEMA_VERSION,
      league_id: p.leagueId != null ? Number(p.leagueId) : null,
      kickoff_at: p.kickoff || null,
      recommended_pick: p.recommended?.pick || null,
      contributions: fi.contributions,
      items: fi.items || [],
      top_features: Array.isArray(fi.topFeatures) ? fi.topFeatures : [],
      method: fi.method || null,
      updated_at: new Date().toISOString()
    });
  }

  if (rows.length === 0) return { ok: true, upserted: 0 };

  try {
    const { error } = await supabase.from(TABLE).upsert(rows, {
      onConflict: "fixture_id,model_version,schema_version"
    });
    if (error) return { ok: false, upserted: 0, error: error.message };
    return { ok: true, upserted: rows.length };
  } catch (e) {
    return { ok: false, upserted: 0, error: e?.message || "persist_failed" };
  }
}
