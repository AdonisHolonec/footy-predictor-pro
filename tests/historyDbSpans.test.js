import test, { mock } from "node:test";
import assert from "node:assert/strict";

import { createHistoryTiming, summarizeHistoryTiming } from "../server-utils/observability/historyTiming.js";

/**
 * Splitting dbReadMs on the path that is actually slow.
 *
 * D2b removed raw_payload from the anonymous aggregate and production dbReadMs
 * did not move — 8,963-39,368 ms — while the identical query run directly
 * against PostgREST answered in 0.33-0.63 s at the same moment. So the query is
 * not the cost, and dbReadMs alone cannot say what is.
 *
 * These tests drive the REAL read function against a stubbed client, so the
 * instrumentation is exercised rather than described: both spans must be
 * recorded, the request span must exclude client acquisition, and the client
 * must be fetched exactly once.
 */

/** How long the stub pretends client acquisition takes. */
const CLIENT_COST_MS = 40;

function busyWait(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* deliberate: Date.now() is the clock the instrumentation reads */
  }
}

/** Minimal PostgREST chain: .from().select().gte().order().limit() is awaited. */
function stubClient(rows) {
  const chain = {
    select: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null })
  };
  return { from: () => chain };
}

/** Mutable controller — mock.module may only register once per specifier. */
const ctl = { rows: [], clientCostMs: 0, calls: 0 };

mock.module("../server-utils/supabaseAdmin.js", {
  namedExports: {
    getSupabaseAdmin: () => {
      ctl.calls += 1;
      if (ctl.clientCostMs) busyWait(ctl.clientCostMs);
      return stubClient(ctl.rows);
    },
    assertSupabaseConfigured: () => ({ ok: true })
  }
});

const { readPredictionsHistoryAggregateStats } = await import("../server-utils/predictionsHistory.js");

function withStub({ rows = [], clientCostMs = 0 } = {}) {
  ctl.rows = rows;
  ctl.clientCostMs = clientCostMs;
  ctl.calls = 0;
}

test("the aggregate records BOTH the client and request spans", async () => {
  withStub({ rows: [] });
  const timing = createHistoryTiming({ days: "30" });

  await readPredictionsHistoryAggregateStats(30, 500, timing);

  const out = summarizeHistoryTiming(timing, { status: 200, durationMs: 9_000 });
  assert.equal(typeof out.supabaseClientMs, "number", "client acquisition must be timed");
  assert.equal(typeof out.supabaseRequestMs, "number", "the Supabase request must be timed");
});

test("the request span excludes client acquisition", async () => {
  // A deliberately expensive client makes the boundary observable: if the
  // request span started at the client span's start, it would swallow this.
  withStub({ rows: [], clientCostMs: CLIENT_COST_MS });
  const timing = createHistoryTiming({ days: "30" });

  await readPredictionsHistoryAggregateStats(30, 500, timing);

  const out = summarizeHistoryTiming(timing, { status: 200, durationMs: 9_000 });
  assert.ok(out.supabaseClientMs >= CLIENT_COST_MS - 5, "client span should capture the cost");
  assert.ok(
    out.supabaseRequestMs < CLIENT_COST_MS / 2,
    `request span must not include client acquisition (got ${out.supabaseRequestMs}ms)`
  );
});

test("the client is acquired exactly once per read", async () => {
  // Guards the mistake the phase is investigating: constructing a client per
  // call instead of reusing the cached one.
  withStub({ rows: [] });
  await readPredictionsHistoryAggregateStats(30, 500, createHistoryTiming({ days: "30" }));
  assert.equal(ctl.calls, 1);
});

test("instrumentation is inert: the aggregate works with no timing accumulator", async () => {
  withStub({ rows: [] });
  const withoutTiming = await readPredictionsHistoryAggregateStats(30, 500);
  const withTiming = await readPredictionsHistoryAggregateStats(
    30,
    500,
    createHistoryTiming({ days: "30" })
  );
  assert.deepEqual(withoutTiming, withTiming, "timing must not change the result");
  assert.ok(withoutTiming.stats, "stats must still be produced");
});

test("nested spans do not inflate the reported unattributed time", async () => {
  withStub({ rows: [], clientCostMs: CLIENT_COST_MS });
  const timing = createHistoryTiming({ days: "30" });
  await readPredictionsHistoryAggregateStats(30, 500, timing);

  // dbReadMs is the caller's span; the two Supabase spans sit inside it.
  const out = summarizeHistoryTiming(timing, { status: 200, durationMs: 1_000 });
  assert.ok(out.unattributedMs >= 0);
  assert.ok(out.unattributedMs <= 1_000, "unattributed must never exceed the total");
});

test("the spans carry no payload rows and no credentials", async () => {
  withStub({
    rows: [{ validation: "win", match_status: "FT", card_markets: { recommended: { pick: "over 2.5" } } }]
  });
  const timing = createHistoryTiming({ days: "30", access_token: "eyJhbGciOi.secret.x" });
  await readPredictionsHistoryAggregateStats(30, 500, timing);

  const serialized = JSON.stringify(summarizeHistoryTiming(timing, { status: 200, durationMs: 9_000 }));
  assert.equal(serialized.includes("over 2.5"), false);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("eyJ"), false);
});
