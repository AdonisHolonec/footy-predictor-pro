import test from "node:test";
import assert from "node:assert/strict";
import { gateHistoryEntry } from "../../server-utils/pipeline/competitionGate.js";
import { buildFixtureErrorRow, buildInsufficientDataRow } from "../../server-utils/pipeline/stages/fixtureStageShared.js";
import { buildValueEngine } from "../../server-utils/value/ValueEngine.js";
import { buildConfidenceEngine } from "../../server-utils/confidence/ConfidenceEngine.js";
import { MODEL_VERSION } from "../../server-utils/modelConstants.js";
import * as Stage10Persistence from "../../server-utils/pipeline/stages/Stage10Persistence.js";
import { UNSUPPORTED_NATIONAL_COMPETITION } from "../../server-utils/competition/competitionCatalog.js";

const persistedNationsLeagueEntry = {
  id: 1528862,
  leagueId: 5,
  league: "UEFA Nations League",
  logos: { league: "L", home: "H", away: "A" },
  teams: { home: "Netherlands", away: "Germany" },
  fixtureTeamIds: { home: 1118, away: 25 },
  kickoff: "2026-09-24T18:45:00+00:00",
  status: "NS",
  score: { home: null, away: null },
  probs: { p1: 40.8, pX: 25.0, p2: 34.2 },
  recommended: { pick: "Over 7.5", confidence: 68.4, family: "Corners" },
  modelMeta: { method: "modular-engine", dataQuality: 0.9 }
};

test("a persisted Nations League row served from the DB comes back as the insufficient row", () => {
  const gated = gateHistoryEntry(persistedNationsLeagueEntry);
  assert.notEqual(gated, persistedNationsLeagueEntry);
  assert.equal(gated.insufficientData, true);
  assert.equal(gated.insufficientReason, UNSUPPORTED_NATIONAL_COMPETITION);
  assert.equal(gated.id, 1528862);
  assert.equal(gated.leagueId, 5);
  assert.deepEqual(gated.teams, { home: "Netherlands", away: "Germany" });
  assert.deepEqual(gated.recommended, { pick: "", confidence: 0 });
  assert.equal(gated.probs.p1, 0);
  assert.equal(gated.modelMeta.method, "unsupported_national_competition");
  assert.equal(gated.competition.competitionType, "NATIONS_LEAGUE");
});

test("a persisted club row is returned as the same reference", () => {
  const club = { ...persistedNationsLeagueEntry, id: 1, leagueId: 39, league: "Premier League" };
  assert.equal(gateHistoryEntry(club), club);
});

test("buildFixtureErrorRow keeps its pre-gate shape exactly", () => {
  const fx = {
    fixture: { date: "2026-09-25T18:45:00+00:00", status: { short: "NS" } },
    league: { name: "Premier League", logo: "L" },
    teams: { home: { logo: "H" }, away: { logo: "A" } },
    goals: { home: 1, away: null }
  };
  const f = { fixtureId: 7, fx, homeName: "Home FC", awayName: "Away FC", homeIdStr: "33", awayIdStr: "40", refereeName: "M. Oliver", venue: { name: "Old Trafford" } };
  const expected = {
    id: 7,
    leagueId: 39,
    league: "Premier League",
    logos: { league: "L", home: "H", away: "A" },
    teams: { home: "Home FC", away: "Away FC" },
    fixtureTeamIds: { home: 33, away: 40 },
    kickoff: "2026-09-25T18:45:00+00:00",
    status: "NS",
    score: { home: 1, away: null },
    referee: "M. Oliver",
    venue: { name: "Old Trafford" },
    insufficientData: true,
    insufficientReason: "fixture_processing_error",
    probs: { p1: 0, pX: 0, p2: 0, pGG: 0, pO25: 0, pU35: 0, pO15: 0, pDC1X: 0, pDC12: 0, pDCX2: 0, pU15: 0, pNGG: 0, pU25: 0 },
    recommended: { pick: "", confidence: 0 },
    predictions: { oneXtwo: "", gg: "", over25: "", correctScore: "" },
    valueBet: { detected: false, type: "", ev: 0, kelly: 0, stakePlan: "", reasons: ["fixture_processing_error"] },
    valueEngine: buildValueEngine([]),
    confidenceEngine: buildConfidenceEngine({ refereeName: "M. Oliver" }),
    modelMeta: { method: "fixture_processing_error", dataQuality: 0, modelVersion: MODEL_VERSION, reasonCodes: ["fixture_processing_error"] },
    modelVersion: MODEL_VERSION,
    evaluation: { track: "none" }
  };
  assert.deepEqual(buildFixtureErrorRow(f, { lId: "39" }), expected);
});

test("Stage10 never persists a gated row (insufficientData rows are filtered before any write)", async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const gated = gateHistoryEntry(persistedNationsLeagueEntry);
    const gatedEuroQ = gateHistoryEntry({ ...persistedNationsLeagueEntry, id: 1144237, leagueId: 960, league: "Euro Championship - Qualification" });
    assert.equal(gatedEuroQ.insufficientData, true, "a persisted Euro qualification row is served as insufficient");
    const gatedRemaining = [29, 30, 31, 33, 34, 37, 6, 36, 7, 9, 22].map((leagueId, i) => gateHistoryEntry({ ...persistedNationsLeagueEntry, id: 900000 + i, leagueId }));
    for (const row of gatedRemaining) assert.equal(row.insufficientData, true, `persisted row for league ${row.leagueId} is served as insufficient`);
    const club = buildInsufficientDataRow({ id: 2, leagueId: 39 }, { reason: "x", method: "x" });
    const normal = { id: 3, leagueId: 39, probs: { p1: 50 }, recommended: { pick: "1", confidence: 60 } };
    const context = { req: {}, res: {}, out: [gated, gatedEuroQ, ...gatedRemaining, club, normal], usageCtx: null, tierContext: null };
    await Stage10Persistence.run(context);
    assert.deepEqual(context.persistable, [normal]);
    assert.equal(context.skipPersist, true);
  } finally {
    if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
    if (prevKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});
