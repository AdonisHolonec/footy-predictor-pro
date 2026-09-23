// National-team TEST MODE: PREDICT_NATIONAL_COMPETITION_GATE=0 lets national fixtures traverse
// the normal Predictor V3 pipeline, persist, and read back unchanged; =1 keeps the kill switch.
// No module mocks here: every assertion runs the real gate, classifier and persistence mapper.
import test from "node:test";
import assert from "node:assert/strict";
import * as StageCompetitionGate from "../../server-utils/pipeline/stages/StageCompetitionGate.js";
import { gateHistoryEntry, resolveFixtureGate, resolveLeagueGate } from "../../server-utils/pipeline/competitionGate.js";
import { FIXTURE_STAGES } from "../../server-utils/pipeline/stages/runFixtureStageLoop.js";
import { beginFixture, createPipelineContext } from "../../server-utils/pipeline/PipelineContext.js";
import { initFixtureWorkingState } from "../../server-utils/pipeline/stages/fixtureStageShared.js";
import { describeCompetitionProvenance, mapPredictionToDbRow } from "../../server-utils/predictionsHistory.js";
import { MODEL_VERSION } from "../../server-utils/modelConstants.js";

const GATE = "PREDICT_NATIONAL_COMPETITION_GATE";
async function withEnv(value, fn) {
  const prev = process.env[GATE];
  if (value === undefined) delete process.env[GATE];
  else process.env[GATE] = value;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[GATE]; else process.env[GATE] = prev; }
}

function nlFixture(id = 1528862, home = "Netherlands", away = "Germany") {
  return {
    fixture: { id, date: "2026-09-24T18:45:00+00:00", status: { short: "NS" } },
    league: { id: 5, name: "UEFA Nations League", type: "Cup", country: "World" },
    teams: { home: { id: 1118, name: home }, away: { id: 25, name: away } },
    goals: { home: null, away: null }
  };
}
function stageContext(fx, lId) {
  const context = createPipelineContext({}, {});
  context.league = { lId: String(lId), leagueSeason: 2026, leagueParams: {}, marketRollingMap: new Map(), standingsMap: new Map() };
  beginFixture(context, fx.fixture.id);
  context.fixture = initFixtureWorkingState(fx, context);
  return context;
}
const nlPrediction = () => ({
  id: 1528862, leagueId: 5, league: "UEFA Nations League", teams: { home: "Netherlands", away: "Germany" },
  kickoff: "2026-09-24T18:45:00+00:00", status: "NS", score: { home: null, away: null },
  probs: { p1: 0.41, pX: 0.27, p2: 0.32 }, recommended: { pick: "Over 7.5", confidence: 68.376 },
  modelMeta: { method: "modular-engine", dataQuality: 0.9, modelVersion: MODEL_VERSION }, modelVersion: MODEL_VERSION
});

test("1. gate=0: a Nations League fixture is NOT aborted by StageCompetitionGate and continues to Stage02", async () => {
  await withEnv("0", async () => {
    const context = stageContext(nlFixture(), 5);
    await StageCompetitionGate.run(context);
    assert.equal(context.fixture.aborted, false);
    assert.equal(context.fixture.row, null, "no insufficient row is built");
    assert.equal(context.stageMarks.StageCompetitionGate.status, "ok");
    assert.equal(context.fixture.competition.entityType, "NATIONAL_TEAM", "classification is still recorded");
    assert.equal(FIXTURE_STAGES[0].STAGE_ID, "StageCompetitionGate");
    assert.equal(FIXTURE_STAGES[1].STAGE_ID, "Stage02FeatureCollection", "the next stage is real data collection");
  });
});

test("2. gate=0: the league-level gate is off too, so the loop warms Elo/rolling/standings for league 5", async () => {
  await withEnv("0", async () => {
    assert.equal(resolveLeagueGate(5).gated, false);
    assert.equal(resolveFixtureGate(nlFixture(), 5).gated, false);
    assert.equal(resolveLeagueGate(960).gated, false);
  });
});

test("3. gate=0: a persisted pre-gate national row reads back as the SAME reference (history / Top picks untouched)", async () => {
  const persisted = { ...nlPrediction() };
  await withEnv("0", async () => {
    assert.equal(gateHistoryEntry(persisted), persisted);
    assert.equal(persisted.recommended.pick, "Over 7.5");
    assert.equal(persisted.insufficientData, undefined);
  });
});

test("4. gate=1 (and the default): the kill switch still aborts national fixtures and gates persisted rows", async () => {
  for (const value of ["1", undefined]) {
    await withEnv(value, async () => {
      const context = stageContext(nlFixture(), 5);
      await StageCompetitionGate.run(context);
      assert.equal(context.fixture.aborted, true);
      assert.equal(context.fixture.row.insufficientData, true);
      assert.equal(gateHistoryEntry(nlPrediction()).insufficientData, true);
    });
  }
});

test("5. club fixtures behave identically with the gate on or off", async () => {
  const club = { ...nlFixture(9001, "Arsenal", "Chelsea"), league: { id: 39, name: "Premier League", type: "League", country: "England" } };
  for (const value of ["0", "1"]) {
    await withEnv(value, async () => {
      const context = stageContext(club, 39);
      await StageCompetitionGate.run(context);
      assert.equal(context.fixture.aborted, false);
      assert.equal(context.stageMarks.StageCompetitionGate.status, "ok");
      const row = { ...nlPrediction(), id: 9001, leagueId: 39 };
      assert.equal(gateHistoryEntry(row), row);
    });
  }
});

test("6. provenance: the persisted historyMeta names the competition class and the gate state at generation time", async () => {
  await withEnv("0", async () => {
    const row = mapPredictionToDbRow(nlPrediction());
    const meta = row.raw_payload.historyMeta;
    assert.equal(meta.source, "api/predict");
    assert.equal(meta.schemaVersion, 2, "additive: the schema version is unchanged");
    assert.match(meta.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(meta.competition, { entityType: "NATIONAL_TEAM", competitionType: "NATIONS_LEAGUE", supported: false, gateEnabled: false, testMode: true });
    // the prediction itself is untouched by provenance
    assert.deepEqual(row.raw_payload.probs, { p1: 0.41, pX: 0.27, p2: 0.32 });
    assert.equal(row.recommended_pick, "Over 7.5");
    assert.equal(row.league_id, 5);
  });
  await withEnv(undefined, async () => {
    assert.deepEqual(describeCompetitionProvenance(5), { entityType: "NATIONAL_TEAM", competitionType: "NATIONS_LEAGUE", supported: false, gateEnabled: true, testMode: false });
  });
  await withEnv("0", async () => {
    assert.deepEqual(describeCompetitionProvenance(39), { entityType: "CLUB", competitionType: "CLUB_COMPETITION", supported: true, gateEnabled: false, testMode: false });
    assert.deepEqual(mapPredictionToDbRow({ ...nlPrediction(), id: 9001, leagueId: 39 }).raw_payload.historyMeta.competition.entityType, "CLUB");
  });
});

test("7. a pre-gate national row without provenance stays readable exactly as stored (no backfill, no rewrite)", async () => {
  const { mapDbRowToHistoryEntry } = await import("../../server-utils/predictionsHistory.js");
  const dbRow = {
    fixture_id: 1528862, league_id: 5, league_name: "UEFA Nations League", home_team: "Netherlands", away_team: "Germany",
    kickoff_at: "2026-09-24T18:45:00+00:00", match_status: "NS", score_home: null, score_away: null, saved_at: "2026-09-22T08:39:28.277Z",
    raw_payload: { ...nlPrediction(), historyMeta: { generatedAt: "2026-09-22T08:39:28.277Z", source: "api/predict", schemaVersion: 2 } }
  };
  for (const value of ["0"]) {
    await withEnv(value, async () => {
      const entry = mapDbRowToHistoryEntry(dbRow);
      assert.equal(entry.recommended.pick, "Over 7.5");
      assert.equal(entry.insufficientData, undefined);
      assert.equal(entry.historyMeta.competition, undefined, "old rows are not rewritten with new provenance");
      assert.equal(gateHistoryEntry(entry), entry);
    });
  }
});
