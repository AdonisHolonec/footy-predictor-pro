import { result } from "./helpers.js";

/**
 * Soft recommendation from Poisson probs (audit only).
 * Does NOT replace api/predict.js recommended pick / value engine.
 */
export function calculate(ctx) {
  const probs = ctx.probs || ctx._poissonProbs || {};
  const p1 = Number(probs.p1);
  const pX = Number(probs.pX);
  const p2 = Number(probs.p2);

  if (![p1, pX, p2].every((x) => Number.isFinite(x))) {
    return result(0, 0, { available: false, reason: "missing_probs", pick: null });
  }

  // Accept 0–100 or 0–1
  const scale = p1 + pX + p2 > 1.5 ? 1 : 100;
  const a = p1 * (scale === 1 ? 1 : 100);
  const b = pX * (scale === 1 ? 1 : 100);
  const c = p2 * (scale === 1 ? 1 : 100);
  const vals = [
    { pick: "1", p: a },
    { pick: "X", p: b },
    { pick: "2", p: c }
  ].sort((x, y) => y.p - x.p);

  const top = vals[0];
  const second = vals[1];
  const margin = (top.p - second.p) / 100;
  const confidence = Math.max(0, Math.min(1, 0.35 + margin * 2));

  return result(top.p / 100, confidence, {
    pick: top.pick,
    margin,
    probs: { p1: a, pX: b, p2: c },
    available: true,
    note: "audit_only_does_not_override_api_recommend"
  });
}

export const RecommendationEngine = { calculate, name: "recommendation" };
