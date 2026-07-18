/**
 * Stage00Ingress — HTTP ingress (moved from api/predict.js).
 * Contract: run(context) → context. Never calls other stages.
 */

import { attachRequestMonitor } from "../../observability/requestMonitor.js";
import { readBearer } from "../../authAdmin.js";
import { isAuthorizedCronOrInternalRequest } from "../../cronRequestAuth.js";
import { todayCalendarEuropeBucharest } from "../../fixtureCalendarDateKey.js";
import { inferSeason } from "../predictHelpers.js";
import { halt } from "../PipelineContext.js";

export const STAGE_ID = "Stage00Ingress";
export const STAGE_DESCRIPTION = "HTTP ingress: monitoring, query normalization, auth gate.";

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

  const isCron = isAuthorizedCronOrInternalRequest(req);
  context.isCronInternal = isCron;

  // P0: live predict requires cron secret or user JWT — no anonymous pipeline.
  if (!isCron && !readBearer(req)) {
    return halt(context, 401, {
      ok: false,
      error: "Autentificare necesară pentru Predict."
    });
  }

  if (!context.stageMarks) context.stageMarks = {};
  context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
