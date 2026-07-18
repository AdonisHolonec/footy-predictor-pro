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
  const leagueAvgHome = Number(ctx.leagueParams?.leagueAvgHome) || leagueAvg;
  const leagueAvgAway = Number(ctx.leagueParams?.leagueAvgAway) || leagueAvg;
  const timeDecay = typeof ctx.timeDecay === "number" ? clamp(ctx.timeDecay, 0.85, 1.05) : 1;

  const atkH = Number(core.attack.details?.atkH);
  const atkA = Number(core.attack.details?.atkA);
  const defH = Number(core.defense.details?.defH);
  const defA = Number(core.defense.details?.defA);
  const hf = clamp(Number(core.form.details?.home) * timeDecay, 0.9, 1.1);
  const af = clamp(Number(core.form.details?.away) * timeDecay, 0.9, 1.1);
  const homeAdv = Number(core.homeAdvantage.details?.homeAdv) || 1.06;
  const awayAdv = Number(core.homeAdvantage.details?.awayAdv) || 0.96;

  const baseLambdaHome =
    leagueAvgHome *
    Math.pow(atkH / leagueAvg, weights.attack) *
    Math.pow(defA / leagueAvg, weights.defense) *
    Math.pow(homeAdv, weights.homeAdvantage) *
    Math.pow(hf, weights.form);

  const baseLambdaAway =
    leagueAvgAway *
    Math.pow(atkA / leagueAvg, weights.attack) *
    Math.pow(defH / leagueAvg, weights.defense) *
    Math.pow(awayAdv, weights.homeAdvantage) *
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

  const lambdaHome = clampLambda(baseLambdaHome * adjHome);
  const lambdaAway = clampLambda(baseLambdaAway * adjAway);

  const shrinkageK = Math.max(1, Number(ctx.shrinkageK) || 6);
  const homePlayed = ctx.hStats.playedHome ?? ctx.hStats.played ?? null;
  const awayPlayed = ctx.aStats.playedAway ?? ctx.aStats.played ?? null;

  const strengthMeta = {
    leagueAvg,
    leagueAvgHome,
    leagueAvgAway,
    homeAdv,
    awayAdv,
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
    baseLambdaAway
  };

  return { lambdaHome, lambdaAway, strengthMeta };
}

export { clampFactor };
