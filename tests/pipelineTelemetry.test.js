import test from "node:test";
import assert from "node:assert/strict";

import {
  FIXTURE_CAP,
  beginFixture,
  createPipelineTelemetry,
  endFixture,
  recordStage,
  summarize
} from "../server-utils/observability/pipelineTelemetry.js";
import { runFixtureStageLoop, FIXTURE_STAGES } from "../server-utils/pipeline/stages/runFixtureStageLoop.js";
import { SLOW_REQUEST_MS } from "../server-utils/observability/requestMonitor.js";

/**
 * Timing attribution for Predictor V3.
 *
 * One production Predict took 48,744 ms for 35 fixtures and nothing could say
 * where it went. `stageMarks` was written by all thirteen stages and read by
 * none, and stages 02-09 overwrote theirs on every fixture, so it could only
 * ever have described the last one.
 *
 * The properties that matter are accumulation (a per-fixture stage must sum, not
 * overwrite), boundedness (35 fixtures must not become 35 log lines) and
 * inertness (measurement must not change a prediction). Those are what is
 * asserted here.
 */

/* -- accumulation ---------------------------------------------------------- */

test("a per-fixture stage accumulates across fixtures instead of overwriting", () => {
  const t = createPipelineTelemetry();
  for (const ms of [10, 30, 20]) {
    beginFixture(t, 1);
    recordStage(t, "Stage02FeatureCollection", ms);
    endFixture(t, ms);
  }
  const s = summarize(t, { totalMs: 60 });
  const stage = s.stages.Stage02FeatureCollection;
  assert.equal(stage.count, 3);
  assert.equal(stage.totalMs, 60);
  assert.equal(stage.maxMs, 30);
  assert.equal(stage.minMs, 10);
  assert.equal(stage.avgMs, 20);
});

test("maxMs tracks the slowest execution, not the last", () => {
  const t = createPipelineTelemetry();
  recordStage(t, "Stage08Decision", 500);
  recordStage(t, "Stage08Decision", 5);
  const s = summarize(t, { totalMs: 505 });
  assert.equal(s.stages.Stage08Decision.maxMs, 500);
  assert.equal(s.stages.Stage08Decision.minMs, 5);
});

test("request-level stages and fixture-level stages share one ledger", () => {
  const t = createPipelineTelemetry();
  recordStage(t, "Stage01DataCollection", 100);
  beginFixture(t, 7);
  recordStage(t, "Stage02FeatureCollection", 40);
  endFixture(t, 45);
  const s = summarize(t, { totalMs: 200 });
  assert.equal(s.stages.Stage01DataCollection.count, 1);
  assert.equal(s.stages.Stage02FeatureCollection.count, 1);
  assert.equal(s.fixtureCount, 1);
});

test("unattributed time is what the stages did not explain", () => {
  const t = createPipelineTelemetry();
  recordStage(t, "Stage01DataCollection", 1000);
  const s = summarize(t, { totalMs: 48744 });
  assert.equal(s.unattributedMs, 47744);
});

test("a fixture records the gap between its wall time and its stages", () => {
  const t = createPipelineTelemetry();
  beginFixture(t, 99);
  recordStage(t, "Stage02FeatureCollection", 30);
  endFixture(t, 200);
  const [f] = summarize(t, { totalMs: 200 }).slowestFixtures;
  assert.equal(f.wallMs, 200);
  assert.equal(f.stageMs, 30);
  assert.equal(f.unattributedMs, 170);
});

/* -- the slow-fixture report is bounded ------------------------------------ */

test("the slowest-fixture report is bounded and ordered", () => {
  const t = createPipelineTelemetry();
  for (let i = 1; i <= 40; i += 1) {
    beginFixture(t, i);
    recordStage(t, "Stage05Simulation", i);
    endFixture(t, i);
  }
  const s = summarize(t, { totalMs: 1000 });
  assert.equal(s.fixtureCount, 40);
  assert.equal(s.slowestFixtures.length, 5, "default must stay small");
  assert.deepEqual(
    s.slowestFixtures.map((f) => f.fixtureId),
    [40, 39, 38, 37, 36]
  );
  assert.equal(summarize(t, { totalMs: 1000, slowFixtureLimit: 2 }).slowestFixtures.length, 2);
});

test("retained fixtures are capped, and the drop is reported rather than hidden", () => {
  const t = createPipelineTelemetry();
  for (let i = 0; i < FIXTURE_CAP + 25; i += 1) {
    beginFixture(t, i);
    endFixture(t, 1);
  }
  const s = summarize(t, { totalMs: 10 });
  assert.equal(t.fixtures.length, FIXTURE_CAP);
  assert.equal(s.droppedFixtures, 25);
  assert.equal(s.fixtureCount, FIXTURE_CAP + 25, "the count must still be truthful");
});

test("the dominant stage of a fixture is the one that cost most", () => {
  const t = createPipelineTelemetry();
  beginFixture(t, 5);
  recordStage(t, "Stage02FeatureCollection", 900);
  recordStage(t, "Stage05Simulation", 10);
  endFixture(t, 910);
  const [f] = summarize(t, { totalMs: 910 }).slowestFixtures;
  assert.equal(f.dominantStage, "Stage02FeatureCollection");
  assert.equal(f.dominantStageMs, 900);
});

/* -- robustness ------------------------------------------------------------ */

test("invalid telemetry inputs never throw", () => {
  for (const bad of [null, undefined, 0, "x", []]) {
    assert.doesNotThrow(() => recordStage(bad, "s", 1));
    assert.doesNotThrow(() => beginFixture(bad, 1));
    assert.doesNotThrow(() => endFixture(bad, 1));
  }
  const s = summarize(null);
  assert.equal(s.totalMs, 0);
  assert.deepEqual(s.stages, {});
  assert.deepEqual(s.slowestFixtures, []);
});

test("non-numeric or negative durations are ignored, not accumulated", () => {
  const t = createPipelineTelemetry();
  for (const ms of [NaN, -5, undefined, null, "abc", Infinity]) recordStage(t, "Stage04ProbabilityGeneration", ms);
  const s = summarize(t, { totalMs: 0 });
  assert.equal(s.stages.Stage04ProbabilityGeneration, undefined);
});

test("closing a fixture that was never opened is harmless", () => {
  const t = createPipelineTelemetry();
  assert.doesNotThrow(() => endFixture(t, 10));
  assert.equal(summarize(t, { totalMs: 0 }).fixtureCount, 0);
});

test("the emit threshold is the one requestMonitor already uses", () => {
  assert.equal(SLOW_REQUEST_MS, 8000);
});

/* -- inertness: the loop behaves identically with and without telemetry ---- */

function fakeFixture(id) {
  return {
    fixture: { id, referee: "R" },
    league: { id: 283 },
    teams: { home: { id: 1, name: "A" }, away: { id: 2, name: "B" } }
  };
}

/** A context shaped like the one PredictorV3 builds. */
function loopContext(telemetry) {
  return {
    halted: false,
    leagueIds: [283],
    season: 2026,
    effectiveLimit: 10,
    allFixtures: [fakeFixture(11), fakeFixture(22), fakeFixture(33)],
    out: [],
    contextSnapshots: [],
    telemetry
  };
}

/** Replaces the eight fixture stages with one stub for the duration of a run. */
async function runLoopWith(context, stageStub) {
  const original = FIXTURE_STAGES.splice(0, FIXTURE_STAGES.length, stageStub);
  try {
    await runFixtureStageLoop(context);
  } finally {
    FIXTURE_STAGES.splice(0, FIXTURE_STAGES.length, ...original);
  }
  return context;
}

const rowStage = {
  STAGE_ID: "StageStub",
  async run(context) {
    context.fixture.row = { id: context.fixture.fixtureId, pick: "Over 2.5" };
  }
};

test("prediction output is identical with and without telemetry", async () => {
  const withT = await runLoopWith(loopContext(createPipelineTelemetry()), rowStage);
  const withoutT = await runLoopWith(loopContext(undefined), rowStage);
  assert.deepEqual(withoutT.out, withT.out);
  assert.equal(withT.out.length, 3);
});

test("the context handed on to persistence is unchanged by telemetry", async () => {
  const withT = await runLoopWith(loopContext(createPipelineTelemetry()), rowStage);
  const withoutT = await runLoopWith(loopContext(undefined), rowStage);
  // `out` is exactly what Stage10 persists and Stage11/12 serialise.
  assert.equal(JSON.stringify(withT.out), JSON.stringify(withoutT.out));
  assert.deepEqual(withT.contextSnapshots, withoutT.contextSnapshots);
  for (const row of withT.out) assert.equal("telemetry" in row, false);
});

test("the loop still completes when no telemetry accumulator is present", async () => {
  const ctx = await runLoopWith(loopContext(undefined), rowStage);
  assert.equal(ctx.out.length, 3);
});

test("telemetry records one fixture entry per fixture the loop processed", async () => {
  const t = createPipelineTelemetry();
  await runLoopWith(loopContext(t), rowStage);
  const s = summarize(t, { totalMs: 100 });
  assert.equal(s.fixtureCount, 3);
  assert.equal(s.stages.StageStub.count, 3);
  assert.deepEqual(
    s.slowestFixtures.map((f) => f.fixtureId).sort((a, b) => a - b),
    [11, 22, 33]
  );
});

test("a throwing stage is still measured and does not abort the run", async () => {
  const t = createPipelineTelemetry();
  const boom = {
    STAGE_ID: "StageBoom",
    async run() {
      throw new Error("stage failed");
    }
  };
  const ctx = await runLoopWith(loopContext(t), boom);
  const s = summarize(t, { totalMs: 100 });
  // finally{} means the duration is recorded even on the failure path.
  assert.equal(s.stages.StageBoom.count, 3);
  assert.equal(s.fixtureCount, 3);
  // The loop's existing behaviour — an error row per failed fixture — is intact.
  assert.equal(ctx.out.length, 3);
});
