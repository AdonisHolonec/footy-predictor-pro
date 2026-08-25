import test, { mock } from "node:test";
import assert from "node:assert/strict";

/**
 * D9 — cutting the two hottest reads of `predictions_history.raw_payload`.
 *
 * Neither query could drop the column: the fields they consume
 * (`probs` / `evaluation.modelProbs1x2Pct`, `modelMeta.method`,
 * `modelMeta.dataQuality`, the 1X2 pick) have no promoted columns, and
 * projecting `raw_payload->key` is measured in this repo at 12.2x SLOWER
 * because Postgres de-TOASTs the whole document to evaluate a key.
 *
 * So the lever is frequency, and these tests pin it:
 *   - the work happens once per TTL, not once per call;
 *   - the numbers a caller gets are unchanged;
 *   - a FAILED read is never cached, so one bad moment is not amortised into
 *     ten minutes of degraded output.
 */

/** A row carrying a probs document, as the live table stores it. */
function row(p1, pX, p2, extra = {}) {
  return {
    raw_payload: { probs: { p1, pX, p2 } },
    validation: "pending",
    odds_home: 2,
    odds_draw: 3,
    odds_away: 4,
    value_bet_validation: null,
    ...extra
  };
}

/**
 * Loads predictHelpers with a Supabase stub that COUNTS selects and records the
 * projection each one asked for.
 */
async function loadHelpers({ rows = [], fail = false }, tag) {
  const calls = { count: 0, selects: [] };
  mock.reset();
  mock.module("../server-utils/supabaseAdmin.js", {
    namedExports: {
      assertSupabaseConfigured: () => ({ ok: true }),
      getSupabaseAdmin: () => ({
        from: () => {
          const chain = {
            select: (projection) => {
              calls.count += 1;
              calls.selects.push(projection);
              return chain;
            },
            gte: () => chain,
            limit: () =>
              fail
                ? Promise.reject(new Error("statement timeout"))
                : Promise.resolve({ data: rows, error: null })
          };
          return chain;
        }
      })
    }
  });
  const mod = await import(`../server-utils/pipeline/predictHelpers.js?d9=${tag}-${Math.random()}`);
  mod.invalidateRiskContextCache();
  return { mod, calls };
}

test("[E] loadRiskContext still computes the same averaged distribution", async () => {
  const { mod } = await loadHelpers({ rows: [row(50, 30, 20), row(70, 20, 10)] }, "avg");
  const ctx = await mod.loadRiskContext();
  // Plain means of each component — unchanged by caching.
  assert.equal(ctx.avgDist.p1, 60);
  assert.equal(ctx.avgDist.pX, 25);
  assert.equal(ctx.avgDist.p2, 15);
  assert.equal(ctx.cooldownCap, 3);
});

test("[E] rows without usable probs are ignored, as before", async () => {
  const { mod } = await loadHelpers(
    { rows: [row(50, 30, 20), { raw_payload: {}, validation: "pending" }, row(70, 20, 10)] },
    "skip"
  );
  const ctx = await mod.loadRiskContext();
  assert.equal(ctx.avgDist.p1, 60);
});

test("[E] no usable rows leaves avgDist null rather than inventing a distribution", async () => {
  const { mod } = await loadHelpers({ rows: [] }, "empty");
  const ctx = await mod.loadRiskContext();
  assert.equal(ctx.avgDist, null);
  assert.equal(ctx.cooldownCap, 3);
});

test("the query runs ONCE across many Predicts inside the TTL", async () => {
  const { mod, calls } = await loadHelpers({ rows: [row(50, 30, 20)] }, "ttl");

  const first = await mod.loadRiskContext();
  for (let i = 0; i < 24; i += 1) await mod.loadRiskContext();

  assert.equal(calls.count, 1, "24 further Predicts must not re-read raw_payload");
  // And every caller sees the same value, not a stale copy of a different shape.
  assert.deepEqual(await mod.loadRiskContext(), first);
});

test("invalidating the cache forces exactly one more read", async () => {
  const { mod, calls } = await loadHelpers({ rows: [row(50, 30, 20)] }, "inval");
  await mod.loadRiskContext();
  await mod.loadRiskContext();
  assert.equal(calls.count, 1);

  mod.invalidateRiskContextCache();
  await mod.loadRiskContext();
  assert.equal(calls.count, 2);
});

test("a FAILED read is not cached — the next Predict retries", async () => {
  const { mod, calls } = await loadHelpers({ fail: true }, "fail");

  const first = await mod.loadRiskContext();
  // Same defaults the pre-D9 catch produced.
  assert.equal(first.avgDist, null);
  assert.equal(first.cooldownCap, 3);

  await mod.loadRiskContext();
  await mod.loadRiskContext();
  assert.equal(calls.count, 3, "a timeout must not be amortised into a whole TTL");
});

test("the cached context is frozen, so a consumer cannot poison every later Predict", async () => {
  const { mod } = await loadHelpers({ rows: [row(50, 30, 20)] }, "frozen");
  const ctx = await mod.loadRiskContext();

  assert.equal(Object.isFrozen(ctx), true);
  assert.equal(Object.isFrozen(ctx.avgDist), true);
  assert.throws(() => {
    ctx.cooldownCap = 99;
  });
  assert.equal((await mod.loadRiskContext()).cooldownCap, 3);
});

test("[D] the risk-context projection is unchanged and still documented as needing raw_payload", async () => {
  const { mod, calls } = await loadHelpers({ rows: [row(50, 30, 20)] }, "projection");
  await mod.loadRiskContext();

  const projection = calls.selects[0];
  /*
    Requirement D asked for proof that raw_payload is ABSENT. The D9 audit proved
    the opposite is currently unavoidable: `probs` has no promoted column, so
    removing it here would change the numbers rather than the cost. This pins the
    projection instead — the exact column set, no more — so any future widening
    is a deliberate edit that trips a test.
  */
  assert.equal(
    projection,
    "raw_payload, validation, odds_home, odds_draw, odds_away, value_bet_validation"
  );
  assert.equal(calls.selects.length, 1);
});

test("the TTL is ten minutes, matching the other request-scoped model assets", async () => {
  const { mod } = await loadHelpers({ rows: [] }, "ttlconst");
  assert.equal(mod.RISK_CONTEXT_TTL_MS, 10 * 60 * 1000);
});

/* ------------------------------------------------------------------------- *
 * /api/backtest?view=metrics — the 60-second admin poll
 * ------------------------------------------------------------------------- */

/** A settled row the metrics reducer will actually score. */
function metricsRow(p1, pX, p2, scoreHome, scoreAway) {
  return {
    league_id: 39,
    league_name: "Premier League",
    score_home: scoreHome,
    score_away: scoreAway,
    match_status: "FT",
    model_version: "v1",
    recommended_confidence: 72,
    recommended_pick: "Over 2.5",
    raw_payload: {
      probs: { p1, pX, p2 },
      modelMeta: { method: "poisson", dataQuality: 0.8 },
      predictions: { oneXtwo: "1" }
    }
  };
}

function fakeRes() {
  const out = { statusCode: 0, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) {
      out.headers[k] = v;
    },
    status(code) {
      out.statusCode = code;
      return {
        json(payload) {
          out.body = payload;
          return payload;
        }
      };
    }
  };
}

/** Loads the backtest handler with a counting Supabase stub. */
async function loadBacktest(rows, tag) {
  const calls = { count: 0, selects: [] };
  mock.reset();
  mock.module("../server-utils/supabaseAdmin.js", {
    namedExports: {
      assertSupabaseConfigured: () => ({ ok: true }),
      getSupabaseAdmin: () => ({
        from: () => {
          const chain = {
            select: (projection) => {
              calls.count += 1;
              calls.selects.push(projection);
              return chain;
            },
            gte: () => chain,
            limit: () => Promise.resolve({ data: rows, error: null })
          };
          return chain;
        }
      })
    }
  });
  process.env.CRON_SECRET = "d9-test-secret";
  const mod = await import(`../api/backtest.js?d9=${tag}-${Math.random()}`);
  mod.invalidateMetricsCache();
  return { mod, calls };
}

const metricsReq = (days = 45) => ({
  method: "GET",
  query: { view: "metrics", days: String(days) },
  headers: { "x-cron-secret": "d9-test-secret" }
});

async function callMetrics(mod, days = 45) {
  const res = fakeRes();
  await mod.default(metricsReq(days), res);
  return res.out;
}

test("[E] metrics still returns the same computed numbers", async () => {
  const { mod } = await loadBacktest([metricsRow(60, 25, 15, 2, 1), metricsRow(50, 30, 20, 0, 0)], "m1");
  const out = await callMetrics(mod);

  assert.equal(out.statusCode, 200);
  assert.equal(out.body.ok, true);
  assert.equal(out.body.days, 45);
  assert.equal(out.body.nRows, 2);
  assert.equal(out.body.nProb, 2);
  // Real Brier/log-loss over the two rows — pinned so caching cannot drift them.
  assert.equal(typeof out.body.brier1x2, "number");
  assert.equal(typeof out.body.logLoss1x2, "number");
  assert.ok(out.body.byMethod.some((m) => m.key === "poisson"));
  assert.ok(out.body.byDataQuality.some((m) => m.key === "high"));
});

test("the 45-day scan runs ONCE across a burst of polls", async () => {
  const { mod, calls } = await loadBacktest([metricsRow(60, 25, 15, 2, 1)], "m2");

  const first = await callMetrics(mod);
  for (let i = 0; i < 9; i += 1) await callMetrics(mod);

  assert.equal(calls.count, 1, "ten 60s polls must not become ten raw_payload scans");
  const last = await callMetrics(mod);
  // Byte-identical replay: requirement C.
  assert.deepEqual(last.body, first.body);
});

test("a different window is computed separately, not served from the wrong cache", async () => {
  const { mod, calls } = await loadBacktest([metricsRow(60, 25, 15, 2, 1)], "m3");
  await callMetrics(mod, 45);
  await callMetrics(mod, 90);
  assert.equal(calls.count, 2);

  await callMetrics(mod, 45);
  await callMetrics(mod, 90);
  assert.equal(calls.count, 2, "each window keeps its own entry");
  assert.equal((await callMetrics(mod, 90)).body.days, 90);
});

test("invalidating clears every window", async () => {
  const { mod, calls } = await loadBacktest([metricsRow(60, 25, 15, 2, 1)], "m4");
  await callMetrics(mod, 45);
  assert.equal(calls.count, 1);

  mod.invalidateMetricsCache();
  await callMetrics(mod, 45);
  assert.equal(calls.count, 2);
});

test("[D] the metrics projection is pinned — widening it must be deliberate", async () => {
  const { mod, calls } = await loadBacktest([metricsRow(60, 25, 15, 2, 1)], "m5");
  await callMetrics(mod);

  /*
    raw_payload stays, and the D9 audit says why: probs / modelMeta.method /
    modelMeta.dataQuality / the 1X2 pick have no promoted columns, and
    `recommended_pick` is the MARKET pick ("Over 2.5"), not the 1X2 one. Pinned
    so the day those columns exist, this test is what points at the query.
  */
  assert.equal(
    calls.selects[0],
    "league_id, league_name, score_home, score_away, match_status, raw_payload, model_version, recommended_confidence, recommended_pick"
  );
});

test("an unauthorized caller is refused before any cache is consulted", async () => {
  const { mod, calls } = await loadBacktest([metricsRow(60, 25, 15, 2, 1)], "m6");
  await callMetrics(mod);
  assert.equal(calls.count, 1);

  const res = fakeRes();
  await mod.default(
    { method: "GET", query: { view: "metrics", days: "45" }, headers: {} },
    res
  );
  // A cached body must never become a way to read metrics without a token.
  assert.equal(res.out.statusCode, 401);
  assert.equal(res.out.body.ok, false);
});
