/** Semantic version for calibration / A-B analysis (override via PREDICT_MODEL_VERSION). */
export const MODEL_VERSION = process.env.PREDICT_MODEL_VERSION || "v2-strength-bp-2026-04";

/** Blend weight for model vs implied market (1X2). Env MODEL_MARKET_BLEND_WEIGHT overrides everything. */
export function getModelMarketBlendWeight(method) {
  const raw = process.env.MODEL_MARKET_BLEND_WEIGHT;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0.35, Math.min(0.92, n));
  }
  return method === "advanced-teamstats" ? 0.76 : 0.63;
}
