import { result, neutral } from "./helpers.js";

/**
 * Expected Goals module.
 * Prefers the real rolling xG model (ctx.xgHome / ctx.xgAway), computed from
 * shots / SoT / big-chance proxy / possession / recent xG. Falls back to λ only
 * when no rolling xG is available for the fixture.
 */
export function calculate(ctx) {
  const rollingHome = Number(ctx.xgHome);
  const rollingAway = Number(ctx.xgAway);
  const hasRolling = Number.isFinite(rollingHome) && Number.isFinite(rollingAway);

  const xgHome = hasRolling ? rollingHome : Number(ctx.lambdaHome);
  const xgAway = hasRolling ? rollingAway : Number(ctx.lambdaAway);
  if (!Number.isFinite(xgHome) || !Number.isFinite(xgAway)) {
    return neutral({ reason: "missing_xg_and_lambdas", extensionPoint: true });
  }

  const total = xgHome + xgAway;
  return result(total / 2.7, hasRolling ? 0.85 : 0.7, {
    home: xgHome,
    away: xgAway,
    xgHome,
    xgAway,
    total,
    source: hasRolling ? (ctx.xgSource || "rolling_xg_model") : "lambda_fallback",
    available: true
  });
}

export const ExpectedGoals = { calculate, name: "expectedGoals" };
