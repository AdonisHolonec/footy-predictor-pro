import { clamp, clampLambda } from "../math.js";
import { computeAttackStrength } from "./AttackStrength.js";
import { computeDefenseStrength } from "./DefenseStrength.js";
import { computeFormEngine } from "./FormEngine.js";
import { computeHomeAdvantage } from "./HomeAdvantage.js";
import { computeStandingsEngine } from "./StandingsEngine.js";
import { computeH2HEngine } from "./H2HEngine.js";
import { computeRefereeEngine } from "./RefereeEngine.js";
import { computeRestDays } from "./RestDays.js";
import { computeRecentMatches } from "./RecentMatches.js";
import { computePoisson } from "./Poisson.js";
import { getPredictionWeights } from "./predictionWeights.js";
import { leagueAvgFromContext } from "./_helpers.js";
import type { ModuleScore, PredictionContext, PredictionEngineResult } from "./types.js";

function sideFactor(detail: Record<string, unknown> | undefined, side: "home" | "away"): number {
  const v = Number(detail?.[side]);
  return Number.isFinite(v) ? v : 1;
}

function optionalAdjustment(
  modules: Array<{ mod: ModuleScore; weight: number }>,
  side: "home" | "away",
  blend: number
): number {
  let delta = 0;
  for (const { mod, weight } of modules) {
    delta += weight * (sideFactor(mod.detail, side) - 1);
  }
  return 1 + blend * delta;
}

function summarizeModuleScores(moduleScores: Record<string, ModuleScore>) {
  const out: Record<string, { score: number; detail?: Record<string, unknown> }> = {};
  for (const [key, mod] of Object.entries(moduleScores)) {
    out[key] = { score: mod.score, detail: mod.detail };
  }
  return out;
}

/** Combines all prediction modules into λ_home/λ_away and Poisson probabilities. */
export function build(ctx: PredictionContext): PredictionEngineResult | null {
  try {
    if (!ctx?.hStats || !ctx?.aStats) return null;

    const weights = getPredictionWeights();
    const attack = computeAttackStrength(ctx);
    const defense = computeDefenseStrength(ctx);
    const form = computeFormEngine(ctx);
    const homeAdvantage = computeHomeAdvantage(ctx);
    const standings = computeStandingsEngine(ctx);
    const h2h = computeH2HEngine(ctx);
    const referee = computeRefereeEngine(ctx);
    const restDays = computeRestDays(ctx);
    const recentMatches = computeRecentMatches(ctx);

    const leagueAvg = leagueAvgFromContext(ctx);
    const leagueAvgHome = Number(ctx.leagueParams?.leagueAvgHome) || leagueAvg;
    const leagueAvgAway = Number(ctx.leagueParams?.leagueAvgAway) || leagueAvg;
    const timeDecay = typeof ctx.timeDecay === "number" ? clamp(ctx.timeDecay, 0.85, 1.05) : 1;

    const atkH = Number(attack.detail?.atkH);
    const atkA = Number(attack.detail?.atkA);
    const defH = Number(defense.detail?.defH);
    const defA = Number(defense.detail?.defA);
    const hf = clamp(Number(form.detail?.home) * timeDecay, 0.9, 1.1);
    const af = clamp(Number(form.detail?.away) * timeDecay, 0.9, 1.1);
    const homeAdv = Number(homeAdvantage.detail?.homeAdv) || 1.06;
    const awayAdv = Number(homeAdvantage.detail?.awayAdv) || 0.96;

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
      { mod: standings, weight: weights.standings },
      { mod: h2h, weight: weights.h2h },
      { mod: referee, weight: weights.referee },
      { mod: restDays, weight: weights.restDays },
      { mod: recentMatches, weight: weights.recentMatches }
    ];

    const adjHome = optionalAdjustment(optionalModules, "home", weights.modularBlend);
    const adjAway = optionalAdjustment(optionalModules, "away", weights.modularBlend);

    const lambdaHome = clampLambda(baseLambdaHome * adjHome);
    const lambdaAway = clampLambda(baseLambdaAway * adjAway);

    if (!Number.isFinite(lambdaHome) || !Number.isFinite(lambdaAway)) return null;

    const fixtureId = ctx.fixtureId ?? 0;
    const poisson = computePoisson(lambdaHome, lambdaAway, fixtureId, {
      correlation: weights.poissonCorrelation,
      rho: ctx.leagueParams?.rho ?? -0.11
    });

    const moduleScores: Record<string, ModuleScore> = {
      attack,
      defense,
      form,
      homeAdvantage,
      standings,
      h2h,
      referee,
      restDays,
      recentMatches,
      poisson
    };

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

    return {
      lambdaHome,
      lambdaAway,
      moduleScores,
      method: "modular-engine",
      probs: poisson.probs,
      bestScore: poisson.bestScore,
      bestScoreProb: poisson.bestScoreProb,
      strengthMeta,
      poissonMeta: poisson.detail
    };
  } catch {
    return null;
  }
}

export const PredictionEngine = {
  build,
  summarizeModuleScores
};

export { summarizeModuleScores };
