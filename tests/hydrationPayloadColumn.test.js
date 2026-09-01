import test from "node:test";
import assert from "node:assert/strict";

import {
  HYDRATION_PAYLOAD_FIELDS,
  buildHydrationPayload,
  deriveHydrationPayloadColumn
} from "../server-utils/hydrationPayloadColumn.js";
import { mapPredictionToDbRow } from "../server-utils/predictionsHistory.js";
import { PREDICTION_LIST_FIELDS } from "../server-utils/predictionListProjection.js";

/**
 * A1 + A2: the hydration column and its dual-write.
 *
 * This is the WRITE half only. Nothing reads `hydration_payload` yet, so these
 * tests cannot assert that hydration still works — they assert that the column
 * is derivable, correct, immutable, and that adding it changed no reader.
 *
 * The load-bearing property is IMMUTABILITY. `predictionsHistory.js`
 * LIVE_RESULT_FIELDS names everything that may move after creation:
 *
 *   status, score, marketResults, cardMarketValidations, momentum,
 *   evaluation, elapsed
 *
 * If any of those ends up in this column, it becomes stale the moment a match
 * goes live and no settlement writer would fix it — because the settlement paths
 * build partial updates that never mention this column. So the exclusion is
 * asserted structurally, not left to review.
 */

/** Mirrors predictionsHistory.js LIVE_RESULT_FIELDS — the mutable set. */
const LIVE_RESULT_FIELDS = [
  "status",
  "score",
  "marketResults",
  "cardMarketValidations",
  "momentum",
  "evaluation",
  "elapsed"
];

/** Board-contract fields that already have their own promoted column. */
const ALREADY_PROMOTED = [
  "id",
  "leagueId",
  "league",
  "teams",
  "logos",
  "kickoff",
  "status",
  "score",
  "validation",
  "savedAt",
  "modelVersion",
  "cardMarkets",
  "cardMarketValidations",
  "marketResults",
  "referee"
];

function payload(extra = {}) {
  return {
    id: 101,
    leagueId: 39,
    league: "Premier League",
    teams: { home: "Home FC", away: "Away FC" },
    logos: { home: "h.png", away: "a.png", league: "l.png" },
    kickoff: "2026-09-02T18:00:00.000Z",
    status: "NS",
    score: { home: null, away: null },
    momentum: { series: [1, 2, 3], updatedAt: "2026-09-02T18:45:00.000Z" },
    marketResults: { cornersTotal: 9 },
    cardMarkets: { corners: { line: 9.5 } },
    cardMarketValidations: { corners: "pending" },
    recommended: { pick: "1", confidence: 61, odd: 1.9, family: "1x2" },
    probs: { p1: 51, pX: 25, p2: 24, corners: { over: 55 }, shotsOnTarget: { over: 48 }, firstHalf: { p1: 40 } },
    predictions: { gg: "GG", over25: "Peste 2.5", marketTiers: ["a"], cards: { pick: "over" } },
    marketOdds: { closing: { home: 1.8 } },
    confidenceEngine: { score: 72, liveAdjustment: null },
    explanation: { summary: "because" },
    featureImportance: { topFeatures: ["elo"] },
    teamContext: { home: { form: "WWD" } },
    valueBet: { type: "1", kellyPct: 2.1 },
    insufficientData: false,
    insufficientReason: null,
    valueEngine: {
      expectedValue: 0.07,
      edge: 1.4,
      type: "1",
      bestMarket: { type: "1" },
      markets: [
        { type: "over_2_5", family: "goals", ev: 0.01 },
        { type: "cards_over", family: "cards", ev: 0.05 },
        { type: "corners_over", family: "corners", ev: 0.02 }
      ]
    },
    ...extra
  };
}

test("the column never carries a field that can change after creation", () => {
  const built = buildHydrationPayload(payload());
  for (const field of LIVE_RESULT_FIELDS) {
    assert.ok(
      !(field in built),
      `${field} is in LIVE_RESULT_FIELDS and must not be stored in an immutable column`
    );
  }
});

test("momentum specifically is excluded - it is live-updated and has no column", () => {
  const built = buildHydrationPayload(payload());
  assert.equal(built.momentum, undefined);
  assert.ok(!HYDRATION_PAYLOAD_FIELDS.includes("momentum"));
});

test("the column never duplicates a field that is already a promoted column", () => {
  for (const field of ALREADY_PROMOTED) {
    assert.ok(
      !HYDRATION_PAYLOAD_FIELDS.includes(field),
      `${field} already has a column; storing it twice invites the two to disagree`
    );
  }
});

test("every field it does store is part of the board contract", () => {
  for (const field of HYDRATION_PAYLOAD_FIELDS) {
    assert.ok(
      PREDICTION_LIST_FIELDS.includes(field),
      `${field} is not in PREDICTION_LIST_FIELDS - the board would never read it`
    );
  }
});

test("probs is carried whole, because hasLegacyPredictionShape reads its sub-keys", () => {
  const built = buildHydrationPayload(payload());
  // 059 promoted prob_1/_x/_2 only; these four have no column and decide staleness.
  assert.ok(built.probs.corners);
  assert.ok(built.probs.shotsOnTarget);
  assert.ok(built.probs.firstHalf);
  assert.equal(built.probs.p1, 51);
});

test("valueEngine is narrowed exactly as the response projection narrows it", () => {
  const built = buildHydrationPayload(payload());
  assert.equal(built.valueEngine.expectedValue, 0.07);
  // markets collapses to the FIRST cards-looking entry, never the whole set.
  assert.equal(built.valueEngine.markets.length, 1);
  assert.equal(built.valueEngine.markets[0].family, "cards");
});

test("the stored value is dramatically smaller than the document it came from", () => {
  /*
    Sized like a real row, not like a fixture. In production `valueEngine` is
    85.3% of the document and `valueEngine.markets` alone is 44.8% — an
    evaluated set over every market, of which the projection keeps exactly one.
    A three-entry `markets` has no bulk to drop, so it would prove nothing.
  */
  const markets = Array.from({ length: 60 }, (_, i) => ({
    type: `market_${i}`,
    family: "goals",
    ev: i / 100,
    line: 2.5,
    odds: { over: 1.9, under: 1.95 },
    probabilities: { over: 52.5, under: 47.5 },
    reasoning: "evaluated against the model distribution"
  }));
  markets.splice(30, 0, { type: "cards_over", family: "cards", ev: 0.05 });

  const full = payload({ valueEngine: { ...payload().valueEngine, markets } });
  const bytes = (v) => Buffer.byteLength(JSON.stringify(v), "utf8");
  assert.ok(
    bytes(buildHydrationPayload(full)) < bytes(full) / 2,
    "the projection did not drop the evaluated market set"
  );
  // and the cards leg still survives, which is the reason markets is kept at all
  assert.equal(buildHydrationPayload(full).valueEngine.markets[0].family, "cards");
});

test("a payload with none of the fields stores null rather than an empty object", () => {
  assert.equal(buildHydrationPayload({ id: 1, teams: {} }), null);
});

test("malformed input never throws and never invents a value", () => {
  for (const bad of [null, undefined, 42, "x", []]) {
    assert.equal(buildHydrationPayload(bad), null);
  }
});

test("the derivation does not mutate the payload it reads", () => {
  const source = payload();
  const before = JSON.stringify(source);
  buildHydrationPayload(source);
  assert.equal(JSON.stringify(source), before);
  // The projector copies before dropping; valueEngine.markets must be intact.
  assert.equal(source.valueEngine.markets.length, 3);
});

test("the dual-write puts the column on the row, beside an untouched raw_payload", () => {
  const row = mapPredictionToDbRow(payload());
  assert.ok(row.hydration_payload, "hydration_payload missing from the mapped row");
  assert.equal(row.hydration_payload.probs.p1, 51);
  // raw_payload REMAINS AUTHORITATIVE - the cache must not have narrowed it.
  assert.ok(row.raw_payload.momentum, "raw_payload lost momentum");
  assert.equal(row.raw_payload.valueEngine.markets.length, 3);
});

test("the column is derived from the payload actually persisted, not the input", () => {
  // mapPredictionToDbRow layers historyMeta/modelVersion onto the payload before
  // storing it; the column must describe THAT object.
  const row = mapPredictionToDbRow(payload());
  assert.equal(row.hydration_payload.recommended.pick, row.raw_payload.recommended.pick);
  assert.equal(row.hydration_payload.valueBet.type, row.raw_payload.valueBet.type);
});

test("deriveHydrationPayloadColumn returns a spreadable single-key patch", () => {
  const patch = deriveHydrationPayloadColumn(payload());
  assert.deepEqual(Object.keys(patch), ["hydration_payload"]);
});
