/**
 * Stage12Response — final JSON + headers (moved from api/predict.js).
 */

import { getLocalCacheStats } from "../../fetcher.js";
import { passesMinDisplayOdds } from "../../predictionDisplayGate.js";

export const STAGE_ID = "Stage12Response";
export const STAGE_DESCRIPTION = "Final JSON response assembly.";

/**
 * @param {object} context
 */
export async function run(context) {
  if (context.halted) {
    // Halt path: write halt response once.
    const { res } = context;
    if (context.haltHeaders) {
      for (const [k, v] of Object.entries(context.haltHeaders)) {
        res.setHeader(k, v);
      }
    }
    if (context.responseHeaders) {
      for (const [k, v] of Object.entries(context.responseHeaders)) {
        res.setHeader(k, v);
      }
    }
    context.responseStatus = context.haltStatus ?? 200;
    context.responseBody = context.haltBody;
    res.status(context.responseStatus).json(context.responseBody);
    context.responseSent = true;
    return context;
  }

  const { res } = context;
  const masked = (context.masked ?? context.out ?? []).filter(passesMinDisplayOdds);
  const oddsPrefetch = context.oddsPrefetch || {};

  if (context.responseHeaders) {
    for (const [k, v] of Object.entries(context.responseHeaders)) {
      res.setHeader(k, v);
    }
  }

  res.setHeader("X-Odds-Prefetch-Mapped", String(oddsPrefetch.fixturesMapped || 0));
  res.setHeader("X-Odds-Prefetch-Upstream", String(oddsPrefetch.upstreamCalls || 0));
  const cacheStats = getLocalCacheStats();
  if (cacheStats.hitRatio != null) {
    res.setHeader("X-Cache-Hit-Ratio", String(cacheStats.hitRatio));
  }

  // Legacy early path when Supabase missing: still return masked rows.
  context.responseStatus = 200;
  context.responseBody = masked;
  res.status(200).json(masked);
  context.responseSent = true;

  if (!context.stageMarks) context.stageMarks = {};
  context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
