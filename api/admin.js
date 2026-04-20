import { assertAdmin } from "../server-utils/authAdmin.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import { parseUsageDayFromQuery } from "../server-utils/userDailyWarmPredictUsage.js";
import { invalidateCalibrationCache } from "../server-utils/isotonicCalibration.js";
import { invalidateStackerCache } from "../server-utils/mlStacker.js";
import { invalidateEloCache } from "../server-utils/teamElo.js";
import { invalidateTeamMarketRollingCache } from "../server-utils/teamMarketRolling.js";
import { MODEL_VERSION } from "../server-utils/modelConstants.js";

/**
 * Unified admin endpoint (consolidează fostele /api/admin/profiles și /api/admin/ml).
 *
 *   /api/admin                       → profiles (GET list, PATCH update) — default / view=profiles
 *   /api/admin?view=profiles         → profiles
 *   /api/admin?view=ml               → ML status (calibration + stacker + elo summary)
 *   /api/admin?view=ml&sub=calibration&leagueId=39   → calibration maps
 *   /api/admin?view=ml&sub=stacker&leagueId=39       → active stacker weights
 *   /api/admin?view=ml&sub=elo&leagueId=39           → team elo ratings
 *   POST /api/admin?view=ml&action=invalidate-cache  → soft refresh of in-memory caches
 */
export default async function handler(req, res) {
  const view = String(req.query.view || "").toLowerCase();
  if (view === "ml") return handleMl(req, res);
  return handleProfiles(req, res);
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function normalizeTierInput(rawTier) {
  if (rawTier == null) return null;
  const tier = String(rawTier).trim().toLowerCase();
  if (!tier) return null;
  if (tier === "free" || tier === "premium" || tier === "ultra") return tier;
  return "__invalid__";
}

function normalizeSubscriptionExpiry(rawValue) {
  if (rawValue === undefined) return { provided: false, invalid: false, value: null };
  if (rawValue === null || rawValue === "") return { provided: true, invalid: false, value: null };
  const parsed = new Date(String(rawValue));
  if (!Number.isFinite(parsed.getTime())) return { provided: true, invalid: true, value: null };
  return { provided: true, invalid: false, value: parsed.toISOString() };
}

async function handleProfiles(req, res) {
  if (req.method !== "GET" && req.method !== "PATCH") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const config = assertSupabaseConfigured();
  if (!config.ok) {
    return res.status(500).json({ ok: false, error: config.error });
  }

  const adminCheck = await assertAdmin(req);
  if (!adminCheck.ok) {
    return res.status(adminCheck.status || 403).json({ ok: false, error: adminCheck.error });
  }
  const requesterId = adminCheck.user?.id;

  const supabase = getSupabaseAdmin();

  try {
    if (req.method === "GET") {
      const includeWarmPredictUsage = String(req.query.includeWarmPredictUsage || "") === "1";
      const usageDay = parseUsageDayFromQuery(req.query);

      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, role, tier, subscription_expires_at, favorite_leagues, is_blocked, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      let items = data || [];

      if (includeWarmPredictUsage) {
        if (!usageDay) {
          return res.status(400).json({
            ok: false,
            error: "usageDay (YYYY-MM-DD) is required when includeWarmPredictUsage=1."
          });
        }
        const { data: usageRows, error: usageError } = await supabase
          .from("user_daily_warm_predict_usage")
          .select("user_id, warm_count, predict_count")
          .eq("usage_day", usageDay);
        if (usageError) throw usageError;
        const byUser = new Map((usageRows || []).map((r) => [r.user_id, r]));
        items = items.map((p) => {
          const u = byUser.get(p.user_id);
          return {
            ...p,
            warmPredictUsage: {
              usageDay,
              warm: u ? Number(u.warm_count) : 0,
              predict: u ? Number(u.predict_count) : 0
            }
          };
        });
      }

      return res.status(200).json({ ok: true, items });
    }

    const body = parseBody(req);
    const userId = String(body.userId || "").trim();
    const role = body.role;
    const isBlocked = body.isBlocked;
    const tier = normalizeTierInput(body.tier);
    const subscriptionExpiry = normalizeSubscriptionExpiry(body.subscriptionExpiresAt);

    if (!userId) {
      return res.status(400).json({ ok: false, error: "userId is required." });
    }

    const nextUpdate = {};
    if (role === "user" || role === "admin") nextUpdate.role = role;
    if (typeof isBlocked === "boolean") nextUpdate.is_blocked = isBlocked;
    if (tier === "__invalid__") {
      return res.status(400).json({ ok: false, error: "tier invalid. Allowed: free, premium, ultra." });
    }
    if (tier) nextUpdate.tier = tier;
    if (subscriptionExpiry.invalid) {
      return res.status(400).json({ ok: false, error: "subscriptionExpiresAt must be a valid ISO date or null." });
    }
    if (subscriptionExpiry.provided) nextUpdate.subscription_expires_at = subscriptionExpiry.value;

    if (!Object.keys(nextUpdate).length) {
      return res.status(400).json({ ok: false, error: "No valid fields to update." });
    }

    // Avoid accidental self lock-out from the admin workspace.
    if (requesterId && userId === requesterId) {
      if (nextUpdate.is_blocked === true) {
        return res.status(400).json({ ok: false, error: "Nu te poti bloca pe tine insuti." });
      }
      if (nextUpdate.role === "user") {
        return res.status(400).json({ ok: false, error: "Nu iti poti elimina propriul rol de admin." });
      }
    }

    // Keep at least one active admin account.
    if (nextUpdate.role === "user" || nextUpdate.is_blocked === true) {
      const { data: targetProfile, error: targetProfileError } = await supabase
        .from("profiles")
        .select("user_id, role, is_blocked")
        .eq("user_id", userId)
        .maybeSingle();
      if (targetProfileError) throw targetProfileError;
      const targetIsActiveAdmin = targetProfile?.role === "admin" && !targetProfile?.is_blocked;
      if (targetIsActiveAdmin) {
        const { data: activeAdmins, error: activeAdminsError } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("role", "admin")
          .eq("is_blocked", false);
        if (activeAdminsError) throw activeAdminsError;
        if ((activeAdmins || []).length <= 1) {
          return res.status(400).json({ ok: false, error: "Trebuie sa existe cel putin un admin activ." });
        }
      }
    }

    const { data, error } = await supabase
      .from("profiles")
      .update(nextUpdate)
      .eq("user_id", userId)
      .select("user_id, role, tier, subscription_expires_at, favorite_leagues, is_blocked, created_at, updated_at")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ ok: false, error: "Profile not found." });
    }
    return res.status(200).json({ ok: true, profile: data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Admin profiles request failed." });
  }
}

async function handleMl(req, res) {
  const admin = await assertAdmin(req);
  if (!admin.ok) return res.status(admin.status || 403).json({ ok: false, error: admin.error });

  const cfg = assertSupabaseConfigured();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase unavailable" });

  const sub = String(req.query.sub || "").toLowerCase();
  const action = String(req.query.action || "").toLowerCase();
  const leagueId = req.query.leagueId != null ? Number(req.query.leagueId) : null;
  const modelVersion = String(req.query.modelVersion || MODEL_VERSION);

  if (req.method === "POST" && action === "invalidate-cache") {
    invalidateCalibrationCache();
    invalidateStackerCache();
    invalidateEloCache();
    invalidateTeamMarketRollingCache();
    return res.status(200).json({ ok: true, invalidated: ["calibration", "stacker", "elo", "market-rolling"] });
  }

  if (sub === "calibration") {
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

  if (sub === "stacker") {
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

  if (sub === "elo") {
    const q = supabase
      .from("team_elo")
      .select("team_id, league_id, elo, matches_played, last_match_at, updated_at");
    if (leagueId != null && Number.isFinite(leagueId)) q.eq("league_id", leagueId);
    const { data, error } = await q.order("elo", { ascending: false }).limit(80);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, count: data?.length || 0, teams: data || [] });
  }

  if (sub === "market-rolling") {
    const season = Number(req.query.season) || new Date().getFullYear();
    const q = supabase
      .from("team_market_rolling")
      .select("*")
      .eq("season", season)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (leagueId != null && Number.isFinite(leagueId)) q.eq("league_id", leagueId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({
      ok: true,
      season,
      count: data?.length || 0,
      teams: data || []
    });
  }

  // default: status snapshot
  const [calib, stacker, elo, marketRolling] = await Promise.all([
    supabase
      .from("calibration_maps")
      .select("league_id", { count: "exact", head: true })
      .eq("model_version", modelVersion),
    supabase
      .from("ml_stacker_weights")
      .select("league_id", { count: "exact", head: true })
      .eq("model_version", modelVersion)
      .eq("active", true),
    supabase.from("team_elo").select("team_id", { count: "exact", head: true }),
    supabase.from("team_market_rolling").select("team_id", { count: "exact", head: true })
  ]);

  return res.status(200).json({
    ok: true,
    modelVersion,
    calibrationMaps: calib.count || 0,
    activeStackerWeights: stacker.count || 0,
    eloTeams: elo.count || 0,
    marketRollingTeams: marketRolling.count || 0,
    helpers: {
      invalidate: "POST /api/admin?view=ml&action=invalidate-cache",
      scripts: [
        "node --env-file=.env.local scripts/fitCalibration.js",
        "node --env-file=.env.local scripts/fitStacker.js",
        "BACKFILL_SEASONS=2023,2024 LEAGUE_IDS=39,140 node --env-file=.env.local scripts/rebuildElo.js",
        "SEASON=2024 ROLLING_WINDOW=15 node --env-file=.env.local scripts/rebuildTeamMarketRolling.js"
      ]
    }
  });
}
