import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBenchmarkConsensus } from "../../server-utils/predictionBenchmark/BenchmarkConsensus.js";
import { normalizeApiFootballPrediction } from "../../server-utils/predictionBenchmark/normalizeApiFootballPrediction.js";

const FIXTURE_TEAMS = { homeTeamId: 100, awayTeamId: 200 };

function rawApiResponse(overrides = {}) {
  return {
    predictions: {
      winner: { id: 100, name: "Home FC", comment: "Winner" },
      win_or_draw: false,
      percent: { home: "55%", draw: "25%", away: "20%" },
      advice: null,
      goals: { home: "-2.5", away: "+1.5" },
      under_over: null,
      ...overrides.predictions
    },
    comparison: {},
    teams: {},
    h2h: null,
    ...overrides
  };
}

test("same-family agreement: both pick Home Win (1x2)", () => {
  const api = normalizeApiFootballPrediction(rawApiResponse(), 555);
  const consensus = buildBenchmarkConsensus({ pick: "1", confidence: 72 }, api, FIXTURE_TEAMS);
  assert.equal(consensus.familyComparable, true);
  assert.equal(consensus.agree, true);
  assert.equal(consensus.recommendationDelta.sameSide, true);
  assert.equal(consensus.apiPick.family, "1x2");
  assert.equal(consensus.apiPick.confidencePct, 55);
  assert.equal(consensus.confidenceDelta, 17);
});

test("same-family disagreement: we pick Away, API favors Home", () => {
  const api = normalizeApiFootballPrediction(rawApiResponse(), 556);
  const consensus = buildBenchmarkConsensus({ pick: "2", confidence: 40 }, api, FIXTURE_TEAMS);
  assert.equal(consensus.familyComparable, true);
  assert.equal(consensus.agree, false);
  assert.equal(consensus.recommendationDelta.ourSide, "2");
  assert.equal(consensus.recommendationDelta.apiSide, "1");
});

test("cross-family: we pick Over 2.5 goals, API only expresses a 1X2 opinion", () => {
  const api = normalizeApiFootballPrediction(rawApiResponse(), 557);
  const consensus = buildBenchmarkConsensus({ pick: "Over 2.5", confidence: 68 }, api, FIXTURE_TEAMS);
  assert.equal(consensus.familyComparable, false);
  assert.equal(consensus.agree, null);
  assert.equal(consensus.recommendationDelta.sameSide, null);
});

test("missing API data: benchmark unavailable for this fixture", () => {
  const consensus = buildBenchmarkConsensus({ pick: "1", confidence: 60 }, null, FIXTURE_TEAMS);
  assert.equal(consensus.familyComparable, false);
  assert.equal(consensus.agree, null);
  assert.equal(consensus.apiPick.inferredPick, null);
  assert.equal(consensus.confidenceDelta, null);
});

test("ou family: same line, same side agrees", () => {
  const api = normalizeApiFootballPrediction(
    rawApiResponse({ predictions: { under_over: "+2.5" } }),
    558
  );
  const consensus = buildBenchmarkConsensus({ pick: "Over 2.5", confidence: 70 }, api, FIXTURE_TEAMS);
  assert.equal(consensus.familyComparable, true);
  assert.equal(consensus.agree, true);
});

test("ou family: different line is agree:null with lineMismatch flag, not a false disagreement", () => {
  const api = normalizeApiFootballPrediction(
    rawApiResponse({ predictions: { under_over: "+3.5" } }),
    559
  );
  const consensus = buildBenchmarkConsensus({ pick: "Over 2.5", confidence: 70 }, api, FIXTURE_TEAMS);
  assert.equal(consensus.familyComparable, false);
  assert.equal(consensus.agree, null);
});

test("draw fallback: no explicit winner, draw is the max percent", () => {
  const api = normalizeApiFootballPrediction(
    rawApiResponse({
      predictions: {
        winner: { id: null, name: null, comment: "Draw" },
        percent: { home: "30%", draw: "40%", away: "30%" }
      }
    }),
    560
  );
  const consensus = buildBenchmarkConsensus({ pick: "X", confidence: 45 }, api, FIXTURE_TEAMS);
  assert.equal(consensus.familyComparable, true);
  assert.equal(consensus.agree, true);
  assert.equal(consensus.apiPick.inferredPick, "x");
});

test("is deterministic — identical inputs produce identical agree/family output across calls", () => {
  const api = normalizeApiFootballPrediction(rawApiResponse(), 561);
  const a = buildBenchmarkConsensus({ pick: "1", confidence: 72 }, api, FIXTURE_TEAMS);
  const b = buildBenchmarkConsensus({ pick: "1", confidence: 72 }, api, FIXTURE_TEAMS);
  assert.equal(a.agree, b.agree);
  assert.equal(a.familyComparable, b.familyComparable);
  assert.deepEqual(a.recommendationDelta, b.recommendationDelta);
});
