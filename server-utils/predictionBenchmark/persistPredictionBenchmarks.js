/**
 * Persist API-Football benchmark comparisons (service_role). Mirrors
 * server-utils/context/persistContextSnapshots.js exactly. Failures are
 * non-fatal — this runs entirely outside the /api/predict request path (see
 * runBenchmarkSweep.js), so there is nothing here that can break prediction.
 */

import { getSupabaseAdmin } from "../supabaseAdmin.js";

const TABLE = "prediction_benchmarks";

/**
 * @param {object[]} benchmarkRows each: { fixtureId, leagueId, kickoffAt, modelVersion, schemaVersion,
 *   ourPick, ourFamily, ourConfidence, ourOdd, apiPrediction, apiRaw, consensus,
 *   scoreHome, scoreAway, ourResult, apiResult, settledAt }
 * @returns {Promise<{ok: boolean, upserted: number, error?: string}>}
 */
export async function persistPredictionBenchmarks(benchmarkRows = []) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !Array.isArray(benchmarkRows) || benchmarkRows.length === 0) {
    return { ok: false, upserted: 0 };
  }

  const rows = [];
  for (const b of benchmarkRows) {
    if (!b) continue;
    const fixtureId = Number(b.fixtureId);
    if (!Number.isFinite(fixtureId)) continue;
    rows.push({
      fixture_id: fixtureId,
      league_id: b.leagueId != null ? Number(b.leagueId) : null,
      kickoff_at: b.kickoffAt || null,
      model_version: String(b.modelVersion || "unknown"),
      schema_version: b.schemaVersion || "benchmark-v1",
      our_pick: String(b.ourPick || ""),
      our_family: b.ourFamily || null,
      our_confidence: Number.isFinite(Number(b.ourConfidence)) ? Number(b.ourConfidence) : null,
      our_odd: Number.isFinite(Number(b.ourOdd)) ? Number(b.ourOdd) : null,
      api_prediction: b.apiPrediction || null,
      api_raw: b.apiRaw || null,
      consensus: b.consensus || null,
      agree: b.consensus?.agree ?? null,
      confidence_delta: b.consensus?.confidenceDelta ?? null,
      score_home: Number.isFinite(Number(b.scoreHome)) ? Number(b.scoreHome) : null,
      score_away: Number.isFinite(Number(b.scoreAway)) ? Number(b.scoreAway) : null,
      our_result: b.ourResult || "pending",
      api_result: b.apiResult || "pending",
      settled_at: b.settledAt || null
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

export default { persistPredictionBenchmarks };
