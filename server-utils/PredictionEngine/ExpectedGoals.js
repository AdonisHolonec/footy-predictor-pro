import { result, neutral } from "./helpers.js";

/**
 * Expected goals view of λ (identity mapping for now).
 * Extension: replace with shot-based xG when available on context.
 */
export function calculate(ctx) {
  const xgHome = Number(ctx.lambdaHome);
  const xgAway = Number(ctx.lambdaAway);
  if (!Number.isFinite(xgHome) || !Number.isFinite(xgAway)) {
    return neutral({ reason: "missing_lambdas", extensionPoint: true });
  }

  const total = xgHome + xgAway;
  return result(total / 2.7, 0.8, {
    home: xgHome,
    away: xgAway,
    xgHome,
    xgAway,
    total,
    source: "lambda_as_xg",
    available: true
  });
}

export const ExpectedGoals = { calculate, name: "expectedGoals" };
