/**
 * Stage10Persistence — history + FI persist (moved from api/predict.js).
 */

import { assertSupabaseConfigured, getSupabaseAdmin } from "../../supabaseAdmin.js";
import { upsertPredictionsHistory } from "../../predictionsHistory.js";
import { persistFeatureImportanceRows } from "../../importance/persistFeatureImportance.js";
import { persistContextSnapshots } from "../../context/persistContextSnapshots.js";
import { linkUserPredictionFixtures } from "../../linkUserPredictionFixtures.js";
import { decrementPredictCountBy, rememberUniquePredictFixtures, USER_TIERS } from "../../accessTier.js";

export const STAGE_ID = "Stage10Persistence";
export const STAGE_DESCRIPTION = "History and feature-importance persistence.";

/**
 * @param {object} context
 */
export async function run(context) {
  if (context.halted) return context;

  const { req, res } = context;
  const out = context.out || [];
  const usageCtx = context.usageCtx;
  let tierContext = context.tierContext;

  const persistable = out.filter((row) => !row.insufficientData);
  context.persistable = persistable;

  const supabaseConfig = assertSupabaseConfigured();
  if (!supabaseConfig.ok) {
    context.skipPersist = true;
    if (!context.stageMarks) context.stageMarks = {};
    context.stageMarks[STAGE_ID] = { status: "skipped_no_supabase", at: Date.now() };
    return context;
  }

  if (persistable.length > 0) {
    try {
      const persistStats = await upsertPredictionsHistory(persistable);
      try {
        await persistFeatureImportanceRows(persistable);
      } catch (fiErr) {
        console.error("[predict featureImportance]", fiErr?.message || fiErr);
      }
      try {
        await persistContextSnapshots(context.contextSnapshots);
      } catch (ctxErr) {
        console.error("[predict contextSnapshot]", ctxErr?.message || ctxErr);
      }
      if (usageCtx?.userId) {
        const supabase = getSupabaseAdmin();
        const link = await linkUserPredictionFixtures(
          usageCtx.userId,
          persistable.map((p) => p.id)
        );
        if (!link.ok) {
          res.setHeader("X-Persist-Warning", "user_prediction_fixtures_link_failed");
        }
        try {
          const persistInserted = Number(persistStats?.inserted ?? 0);
          const persistUpdated = Number(persistStats?.updated ?? 0);
          const persistSkippedFinal = Number(persistStats?.skippedFinal ?? 0);
          const persistSkippedStale = Number(persistStats?.skippedStale ?? 0);
          const persistSkippedPrekickoff = Number(persistStats?.skipped ?? 0);
          await supabase.from("history_sync_log").insert({
            source: "predict_persist",
            method: String(req.method || "GET").toUpperCase(),
            ok: true,
            scanned: Number(persistStats?.count ?? persistable.length ?? 0),
            updated: persistInserted + persistUpdated,
            persist_inserted: persistInserted,
            persist_updated: persistUpdated,
            persist_skipped_final: persistSkippedFinal,
            persist_skipped_stale: persistSkippedStale,
            persist_skipped_prekickoff: persistSkippedPrekickoff
          });
        } catch {
          // telemetry must never block predict response
        }
      }
    } catch (persistError) {
      console.error("[predict persist]", persistError?.message || persistError);
      res.setHeader("X-Persist-Warning", "predictions_history_upsert_failed");
    }
  }

  // Ultra: remember unique fixture ids after a live run (idempotent SADD).
  if (
    usageCtx?.userId &&
    tierContext &&
    !tierContext.quotaExempt &&
    tierContext.effectiveTier === USER_TIERS.ULTRA
  ) {
    const ids = out
      .map((row) => row?.id ?? row?.fixtureId ?? row?.fixture_id)
      .filter((id) => id != null && id !== "");
    try {
      const after = await rememberUniquePredictFixtures(usageCtx.userId, usageCtx.usageDay, ids);
      tierContext = { ...tierContext, predictCountToday: after };
      context.tierContext = tierContext;
    } catch (e) {
      console.error("[ultra unique remember]", e?.message || e);
    }
  }

  const reservedTierUsage = context.reservedTierUsage || 0;
  if (reservedTierUsage > 0 && usageCtx?.userId) {
    const unusedReservations = Math.max(0, reservedTierUsage - out.length);
    if (unusedReservations > 0) {
      await decrementPredictCountBy(usageCtx.userId, usageCtx.usageDay, unusedReservations);
    }
    tierContext = tierContext
      ? {
          ...tierContext,
          predictCountToday: Math.max(0, Number(tierContext.predictCountToday || 0) - unusedReservations)
        }
      : tierContext;
    context.tierContext = tierContext;
  }

  if (!context.stageMarks) context.stageMarks = {};
  context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
