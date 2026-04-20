import { assertAdmin } from "../../server-utils/authAdmin.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../../server-utils/supabaseAdmin.js";
import { invalidateCalibrationCache } from "../../server-utils/isotonicCalibration.js";
import { invalidateStackerCache } from "../../server-utils/mlStacker.js";
import { invalidateEloCache } from "../../server-utils/teamElo.js";
import { MODEL_VERSION } from "../../server-utils/modelConstants.js";

/**
 * GET /api/admin/ml?view=status                    — status summary (calibration + stacker + elo)
 * POST /api/admin/ml?action=invalidate-cache       — soft refresh of in-memory caches
 * GET /api/admin/ml?view=calibration&leagueId=39   — list fitted maps
 * GET /api/admin/ml?view=stacker&leagueId=39       — list active stacker weights
 *
 * Nu poate antrena din endpoint (cost CPU/timp > 10s limit Vercel). Antrenamentul rulează via:
 *   `node --env-file=.env.local scripts/fitCalibration.js`
 *   `node --env-file=.env.local scripts/fitStacker.js`
 *   `node --env-file=.env.local scripts/rebuildElo.js`
 */
export default async function handler(req, res) {
  const admin = await assertAdmin(req);
  if (!admin.ok) return res.status(admin.status || 403).json({ ok: false, error: admin.error });

  const cfg = assertSupabaseConfigured();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase unavailable" });

  const view = String(req.query.view || "").toLowerCase();
  const action = String(req.query.action || "").toLowerCase();
  const leagueId = req.query.leagueId != null ? Number(req.query.leagueId) : null;
  const modelVersion = String(req.query.modelVersion || MODEL_VERSION);

  if (req.method === "POST" && action === "invalidate-cache") {
    invalidateCalibrationCache();
    invalidateStackerCache();
    invalidateEloCache();
    return res.status(200).json({ ok: true, invalidated: ["calibration", "stacker", "elo"] });
  }

  if (view === "calibration") {
    const q = supabase
      .from("calibration_maps")
      .select("league_id, outcome, sample_size, brier_raw, brier_calibrated, fitted_at")
      .eq("model_version", modelVersion)
      .order("fitted_at", { ascending: false });
    if (leagueId != null && Number.isFinite(leagueId)) q.eq("league_id", leagueId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ ok: false, error: error.message });
    const byLeague = new Map();
    for (const row of data || []) {
      const key = row.league_id;
      if (!byLeague.has(key)) byLeague.set(key, { leagueId: key, outcomes: [] });
      byLeague.get(key).outcomes.push({
        outcome: row.outcome,
        sampleSize: row.sample_size,
        brierRaw: row.brier_raw,
        brierCalibrated: row.brier_calibrated,
        brierDelta:
          row.brier_raw != null && row.brier_calibrated != null
            ? Number((row.brier_calibrated - row.brier_raw).toFixed(5))
            : null,
        fittedAt: row.fitted_at
      });
    }
    return res.status(200).json({
      ok: true,
      modelVersion,
      count: data?.length || 0,
      byLeague: Array.from(byLeague.values())
    });
  }

  if (view === "stacker") {
    const q = supabase
      .from("ml_stacker_weights")
      .select("league_id, sample_size, feature_count, metrics_json, fitted_at, active")
      .eq("model_version", modelVersion)
      .eq("active", true)
      .order("league_id", { ascending: true, nullsFirst: true });
    if (leagueId != null && Number.isFinite(leagueId)) q.eq("league_id", leagueId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({
      ok: true,
      modelVersion,
      count: data?.length || 0,
      weights: (data || []).map((row) => ({
        leagueId: row.league_id,
        sampleSize: row.sample_size,
        featureCount: row.feature_count,
        metrics: row.metrics_json,
        fittedAt: row.fitted_at
      }))
    });
  }

  if (view === "elo") {
    const q = supabase
      .from("team_elo")
      .select("team_id, league_id, elo, matches_played, last_match_at, updated_at");
    if (leagueId != null && Number.isFinite(leagueId)) q.eq("league_id", leagueId);
    const { data, error } = await q.order("elo", { ascending: false }).limit(80);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, count: data?.length || 0, teams: data || [] });
  }

  // default: status snapshot
  const [calib, stacker, elo] = await Promise.all([
    supabase
      .from("calibration_maps")
      .select("league_id", { count: "exact", head: true })
      .eq("model_version", modelVersion),
    supabase
      .from("ml_stacker_weights")
      .select("league_id", { count: "exact", head: true })
      .eq("model_version", modelVersion)
      .eq("active", true),
    supabase.from("team_elo").select("team_id", { count: "exact", head: true })
  ]);

  return res.status(200).json({
    ok: true,
    modelVersion,
    calibrationMaps: calib.count || 0,
    activeStackerWeights: stacker.count || 0,
    eloTeams: elo.count || 0,
    helpers: {
      invalidate: "POST /api/admin/ml?action=invalidate-cache",
      scripts: [
        "node --env-file=.env.local scripts/fitCalibration.js",
        "node --env-file=.env.local scripts/fitStacker.js",
        "BACKFILL_SEASONS=2023,2024 LEAGUE_IDS=39,140 node --env-file=.env.local scripts/rebuildElo.js"
      ]
    }
  });
}
