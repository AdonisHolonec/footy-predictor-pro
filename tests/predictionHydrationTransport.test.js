import test, { mock } from "node:test";
import assert from "node:assert/strict";

import {
  DEAD_VALUE_ENGINE_ARRAYS,
  stripDeadValueEngineArrays,
  stripDeadValueEngineArraysFromRows
} from "../server-utils/valueEngineTransport.js";
import { handleHistoryDetail } from "../api/history.js";

/**
 * Transport reduction for the prediction hydration response.
 *
 * `buildValueEngine` emits three arrays over the same evaluated set. Measured on
 * 184 real production rows: markets 108,774 B/row, negativeMarkets 82,876 B/row,
 * positiveMarkets 17,590 B/row — and positive/negative are each a strict subset
 * of markets on 184/184, split on the sign of expectedValue. Nothing in src/,
 * server-utils/ or api/ reads either subset; only their counts are read, and
 * those are already separate scalars.
 *
 * What must hold, asserted on behaviour rather than source text:
 *   - the hydration response drops both dead arrays
 *   - it keeps `markets`, `bestMarket` and every scalar
 *   - the by-fixture DETAIL response keeps everything, including both arrays
 *   - the stored document is never mutated — mapDbRowToHistoryEntry spreads
 *     raw_payload, so a mapped row's valueEngine IS the database row's object
 */

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
  rejectedNegativeCount: 116,
  positiveEvCount: 23,
  negativeEvCount: 116,
  familiesSupported: ["1X2", "Over/Under"],
  familiesPresent: ["Over/Under"],
  rule: "never_recommend_negative_ev",
  highlighted: true,
  explanation: "value found"
};

const BEST_MARKET = { type: "Over 2.5", family: "Over/Under", expectedValue: 0.14, odds: 1.9, probability: 0.6 };

function market(type, ev) {
  return { type, family: "Over/Under", expectedValue: ev, probability: 0.6, odds: 1.9, valueScore: 50 };
}

const POSITIVE = [market("Over 2.5", 0.14)];
const NEGATIVE = [market("Under 2.5", -0.08), market("BTTS No", -0.02)];
const MARKETS = [...POSITIVE, ...NEGATIVE, market("Corners Over 9.5", 0)];

function valueEngine() {
  return {
    ...SCALARS,
    bestMarket: { ...BEST_MARKET },
    markets: MARKETS.map((m) => ({ ...m })),
    positiveMarkets: POSITIVE.map((m) => ({ ...m })),
    negativeMarkets: NEGATIVE.map((m) => ({ ...m }))
  };
}

function dbRow(fixtureId = 4242) {
  return {
    fixture_id: fixtureId,
    league_id: 283,
    league_name: "Liga I",
    kickoff_at: "2026-08-18T18:00:00+00:00",
    home_team: "A",
    away_team: "B",
    score_home: null,
    score_away: null,
    validation: "pending",
    match_status: "NS",
    recommended_pick: "Over 2.5",
    recommended_confidence: 70,
    saved_at: "2026-08-18T09:00:00+00:00",
    model_version: "v3",
    raw_payload: {
      id: fixtureId,
      kickoff: "2026-08-18T18:00:00+00:00",
      teams: { home: "A", away: "B" },
      probs: { corners: { over: 0.5 }, shotsOnTarget: { over: 0.5 } },
      recommended: { pick: "Over 2.5", confidence: 70, odd: 1.9 },
      marketOdds: { over25: 1.9 },
      valueEngine: valueEngine()
    }
  };
}

/** Loads predictionsHistory with getSupabaseAdmin faked to return these RPC rows. */
async function loadWithRows(rows, tag) {
  mock.reset();
  mock.module("../server-utils/supabaseAdmin.js", {
    namedExports: {
      getSupabaseAdmin: () => ({ rpc: async () => ({ data: rows, error: null }) }),
      assertSupabaseConfigured: () => ({ ok: true })
    }
  });
  return import(`../server-utils/predictionsHistory.js?${tag}=${Math.random()}`);
}

async function readHydrationWith(rows) {
  const mod = await loadWithRows(rows, "hydration");
  return mod.readPredictionsHistoryForUser("user-1", 14, 1000);
}

function fakeRes() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    }
  };
}

async function readDetail(row, fixtureId) {
  const res = fakeRes();
  await handleHistoryDetail({ method: "GET", query: {} }, res, fixtureId, {
    getRequester: async () => ({ ok: true, user: { id: "user-1" } }),
    getSupabaseAdmin: () => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) })
    })
  });
  return res;
}

/* ---------------------------------------------------------------- */
/* the pure helper                                                    */
/* ---------------------------------------------------------------- */

test("strip removes both dead arrays from a row", () => {
  const out = stripDeadValueEngineArrays({ id: 1, valueEngine: valueEngine() });
  assert.equal("positiveMarkets" in out.valueEngine, false);
  assert.equal("negativeMarkets" in out.valueEngine, false);
});

test("strip keeps markets, bestMarket and every scalar", () => {
  const out = stripDeadValueEngineArrays({ id: 1, valueEngine: valueEngine() });
  assert.deepEqual(out.valueEngine.markets, MARKETS);
  assert.deepEqual(out.valueEngine.bestMarket, BEST_MARKET);
  for (const [key, value] of Object.entries(SCALARS)) {
    assert.deepEqual(out.valueEngine[key], value, `scalar ${key} was lost`);
  }
});

test("strip does not mutate the source row or its valueEngine", () => {
  const source = { id: 1, valueEngine: valueEngine() };
  const engineRef = source.valueEngine;
  const before = JSON.stringify(source);
  stripDeadValueEngineArrays(source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(source.valueEngine, engineRef);
  assert.equal(source.valueEngine.positiveMarkets.length, POSITIVE.length);
  assert.equal(source.valueEngine.negativeMarkets.length, NEGATIVE.length);
});

test("strip leaves every other top-level field untouched", () => {
  const row = { id: 1, probs: { a: 1 }, recommended: { pick: "x" }, marketOdds: { o: 2 }, valueEngine: valueEngine() };
  const out = stripDeadValueEngineArrays(row);
  assert.deepEqual(out.probs, row.probs);
  assert.deepEqual(out.recommended, row.recommended);
  assert.deepEqual(out.marketOdds, row.marketOdds);
});

test("strip returns the same reference when there is nothing to remove", () => {
  const clean = { id: 1, valueEngine: { ...SCALARS, markets: [] } };
  assert.equal(stripDeadValueEngineArrays(clean), clean);
  const noEngine = { id: 2 };
  assert.equal(stripDeadValueEngineArrays(noEngine), noEngine);
});

test("strip tolerates malformed rows", () => {
  assert.equal(stripDeadValueEngineArrays(null), null);
  assert.equal(stripDeadValueEngineArrays(undefined), undefined);
  const arrayEngine = { valueEngine: [1, 2] };
  assert.equal(stripDeadValueEngineArrays(arrayEngine), arrayEngine);
  const nullEngine = { valueEngine: null };
  assert.equal(stripDeadValueEngineArrays(nullEngine), nullEngine);
});

test("the dead set is exactly the two subset arrays and never markets", () => {
  assert.deepEqual([...DEAD_VALUE_ENGINE_ARRAYS].sort(), ["negativeMarkets", "positiveMarkets"]);
  assert.equal(DEAD_VALUE_ENGINE_ARRAYS.includes("markets"), false);
});

test("row helper maps every row and passes non-arrays through", () => {
  const out = stripDeadValueEngineArraysFromRows([{ valueEngine: valueEngine() }, { valueEngine: valueEngine() }]);
  assert.equal(out.length, 2);
  for (const r of out) assert.equal("negativeMarkets" in r.valueEngine, false);
  assert.equal(stripDeadValueEngineArraysFromRows(null), null);
});

/* ---------------------------------------------------------------- */
/* the wiring: hydration trims, detail does not                       */
/* ---------------------------------------------------------------- */

test("hydration response carries no positiveMarkets and no negativeMarkets", async () => {
  const { items } = await readHydrationWith([dbRow()]);
  assert.equal(items.length, 1);
  assert.equal("positiveMarkets" in items[0].valueEngine, false);
  assert.equal("negativeMarkets" in items[0].valueEngine, false);
});

test("hydration response keeps markets, bestMarket and the scalars", async () => {
  const { items } = await readHydrationWith([dbRow()]);
  assert.deepEqual(items[0].valueEngine.markets, MARKETS);
  assert.deepEqual(items[0].valueEngine.bestMarket, BEST_MARKET);
  for (const key of Object.keys(SCALARS)) {
    assert.deepEqual(items[0].valueEngine[key], SCALARS[key], `scalar ${key} was lost`);
  }
});

test("hydration keeps the rest of the prediction document intact", async () => {
  const { items } = await readHydrationWith([dbRow()]);
  const source = dbRow().raw_payload;
  assert.deepEqual(items[0].probs, source.probs);
  assert.deepEqual(items[0].marketOdds, source.marketOdds);
  assert.deepEqual(items[0].recommended, source.recommended);
  assert.equal(items[0].id, 4242);
});

test("hydration does not mutate the database row it read", async () => {
  const rows = [dbRow()];
  const before = JSON.stringify(rows);
  const mod = await loadWithRows(rows, "nomutate");
  await mod.readPredictionsHistoryForUser("user-1", 14, 1000);
  assert.equal(JSON.stringify(rows), before, "the stored raw_payload was mutated in place");
  assert.equal(rows[0].raw_payload.valueEngine.positiveMarkets.length, POSITIVE.length);
  assert.equal(rows[0].raw_payload.valueEngine.negativeMarkets.length, NEGATIVE.length);
});

test("hydration still reports stats alongside the trimmed items", async () => {
  const { items, stats } = await readHydrationWith([dbRow()]);
  assert.equal(items.length, 1);
  assert.equal(typeof stats, "object");
  assert.equal(typeof stats.settled, "number");
});

test("the by-fixture detail response still carries BOTH dead arrays", async () => {
  const res = await readDetail(dbRow(9001), 9001);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.scope, "fixture_detail");
  const engine = res.payload.item.valueEngine;
  assert.equal(Array.isArray(engine.positiveMarkets), true, "detail lost positiveMarkets");
  assert.equal(Array.isArray(engine.negativeMarkets), true, "detail lost negativeMarkets");
  assert.deepEqual(engine.markets, MARKETS);
  assert.deepEqual(engine.bestMarket, BEST_MARKET);
});

test("detail and hydration differ only by the two dead arrays", async () => {
  const res = await readDetail(dbRow(9002), 9002);
  const { items } = await readHydrationWith([dbRow(9002)]);
  const detailTrimmed = stripDeadValueEngineArrays(res.payload.item);
  assert.deepEqual(Object.keys(items[0].valueEngine).sort(), Object.keys(detailTrimmed.valueEngine).sort());
});
