/**
 * Pure combiner — turns module results + weights into λ_home / λ_away.
 * No module logic lives here; only weighted aggregation.
 */

import { clamp, clampFactor, leagueAvgFromContext } from "./helpers.js";
import { clampLambda } from "../math.js";

function sideFactor(details, side) {
  const v = Number(details?.[side]);
  return Number.isFinite(v) ? v : 1;
}

function optionalAdjustment(modules, side, blend) {
  let delta = 0;
  for (const { mod, weight } of modules) {
    delta += weight * (sideFactor(mod.details, side) - 1);
  }
  return 1 + blend * delta;
}

/**
 * @param {object} ctx
 * @param {Record<string, import('./types.ts').ModuleResult>} core
 * @param {object} weights
 */
export function combineLambdas(ctx, core, weights) {
  const leagueAvg = leagueAvgFromContext(ctx);
  // A venue split counts only when BOTH sides are present; a one-sided value is
  // ignored so home advantage can never be half-encoded and then multiplied again.
  const splitHome = Number(ctx.leagueParams?.leagueAvgHome);
  const splitAway = Number(ctx.leagueParams?.leagueAvgAway);
  const hasVenueSplit = splitHome > 0 && splitAway > 0;
  const leagueAvgHome = hasVenueSplit ? splitHome : leagueAvg;
  const leagueAvgAway = hasVenueSplit ? splitAway : leagueAvg;
  const timeDecay = typeof ctx.timeDecay === "number" ? clamp(ctx.timeDecay, 0.85, 1.05) : 1;

  const atkH = Number(core.attack.details?.atkH);
  const atkA = Number(core.attack.details?.atkA);
  const defH = Number(core.defense.details?.defH);
  const defA = Number(core.defense.details?.defA);
  const hf = clamp(Number(core.form.details?.home) * timeDecay, 0.9, 1.1);
  const af = clamp(Number(core.form.details?.away) * timeDecay, 0.9, 1.1);
  const homeAdv = Number(core.homeAdvantage.details?.homeAdv) || 1.06;
  const awayAdv = Number(core.homeAdvantage.details?.awayAdv) || 0.96;

  /*
    Home advantage enters λ exactly once. League profiles already split the goal
    average by venue (leagueAvgHome = total × homeShare(homeAdvantage), see
    LeagueProfile.splitGoalAverages), so when that split is present the explicit
    homeAdv / awayAdv factor counts the same effect twice — measured on 841
    persisted fixtures: λ_home +13% / λ_away −8% against actual goals, raw P(home)
    0.525 vs 0.452 observed, 83% home picks. The explicit factor is kept only for
    callers that supply a single leagueAvg with no venue split.
  */
  const homeAdvFactor = hasVenueSplit ? 1 : homeAdv;
  const awayAdvFactor = hasVenueSplit ? 1 : awayAdv;

  const baseLambdaHome =
    leagueAvgHome *
    Math.pow(atkH / leagueAvg, weights.attack) *
    Math.pow(defA / leagueAvg, weights.defense) *
    Math.pow(homeAdvFactor, weights.homeAdvantage) *
    Math.pow(hf, weights.form);

  const baseLambdaAway =
    leagueAvgAway *
    Math.pow(atkA / leagueAvg, weights.attack) *
    Math.pow(defH / leagueAvg, weights.defense) *
    Math.pow(awayAdvFactor, weights.homeAdvantage) *
    Math.pow(af, weights.form);

  const optionalModules = [
    { mod: core.standings, weight: weights.standings },
    { mod: core.h2h, weight: weights.h2h },
    { mod: core.referee, weight: weights.referee },
    { mod: core.restDays, weight: weights.restDays },
    { mod: core.recentMatches, weight: weights.recentMatches },
    { mod: core.awayStrength, weight: weights.awayStrength },
    { mod: core.injuries, weight: weights.injuries },
    { mod: core.lineup, weight: weights.lineup },
    { mod: core.odds, weight: weights.odds },
    { mod: core.motivation, weight: weights.motivation },
    { mod: core.weather, weight: weights.weather }
  ];

  const adjHome = optionalAdjustment(optionalModules, "home", weights.modularBlend);
  const adjAway = optionalAdjustment(optionalModules, "away", weights.modularBlend);

  let lambdaHome = clampLambda(baseLambdaHome * adjHome);
  let lambdaAway = clampLambda(baseLambdaAway * adjAway);

  // Predictor V2: blend strength λ toward rolling xG when ctx.xgHome/xgAway present.
  const xgW = Math.max(0, Math.min(1, Number(weights.expectedGoals) || 0));
  const xgH = Number(ctx.xgHome);
  const xgA = Number(ctx.xgAway);
  let xgBlend = null;
  if (xgW > 0 && Number.isFinite(xgH) && Number.isFinite(xgA)) {
    lambdaHome = clampLambda(lambdaHome * (1 - xgW) + xgH * xgW);
    lambdaAway = clampLambda(lambdaAway * (1 - xgW) + xgA * xgW);
    xgBlend = { weight: xgW, xgHome: xgH, xgAway: xgA, applied: true };
  }

  const shrinkageK = Math.max(1, Number(ctx.shrinkageK) || 6);
  const homePlayed = ctx.hStats.playedHome ?? ctx.hStats.played ?? null;
  const awayPlayed = ctx.aStats.playedAway ?? ctx.aStats.played ?? null;

  const strengthMeta = {
    leagueAvg,
    leagueAvgHome,
    leagueAvgAway,
    homeAdv,
    awayAdv,
    /** false when the venue split already carried home advantage (explicit factor skipped). */
    homeAdvApplied: !hasVenueSplit,
    atkH,
    defH,
    atkA,
    defA,
    timeDecay,
    shrinkageK,
    homePlayed: Number.isFinite(Number(homePlayed)) && Number(homePlayed) > 0 ? Number(homePlayed) : null,
    awayPlayed: Number.isFinite(Number(awayPlayed)) && Number(awayPlayed) > 0 ? Number(awayPlayed) : null,
    modularBlend: weights.modularBlend,
    adjHome,
    adjAway,
    baseLambdaHome,
    baseLambdaAway,
    xgBlend
  };

  return { lambdaHome, lambdaAway, strengthMeta };
}

export { clampFactor };
