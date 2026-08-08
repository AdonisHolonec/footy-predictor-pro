/**
 * Stage11Masking — tier mask (moved from api/predict.js).
 */

import { USER_TIERS, maskPredictionForTier } from "../../accessTier.js";

export const STAGE_ID = "Stage11Masking";
export const STAGE_DESCRIPTION = "Tier masking and usage header shaping.";

/**
 * @param {object} context
 */
export async function run(context) {
  if (context.halted) return context;

  const out = context.out || [];
  const tierContext = context.tierContext;
  const isCron = context.isCronInternal === true;

  // P0: never return unmasked Ultra payload to non-cron callers.
  let masked;
  if (isCron) {
    masked = out;
  } else if (tierContext?.quotaExempt) {
    masked = out;
  } else {
    const tier = tierContext?.effectiveTier || USER_TIERS.FREE;
    masked = out.map((row) => maskPredictionForTier(row, tier));
  }

  context.masked = masked;

  if (tierContext) {
    context.responseHeaders = {
      ...(context.responseHeaders || {}),
      "X-Tier": String(tierContext.effectiveTier),
      "X-Predict-Count": String(tierContext.predictCountToday ?? ""),
      "X-Predict-Limit": String(tierContext.predictLimit ?? "")
    };
  }

  if (!context.stageMarks) context.stageMarks = {};
  context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
