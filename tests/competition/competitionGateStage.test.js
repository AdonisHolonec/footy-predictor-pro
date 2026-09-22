import test from "node:test";
import assert from "node:assert/strict";
import * as StageCompetitionGate from "../../server-utils/pipeline/stages/StageCompetitionGate.js";
import { FIXTURE_STAGES } from "../../server-utils/pipeline/stages/runFixtureStageLoop.js";
import { STAGE_ORDER } from "../../server-utils/pipeline/PredictorV3.js";
import { beginFixture, createPipelineContext } from "../../server-utils/pipeline/PipelineContext.js";
import { initFixtureWorkingState } from "../../server-utils/pipeline/stages/fixtureStageShared.js";
import { UNSUPPORTED_NATIONAL_COMPETITION } from "../../server-utils/competition/competitionCatalog.js";

function providerFixture(leagueId, leagueName, homeId, homeName, awayId, awayName) {
  return {
    fixture: { id: 1528886, date: "2026-09-25T18:45:00+00:00", status: { short: "NS" }, referee: null, venue: { id: 0, name: null } },
    league: { id: leagueId, name: leagueName, type: "Cup", country: "World", logo: "L" },
    teams: { home: { id: homeId, name: homeName, logo: "H" }, away: { id: awayId, name: awayName, logo: "A" } },
    goals: { home: null, away: null }
  };
}

function contextFor(fx, lId) {
  const context = createPipelineContext({}, {});
  context.league = { lId: String(lId), leagueSeason: 2026, leagueParams: {}, marketRollingMap: new Map(), standingsMap: new Map() };
  const f = beginFixture(context, {
    fixtureId: fx.fixture.id,
    fx,
    homeName: fx.teams.home.name,
    awayName: fx.teams.away.name,
    homeIdStr: String(fx.teams.home.id),
    awayIdStr: String(fx.teams.away.id),
    refereeName: "",
    venue: undefined
  });
  initFixtureWorkingState(f);
  return context;
}

test("the gate is the first fixture stage and sits right after Stage01 in the stage order", () => {
  assert.equal(FIXTURE_STAGES[0].STAGE_ID, "StageCompetitionGate");
  assert.equal(FIXTURE_STAGES[1].STAGE_ID, "Stage02FeatureCollection");
  const ids = STAGE_ORDER.map((s) => s.STAGE_ID);
  assert.equal(ids.indexOf("StageCompetitionGate"), ids.indexOf("Stage01DataCollection") + 1);
  assert.equal(ids.indexOf("Stage02FeatureCollection"), ids.indexOf("StageCompetitionGate") + 1);
});

test("Sweden vs Romania (Nations League, league 5) aborts before data collection with the insufficient row", async () => {
  const context = contextFor(providerFixture(5, "UEFA Nations League", 5, "Sweden", 774, "Romania"), 5);
  await StageCompetitionGate.run(context);
  const f = context.fixture;
  assert.equal(f.aborted, true);
  assert.equal(f.engineCtx, null, "Stage02 inputs were never assembled");
  assert.equal(f.lambdaHome, undefined, "no lambda was generated");
  const row = f.row;
  assert.equal(row.insufficientData, true);
  assert.equal(row.insufficientReason, UNSUPPORTED_NATIONAL_COMPETITION);
  assert.deepEqual(row.competition, {
    entityType: "NATIONAL_TEAM",
    competitionType: "NATIONS_LEAGUE",
    supported: false,
    reason: UNSUPPORTED_NATIONAL_COMPETITION
  });
  assert.equal(row.id, 1528886);
  assert.equal(row.leagueId, 5);
  assert.deepEqual(row.teams, { home: "Sweden", away: "Romania" });
  assert.deepEqual(row.fixtureTeamIds, { home: 5, away: 774 });
  assert.equal(row.modelMeta.method, "unsupported_national_competition");
  assert.deepEqual(row.modelMeta.reasonCodes, ["unsupported_national_competition"]);
  assert.equal(row.modelMeta.dataQuality, 0);
  assert.deepEqual(row.recommended, { pick: "", confidence: 0 });
  assert.equal(row.probs.p1, 0);
  assert.equal(row.valueBet.detected, false);
  assert.equal(context.stageMarks.StageCompetitionGate.status, "unsupported_national_competition");
});

test("a Euro qualification fixture (league 960) is blocked before Stage02 with the same row as league 5", async () => {
  const fx = providerFixture(960, "Euro Championship - Qualification", 774, "Romania", 15, "Switzerland");
  const context = contextFor(fx, 960);
  await StageCompetitionGate.run(context);
  const f = context.fixture;
  assert.equal(f.aborted, true);
  assert.equal(f.engineCtx, null, "no factor inputs assembled");
  assert.equal(f.modularScores, null, "no PredictionEngine factor executed");
  assert.equal(f.lambdaHome, undefined);
  assert.equal(f.p, null, "no probabilities generated");
  assert.equal(f.row.insufficientData, true);
  assert.equal(f.row.insufficientReason, UNSUPPORTED_NATIONAL_COMPETITION);
  assert.equal(f.row.modelMeta.method, "unsupported_national_competition");
  assert.deepEqual(f.row.competition, { entityType: "NATIONAL_TEAM", competitionType: "EURO_QUALIFICATION", supported: false, reason: UNSUPPORTED_NATIONAL_COMPETITION });
  assert.deepEqual(f.row.recommended, { pick: "", confidence: 0 }, "no recommendation");
  assert.equal(f.row.valueBet.detected, false);
  assert.equal(context.stageMarks.StageCompetitionGate.status, "unsupported_national_competition");
  // identical shape to the Nations League row apart from identity and competition type
  const nl = contextFor(providerFixture(5, "UEFA Nations League", 5, "Sweden", 774, "Romania"), 5);
  await StageCompetitionGate.run(nl);
  const shape = (row) => Object.keys(row).sort().join(",");
  assert.equal(shape(f.row), shape(nl.fixture.row));
});

test("a club fixture passes through untouched", async () => {
  const fx = providerFixture(39, "Premier League", 33, "Manchester United", 40, "Liverpool");
  fx.league.type = "League";
  fx.league.country = "England";
  const context = contextFor(fx, 39);
  await StageCompetitionGate.run(context);
  assert.equal(context.fixture.aborted, false);
  assert.equal(context.fixture.row, null);
  assert.equal(context.fixture.competition.entityType, "CLUB");
  assert.equal(context.fixture.competition.supported, true);
  assert.equal(context.stageMarks.StageCompetitionGate.status, "ok");
});

test("a halted context or an already-aborted fixture is left alone", async () => {
  const halted = contextFor(providerFixture(5, "UEFA Nations League", 5, "Sweden", 774, "Romania"), 5);
  halted.halted = true;
  await StageCompetitionGate.run(halted);
  assert.equal(halted.fixture.row, null);
  const aborted = contextFor(providerFixture(5, "UEFA Nations League", 5, "Sweden", 774, "Romania"), 5);
  aborted.fixture.aborted = true;
  await StageCompetitionGate.run(aborted);
  assert.equal(aborted.fixture.row, null);
});
