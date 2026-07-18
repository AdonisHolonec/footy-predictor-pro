/**
 * Stage01DataCollection — auth, tier, fixtures, odds, calib/stacker load.
 * Moved from api/predict.js. Never calls other stages.
 */

import { getWithCache } from "../../fetcher.js";
import {
  commitWarmPredictIncrement,
  isWarmPredictQuotaExempt,
  resolveAuthenticatedUsageContext
} from "../../userDailyWarmPredictUsage.js";
import { isAuthorizedCronOrInternalRequest } from "../../cronRequestAuth.js";
import {
  USER_TIERS,
  getPredictCountToday,
  incrementPredictCountBy,
  maskPredictionForTier,
  resolveEffectiveTierFromProfile,
  tierDailyActionLimit,
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
    const quotaExempt =
      role === "admin" || (await isWarmPredictQuotaExempt(usageCtx.userId, usageCtx.userEmail));
    const dailyLimit = quotaExempt ? Number.POSITIVE_INFINITY : tierDailyLimit(tierInfo.effectiveTier);
    let predictCountToday = 0;
    try {
      predictCountToday = await getPredictCountToday(usageCtx.userId, usageCtx.usageDay, {
        failClosed: !quotaExempt
      });
    } catch (e) {
      if (!quotaExempt) {
        return halt(context, 503, {
          ok: false,
          error: "Contorul zilnic de predicții nu este disponibil. Încearcă din nou."
        });
      }
    }

    tierContext = {
      ...tierInfo,
      effectiveTier: quotaExempt ? USER_TIERS.ULTRA : tierInfo.effectiveTier,
      quotaExempt,
      predictCountToday,
      predictLimit: Number.isFinite(dailyLimit) ? dailyLimit : null
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
      const limitHdr = Number.isFinite(dailyLimit) ? dailyLimit : tierDailyLimit(tierContext.effectiveTier);
      context.responseHeaders = {
        "X-Tier": String(tierContext.effectiveTier),
        "X-Predict-Count": String(tierContext.predictCountToday ?? 0),
        "X-Predict-Limit": String(limitHdr),
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
      // C10: soft (≥80%) or hard (≥95%/reserve) → DB-only instead of burning upstream.
      const { evaluateApiBudget } = await import("../../apiBudgetCircuit.js");
      const budget = await evaluateApiBudget().catch(() => null);
      if (budget?.softStop || budget?.hardStop) {
        await readDbOnlyPredictions(
          budget.hardStop ? "db_only_budget_hard_stop" : "db_only_budget_soft_stop"
        );
        context.tierContext = tierContext;
        context.reservedTierUsage = reservedTierUsage;
        context.apiBudget = budget;
        return context;
      }

      // Action quota (runs/day) — separate from match-row KV reservation.
      const actionMax = tierDailyActionLimit(tierContext.effectiveTier);
      const actionInc = await commitWarmPredictIncrement(
        usageCtx.userId,
        usageCtx.usageDay,
        "predict",
        actionMax
      );
      if (!actionInc?.ok) {
        return halt(context, 429, {
          ok: false,
          error: "Ai atins limita zilnică de Predict pentru abonamentul tău.",
          reason: actionInc?.reason || "predict_limit",
          warmCount: actionInc?.warm_count,
          predictCount: actionInc?.predict_count,
          actionLimit: actionMax
        });
      }

      // Match-row KV quota: reserve up to remaining daily matches for this request.
      const remainingMatches = Math.max(0, dailyLimit - predictCountToday);
      if (remainingMatches <= 0) {
        return halt(context, 429, {
          ok: false,
          error: `Ai atins limita zilnică de ${dailyLimit} meciuri predictate.`,
          predictCountToday,
          predictLimit: dailyLimit
        });
      }
      const reserveAmount = Math.min(effectiveLimit, remainingMatches);
      try {
        const after = await incrementPredictCountBy(usageCtx.userId, usageCtx.usageDay, reserveAmount);
        reservedTierUsage = reserveAmount;
        effectiveLimit = reserveAmount;
        tierContext.predictCountToday = after;
        tierContext.predictLimit = dailyLimit;
      } catch (e) {
        console.error("[predict quota reserve]", e?.message || e);
        return halt(context, 503, {
          ok: false,
          error: "Nu am putut rezerva cota de predicții. Încearcă din nou."
        });
      }
    }
  }

  context.tierContext = tierContext;
  context.reservedTierUsage = reservedTierUsage;
  context.effectiveLimit = effectiveLimit;

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
