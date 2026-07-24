/**
 * Persist context-capture snapshots for backtesting (service_role).
 * Failures are non-fatal — predict must not break.
 */

import { getSupabaseAdmin } from "../supabaseAdmin.js";
import { CONTEXT_SNAPSHOT_SCHEMA_VERSION } from "./captureContextSnapshot.js";

const TABLE = "prediction_context_snapshots";

/**
 * @param {object[]} snapshots - snapshot objects built by buildContextSnapshot()
 */
export async function persistContextSnapshots(snapshots = []) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !Array.isArray(snapshots) || snapshots.length === 0) {
    return { ok: false, upserted: 0 };
  }

  const rows = [];
  for (const snap of snapshots) {
    if (!snap) continue;
    const fixtureId = Number(snap.fixtureId);
    if (!Number.isFinite(fixtureId)) continue;
    rows.push({
      fixture_id: fixtureId,
      model_version: String(snap.modelVersion || "unknown"),
      schema_version: snap.schemaVersion || CONTEXT_SNAPSHOT_SCHEMA_VERSION,
      league_id: snap.leagueId != null ? Number(snap.leagueId) : null,
      kickoff_at: snap.kickoff || null,
      referee_name: snap.refereeName || null,
      injuries: snap.injuries || null,
      home_lineup: snap.homeLineup || null,
      away_lineup: snap.awayLineup || null,
      home_recent_matches: snap.homeRecentMatches || null,
      away_recent_matches: snap.awayRecentMatches || null,
      home_last_match_date: snap.homeLastMatchDate || null,
      away_last_match_date: snap.awayLastMatchDate || null,
      weather: snap.weather || null,
      referee_stats: snap.refereeStats || null,
      captured_at: snap.capturedAt || new Date().toISOString()
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

export default { persistContextSnapshots };
