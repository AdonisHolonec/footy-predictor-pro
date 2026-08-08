/**
 * Stage02FeatureCollection — team stats, form, moduleInputs, early xG, engineCtx.
 * Algorithms unchanged; hands engineCtx to Stage03 via context.fixture.
 */

import { extractFormMultiplier, extractFirstHalfFractions } from "../../math.js";
import { collectModuleInputs } from "../../PredictionEngine/moduleInputs.js";
import { computeRefereeStatsFromHistory } from "../../context/refereeStatsFromHistory.js";
import { buildContextSnapshot } from "../../context/captureContextSnapshot.js";
import { MODEL_VERSION } from "../../modelConstants.js";
import { resolveFixtureXg } from "../xgLambdaBlend.js";
import { coerceFormFromTeamStats, fetchTeamStatisticsWithSeasonFallback } from "../predictHelpers.js";



export const STAGE_ID = "Stage02FeatureCollection";
export const STAGE_DESCRIPTION =
  "Team stats, form, moduleInputs, early xG, engine/confidence context.";

export async function run(context) {
  if (context.halted || context.fixture?.aborted) return context;
  const f = context.fixture;
  const league = context.league;
  if (!f || !league) return context;

  const lId = league.lId;
  const leagueParams = league.leagueParams;
  const marketRollingMap = league.marketRollingMap;
  const standingsMap = league.standingsMap;

  const season = Number(league.leagueSeason) || Number(context.season);
  const shrinkageK = context.shrinkageK;
  const oddsByFixtureId = context.oddsByFixtureId;

  const fixtureId = f.fixtureId;
  const fx = f.fx;
  const homeIdStr = f.homeIdStr;
  const awayIdStr = f.awayIdStr;
  const refereeName = f.refereeName;

  let method = f.method ?? "none";
  let formHomeStr = null;
  let formAwayStr = null;
  let confidenceCtx = null;
  let fhFractionsHome = null;
  let fhFractionsAway = null;
  let engineCtx = null;
  let hStats = null;
  let aStats = null;
  let hMulti = null;
  let aMulti = null;

  if (homeIdStr && awayIdStr) {
    // Current cup season often empty in July qualifying — fall back to season-1.
    const [tsH, tsA] = await Promise.all([
      fetchTeamStatisticsWithSeasonFallback({
        leagueId: lId,
        season,
        teamId: homeIdStr,
        ttlSeconds: 86400
      }),
      fetchTeamStatisticsWithSeasonFallback({
        leagueId: lId,
        season,
        teamId: awayIdStr,
        ttlSeconds: 86400
      })
    ]);
    const tsHNorm = tsH.ok ? tsH.norm : null;
    const tsANorm = tsA.ok ? tsA.norm : null;
    if (tsHNorm) {
      formHomeStr = coerceFormFromTeamStats(tsHNorm);
      fhFractionsHome = extractFirstHalfFractions(tsHNorm);
    }
    if (tsANorm) {
      formAwayStr = coerceFormFromTeamStats(tsANorm);
      fhFractionsAway = extractFirstHalfFractions(tsANorm);
    }
    hStats = tsH.ok ? tsH.stats : null;
    aStats = tsA.ok ? tsA.stats : null;
    if (hStats && aStats && tsHNorm && tsANorm) {
      hMulti = extractFormMultiplier(tsHNorm.response?.form);
      aMulti = extractFormMultiplier(tsANorm.response?.form);
      const rowH = standingsMap.get(homeIdStr);
      const rowA = standingsMap.get(awayIdStr);
      const moduleInputs = await collectModuleInputs({
        fixtureId,
        homeTeamId: homeIdStr,
        awayTeamId: awayIdStr,
        leagueId: lId,
        season,
        fixtureDate: fx.fixture?.date,
        oddsData: oddsByFixtureId.get(Number(fixtureId)),
        fx
      });
      const earlyRollingHome = homeIdStr ? marketRollingMap.get(Number(homeIdStr)) : null;
      const earlyRollingAway = awayIdStr ? marketRollingMap.get(Number(awayIdStr)) : null;
      const earlyXg = resolveFixtureXg({
        rollingHome: earlyRollingHome,
        rollingAway: earlyRollingAway,
        leagueAvg: leagueParams.leagueAvg,
        homeAdv: leagueParams.homeAdv,
        awayAdv: leagueParams.awayAdv
      });
      const statsSeasonMeta = {
        homeStatsSeason: tsH.seasonUsed,
        awayStatsSeason: tsA.seasonUsed,
        homeStatsSource: tsH.source,
        awayStatsSource: tsA.source,
        homeStatsLeagueId: tsH.statsLeagueId ?? null,
        awayStatsLeagueId: tsA.statsLeagueId ?? null
      };
      engineCtx = {
        hStats,
        aStats,
        formHome: tsHNorm.response?.form,
        formAway: tsANorm.response?.form,
        hFormMulti: hMulti,
        aFormMulti: aMulti,
        leagueParams,
        homeStandingsRow: rowH || null,
        awayStandingsRow: rowA || null,
        refereeName: refereeName || undefined,
        fixtureId,
        fixtureDate: fx.fixture?.date,
        homeTeamId: homeIdStr,
        awayTeamId: awayIdStr,
        shrinkageK,
        poissonCorrelation: Number.isFinite(Number(context.poissonCorrelation))
          ? Number(context.poissonCorrelation)
          : undefined,
        ...statsSeasonMeta,
        ...(earlyXg
          ? {
              xgHome: earlyXg.xgHome,
              xgAway: earlyXg.xgAway,
              xgSource: earlyXg.source
            }
          : {}),
        ...moduleInputs
      };

      const refereeStats = refereeName
        ? await computeRefereeStatsFromHistory(refereeName, { excludeFixtureId: fixtureId })
        : null;
      if (refereeStats) engineCtx.refereeStats = refereeStats;

      f.contextSnapshot = buildContextSnapshot({
        fixtureId,
        leagueId: lId,
        kickoff: fx.fixture?.date,
        refereeName,
        modelVersion: MODEL_VERSION,
        moduleInputs,
        refereeStats
      });

      confidenceCtx = {
        hStats,
        aStats,
        formHome: tsHNorm.response?.form,
        formAway: tsANorm.response?.form,
        hFormMulti: hMulti,
        aFormMulti: aMulti,
        leagueParams,
        homeStandingsRow: rowH || null,
        awayStandingsRow: rowA || null,
        refereeName: refereeName || undefined,
        homeTeamId: homeIdStr,
        awayTeamId: awayIdStr,
        fixtureDate: fx.fixture?.date,
        ...statsSeasonMeta,
        ...moduleInputs,
        ...(earlyXg
          ? { xgHome: earlyXg.xgHome, xgAway: earlyXg.xgAway, xgSource: earlyXg.source }
          : {})
      };
      if (refereeStats) confidenceCtx.refereeStats = refereeStats;
    }
  }

  Object.assign(f, {
    method,
    formHomeStr,
    formAwayStr,
    confidenceCtx,
    fhFractionsHome,
    fhFractionsAway,
    engineCtx,
    hStats,
    aStats,
    hMulti,
    aMulti
  });

  if (!context.stageMarks) context.stageMarks = {};
  context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
