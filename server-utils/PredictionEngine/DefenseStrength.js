import { applyBayesianShrinkage } from "../math.js";
import { clampFactor, venueAverages, result } from "./helpers.js";

/*
  Which average does a CONCEDED rate belong to?

    gaHome = goals the HOME team concedes at home = goals AWAY teams score = leagueAvgAway
    gaAway = goals the AWAY team concedes away    = goals HOME teams score = leagueAvgHome

  So the venue baseline of a defensive rate is the OPPOSITE side's scoring average.
  Both the Bayesian prior and the normalising denominator use that opposite-side
  average; using the same-side one would shrink a rate toward a mean it never has.
*/
export function calculate(ctx) {
  const { leagueAvg, leagueAvgHome, leagueAvgAway } = venueAverages(ctx);
  const shrinkageK = Math.max(1, Number(ctx.shrinkageK) || 6);
  const eps = 0.28;

  const homePlayed = Number(ctx.hStats?.playedHome ?? ctx.hStats?.played);
  const awayPlayed = Number(ctx.aStats?.playedAway ?? ctx.aStats?.played);
  const shrinkHome = Number.isFinite(homePlayed) && homePlayed > 0;
  const shrinkAway = Number.isFinite(awayPlayed) && awayPlayed > 0;

  const rawDefH = Math.max(eps, Number(ctx.hStats?.gaHome) || eps);
  const rawDefA = Math.max(eps, Number(ctx.aStats?.gaAway) || eps);

  const defH = clampFactor(
    shrinkHome ? applyBayesianShrinkage(rawDefH, homePlayed, leagueAvgAway, shrinkageK) : rawDefH
  );
  const defA = clampFactor(
    shrinkAway ? applyBayesianShrinkage(rawDefA, awayPlayed, leagueAvgHome, shrinkageK) : rawDefA
  );

  const homeFactor = defH / leagueAvgAway;
  const awayFactor = defA / leagueAvgHome;

  return result((homeFactor + awayFactor) / 2, 0.85, {
    defH,
    defA,
    leagueAvg,
    homeFactor,
    awayFactor,
    home: homeFactor,
    away: awayFactor
  });
}

export const DefenseStrength = { calculate, name: "defense" };
