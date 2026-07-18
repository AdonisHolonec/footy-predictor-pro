/**
 * Stage00Ingress — HTTP ingress (moved from api/predict.js).
 * Contract: run(context) → context. Never calls other stages.
 */

import { attachRequestMonitor } from "../../observability/requestMonitor.js";
import { readBearer } from "../../authAdmin.js";
import { checkAnonymousRateLimit } from "../../anonymousRateLimit.js";
import { todayCalendarEuropeBucharest } from "../../fixtureCalendarDateKey.js";
import { inferSeason } from "../predictHelpers.js";
import { halt } from "../PipelineContext.js";

export const STAGE_ID = "Stage00Ingress";
export const STAGE_DESCRIPTION = "HTTP ingress: monitoring, query normalization, anonymous rate limit.";

/**
 * @param {object} context
 */
export async function run(context) {
  const { req, res } = context;
  attachRequestMonitor(req, res, { route: "predict" });

  const date = req.query.date || todayCalendarEuropeBucharest();
  const leagueIdsStr = req.query.leagueIds || "";
  const leagueIds = leagueIdsStr.split(",").filter(Boolean).map((s) => s.trim());
  const season = Number(req.query.season || inferSeason(date));
  const limit = Math.min(Number(req.query.limit || 15), 15);

  context.date = date;
  context.leagueIds = leagueIds;
  context.season = season;
  context.limit = limit;
  context.effectiveLimit = limit;

  if (leagueIds.length === 0) {
    return halt(context, 400, { ok: false, error: "Nu ai selectat nicio ligă." });
  }

  if (!readBearer(req)) {
    const maxPerHour = Math.max(1, Math.min(Number(process.env.ANON_RATE_PREDICT_PER_HOUR || 16), 200));
    const rl = await checkAnonymousRateLimit(req, { namespace: "predict", maxPerHour });
    if (!rl.ok) {
      return halt(context, 429, {
        ok: false,
        error: "Prea multe cereri anonime pentru Predict. Autentifica-te sau incearca mai tarziu.",
        retryAfterSec: rl.retryAfterSec
      });
    }
  }

  if (!context.stageMarks) context.stageMarks = {};
  context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
