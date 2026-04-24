import { assertAdmin } from "../server-utils/authAdmin.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import { parseUsageDayFromQuery } from "../server-utils/userDailyWarmPredictUsage.js";
import { mapUserIdsToEmails } from "../server-utils/adminUserEmails.js";
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

function resolvePublicBaseUrl(req) {
  const explicit = String(process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").trim();
  if (!host) return "http://localhost:3000";
  const proto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  const protocol = proto === "http" ? "http" : "https";
  return `${protocol}://${host}`.replace(/\/+$/, "");
}

function inferSeason(dateISO) {
  const [y, m] = String(dateISO || "").split("-").map(Number);
  if (!y || !m) return new Date().getFullYear() - 1;
  return m >= 7 ? y : y - 1;
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
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
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

      let data = null;
      let error = null;
      ({ data, error } = await supabase
        .from("profiles")
        .select("user_id, role, tier, subscription_expires_at, favorite_leagues, is_blocked, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(500));

      if (error) {
        const msg = String(error.message || "").toLowerCase();
        const missingTierCols = msg.includes("column") && (msg.includes("tier") || msg.includes("subscription_expires_at"));
        if (!missingTierCols) throw error;
        // Backward-compat: migration for tier/subscription not applied yet.
        const legacy = await supabase
          .from("profiles")
          .select("user_id, role, favorite_leagues, is_blocked, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(500);
        if (legacy.error) throw legacy.error;
        data = (legacy.data || []).map((row) => ({
          ...row,
          tier: "free",
          subscription_expires_at: null
        }));
        error = null;
      }

      if (error) throw error;
      let items = data || [];

      if (includeWarmPredictUsage) {
        if (!usageDay) {
          return res.status(400).json({
            ok: false,
            error: "usageDay (YYYY-MM-DD) este obligatoriu când includeWarmPredictUsage=1."
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

      const emailByUserId = await mapUserIdsToEmails(
        supabase,
        items.map((item) => item.user_id)
      );
      items = items.map((item) => ({
        ...item,
        email: emailByUserId.get(item.user_id) || null
      }));

      return res.status(200).json({ ok: true, items });
    }

    const body = parseBody(req);
    const userId = String(body.userId || "").trim();
    const role = body.role;
    const isBlocked = body.isBlocked;
    const tier = normalizeTierInput(body.tier);
    const subscriptionExpiry = normalizeSubscriptionExpiry(body.subscriptionExpiresAt);

    if (!userId) {
      return res.status(400).json({ ok: false, error: "userId este obligatoriu." });
    }

    const nextUpdate = {};
    if (role === "user" || role === "admin") nextUpdate.role = role;
    if (typeof isBlocked === "boolean") nextUpdate.is_blocked = isBlocked;
    if (tier === "__invalid__") {
      return res.status(400).json({ ok: false, error: "tier invalid. Valori permise: free, premium, ultra." });
    }
    if (tier) nextUpdate.tier = tier;
    if (subscriptionExpiry.invalid) {
      return res.status(400).json({ ok: false, error: "subscriptionExpiresAt trebuie să fie o dată ISO validă sau null." });
    }
    if (subscriptionExpiry.provided) nextUpdate.subscription_expires_at = subscriptionExpiry.value;

    if (!Object.keys(nextUpdate).length) {
      return res.status(400).json({ ok: false, error: "Nu există câmpuri valide pentru actualizare." });
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

    let data = null;
    let error = null;
    ({ data, error } = await supabase
      .from("profiles")
      .update(nextUpdate)
      .eq("user_id", userId)
      .select("user_id, role, tier, subscription_expires_at, favorite_leagues, is_blocked, created_at, updated_at")
      .maybeSingle());

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      const missingTierCols = msg.includes("column") && (msg.includes("tier") || msg.includes("subscription_expires_at"));
      const touchesTierFields =
        Object.prototype.hasOwnProperty.call(nextUpdate, "tier")
        || Object.prototype.hasOwnProperty.call(nextUpdate, "subscription_expires_at");

      if (!missingTierCols) throw error;

      // Backward-compat: when migration is missing, allow non-tier updates to proceed.
      if (!touchesTierFields) {
        const legacy = await supabase
          .from("profiles")
          .update(nextUpdate)
          .eq("user_id", userId)
          .select("user_id, role, favorite_leagues, is_blocked, created_at, updated_at")
          .maybeSingle();
        if (legacy.error) throw legacy.error;
        data = legacy.data
          ? {
              ...legacy.data,
              tier: "free",
              subscription_expires_at: null
            }
          : null;
      } else {
        return res.status(409).json({
          ok: false,
          error:
            "Planul nu poate fi salvat deoarece lipsesc coloanele tier/subscription_expires_at din tabela profiles. Rulează migrarea 016_user_tiers_and_trials.sql."
        });
      }
    }

    if (!data) {
      return res.status(404).json({ ok: false, error: "Profilul nu a fost găsit." });
    }
    return res.status(200).json({ ok: true, profile: data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Cererea profilurilor admin a eșuat." });
  }
}

async function handleMl(req, res) {
  const admin = await assertAdmin(req);
  if (!admin.ok) return res.status(admin.status || 403).json({ ok: false, error: admin.error });

  const cfg = assertSupabaseConfigured();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase nu este disponibil" });

  const sub = String(req.query.sub || "").toLowerCase();
  const action = String(req.query.action || "").toLowerCase();
  const leagueId = req.query.leagueId != null ? Number(req.query.leagueId) : null;
  const modelVersion = String(req.query.modelVersion || MODEL_VERSION);
  const todayIso = new Date().toISOString().slice(0, 10);
  const inferredSeason = inferSeason(todayIso);
  const prewarmSeasonOverrideRaw = String(process.env.PREWARM_SEASON || "").trim();
  const prewarmSeasonOverride = prewarmSeasonOverrideRaw ? Number(prewarmSeasonOverrideRaw) : null;

  if (req.method === "POST" && action === "invalidate-cache") {
    invalidateCalibrationCache();
    invalidateStackerCache();
    invalidateEloCache();
    invalidateTeamMarketRollingCache();
    return res.status(200).json({ ok: true, invalidated: ["calibration", "stacker", "elo", "market-rolling"] });
  }

  if (req.method === "POST" && action === "train-now") {
    const mode = String(req.query.mode || "all").toLowerCase();
    const cronSecret = String(process.env.CRON_SECRET || "");
    if (!cronSecret) {
      return res.status(500).json({
        ok: false,
        error: "CRON_SECRET lipsește. Train-now folosește endpointul intern /api/cron/daily-ml."
      });
    }
    try {
      const base = resolvePublicBaseUrl(req);
      const qs = new URLSearchParams({
        mode,
        modelVersion
      });
      const run = await fetch(`${base}/api/cron/daily-ml?${qs.toString()}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${cronSecret}`,
          "x-internal-admin": "ml-train-now"
        }
      });
      const body = await run.json().catch(() => ({}));
      if (!run.ok || body?.ok === false) {
        return res.status(502).json({
          ok: false,
          mode,
          modelVersion,
          status: run.status,
          error: body?.error || "Train-now a eșuat la /api/cron/daily-ml.",
          train: body
        });
      }
      return res.status(200).json({
        ok: true,
        mode,
        modelVersion,
        status: run.status,
        train: body
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        mode,
        modelVersion,
        error: error?.message || "Train-now a eșuat."
      });
    }
  }

  if (req.method === "POST" && action === "history-sync-now") {
    const cronSecret = String(process.env.CRON_SECRET || "");
    if (!cronSecret) {
      return res.status(500).json({
        ok: false,
        error: "CRON_SECRET lipsește. History sync now folosește endpointul intern /api/history?sync=1."
      });
    }
    try {
      const days = Number(req.query.days || 30);
      const safeDays = Number.isFinite(days) && days > 0 ? Math.min(90, Math.floor(days)) : 30;
      const base = resolvePublicBaseUrl(req);
      const run = await fetch(`${base}/api/history?sync=1&days=${safeDays}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${cronSecret}`,
          "x-internal-admin": "history-sync-now"
        }
      });
      const body = await run.json().catch(() => ({}));
      if (!run.ok || body?.ok === false) {
        return res.status(502).json({
          ok: false,
          status: run.status,
          error: body?.error || "History sync now a eșuat la /api/history?sync=1.",
          sync: body
        });
      }
      return res.status(200).json({
        ok: true,
        status: run.status,
        sync: body
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error?.message || "History sync now a eșuat."
      });
    }
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

  const deriveHistorySyncHealth = (statusRow, recentRows) => {
    const now = Date.now();
    const lastRanAt = statusRow?.last_ran_at ? new Date(statusRow.last_ran_at).getTime() : NaN;
    const hoursSinceLastRun = Number.isFinite(lastRanAt) ? (now - lastRanAt) / (1000 * 60 * 60) : Number.POSITIVE_INFINITY;
    if (statusRow?.last_ok === false) return "fail";
    if (!Number.isFinite(hoursSinceLastRun) || hoursSinceLastRun > 8) return "warn";
    const failedRecent = (recentRows || []).some((row) => row?.ok === false);
    if (failedRecent) return "warn";
    return "ok";
  };
  const deriveHistorySyncHint = (statusRow, recentRows, hoursSinceLastRun) => {
    const errors = (recentRows || [])
      .filter((row) => row?.ok === false && row?.error)
      .map((row) => String(row.error).toLowerCase());
    if ((hoursSinceLastRun ?? 999) > 8) {
      return {
        level: "warn",
        title: "Sync stale",
        message: "Ultima rulare este mai veche de 8h. Verifică jobul cron și deploy-ul curent."
      };
    }
    if (errors.some((e) => e.includes("401") || e.includes("403") || e.includes("unauthorized") || e.includes("forbidden"))) {
      return {
        level: "fail",
        title: "Auth failure",
        message: "Au apărut erori de autorizare. Verifică CRON_SECRET și header-ele interne."
      };
    }
    if (errors.some((e) => e.includes("429") || e.includes("rate"))) {
      return {
        level: "warn",
        title: "Rate limited",
        message: "Sync-ul întâlnește rate limiting. Ajustează frecvența cron sau cache TTL."
      };
    }
    if (errors.some((e) => e.includes("timeout") || e.includes("fetch") || e.includes("network"))) {
      return {
        level: "warn",
        title: "Upstream/network",
        message: "Există indicii de timeout/network pe upstream. Verifică disponibilitatea providerului."
      };
    }
    if (statusRow?.last_ok === false) {
      return {
        level: "warn",
        title: "Recent failure",
        message: "Ultima rulare a eșuat. Verifică eroarea curentă și rulează manual sync pentru confirmare."
      };
    }
    return {
      level: "ok",
      title: "Healthy",
      message: "Sync-ul rulează în parametri normali."
    };
  };

  // default: status snapshot
  const [calib, stacker, elo, marketRolling, historyStatus, historyRecent] = await Promise.all([
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
    supabase.from("team_market_rolling").select("team_id", { count: "exact", head: true }),
    supabase
      .from("history_sync_status")
      .select("last_ran_at, last_source, last_method, last_scanned, last_updated, last_estimated_calls, last_ok, last_error")
      .eq("id", 1)
      .maybeSingle(),
    supabase
      .from("history_sync_log")
      .select(
        "ran_at, source, method, ok, scanned, updated, estimated_calls, error, persist_inserted, persist_updated, persist_skipped_final, persist_skipped_stale, persist_skipped_prekickoff"
      )
      .order("ran_at", { ascending: false })
      .limit(8)
  ]);

  const recentRuns = Array.isArray(historyRecent.data) ? historyRecent.data : [];
  const recentRunsNormalized = recentRuns.map((row) => ({
    ranAt: row.ran_at || null,
    source: row.source || null,
    method: row.method || null,
    ok: Boolean(row.ok),
    scanned: Number(row.scanned || 0),
    updated: Number(row.updated || 0),
    estimatedCalls: Number(row.estimated_calls || 0),
    error: row.error || null,
    persistInserted: Number(row.persist_inserted || 0),
    persistUpdated: Number(row.persist_updated || 0),
    persistSkippedFinal: Number(row.persist_skipped_final || 0),
    persistSkippedStale: Number(row.persist_skipped_stale || 0),
    persistSkippedPrekickoff: Number(row.persist_skipped_prekickoff || 0)
  }));
  const lastSuccessfulRun = recentRunsNormalized.find((row) => row.ok === true) || null;
  const recentFailures = recentRunsNormalized.filter((row) => row.ok === false).length;
  const recentUpdatedTotal = recentRunsNormalized.reduce((sum, row) => sum + Number(row.updated || 0), 0);
  const recentEstimatedCallsTotal = recentRunsNormalized.reduce((sum, row) => sum + Number(row.estimatedCalls || 0), 0);
  const historySyncHealth = deriveHistorySyncHealth(historyStatus.data, recentRuns);
  const lastRanAtMs = historyStatus.data?.last_ran_at ? new Date(historyStatus.data.last_ran_at).getTime() : NaN;
  const hoursSinceLastRun = Number.isFinite(lastRanAtMs) ? Number(((Date.now() - lastRanAtMs) / (1000 * 60 * 60)).toFixed(2)) : null;
  const persistRuns = recentRunsNormalized.filter((row) => row.source === "predict_persist");
  const historySyncHint = deriveHistorySyncHint(historyStatus.data, recentRuns, hoursSinceLastRun);
  const nowMs = Date.now();
  const runs24h = recentRunsNormalized.filter((row) => {
    const ts = row.ranAt ? new Date(row.ranAt).getTime() : NaN;
    return Number.isFinite(ts) && nowMs - ts <= 24 * 60 * 60 * 1000;
  });
  const successful24h = runs24h.filter((row) => row.ok).length;
  const successRate24h = runs24h.length > 0 ? Number(((successful24h / runs24h.length) * 100).toFixed(1)) : null;
  const updated24h = runs24h.reduce((sum, row) => sum + Number(row.updated || 0), 0);
  const scanned24h = runs24h.reduce((sum, row) => sum + Number(row.scanned || 0), 0);
  const estimatedCalls24h = runs24h.reduce((sum, row) => sum + Number(row.estimatedCalls || 0), 0);
  const avgEstimatedCallsPerRun =
    recentRunsNormalized.length > 0
      ? Number((recentEstimatedCallsTotal / recentRunsNormalized.length).toFixed(1))
      : null;
  const callsBudgetWarn24h = Math.max(50, Number(process.env.HISTORY_SYNC_CALLS_WARN_24H || 500));
  const callsBudgetCritical24h = Math.max(callsBudgetWarn24h, Number(process.env.HISTORY_SYNC_CALLS_CRITICAL_24H || 1000));
  const callsBudgetLevel =
    estimatedCalls24h >= callsBudgetCritical24h ? "critical" : estimatedCalls24h >= callsBudgetWarn24h ? "warn" : "ok";
  const lastSuccessfulRunAtMs = lastSuccessfulRun?.ranAt ? new Date(lastSuccessfulRun.ranAt).getTime() : NaN;
  const hoursSinceLastSuccess = Number.isFinite(lastSuccessfulRunAtMs)
    ? Number(((Date.now() - lastSuccessfulRunAtMs) / (1000 * 60 * 60)).toFixed(2))
    : null;
  const proactiveAlerts = [];
  if ((hoursSinceLastRun ?? 999) > 8) {
    proactiveAlerts.push({
      level: "fail",
      code: "sync_stale",
      message: "Sync oprit/stale: ultima rulare este mai veche de 8h."
    });
  }
  if (runs24h.length === 0) {
    proactiveAlerts.push({
      level: "fail",
      code: "zero_runs_24h",
      message: "Nu există rulări de sync în ultimele 24h."
    });
  }
  if (successRate24h != null && successRate24h < 80) {
    proactiveAlerts.push({
      level: "warn",
      code: "low_success_rate_24h",
      message: `Rata de succes pe 24h este ${successRate24h.toFixed(1)}% (<80%).`
    });
  }
  if (updated24h === 0 && scanned24h > 0) {
    proactiveAlerts.push({
      level: "warn",
      code: "no_updates_24h",
      message: "Au existat rulări, dar fără update-uri în ultimele 24h."
    });
  }
  if (callsBudgetLevel === "critical") {
    proactiveAlerts.push({
      level: "fail",
      code: "high_sync_calls_24h_critical",
      message: `Cost ridicat: history sync are ${estimatedCalls24h} calls estimate în 24h (>= ${callsBudgetCritical24h}).`
    });
  } else if (callsBudgetLevel === "warn") {
    proactiveAlerts.push({
      level: "warn",
      code: "high_sync_calls_24h_warn",
      message: `Cost în creștere: history sync are ${estimatedCalls24h} calls estimate în 24h (>= ${callsBudgetWarn24h}).`
    });
  }
  let reliability = "HEALTHY";
  if (
    (hoursSinceLastSuccess ?? 999) > 8
    || runs24h.length === 0
    || (successRate24h != null && successRate24h < 60)
  ) {
    reliability = "CRITICAL";
  } else if (
    (hoursSinceLastSuccess ?? 0) > 4
    || (successRate24h != null && successRate24h < 90)
    || recentFailures > 0
  ) {
    reliability = "DEGRADED";
  }
  const persistSummary = {
    runs: persistRuns.length,
    inserted: persistRuns.reduce((sum, row) => sum + Number(row.persistInserted || 0), 0),
    updated: persistRuns.reduce((sum, row) => sum + Number(row.persistUpdated || 0), 0),
    skippedFinal: persistRuns.reduce((sum, row) => sum + Number(row.persistSkippedFinal || 0), 0),
    skippedStale: persistRuns.reduce((sum, row) => sum + Number(row.persistSkippedStale || 0), 0),
    skippedPrekickoff: persistRuns.reduce((sum, row) => sum + Number(row.persistSkippedPrekickoff || 0), 0)
  };

  return res.status(200).json({
    ok: true,
    modelVersion,
    calibrationMaps: calib.count || 0,
    activeStackerWeights: stacker.count || 0,
    eloTeams: elo.count || 0,
    marketRollingTeams: marketRolling.count || 0,
    historySync: {
      health: historySyncHealth,
      last: historyStatus.data
        ? {
            ranAt: historyStatus.data.last_ran_at || null,
            source: historyStatus.data.last_source || null,
            method: historyStatus.data.last_method || null,
            scanned: Number(historyStatus.data.last_scanned || 0),
            updated: Number(historyStatus.data.last_updated || 0),
            estimatedCalls: Number(historyStatus.data.last_estimated_calls || 0),
            ok: Boolean(historyStatus.data.last_ok),
            error: historyStatus.data.last_error || null
          }
        : null,
      recent: recentRunsNormalized,
      summary: {
        runs: recentRunsNormalized.length,
        failures: recentFailures,
        updatedTotal: recentUpdatedTotal,
        estimatedCallsTotal: recentEstimatedCallsTotal,
        avgEstimatedCallsPerRun,
        hoursSinceLastRun,
        hoursSinceLastSuccess,
        runs24h: runs24h.length,
        successRate24h,
        updated24h,
        scanned24h,
        estimatedCalls24h,
        callsBudgetWarn24h,
        callsBudgetCritical24h,
        callsBudgetLevel,
        reliability
      },
      persist: persistSummary,
      hint: historySyncHint,
      alerts: proactiveAlerts,
      lastSuccessfulRun
    },
    seasonInfo: {
      today: todayIso,
      inferredSeason,
      effectiveSeason: Number.isFinite(prewarmSeasonOverride) ? prewarmSeasonOverride : inferredSeason,
      overrideActive: Number.isFinite(prewarmSeasonOverride)
    },
    helpers: {
      invalidate: "POST /api/admin?view=ml&action=invalidate-cache",
      trainNow: "POST /api/admin?view=ml&action=train-now&mode=all|calibration|stacker",
      historySyncNow: "POST /api/admin?view=ml&action=history-sync-now&days=30",
      scripts: [
        "node --env-file=.env.local scripts/fitCalibration.js",
        "node --env-file=.env.local scripts/fitStacker.js",
        "BACKFILL_SEASONS=2023,2024 LEAGUE_IDS=39,140 node --env-file=.env.local scripts/rebuildElo.js",
        "SEASON=<inferSeason(date)> ROLLING_WINDOW=15 node --env-file=.env.local scripts/rebuildTeamMarketRolling.js"
      ]
    }
  });
}
