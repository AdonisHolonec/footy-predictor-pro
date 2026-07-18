import { applyBayesianShrinkage } from "../math.js";
import { clampFactor, leagueAvgFromContext, result } from "./helpers.js";

export function calculate(ctx) {
  const leagueAvg = leagueAvgFromContext(ctx);
  const leagueAvgHome = Number(ctx.leagueParams?.leagueAvgHome) || leagueAvg;
  const leagueAvgAway = Number(ctx.leagueParams?.leagueAvgAway) || leagueAvg;
  const shrinkageK = Math.max(1, Number(ctx.shrinkageK) || 6);
  const eps = 0.28;

  const homePlayed = Number(ctx.hStats?.playedHome ?? ctx.hStats?.played);
  const awayPlayed = Number(ctx.aStats?.playedAway ?? ctx.aStats?.played);
  const shrinkHome = Number.isFinite(homePlayed) && homePlayed > 0;
  const shrinkAway = Number.isFinite(awayPlayed) && awayPlayed > 0;

  const rawAtkH = Math.max(eps, Number(ctx.hStats?.gfHome) || eps);
  const rawAtkA = Math.max(eps, Number(ctx.aStats?.gfAway) || eps);

  const atkH = clampFactor(
    shrinkHome ? applyBayesianShrinkage(rawAtkH, homePlayed, leagueAvgHome, shrinkageK) : rawAtkH
  );
  const atkA = clampFactor(
    shrinkAway ? applyBayesianShrinkage(rawAtkA, awayPlayed, leagueAvgAway, shrinkageK) : rawAtkA
  );

  const homeFactor = atkH / leagueAvg;
  const awayFactor = atkA / leagueAvg;
  const dataOk = Number.isFinite(rawAtkH) && Number.isFinite(rawAtkA);

  return result((homeFactor + awayFactor) / 2, dataOk ? 0.85 : 0.35, {
    atkH,
    atkA,
    leagueAvg,
    homeFactor,
    awayFactor,
    home: homeFactor,
    away: awayFactor
  });
}

export const AttackStrength = { calculate, name: "attack" };
