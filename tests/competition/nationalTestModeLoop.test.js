// National-team TEST MODE at loop + persistence level: with PREDICT_NATIONAL_COMPETITION_GATE=0
// a Nations League fixture reaches Stage02 after the league warm loads ran, and a normal
// (non-aborted) national row reaches Stage10's history upsert like any club row.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

process.env.PREDICT_NATIONAL_COMPETITION_GATE = "0";
const calls = [];
const record = (name) => async () => { calls.push(name); return new Map(); };

const rollingOrig = await import("../../server-utils/teamMarketRolling.js");
const eloOrig = await import("../../server-utils/teamElo.js");
const helpersOrig = await import("../../server-utils/pipeline/predictHelpers.js");
const historyOrig = await import("../../server-utils/predictionsHistory.js");

// Stage02 is the real data-collection boundary: reaching it proves V3 was entered. It is
// replaced by a recorder that stamps a synthetic row and stops the fixture so no provider I/O runs.
mock.module("../../server-utils/pipeline/stages/Stage02FeatureCollection.js", {
  namedExports: {
    STAGE_ID: "Stage02FeatureCollection",
    run: async (context) => {
      calls.push(`Stage02:${context.fixture.fixtureId}`);
      context.fixture.row = { id: context.fixture.fixtureId, leagueId: 5, reachedStage02: true };
      context.fixture.aborted = true;
      return context;
    }
  }
});
mock.module("../../server-utils/teamMarketRolling.js", { namedExports: { ...rollingOrig, loadTeamMarketRolling: record("loadTeamMarketRolling") } });
mock.module("../../server-utils/teamElo.js", { namedExports: { ...eloOrig, loadLeagueElo: record("loadLeagueElo") } });
mock.module("../../server-utils/pipeline/predictHelpers.js", {
  namedExports: { ...helpersOrig, loadStandingsMap: async () => { calls.push("loadStandingsMap"); return { standingsRows: [], standingsMap: new Map() }; } }
});
const persisted = [];
mock.module("../../server-utils/supabaseAdmin.js", {
  namedExports: { assertSupabaseConfigured: () => ({ ok: true }), getSupabaseAdmin: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) }
});
mock.module("../../server-utils/predictionsHistory.js", {
  namedExports: {
    ...historyOrig,
    applyCanonicalPayloads: async (out) => out,
    upsertPredictionsHistory: async (rows) => { persisted.push(...rows); return { count: rows.length, skipped: 0, inserted: rows.length, updated: 0, skippedFinal: 0, skippedStale: 0 }; }
  }
});
mock.module("../../server-utils/importance/persistFeatureImportance.js", { namedExports: { persistFeatureImportanceRows: async () => undefined } });
mock.module("../../server-utils/context/persistContextSnapshots.js", { namedExports: { persistContextSnapshots: async () => undefined } });
mock.module("../../server-utils/linkUserPredictionFixtures.js", { namedExports: { linkUserPredictionFixtures: async () => ({ ok: true, linked: 1 }) } });
mock.module("../../server-utils/accessTier.js", {
  namedExports: { decrementPredictCountBy: async () => 0, rememberUniquePredictFixtures: async () => 0, USER_TIERS: { FREE: "free", PRO: "pro", ULTRA: "ultra" } }
});

const { runFixtureStageLoop } = await import("../../server-utils/pipeline/stages/runFixtureStageLoop.js");
const { createPipelineContext } = await import("../../server-utils/pipeline/PipelineContext.js");
const Stage10 = await import("../../server-utils/pipeline/stages/Stage10Persistence.js");

const nl = (id, home, homeId, away, awayId) => ({
  fixture: { id, date: "2026-09-24T18:45:00+00:00", status: { short: "NS" } },
  league: { id: 5, name: "UEFA Nations League", type: "Cup", country: "World", season: 2026 },
  teams: { home: { id: homeId, name: home }, away: { id: awayId, name: away } },
  goals: { home: null, away: null }
});

test("gate=0: Nations League fixtures reach Stage02 after the league warm loads, exactly like a club league", async () => {
  const context = createPipelineContext({}, {});
  context.leagueIds = ["5"];
  context.season = 2026;
  context.effectiveLimit = 15;
  context.allFixtures = [nl(1528862, "Netherlands", 1118, "Germany", 25), nl(1528879, "Kosovo", 1119, "Rep. Of Ireland", 1120)];
  await runFixtureStageLoop(context);
  assert.deepEqual(calls.filter((c) => !c.startsWith("Stage02")).sort(), ["loadLeagueElo", "loadStandingsMap", "loadTeamMarketRolling"]);
  assert.deepEqual(calls.filter((c) => c.startsWith("Stage02")), ["Stage02:1528862", "Stage02:1528879"]);
  assert.equal(context.out.length, 2);
  assert.ok(context.out.every((r) => r.reachedStage02 === true && r.insufficientData === undefined));
  assert.equal(context.league.competition.entityType, "NATIONAL_TEAM", "classification is still attached for observability");
  assert.equal(context.league.competition.supported, false);
});

test("gate=0: a normal national prediction row goes through Stage10 persistence like any other row", async () => {
  const headers = {};
  const row = { id: 1528862, leagueId: 5, league: "UEFA Nations League", teams: { home: "Netherlands", away: "Germany" }, kickoff: "2026-09-24T18:45:00+00:00", status: "NS", probs: { p1: 0.41, pX: 0.27, p2: 0.32 }, recommended: { pick: "Over 7.5", confidence: 68.376 }, modelMeta: { method: "modular-engine", dataQuality: 0.9 } };
  const ctx = { req: { method: "GET" }, res: { setHeader: (k, v) => (headers[k] = v) }, out: [row], usageCtx: { userId: "user-1", usageDay: "2026-09-23" }, tierContext: null, reservedTierUsage: 0 };
  await Stage10.run(ctx);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].id, 1528862);
  assert.equal(persisted[0].recommended.pick, "Over 7.5");
  assert.equal(headers["X-Persist-Warning"], undefined);
});
