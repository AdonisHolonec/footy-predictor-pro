import test from "node:test";
import assert from "node:assert/strict";

import {
  PREDICTION_LIST_FIELDS,
  PREDICTION_LIST_VALUE_ENGINE_FIELDS,
  projectPredictionListRow,
  projectPredictionListRows
} from "../server-utils/predictionListProjection.js";
import { shouldServeLightList, shouldServePredictionList } from "../api/history.js";

/**
 * P3-B: the prediction hydration projection.
 *
 * `/api/history?mine=1` with no `view` is the prediction hydration source, and
 * measured on one real user it returned 184 items / 45,074,431 B / 11.0 s to
 * render a board that shows a scoreline, a recommendation and a value badge.
 *
 * The projection is OPT-IN because that endpoint has a SECOND full-shape
 * consumer — historyService.loadHistory serves the guest and admin observatory
 * from `mine=1` with no `view`. These tests pin that boundary: only the exact
 * token narrows anything, and the FULL default is unchanged.
 */

const CARD_MARKET = { type: "Cards Over 3.5", family: "Cards", probability: 62, line: 3.5 };

const HEAVY_KEYS = [
  "monteCarlo",
  "modelMeta",
  "predictionLaboratory",
  "leagueStandings",
  "predictionContributions",
  "odds",
  "auditLog",
  "historyMeta",
  "lambdas",
  "luckStats",
  "evaluation",
  "leagueProfile",
  "venue",
  "fixtureTeamIds"
];

const SCALARS = {
  expectedValue: 0.14,
  edge: 0.06,
  signal: "positive",
  detected: true,
  recommendable: true,
  negativeEV: false,
  positiveEV: true,
  kellyPct: 3.2,
  valueScore: 71,
  type: "Over 2.5",
  family: "Over/Under",
  positiveEvCount: 23,
  negativeEvCount: 116,
  familiesSupported: ["Over/Under"],
  familiesPresent: ["Over/Under"],
  rule: "never_recommend_negative_ev",
  highlighted: true,
  explanation: "value found"
};

const BEST_MARKET = { type: "Over 2.5", family: "Over/Under", odds: 1.9 };

/** A mapped history entry, as mapDbRowToHistoryEntry produces one. */
function mappedRow(overrides = {}) {
  const heavy = {};
  for (const k of HEAVY_KEYS) heavy[k] = { padding: "x".repeat(200) };
  return {
    id: 4242,
    leagueId: 283,
    league: "Liga I",
    teams: { home: "A", away: "B" },
    logos: { home: "h.png", away: "a.png" },
    kickoff: "2026-08-18T18:00:00+00:00",
    status: "NS",
    score: { home: null, away: null },
    validation: "pending",
    savedAt: "2026-08-18T09:00:00+00:00",
    modelVersion: "v3",
    recommended: { pick: "Over 2.5", confidence: 70, odd: 1.9 },
    probs: { corners: { total: 9.5 }, shotsOnTarget: { total: 8.5 }, firstHalf: { pO15: 55 } },
    predictions: { marketTiers: { over25: { tier: "strong" } }, cards: "Over 3.5" },
    cardMarkets: { corners: {} },
    cardMarketValidations: { corners: "win" },
    marketResults: { cornersTotal: 9 },
    marketOdds: { cards: { line: 3.5, odd: 1.8 }, btts: { odd: 1.7 } },
    confidenceEngine: { overall: 71, liveAdjustment: null },
    explanation: { why: ["reason"] },
    featureImportance: { top: ["xg"] },
    teamContext: { home: {} },
    momentum: null,
    valueBet: { detected: true, ev: 0.14 },
    referee: "R. Referee",
    ...heavy,
    valueEngine: {
      ...SCALARS,
      bestMarket: { ...BEST_MARKET },
      markets: [
        { type: "Over 2.5", family: "Over/Under" },
        { ...CARD_MARKET },
        { type: "Under 2.5", family: "Over/Under" }
      ]
    },
    ...overrides
  };
}

const bytes = (v) => Buffer.byteLength(JSON.stringify(v), "utf8");

/* -- the projection ------------------------------------------------------- */

test("keeps every field the prediction board renders from", () => {
  const p = projectPredictionListRow(mappedRow());
  const required = [
    "id", "leagueId", "league", "teams", "logos", "kickoff", "status", "score", "validation",
    "savedAt", "modelVersion", "recommended", "probs", "predictions", "cardMarketValidations",
    "marketResults", "marketOdds", "confidenceEngine", "explanation", "featureImportance",
    "teamContext", "valueBet", "referee"
  ];
  for (const field of required) {
    assert.ok(field in p, `the projection dropped "${field}"`);
  }
});

test("drops the analytical fields no board surface reads", () => {
  const p = projectPredictionListRow(mappedRow());
  for (const key of HEAVY_KEYS) {
    assert.equal(key in p, false, `"${key}" survived the projection`);
  }
});

test("keeps probs.corners, probs.shotsOnTarget and modelVersion", () => {
  // hasLegacyPredictionShape reads exactly these. Losing them would leave every
  // hydrated row looking stale to a paid tier and re-arm the rehydrate that
  // fetched it — the loop Phase 4I exists to prevent.
  const p = projectPredictionListRow(mappedRow());
  assert.ok(p.probs.corners);
  assert.ok(p.probs.shotsOnTarget);
  assert.equal(p.modelVersion, "v3");
});

test("keeps the valueEngine scalars and bestMarket", () => {
  const engine = projectPredictionListRow(mappedRow()).valueEngine;
  for (const [key, value] of Object.entries(SCALARS)) {
    assert.deepEqual(engine[key], value, `scalar ${key} was lost`);
  }
  assert.deepEqual(engine.bestMarket, BEST_MARKET);
});

test("keeps exactly the one card market specialBet reads", () => {
  const engine = projectPredictionListRow(mappedRow()).valueEngine;
  assert.deepEqual(engine.markets, [CARD_MARKET]);
});

test("omits markets when there is no card entry", () => {
  const row = mappedRow();
  row.valueEngine.markets = [{ type: "Over 2.5", family: "Over/Under" }];
  assert.equal("markets" in projectPredictionListRow(row).valueEngine, false);
});

test("does not mutate the row it projects", () => {
  // mapDbRowToHistoryEntry spreads raw_payload, so these are shared references.
  const row = mappedRow();
  const before = JSON.stringify(row);
  projectPredictionListRow(row);
  assert.equal(JSON.stringify(row), before);
  assert.equal(row.valueEngine.markets.length, 3);
  assert.ok(row.monteCarlo);
});

test("is materially smaller than the row it came from", () => {
  const row = mappedRow();
  assert.ok(bytes(projectPredictionListRow(row)) < bytes(row) / 2);
});

test("tolerates malformed rows", () => {
  assert.equal(projectPredictionListRow(null), null);
  assert.equal(projectPredictionListRow(undefined), undefined);
  const arr = [1, 2];
  assert.equal(projectPredictionListRow(arr), arr);
  assert.equal("valueEngine" in projectPredictionListRow({ id: 1 }), false);
  assert.equal(projectPredictionListRows(null), null);
});

test("projects every row in a list", () => {
  const out = projectPredictionListRows([mappedRow(), mappedRow({ id: 7 })]);
  assert.equal(out.length, 2);
  for (const r of out) assert.equal("monteCarlo" in r, false);
});

test("the field lists never include the analytical keys", () => {
  for (const key of HEAVY_KEYS) {
    assert.equal(PREDICTION_LIST_FIELDS.includes(key), false, `"${key}" is in the contract`);
  }
  assert.equal(PREDICTION_LIST_VALUE_ENGINE_FIELDS.includes("markets"), false);
  assert.equal(PREDICTION_LIST_VALUE_ENGINE_FIELDS.includes("positiveMarkets"), false);
  assert.equal(PREDICTION_LIST_VALUE_ENGINE_FIELDS.includes("negativeMarkets"), false);
});

/* -- the caller boundary --------------------------------------------------- */

test("only the exact token `prediction-list` opts in", () => {
  assert.equal(shouldServePredictionList({ view: "prediction-list" }), true);
  assert.equal(shouldServePredictionList({}), false);
  assert.equal(shouldServePredictionList(undefined), false);
  assert.equal(shouldServePredictionList({ view: "" }), false);
  assert.equal(shouldServePredictionList({ view: "list" }), false);
  assert.equal(shouldServePredictionList({ view: "special-bets" }), false);
  assert.equal(shouldServePredictionList({ view: "Prediction-List" }), false);
  // historyService.loadHistory — the OTHER full-shape consumer — must stay full.
  assert.equal(shouldServePredictionList({ days: "30", limit: "2000", mine: "1" }), false);
});

test("the two view tokens never collide", () => {
  // Each must leave the other's route alone, or the History list and the
  // prediction board would silently swap projections.
  assert.equal(shouldServeLightList({ view: "prediction-list" }), false);
  assert.equal(shouldServePredictionList({ view: "list" }), false);
  assert.equal(shouldServeLightList({ view: "list" }), true);
  assert.equal(shouldServePredictionList({ view: "prediction-list" }), true);
});
