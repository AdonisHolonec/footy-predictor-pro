import { applyBayesianShrinkage } from "../math.js";
import type { ModuleScore, PredictionContext } from "./types.js";
import { clampFactor, leagueAvgFromContext } from "./_helpers.js";

/** Defense strength from home/away goals-against averages with Bayesian shrinkage. */
export function computeDefenseStrength(ctx: PredictionContext): ModuleScore {
  const leagueAvg = leagueAvgFromContext(ctx);
  const leagueAvgHome = Number(ctx.leagueParams?.leagueAvgHome) || leagueAvg;
  const leagueAvgAway = Number(ctx.leagueParams?.leagueAvgAway) || leagueAvg;
  const shrinkageK = Math.max(1, Number(ctx.shrinkageK) || 6);
  const eps = 0.28;

  const homePlayed = Number(ctx.hStats?.playedHome ?? ctx.hStats?.played);
  const awayPlayed = Number(ctx.aStats?.playedAway ?? ctx.aStats?.played);
  const shrinkHome = Number.isFinite(homePlayed) && homePlayed > 0;
  const shrinkAway = Number.isFinite(awayPlayed) && awayPlayed > 0;

  const rawDefH = Math.max(eps, Number(ctx.hStats.gaHome) || eps);
  const rawDefA = Math.max(eps, Number(ctx.aStats.gaAway) || eps);

  const defH = clampFactor(
    shrinkHome ? applyBayesianShrinkage(rawDefH, homePlayed, leagueAvgHome, shrinkageK) : rawDefH
  );
  const defA = clampFactor(
    shrinkAway ? applyBayesianShrinkage(rawDefA, awayPlayed, leagueAvgAway, shrinkageK) : rawDefA
  );

  const homeFactor = defH / leagueAvg;
  const awayFactor = defA / leagueAvg;

  return {
    score: (homeFactor + awayFactor) / 2,
    detail: { defH, defA, leagueAvg, homeFactor, awayFactor }
  };
}
