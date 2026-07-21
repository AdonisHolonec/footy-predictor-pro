/**
 * Build a PipelineContext + league/fixture bags from a golden JSON case.
 */

import { createPipelineContext, beginFixture } from "../PipelineContext.js";
import { initFixtureWorkingState } from "../stages/fixtureStageShared.js";
import { getLeagueParams, getLeagueProfile } from "../../modelConstants.js";
import { getPredictionWeights } from "../../prediction/PredictionEngine.js";

function usableRolling(overrides = {}) {
  return {
    matches_sampled: 8,
    xg_samples: 8,
    xg_for_avg: 1.55,
    xg_against_avg: 1.25,
    xg_source: "rolling_xg",
    corners_for_avg: 5.2,
    corners_against_avg: 4.8,
    sot_for_avg: 4.1,
    sot_against_avg: 3.6,
    shots_total_for_avg: 12.5,
    shots_total_against_avg: 10.8,
    ...overrides
  };
}

function defaultFx(fixtureInit) {
  const homeId = Number(fixtureInit.homeIdStr) || 33;
  const awayId = Number(fixtureInit.awayIdStr) || 34;
  return {
    fixture: {
      id: fixtureInit.fixtureId,
      date: "2026-03-15T15:00:00+00:00",
      referee: "Golden Ref",
      status: { short: "NS" }
    },
    league: { id: 39, name: "Premier League", logo: null },
    teams: {
      home: { id: homeId, name: fixtureInit.homeName || "Home FC", logo: null },
      away: { id: awayId, name: fixtureInit.awayName || "Away FC", logo: null }
    },
    goals: { home: null, away: null },
    ...(fixtureInit.fx || {})
  };
}

/**
 * @param {object} goldenCase
 */
export function buildGoldenContext(goldenCase) {
  const req = { query: {}, headers: {} };
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    }
  };

  const context = createPipelineContext(req, res);
  const lId = Number(goldenCase.league?.lId || 39);
  const leagueParams = {
    ...getLeagueParams(lId),
    ...(goldenCase.league?.leagueParams || {})
  };
  const leagueProfile = getLeagueProfile(lId);

  const fixtureInit = goldenCase.fixtureInit || {};
  const homeIdStr = String(fixtureInit.homeIdStr || "33");
  const awayIdStr = String(fixtureInit.awayIdStr || "34");
  const fx = defaultFx({
    ...fixtureInit,
    homeIdStr,
    awayIdStr,
    fixtureId: fixtureInit.fixtureId || 900001
  });

  const rollingHome = usableRolling(goldenCase.preStage?.rollingHint?.home || {});
  const rollingAway = usableRolling(goldenCase.preStage?.rollingHint?.away || {});
  const marketRollingMap = new Map([
    [Number(homeIdStr), rollingHome],
    [Number(awayIdStr), rollingAway]
  ]);

  const standingsMap = new Map();
  const standingsRows = goldenCase.league?.standingsRows;
  if (Array.isArray(standingsRows)) {
    for (const r of standingsRows) {
      if (r?.team?.id) standingsMap.set(String(r.team.id), r);
    }
  } else {
    // Default standings rows for standings-lambda path.
    standingsMap.set(homeIdStr, {
      team: { id: Number(homeIdStr) },
      all: { played: 20, goals: { for: 32, against: 22 } }
    });
    standingsMap.set(awayIdStr, {
      team: { id: Number(awayIdStr) },
      all: { played: 20, goals: { for: 24, against: 28 } }
    });
  }

  context.date = goldenCase.date || "2026-03-15";
  context.leagueIds = [String(lId)];
  context.season = Number(goldenCase.season || 2025);
  context.effectiveLimit = 15;
  context.engineWeights = getPredictionWeights();
  context.poissonCorrelation = Number(
    goldenCase.poissonCorrelation ?? context.engineWeights.poissonCorrelation ?? 0
  );
  context.shrinkageK = 6;
  context.activeModelId = goldenCase.activeModelId || "E";
  context.riskContext = goldenCase.riskContext || { avgDist: null, cooldownCap: 3 };
  context.calibrationMaps = goldenCase.calibrationMaps || {};
  context.stackerWeightsMap =
    goldenCase.stackerWeightsMap instanceof Map
      ? goldenCase.stackerWeightsMap
      : new Map(Object.entries(goldenCase.stackerWeightsMap || {}));
  context.oddsByFixtureId = new Map();
  context.liveRollingCache = new Map();
  context.statsBudgetRef = { remaining: 0 }; // force no live hydrate network
  context.out = [];

  context.league = {
    lId,
    leagueParams,
    leagueProfile,
    marketRollingMap,
    standingsMap,
    leagueStandings: [],
    standingsRows: [],
    leagueFixtures: [fx]
  };

  const f = beginFixture(context, {
    fixtureId: fx.fixture?.id,
    fx,
    homeName: fx.teams?.home?.name || "Home",
    awayName: fx.teams?.away?.name || "Away",
    homeIdStr,
    awayIdStr,
    refereeName: "Golden Ref"
  });
  initFixtureWorkingState(f);

  const pre = goldenCase.preStage || {};
  Object.assign(f, {
    method: pre.method ?? f.method,
    lambdaHome: pre.lambdaHome,
    lambdaAway: pre.lambdaAway,
    luckStats: pre.luckStats ?? {
      hG: 1.4,
      hXG: 1.4,
      aG: 1.1,
      aXG: 1.1,
      intensityNote: "golden"
    },
    strengthMeta: pre.strengthMeta ?? null,
    modularScores: pre.modularScores ?? null,
    confidenceCtx: pre.confidenceCtx ?? {
      hStats: { playedHome: 10, played: 20, gfHome: 1.5 },
      aStats: { playedAway: 10, played: 20, gfAway: 1.1 },
      hFormMulti: 1,
      aFormMulti: 1,
      leagueParams
    },
    engineCtx: pre.engineCtx ?? null,
    hStats: pre.hStats ?? null,
    aStats: pre.aStats ?? null,
    hMulti: pre.hMulti ?? null,
    aMulti: pre.aMulti ?? null,
    formHomeStr: pre.formHomeStr ?? "WWDLW",
    formAwayStr: pre.formAwayStr ?? "LDLWL",
    fhFractionsHome: pre.fhFractionsHome ?? null,
    fhFractionsAway: pre.fhFractionsAway ?? null
  });

  context.goldenMocks = goldenCase.mocks || {};
  return context;
}

export { usableRolling };
export default { buildGoldenContext };
