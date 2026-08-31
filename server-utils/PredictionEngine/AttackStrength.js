import { applyBayesianShrinkage } from "../math.js";
import { clampFactor, venueAverages, result } from "./helpers.js";

export function calculate(ctx) {
  const { leagueAvg, leagueAvgHome, leagueAvgAway } = venueAverages(ctx);
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

  /*
    Each side is measured against the average for ITS OWN venue, which is also the
    prior it was shrunk toward. `gfHome` is a home-venue rate, so dividing it by the
    venue-neutral `leagueAvg` would leave leagueAvgHome/leagueAvg (~1.12 in production)
    in the ratio on top of the venue-split baseline combineLambdas already starts from.
    With no venue split all three averages collapse to `leagueAvg` and this is a no-op.
  */
  const homeFactor = atkH / leagueAvgHome;
  const awayFactor = atkA / leagueAvgAway;
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
