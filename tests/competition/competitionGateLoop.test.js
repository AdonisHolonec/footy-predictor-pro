import test, { mock } from "node:test";
import assert from "node:assert/strict";

/**
 * End-to-end through the fixture loop: for a gated league the loop must emit the
 * insufficient row without touching Stage02 (data collection) or the league warm loads
 * (rolling / Elo / standings). Every collaborator that would reach the network or the
 * database is a module mock that fails the test if called.
 */

const calls = [];
const fail = (name) => () => {
  calls.push(name);
  throw new Error(`${name} must not run for a gated competition`);
};

// Originals are captured before mocking so every other export keeps its real behaviour;
// only the collaborators the gate must skip are replaced.
const rollingOrig = await import("../../server-utils/teamMarketRolling.js");
const eloOrig = await import("../../server-utils/teamElo.js");
const helpersOrig = await import("../../server-utils/pipeline/predictHelpers.js");

mock.module("../../server-utils/pipeline/stages/Stage02FeatureCollection.js", {
  namedExports: { STAGE_ID: "Stage02FeatureCollection", run: fail("Stage02FeatureCollection.run") }
});
mock.module("../../server-utils/teamMarketRolling.js", {
  namedExports: { ...rollingOrig, loadTeamMarketRolling: fail("loadTeamMarketRolling") }
});
mock.module("../../server-utils/teamElo.js", {
  namedExports: { ...eloOrig, loadLeagueElo: fail("loadLeagueElo") }
});
mock.module("../../server-utils/pipeline/predictHelpers.js", {
  namedExports: { ...helpersOrig, loadStandingsMap: fail("loadStandingsMap") }
});

const { runFixtureStageLoop } = await import("../../server-utils/pipeline/stages/runFixtureStageLoop.js");
const { createPipelineContext } = await import("../../server-utils/pipeline/PipelineContext.js");

test("league 5 fixtures go through the loop as insufficient rows with no data collection", async () => {
  {
    const context = createPipelineContext({}, {});
    context.leagueIds = ["5"];
    context.season = 2026;
    context.effectiveLimit = 15;
    context.allFixtures = [
      {
        fixture: { id: 1528886, date: "2026-09-25T18:45:00+00:00", status: { short: "NS" } },
        league: { id: 5, name: "UEFA Nations League", type: "Cup", country: "World", season: 2026 },
        teams: { home: { id: 5, name: "Sweden" }, away: { id: 774, name: "Romania" } },
        goals: { home: null, away: null }
      },
      {
        fixture: { id: 1528908, date: "2026-09-28T18:45:00+00:00", status: { short: "NS" } },
        league: { id: 5, name: "UEFA Nations League", type: "Cup", country: "World", season: 2026 },
        teams: { home: { id: 774, name: "Romania" }, away: { id: 1113, name: "Bosnia & Herzegovina" } },
        goals: { home: null, away: null }
      }
    ];
    await runFixtureStageLoop(context);
    assert.deepEqual(calls, []);
    assert.equal(context.out.length, 2);
    for (const row of context.out) {
      assert.equal(row.insufficientData, true);
      assert.equal(row.insufficientReason, "UNSUPPORTED_NATIONAL_COMPETITION");
      assert.equal(row.competition.competitionType, "NATIONS_LEAGUE");
      assert.equal(row.recommended.pick, "");
    }
    assert.deepEqual(context.contextSnapshots, []);
    assert.equal(context.league.competition.supported, false);
  }
});
