import test, { mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Mixed request through the fixture loop: two gated national competitions (Nations League 5,
 * World Cup qualification South America 34) plus one club competition (Premier League 39).
 * Data-collection collaborators are mocks that RECORD which league reached them: only the club
 * league may, and Stage02 must run only for the club fixture.
 */

const calls = { stage02: [], rolling: [], elo: [], standings: [] };
const rollingOrig = await import("../../server-utils/teamMarketRolling.js");
const eloOrig = await import("../../server-utils/teamElo.js");
const helpersOrig = await import("../../server-utils/pipeline/predictHelpers.js");

mock.module("../../server-utils/pipeline/stages/Stage02FeatureCollection.js", {
  namedExports: {
    STAGE_ID: "Stage02FeatureCollection",
    run: async (context) => {
      calls.stage02.push(Number(context.league.lId));
      // Stop the club fixture here: this test is about the gate, not the rest of the pipeline.
      context.fixture.aborted = true;
      context.fixture.silentSkip = true;
      return context;
    }
  }
});
mock.module("../../server-utils/teamMarketRolling.js", { namedExports: { ...rollingOrig, loadTeamMarketRolling: async (lId) => { calls.rolling.push(Number(lId)); return new Map(); } } });
mock.module("../../server-utils/teamElo.js", { namedExports: { ...eloOrig, loadLeagueElo: async (lId) => { calls.elo.push(Number(lId)); return new Map(); } } });
mock.module("../../server-utils/pipeline/predictHelpers.js", { namedExports: { ...helpersOrig, loadStandingsMap: async (lId) => { calls.standings.push(Number(lId)); return { standingsRows: [], standingsMap: new Map(), seasonUsed: 2026, fromCache: true }; } } });

const { runFixtureStageLoop } = await import("../../server-utils/pipeline/stages/runFixtureStageLoop.js");
const { createPipelineContext } = await import("../../server-utils/pipeline/PipelineContext.js");

const fixture = (id, leagueId, leagueName, type, country, home, away) => ({
  fixture: { id, date: "2026-10-10T18:45:00+00:00", status: { short: "NS" } },
  league: { id: leagueId, name: leagueName, type, country, season: 2026 },
  teams: { home: { id: home[0], name: home[1] }, away: { id: away[0], name: away[1] } },
  goals: { home: null, away: null }
});

test("only the national competitions are gated; the club league alone reaches data collection", async () => {
  const context = createPipelineContext({}, {});
  context.leagueIds = ["5", "39", "34"];
  context.season = 2026;
  context.effectiveLimit = 15;
  context.allFixtures = [
    fixture(1, 5, "UEFA Nations League", "Cup", "World", [5, "Sweden"], [774, "Romania"]),
    fixture(2, 39, "Premier League", "League", "England", [42, "Arsenal"], [63, "Leeds"]),
    fixture(3, 34, "World Cup - Qualification South America", "Cup", "World", [2380, "Paraguay"], [2382, "Peru"])
  ];
  await runFixtureStageLoop(context);

  assert.deepEqual(calls.stage02, [39], "Stage02 ran for the club fixture only");
  assert.deepEqual(calls.rolling, [39]);
  assert.deepEqual(calls.elo, [39]);
  assert.deepEqual(calls.standings, [39]);

  const gated = context.out.filter((r) => r.insufficientData);
  assert.deepEqual(gated.map((r) => r.leagueId).sort((a, b) => a - b), [5, 34]);
  for (const row of gated) {
    assert.equal(row.insufficientReason, "UNSUPPORTED_NATIONAL_COMPETITION");
    assert.equal(row.modelMeta.method, "unsupported_national_competition");
    assert.equal(row.competition.entityType, "NATIONAL_TEAM");
    assert.equal(row.recommended.pick, "");
  }
  assert.equal(context.out.some((r) => r.leagueId === 39), false, "club fixture was handed to Stage02 (silently skipped by the mock), not gated");
  assert.equal(context.league.competition.leagueId, 34);
});
