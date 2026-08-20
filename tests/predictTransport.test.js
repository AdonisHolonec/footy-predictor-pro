import test from "node:test";
import assert from "node:assert/strict";

import * as Stage12Response from "../server-utils/pipeline/stages/Stage12Response.js";

/**
 * /api/predict transport reduction (P2-C).
 *
 * P2-B trimmed the two dead valueEngine arrays out of the /api/history hydration
 * response. They were still leaving through /api/predict, whose rows are stored
 * verbatim in `footy.user.predictionsByUser` — dedupePredictionsById only
 * de-duplicates and mergePredictionRows only spreads, so nothing transforms the
 * row between the response and localStorage.
 *
 * Measured on the rows actually resident in that key: valueEngine is 85.3% of
 * the blob, and positiveMarkets + negativeMarkets alone are 40.0% of it, with no
 * runtime reader anywhere in src/, api/, server-utils/ or scripts/.
 *
 * Stage12 is the ONE serialization boundary for this endpoint. Every halt —
 * FREE readDbOnlyPredictions, tryPaidDbCacheHit, both budget-circuit stops —
 * routes through PredictorV3.handle back into Stage12Response.run, so both
 * branches are asserted here. Stage10 has already persisted by this point, which
 * is what makes the trim transport-only.
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
  positiveEvCount: 23,
  negativeEvCount: 116,
  familiesSupported: ["1X2", "Over/Under"],
  familiesPresent: ["Over/Under"]
};

const BEST_MARKET = { type: "Over 2.5", family: "Over/Under", expectedValue: 0.14, odds: 1.9 };
const MARKETS = [
  { type: "Over 2.5", family: "Over/Under", expectedValue: 0.14, probability: 0.6 },
  { type: "Cards Over 3.5", family: "Cards", expectedValue: -0.02, probability: 0.44 }
];

function predictionRow(overrides = {}) {
  return {
    id: 4242,
    leagueId: 283,
    kickoff: "2026-08-18T18:00:00+00:00",
    teams: { home: "A", away: "B" },
    probs: { corners: { over: 0.5 }, shotsOnTarget: { over: 0.5 } },
    modelVersion: "v3",
    recommended: { pick: "Over 2.5", confidence: 70, odd: 1.9 },
    marketOdds: { over25: 1.9 },
    valueEngine: {
      ...SCALARS,
      bestMarket: { ...BEST_MARKET },
      markets: MARKETS.map((m) => ({ ...m })),
      positiveMarkets: [{ ...MARKETS[0] }],
      negativeMarkets: [{ ...MARKETS[1] }]
    },
    ...overrides
  };
}

function fakeRes() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
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

/** A context as PredictorV3 hands it to Stage12 on the live path. */
function liveContext(rows, extra = {}) {
  return { halted: false, res: fakeRes(), masked: rows, out: rows, oddsPrefetch: {}, ...extra };
}

/** A context as PredictorV3 hands it to Stage12 after any halt. */
function haltContext(body, status = 200) {
  return { halted: true, res: fakeRes(), haltStatus: status, haltBody: body, haltHeaders: {}, responseHeaders: {} };
}

const engineOf = (row) => row.valueEngine;

/* ---------------------------------------------------------------- */
/* boundary 1 — the live pipeline response                           */
/* ---------------------------------------------------------------- */

test("live response carries no positiveMarkets and no negativeMarkets", async () => {
  const ctx = liveContext([predictionRow()]);
  await Stage12Response.run(ctx);

  assert.equal(ctx.res.statusCode, 200);
  assert.equal(ctx.res.payload.length, 1);
  assert.equal("positiveMarkets" in engineOf(ctx.res.payload[0]), false);
  assert.equal("negativeMarkets" in engineOf(ctx.res.payload[0]), false);
});

test("live response keeps markets, bestMarket and every scalar", async () => {
  const ctx = liveContext([predictionRow()]);
  await Stage12Response.run(ctx);

  const engine = engineOf(ctx.res.payload[0]);
  assert.deepEqual(engine.markets, MARKETS);
  assert.deepEqual(engine.bestMarket, BEST_MARKET);
  for (const [key, value] of Object.entries(SCALARS)) {
    assert.deepEqual(engine[key], value, `scalar ${key} was lost`);
  }
});

test("live response keeps the rest of the prediction row intact", async () => {
  const ctx = liveContext([predictionRow()]);
  await Stage12Response.run(ctx);

  const sent = ctx.res.payload[0];
  const source = predictionRow();
  assert.equal(sent.id, source.id);
  assert.deepEqual(sent.probs, source.probs);
  assert.deepEqual(sent.recommended, source.recommended);
  assert.deepEqual(sent.marketOdds, source.marketOdds);
  assert.equal(sent.modelVersion, source.modelVersion);
});

test("the legacy-shape fields survive, so hydration cannot loop", async () => {
  const ctx = liveContext([predictionRow()]);
  await Stage12Response.run(ctx);

  // hasLegacyPredictionShape reads exactly these; none lives inside valueEngine.
  const sent = ctx.res.payload[0];
  assert.ok(sent.probs.corners, "probs.corners was lost");
  assert.ok(sent.probs.shotsOnTarget, "probs.shotsOnTarget was lost");
  assert.equal(sent.modelVersion, "v3");
});

test("cron and quota-exempt callers are trimmed too", async () => {
  // Stage11 passes `out` straight through for those callers rather than masking,
  // so the trim must not depend on having gone through maskPredictionForTier.
  const rows = [predictionRow()];
  const ctx = { halted: false, res: fakeRes(), masked: rows, out: rows, oddsPrefetch: {} };
  await Stage12Response.run(ctx);

  assert.equal("negativeMarkets" in engineOf(ctx.res.payload[0]), false);
});

test("the minimum-odds gate still runs on the live path", async () => {
  const ctx = liveContext([
    predictionRow({ id: 1, recommended: { pick: "x", confidence: 50, odd: 1.24 } }),
    predictionRow({ id: 2, recommended: { pick: "y", confidence: 50, odd: 1.9 } })
  ]);
  await Stage12Response.run(ctx);

  assert.deepEqual(
    ctx.res.payload.map((r) => r.id),
    [2]
  );
});

test("response headers are still written", async () => {
  const ctx = liveContext([predictionRow()], { oddsPrefetch: { fixturesMapped: 7, upstreamCalls: 2 } });
  await Stage12Response.run(ctx);

  assert.equal(ctx.res.headers["X-Odds-Prefetch-Mapped"], "7");
  assert.equal(ctx.res.headers["X-Odds-Prefetch-Upstream"], "2");
});

/* ---------------------------------------------------------------- */
/* boundary 2 — every halt body                                      */
/* ---------------------------------------------------------------- */

test("a 200 halt body of prediction rows is trimmed", async () => {
  // readDbOnlyPredictions (FREE), tryPaidDbCacheHit and both budget stops all
  // reach Stage12 this way, carrying rows built by mapDbRowToHistoryEntry.
  const ctx = haltContext([predictionRow()]);
  await Stage12Response.run(ctx);

  assert.equal(ctx.res.statusCode, 200);
  assert.equal("positiveMarkets" in engineOf(ctx.res.payload[0]), false);
  assert.equal("negativeMarkets" in engineOf(ctx.res.payload[0]), false);
  assert.deepEqual(engineOf(ctx.res.payload[0]).markets, MARKETS);
});

test("an error halt body is passed through untouched", async () => {
  const body = { ok: false, error: "Ai atins limita zilnica de Predict.", reason: "predict_limit" };
  const ctx = haltContext(body, 429);
  await Stage12Response.run(ctx);

  assert.equal(ctx.res.statusCode, 429);
  assert.deepEqual(ctx.res.payload, body);
});

test("a halt body that is not an array survives", async () => {
  const ctx = haltContext({ ok: true, items: [] }, 200);
  await Stage12Response.run(ctx);
  assert.deepEqual(ctx.res.payload, { ok: true, items: [] });
});

/* ---------------------------------------------------------------- */
/* transport only — nothing upstream is mutated                      */
/* ---------------------------------------------------------------- */

test("the rows Stage10 already persisted are not mutated", async () => {
  const rows = [predictionRow()];
  const before = JSON.stringify(rows);
  const ctx = liveContext(rows);
  await Stage12Response.run(ctx);

  assert.equal(JSON.stringify(rows), before, "Stage12 mutated the persisted row objects");
  assert.equal(rows[0].valueEngine.positiveMarkets.length, 1);
  assert.equal(rows[0].valueEngine.negativeMarkets.length, 1);
});

test("the halt body the caller built is not mutated", async () => {
  const body = [predictionRow()];
  const before = JSON.stringify(body);
  const ctx = haltContext(body);
  await Stage12Response.run(ctx);

  assert.equal(JSON.stringify(body), before, "Stage12 mutated the halt body");
});

test("a row without a valueEngine passes through unchanged", async () => {
  const bare = { id: 9, recommended: { pick: "x", confidence: 1, odd: 2 }, probs: {} };
  const ctx = liveContext([bare]);
  await Stage12Response.run(ctx);

  assert.deepEqual(ctx.res.payload[0], bare);
});
