/**
 * Stage03LambdaGeneration — PredictionEngine λ / fallback / standings; insufficientData abort.
 * Consumes context.fixture.engineCtx from Stage02.
 */

import { recordObservation } from "../../fetcher.js";
import { clampLambda, strengthRatingsLambdas } from "../../math.js";
import { PredictionEngine, summarizeModuleScores } from "../../prediction/PredictionEngine.js";
import { applyContextToLambdas } from "../../context/ContextEngine.js";
import { buildConfidenceEngine } from "../../confidence/ConfidenceEngine.js";
import { buildValueEngine } from "../../value/ValueEngine.js";
import { MODEL_VERSION } from "../../modelConstants.js";
import { isGoodNum, roundDisplayRate, buildTeamContext, isUefaClubCompetition, syntheticLeagueAvgStats, leaguePriorLambdas } from "../predictHelpers.js";



export const STAGE_ID = "Stage03LambdaGeneration";
export const STAGE_DESCRIPTION =
  "PredictionEngine λ / fallback / standings; insufficientData abort.";

/** Maps the resolved λ-generation `method` to its telemetry channel (metricsStore.js routes). */
const LAMBDA_METHOD_CHANNELS = {
  "modular-engine": "lambdaPredictionEngine",
  "strength-ratings": "lambdaStrengthRatings",
  standings: "lambdaStandings",
  partial_stats_league_prior: "lambdaPartialStats",
  uefa_league_prior: "lambdaUefaFallback"
};

export async function run(context) {
  if (context.halted || context.fixture?.aborted) return context;
  const f = context.fixture;
  const league = context.league;
  if (!f || !league) return context;

  const lId = league.lId;
  const leagueParams = league.leagueParams;
  const standingsMap = league.standingsMap;
  const leagueStandings = league.leagueStandings;

  const shrinkageK = context.shrinkageK;

  const fixtureId = f.fixtureId;
  const fx = f.fx;
  const homeName = f.homeName;
  const awayName = f.awayName;
  const homeIdStr = f.homeIdStr;
  const awayIdStr = f.awayIdStr;
  const refereeName = f.refereeName;

  let method = f.method ?? "none";
  let lambdaHome = f.lambdaHome;
  let lambdaAway = f.lambdaAway;
  let luckStats = f.luckStats;
  let strengthMeta = f.strengthMeta;
  let modularScores = f.modularScores;
  let contextEngineResult = f.contextEngine ?? null;
  const formHomeStr = f.formHomeStr;
  const formAwayStr = f.formAwayStr;
  const engineCtx = f.engineCtx;
  const hStats = f.hStats;
  const aStats = f.aStats;
  const hMulti = f.hMulti;
  const aMulti = f.aMulti;

  if (engineCtx && hStats && aStats) {
    let sr;
    try {
      sr = PredictionEngine.build(engineCtx);
    } catch {
      sr = null;
    }
    if (!sr || !isGoodNum(sr.lambdaHome) || !isGoodNum(sr.lambdaAway)) {
      sr = strengthRatingsLambdas(hStats, aStats, hMulti, aMulti, {
        leagueAvgGoals: leagueParams.leagueAvg,
        leagueAvgHome: leagueParams.leagueAvgHome,
        leagueAvgAway: leagueParams.leagueAvgAway,
        homeAdv: leagueParams.homeAdv,
        awayAdv: leagueParams.awayAdv,
        homePlayed: hStats.playedHome || hStats.played,
        awayPlayed: aStats.playedAway || aStats.played,
        shrinkageK
      });
      if (sr && isGoodNum(sr.lambdaHome) && isGoodNum(sr.lambdaAway)) {
        method = "strength-ratings";
      }
    } else {
      method = sr.method || "modular-engine";
      modularScores = summarizeModuleScores(sr.moduleScores);
    }
    if (sr && isGoodNum(sr.lambdaHome) && isGoodNum(sr.lambdaAway)) {
      lambdaHome = sr.lambdaHome;
      lambdaAway = sr.lambdaAway;
      strengthMeta = sr.strengthMeta;
      luckStats = {
        hG: roundDisplayRate(hStats.gfHome),
        hXG: roundDisplayRate(sr.lambdaHome),
        aG: roundDisplayRate(aStats.gfAway),
        aXG: roundDisplayRate(sr.lambdaAway),
        intensityNote: "expected_rate_from_strength_model"
      };
    }
  }

  if (!isGoodNum(lambdaHome)) {
    const rowH = standingsMap.get(homeIdStr);
    const rowA = standingsMap.get(awayIdStr);
    // Quality gate: a standings-derived per-game rate is too noisy on a handful of
    // matches — require a minimum sample before trusting it (lower bar for UEFA,
    // where qualifying rounds mean thinner tables even for legitimate contenders).
    const minPlayedForStandings = isUefaClubCompetition(lId) ? 3 : 5;
    const playedH = Number(rowH?.all?.played) || 0;
    const playedA = Number(rowA?.all?.played) || 0;
    if (rowH && rowA && playedH >= minPlayedForStandings && playedA >= minPlayedForStandings) {
      method = "standings";
      const phH = Math.max(1, playedH);
      const phA = Math.max(1, playedA);
      const gfH = Number(rowH.all?.goals?.for) / phH;
      const gaH = Number(rowH.all?.goals?.against) / phH;
      const gfA = Number(rowA.all?.goals?.for) / phA;
      const gaA = Number(rowA.all?.goals?.against) / phA;

      const SK = 4;
      const atkHs = (phH * gfH + SK * leagueParams.leagueAvg) / (phH + SK);
      const defHs = (phH * gaH + SK * leagueParams.leagueAvg) / (phH + SK);
      const atkAs = (phA * gfA + SK * leagueParams.leagueAvg) / (phA + SK);
      const defAs = (phA * gaA + SK * leagueParams.leagueAvg) / (phA + SK);

      lambdaHome = clampLambda((atkHs + defAs) / 2 * leagueParams.homeAdv);
      lambdaAway = clampLambda((atkAs + defHs) / 2 * leagueParams.awayAdv);
    }
  }

  // One side has real stats, the other does not — fill missing side with league-average rates.
  if (!isGoodNum(lambdaHome) && (hStats || aStats)) {
    const synth = syntheticLeagueAvgStats(leagueParams);
    const sr = strengthRatingsLambdas(hStats || synth, aStats || synth, hMulti, aMulti, {
      leagueAvgGoals: leagueParams.leagueAvg,
      leagueAvgHome: leagueParams.leagueAvgHome,
      leagueAvgAway: leagueParams.leagueAvgAway,
      homeAdv: leagueParams.homeAdv,
      awayAdv: leagueParams.awayAdv,
      homePlayed: (hStats || synth).playedHome || (hStats || synth).played,
      awayPlayed: (aStats || synth).playedAway || (aStats || synth).played,
      shrinkageK
    });
    if (sr && isGoodNum(sr.lambdaHome) && isGoodNum(sr.lambdaAway)) {
      method = hStats && aStats ? "strength-ratings" : "partial_stats_league_prior";
      lambdaHome = sr.lambdaHome;
      lambdaAway = sr.lambdaAway;
      strengthMeta = sr.strengthMeta;
      luckStats = {
        hG: roundDisplayRate((hStats || synth).gfHome),
        hXG: roundDisplayRate(sr.lambdaHome),
        aG: roundDisplayRate((aStats || synth).gfAway),
        aXG: roundDisplayRate(sr.lambdaAway),
        intensityNote: method
      };
    }
  }

  // UEFA last resort: always produce a prediction from league priors (qualifying / empty cup tables).
  if (!isGoodNum(lambdaHome) && isUefaClubCompetition(lId)) {
    const prior = leaguePriorLambdas(leagueParams);
    method = "uefa_league_prior";
    lambdaHome = prior.lambdaHome;
    lambdaAway = prior.lambdaAway;
    luckStats = {
      hG: roundDisplayRate(Number(leagueParams.leagueAvgHome) || Number(leagueParams.leagueAvg) || 1.35),
      hXG: roundDisplayRate(prior.lambdaHome),
      aG: roundDisplayRate(Number(leagueParams.leagueAvgAway) || Number(leagueParams.leagueAvg) || 1.35),
      aXG: roundDisplayRate(prior.lambdaAway),
      intensityNote: "uefa_league_prior"
    };
  }

  if (engineCtx && isGoodNum(lambdaHome) && isGoodNum(lambdaAway)) {
    const nudged = applyContextToLambdas(engineCtx, lambdaHome, lambdaAway);
    contextEngineResult = nudged.contextResult;
    if (nudged.contextResult.appliedToLambda) {
      lambdaHome = clampLambda(nudged.lambdaHome);
      lambdaAway = clampLambda(nudged.lambdaAway);
    }
  }

  const lambdaMethodChannel =
    isGoodNum(lambdaHome) && isGoodNum(lambdaAway)
      ? LAMBDA_METHOD_CHANNELS[method] || null
      : "lambdaInsufficientData";
  if (lambdaMethodChannel) void recordObservation(lambdaMethodChannel, { durationMs: 0, ok: true });

  Object.assign(f, {
    method,
    lambdaHome,
    lambdaAway,
    luckStats,
    strengthMeta,
    modularScores,
    contextEngine: contextEngineResult
  });

  if (!isGoodNum(lambdaHome)) {
    const teamContextEarly = buildTeamContext({
      homeIdStr,
      awayIdStr,
      standingsMap,
      formHome: formHomeStr,
      formAway: formAwayStr
    });
    f.row = {
      id: fixtureId,
      leagueId: Number(lId),
      league: fx.league?.name || "Unknown",
      logos: { league: fx.league?.logo, home: fx.teams?.home?.logo, away: fx.teams?.away?.logo },
      teams: { home: homeName, away: awayName },
      fixtureTeamIds:
        homeIdStr && awayIdStr
          ? { home: Number(homeIdStr) || undefined, away: Number(awayIdStr) || undefined }
          : undefined,
      kickoff: fx.fixture?.date,
      status: fx.fixture?.status?.short,
      score: {
        home: typeof fx.goals?.home === "number" ? fx.goals.home : null,
        away: typeof fx.goals?.away === "number" ? fx.goals.away : null
      },
      referee: refereeName || undefined,
      venue: f.venue || undefined,
      insufficientData: true,
      insufficientReason: "no_team_or_standings_data",
      teamContext: teamContextEarly,
      leagueStandings,
      probs: {
        p1: 0, pX: 0, p2: 0, pGG: 0, pO25: 0, pU35: 0, pO15: 0,
        pDC1X: 0, pDC12: 0, pDCX2: 0, pU15: 0, pNGG: 0, pU25: 0
      },
      recommended: { pick: "", confidence: 0 },
      predictions: { oneXtwo: "", gg: "", over25: "", correctScore: "" },
      valueBet: { detected: false, type: "", ev: 0, kelly: 0, stakePlan: "", reasons: ["insufficient_data"] },
      valueEngine: buildValueEngine([]),
      confidenceEngine: buildConfidenceEngine({ refereeName: refereeName || undefined }),
      modelMeta: {
        method: "insufficient_data",
        dataQuality: 0,
        modelVersion: MODEL_VERSION,
        reasonCodes: ["insufficient_data"]
      },
      modelVersion: MODEL_VERSION,
      evaluation: { track: "none" }
    };
    f.aborted = true;
    if (!context.stageMarks) context.stageMarks = {};
    context.stageMarks[STAGE_ID] = { status: "insufficient_data", at: Date.now() };
    return context;
  }

  if (!context.stageMarks) context.stageMarks = {};
  context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
