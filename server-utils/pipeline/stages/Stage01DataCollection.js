/**
 * Stage01DataCollection — auth, tier, fixtures, odds, calib/stacker load.
 * Moved from api/predict.js. Never calls other stages.
 */

import { getApiUsage, getWithCache } from "../../fetcher.js";
import { resolveAuthenticatedUsageContext } from "../../userDailyWarmPredictUsage.js";
import { isAuthorizedCronOrInternalRequest } from "../../cronRequestAuth.js";
import {
  USER_TIERS,
  maskPredictionForTier,
  resolveEffectiveTierFromProfile,
  tierDailyLimit
} from "../../accessTier.js";
import { getSupabaseAdmin } from "../../supabaseAdmin.js";
import { mapDbRowToHistoryEntry } from "../../predictionsHistory.js";
import { getPredictionWeights } from "../../prediction/PredictionEngine.js";
import { getActiveModelId } from "../../modelLab/AutoModelSelection.js";
import { loadCalibrationMaps } from "../../isotonicCalibration.js";
import { loadStackerWeights } from "../../mlStacker.js";
import { refreshAutoCalibrationOverlays } from "../../calibration/overlayRuntime.js";
import { prefetchOddsByDate } from "../../oddsPrefetch.js";
import { MODEL_VERSION } from "../../modelConstants.js";
import { LIVE_ROLLING_MAX_UNCACHED_STATS_CALLS, loadRiskContext } from "../predictHelpers.js";
import { halt } from "../PipelineContext.js";

export const STAGE_ID = "Stage01DataCollection";
export const STAGE_DESCRIPTION =
  "Auth, tier policy, DB-only guards, fixtures/odds prefetch, calibration + stacker load.";

/**
 * @param {object} context
 */
export async function run(context) {
  if (context.halted) return context;

  const { req, res } = context;
  const date = context.date;
  const leagueIds = context.leagueIds;
  let effectiveLimit = context.effectiveLimit;

  // Cron uses CRON_SECRET as Bearer — must not call auth.getUser on that token.
  const isCron = context.isCronInternal === true || isAuthorizedCronOrInternalRequest(req);
  context.isCronInternal = isCron;

  let usageCtx;
  if (isCron) {
    usageCtx = { anonymous: true, cronInternal: true, userId: null };
    context.usageCtx = usageCtx;
  } else {
    usageCtx = await resolveAuthenticatedUsageContext(req);
    context.usageCtx = usageCtx;
    if (usageCtx.error) {
      return halt(context, usageCtx.error.status, usageCtx.error.body);
    }
    if (usageCtx.anonymous) {
      return halt(context, 401, { ok: false, error: "Autentificare necesară pentru Predict." });
    }
  }

  let tierContext = null;
  let reservedTierUsage = 0;

  if (!isCron && !usageCtx.anonymous && usageCtx.userId) {
    const supabase = getSupabaseAdmin();
    let profile = null;
    let { data: profData, error: profileError } = await supabase
      .from("profiles")
      .select("role, tier, subscription_expires_at, premium_trial_activated_at, ultra_trial_activated_at, created_at")
      .eq("user_id", usageCtx.userId)
      .maybeSingle();
    if (profileError) {
      const msg = String(profileError.message || "").toLowerCase();
      const missingTierCols = msg.includes("column") && (msg.includes("tier") || msg.includes("subscription_expires_at"));
      if (!missingTierCols) {
        return halt(context, 500, { ok: false, error: profileError.message || "Nu am putut verifica abonamentul." });
      }
      const { data: legacyData, error: legacyError } = await supabase
        .from("profiles")
        .select("created_at")
        .eq("user_id", usageCtx.userId)
        .maybeSingle();
      if (legacyError) {
        return halt(context, 500, { ok: false, error: legacyError.message || "Nu am putut verifica profilul." });
      }
      profile = { role: "user", tier: USER_TIERS.FREE, created_at: legacyData?.created_at };
    } else {
      profile = profData;
    }
    if (!profile) {
      return halt(context, 404, { ok: false, error: "Profil utilizator inexistent." });
    }

    const tierInfo = resolveEffectiveTierFromProfile(profile);
    const role = String(profile?.role || "").toLowerCase();
    const quotaExempt = role === "admin";
    tierContext = {
      ...tierInfo,
      effectiveTier: quotaExempt ? USER_TIERS.ULTRA : tierInfo.effectiveTier,
      quotaExempt,
      predictCountToday: null,
      predictLimit: null
    };

    const readDbOnlyPredictions = async (reason = "db_only_free") => {
      const from = `${date}T00:00:00.000Z`;
      const to = `${date}T23:59:59.999Z`;
      const leagueFilter = leagueIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));
      const sb = getSupabaseAdmin();
      let query = sb
        .from("predictions_history")
        .select("*")
        .gte("kickoff_at", from)
        .lte("kickoff_at", to)
        .order("kickoff_at", { ascending: true })
        .limit(200);
      if (leagueFilter.length > 0) query = query.in("league_id", leagueFilter);
      const { data, error } = await query;
      if (error) {
        return halt(context, 500, { ok: false, error: error.message || "Nu am putut citi predictions_history." });
      }
      const dbRows = Array.isArray(data) ? data : [];
      const items = dbRows
        .map((row) => mapDbRowToHistoryEntry(row))
        .slice(0, effectiveLimit)
        .map((row) => maskPredictionForTier(row, tierContext.effectiveTier));
      const dailyLimit = tierDailyLimit(tierContext.effectiveTier);
      context.responseHeaders = {
        "X-Tier": String(tierContext.effectiveTier),
        "X-Predict-Count": "0",
        "X-Predict-Limit": String(dailyLimit),
        "X-Data-Source": reason
      };
      return halt(context, 200, items);
    };

    if (!tierContext.quotaExempt && tierContext.effectiveTier === USER_TIERS.FREE) {
      await readDbOnlyPredictions("db_only_free");
      context.tierContext = tierContext;
      context.reservedTierUsage = reservedTierUsage;
      return context;
    }

    if (!tierContext.quotaExempt) {
      const usageHardStopPct = Math.max(60, Math.min(Number(process.env.PREDICT_USAGE_DB_ONLY_PCT || 75), 99));
      const reserveCalls = Math.max(0, Number(process.env.PREDICT_USAGE_RESERVE_CALLS || 2000));
      const usage = await getApiUsage().catch(() => ({ count: 0, limit: 0 }));
      const usageCount = Number(usage?.count || 0);
      const usageLimit = Number(usage?.limit || 0);
      const usagePct = usageLimit > 0 ? (usageCount / usageLimit) * 100 : 0;
      const usageRemaining = Math.max(0, usageLimit - usageCount);
      if (usagePct >= usageHardStopPct || usageRemaining <= reserveCalls) {
        await readDbOnlyPredictions("db_only_budget_guard");
        context.tierContext = tierContext;
        context.reservedTierUsage = reservedTierUsage;
        return context;
      }
    }
  }

  context.tierContext = tierContext;
  context.reservedTierUsage = reservedTierUsage;

  // Request-scoped model assets + upstream data (was top of try-block).
  context.out = [];
  context.liveRollingCache = new Map();
  context.statsBudgetRef = { remaining: LIVE_ROLLING_MAX_UNCACHED_STATS_CALLS };

  const engineWeights = getPredictionWeights();
  context.engineWeights = engineWeights;
  context.poissonCorrelation = Number.isFinite(Number(engineWeights.poissonCorrelation))
    ? Number(engineWeights.poissonCorrelation)
    : 0.12;
  context.shrinkageK = Math.max(1, Number(process.env.PREDICT_SHRINKAGE_K) || 6);
  context.activeModelId = await getActiveModelId().catch(() => "E");
  context.riskContext = await loadRiskContext();

  const [calibrationMaps, stackerWeightsMap] = await Promise.all([
    loadCalibrationMaps(MODEL_VERSION).catch(() => ({})),
    loadStackerWeights(MODEL_VERSION).catch(() => new Map()),
    refreshAutoCalibrationOverlays(MODEL_VERSION).catch(() => ({}))
  ]);
  context.calibrationMaps = calibrationMaps;
  context.stackerWeightsMap = stackerWeightsMap;

  const dayReq = await getWithCache("/fixtures", { date }, 21600);
  if (!dayReq.ok) {
    const status = Number(dayReq?.status);
    return halt(context, Number.isFinite(status) && status >= 400 ? status : 502, {
      ok: false,
      error: typeof dayReq.error === "string" ? dayReq.error : "Serviciul upstream /fixtures nu este disponibil.",
      provider: dayReq?.provider || null
    });
  }
  context.allFixtures = dayReq.data?.response || dayReq.data || [];

  const oddsPrefetch = await prefetchOddsByDate(date, {
    leagueIds: leagueIds.map(Number),
    maxPages: Math.max(2, Math.min(Number(process.env.ODDS_PREFETCH_MAX_PAGES || 6), 12)),
    ttlSeconds: 86400
  });
  context.oddsPrefetch = oddsPrefetch;
  context.oddsByFixtureId = oddsPrefetch.byFixtureId;

  if (!context.stageMarks) context.stageMarks = {};
  context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
