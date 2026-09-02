import test from "node:test";
import assert from "node:assert/strict";

import {
  runBackfill,
  planRowUpdate,
  BackfillAbort,
  BACKFILL_SELECT,
  DEFAULT_BATCH,
  MAX_BATCH_MS,
  MAX_ERROR_RATE
} from "../server-utils/backfill/hydrationPayload.js";
import { buildHydrationPayload } from "../server-utils/hydrationPayloadColumn.js";

/**
 * A3: the hydration_payload backfill.
 *
 * The properties that matter here are not "does it fill the column" — that is
 * the easy part — but the ones that make it safe to run against a live table
 * while A2 is writing:
 *
 *   - it writes ONE column, never updated_at or a prediction field
 *   - every UPDATE carries `hydration_payload IS NULL`, so A2 wins a race
 *   - a bad row cannot abort its neighbours
 *   - stopping halfway leaves valid data and an eligible remainder
 *   - the value is identical to what A2 would have written
 *
 * The fake client below records every call, so the assertions are about the
 * REQUEST the backfill issues, not just the numbers it reports.
 */

function payload(extra = {}) {
  return {
    id: 101,
    teams: { home: "Home FC", away: "Away FC" },
    kickoff: "2026-09-02T18:00:00.000Z",
    status: "NS",
    momentum: { series: [1, 2, 3] },
    recommended: { pick: "1", confidence: 61, odd: 1.9 },
    probs: { p1: 51, corners: { over: 55 }, shotsOnTarget: { over: 48 }, firstHalf: { p1: 40 } },
    predictions: { gg: "GG" },
    marketOdds: { closing: { home: 1.8 } },
    confidenceEngine: { score: 72 },
    explanation: { summary: "because" },
    featureImportance: { topFeatures: ["elo"] },
    teamContext: { home: { form: "WWD" } },
    valueBet: { type: "1", kellyPct: 2.1 },
    insufficientData: false,
    valueEngine: {
      expectedValue: 0.07,
      markets: [
        { type: "over_2_5", family: "goals" },
        { type: "cards_over", family: "cards" }
      ]
    },
    ...extra
  };
}

function row(fixtureId, { hydration = null, raw = undefined } = {}) {
  return {
    fixture_id: fixtureId,
    hydration_payload: hydration,
    raw_payload: raw === undefined ? payload({ id: fixtureId }) : raw
  };
}

/**
 * Minimal PostgREST-shaped fake. Records selects and updates so tests can
 * assert on the filters actually applied, not merely on the outcome.
 */
function fakeSupabase(pages, { updateResult = null, updateError = null, failUpdateForIds = [] } = {}) {
  const calls = { selects: [], updates: [], counts: 0 };
  let pageIndex = 0;

  return {
    calls,
    from() {
      const q = { filters: {}, _isCount: false, _payload: null, _select: null, limit: null };
      const builder = {
        is(col, val) {
          q.filters[`is:${col}`] = val;
          return builder;
        },
        not(col, op, val) {
          q.filters[`not:${col}`] = `${op}:${val}`;
          return builder;
        },
        gt(col, val) {
          q.filters[`gt:${col}`] = val;
          return builder;
        },
        eq(col, val) {
          q.filters[`eq:${col}`] = val;
          return builder;
        },
        order() {
          return builder;
        },
        limit(n) {
          q.limit = n;
          calls.selects.push({ select: q._select, filters: { ...q.filters }, limit: n });
          const page = pages[pageIndex] ?? [];
          pageIndex += 1;
          if (page instanceof Error) return Promise.resolve({ data: null, error: page });
          return Promise.resolve({ data: page, error: null });
        },
        update(values) {
          q._payload = values;
          return builder;
        },
        select(sel, opts) {
          // After .update(), .select() is the write's terminal call.
          if (q._payload !== null) {
            calls.updates.push({ values: q._payload, filters: { ...q.filters } });
            if (failUpdateForIds.includes(q.filters["eq:fixture_id"])) {
              return Promise.resolve({ data: null, error: { message: "boom" } });
            }
            if (updateError) return Promise.resolve({ data: null, error: updateError });
            return Promise.resolve({
              data: updateResult ?? [{ fixture_id: q.filters["eq:fixture_id"] }],
              error: null
            });
          }
          if (opts && opts.count) {
            q._isCount = true;
            calls.counts += 1;
            return Promise.resolve({ count: 0, error: null });
          }
          q._select = sel;
          return builder;
        }
      };
      return builder;
    }
  };
}

const clock = () => {
  let t = 0;
  return () => (t += 10);
};

test("1. dry run does not write", async () => {
  const sb = fakeSupabase([[row(1), row(2)]]);
  const stats = await runBackfill({ supabase: sb, apply: false, batchSize: 50, now: clock(), countRemaining: false });
  assert.equal(sb.calls.updates.length, 0);
  assert.equal(stats.updated, 2, "dry run still reports what it WOULD write");
  assert.equal(stats.eligible, 2);
});

test("2. --apply writes hydration_payload and nothing else", async () => {
  const sb = fakeSupabase([[row(1)]]);
  await runBackfill({ supabase: sb, apply: true, batchSize: 50, now: clock(), countRemaining: false });
  assert.equal(sb.calls.updates.length, 1);
  assert.deepEqual(Object.keys(sb.calls.updates[0].values), ["hydration_payload"]);
});

test("3. idempotent — a second pass over populated rows writes nothing", async () => {
  const sb = fakeSupabase([[row(1, { hydration: { probs: {} } }), row(2, { hydration: { probs: {} } })]]);
  const stats = await runBackfill({ supabase: sb, apply: true, batchSize: 50, now: clock(), countRemaining: false });
  assert.equal(sb.calls.updates.length, 0);
  assert.equal(stats.skippedNonNull, 2);
  assert.equal(stats.updated, 0);
});

test("4. every UPDATE carries the hydration_payload IS NULL guard", async () => {
  const sb = fakeSupabase([[row(1)]]);
  await runBackfill({ supabase: sb, apply: true, batchSize: 50, now: clock(), countRemaining: false });
  assert.equal(sb.calls.updates[0].filters["is:hydration_payload"], null);
  assert.equal(sb.calls.updates[0].filters["eq:fixture_id"], 1);
});

test("4b. a row A2 populated mid-run is counted, not overwritten", async () => {
  // The guard matched nothing: PostgREST returns an empty representation.
  const sb = fakeSupabase([[row(1)]], { updateResult: [] });
  const stats = await runBackfill({ supabase: sb, apply: true, batchSize: 50, now: clock(), countRemaining: false });
  assert.equal(stats.updated, 0);
  assert.equal(stats.skippedNonNull, 1);
  assert.equal(stats.failed, 0);
});

test("5. skippedEmpty — a malformed payload is skipped, never written as NULL", async () => {
  const sb = fakeSupabase([[row(1, { raw: "not-an-object" }), row(2, { raw: { id: 2 } })]]);
  const stats = await runBackfill({ supabase: sb, apply: true, batchSize: 50, now: clock(), countRemaining: false });
  assert.equal(sb.calls.updates.length, 0, "no NULL was written");
  assert.equal(stats.skippedEmpty, 2);
  assert.deepEqual(stats.skippedEmptyIds, [1, 2]);
});

test("6. skippedNonNull is distinct from skippedEmpty", async () => {
  const sb = fakeSupabase([[row(1, { hydration: { probs: {} } }), row(2, { raw: null })]]);
  const stats = await runBackfill({ supabase: sb, apply: false, batchSize: 50, now: clock(), countRemaining: false });
  assert.equal(stats.skippedNonNull, 1);
  assert.equal(stats.skippedEmpty, 1);
  assert.equal(stats.scanned, 2);
});

test("7. keyset pagination is deterministic and strictly increasing", async () => {
  const sb = fakeSupabase([[row(10), row(20)], [row(30)]]);
  const stats = await runBackfill({ supabase: sb, apply: false, batchSize: 2, now: clock(), countRemaining: false });
  assert.equal(sb.calls.selects[0].filters["gt:fixture_id"], 0);
  assert.equal(sb.calls.selects[1].filters["gt:fixture_id"], 20, "cursor advanced past the highest id seen");
  assert.equal(stats.lastFixtureId, 30);
  // Eligibility is pushed into the query, not just the loop.
  assert.equal(sb.calls.selects[0].filters["is:hydration_payload"], null);
  assert.equal(sb.calls.selects[0].filters["not:raw_payload"], "is:null");
});

test("8. --after resumes from the given cursor", async () => {
  const sb = fakeSupabase([[row(99)]]);
  await runBackfill({ supabase: sb, apply: false, after: 42, batchSize: 50, now: clock(), countRemaining: false });
  assert.equal(sb.calls.selects[0].filters["gt:fixture_id"], 42);
});

test("9. batch size is honoured and defaults to 50", async () => {
  const sb = fakeSupabase([[row(1)]]);
  await runBackfill({ supabase: sb, apply: false, now: clock(), countRemaining: false });
  assert.equal(sb.calls.selects[0].limit, DEFAULT_BATCH);
  assert.equal(DEFAULT_BATCH, 50);

  const sb2 = fakeSupabase([[row(1)]]);
  await runBackfill({ supabase: sb2, apply: false, batchSize: 7, now: clock(), countRemaining: false });
  assert.equal(sb2.calls.selects[0].limit, 7);
});

test("10. the written value is exactly what buildHydrationPayload produces", async () => {
  const doc = payload({ id: 5 });
  const sb = fakeSupabase([[{ fixture_id: 5, hydration_payload: null, raw_payload: doc }]]);
  await runBackfill({ supabase: sb, apply: true, batchSize: 50, now: clock(), countRemaining: false });
  assert.deepEqual(sb.calls.updates[0].values.hydration_payload, buildHydrationPayload(doc));
  // and it inherits A2's narrowing: momentum out, cards market only
  assert.equal(sb.calls.updates[0].values.hydration_payload.momentum, undefined);
  assert.equal(sb.calls.updates[0].values.hydration_payload.valueEngine.markets.length, 1);
});

test("11. absent-vs-null on recommended survives the derivation", () => {
  const withNull = buildHydrationPayload(payload({ recommended: { pick: "1", odd: null } }));
  const withAbsent = buildHydrationPayload(payload({ recommended: { pick: "1" } }));
  assert.equal(withNull.recommended.odd, null, "an explicit null stays null");
  assert.ok(!("odd" in withAbsent.recommended), "an absent key stays absent");
});

test("12. a failed row does not poison its neighbours", async () => {
  // 25 rows, one failing write: 4% error rate, deliberately under the 5%
  // ceiling so this tests ISOLATION and not the abort path (13d covers that).
  const rows = Array.from({ length: 25 }, (_, i) => row(i + 1));
  const sb = fakeSupabase([rows], { failUpdateForIds: [7] });
  const stats = await runBackfill({ supabase: sb, apply: true, batchSize: 25, now: clock(), countRemaining: false });
  assert.equal(stats.scanned, 25, "every row was still processed after the failure");
  assert.equal(stats.failed, 1);
  assert.equal(stats.updated, 24);
  assert.deepEqual(stats.failedIds, [7]);
  // The failed row stays NULL, so a later run picks it up again.
  assert.ok(stats.failed + stats.updated === stats.eligible);
});

test("12b. a batch whose failures exceed the ceiling still processes every row before aborting", async () => {
  const sb = fakeSupabase([[row(1), row(2), row(3)]], { failUpdateForIds: [2] });
  await assert.rejects(
    () => runBackfill({ supabase: sb, apply: true, batchSize: 3, now: clock(), countRemaining: false }),
    (err) => {
      assert.ok(err instanceof BackfillAbort);
      assert.equal(err.reason, "error_rate");
      assert.equal(err.stats.scanned, 3, "isolation held even though the batch then aborted");
      assert.equal(err.stats.updated, 2);
      return true;
    }
  );
});

test("13a. a statement timeout aborts with a resumable cursor", async () => {
  const timeout = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
  const sb = fakeSupabase([[row(1)], timeout]);
  await assert.rejects(
    () => runBackfill({ supabase: sb, apply: false, batchSize: 1, now: clock(), countRemaining: false }),
    (err) => {
      assert.ok(err instanceof BackfillAbort);
      assert.equal(err.reason, "statement_timeout");
      assert.equal(err.lastFixtureId, 1, "the cursor is reported so the run can resume");
      return true;
    }
  );
});

test("13b. two consecutive batch failures abort", async () => {
  const boom = new Error("connection reset");
  const sb = fakeSupabase([boom, boom]);
  await assert.rejects(
    () => runBackfill({ supabase: sb, apply: false, batchSize: 50, now: clock(), countRemaining: false }),
    (err) => err instanceof BackfillAbort && err.reason === "consecutive_batch_failures"
  );
});

test("13c. an over-long batch aborts", async () => {
  let t = 0;
  const slow = () => (t += MAX_BATCH_MS + 1000);
  const sb = fakeSupabase([[row(1), row(2)]]);
  await assert.rejects(
    () => runBackfill({ supabase: sb, apply: false, batchSize: 2, now: slow, countRemaining: false }),
    (err) => err instanceof BackfillAbort && err.reason === "batch_duration"
  );
});

test("13d. an error rate above the ceiling aborts", async () => {
  const sb = fakeSupabase([[row(1), row(2)]], { updateError: { message: "write failed" } });
  await assert.rejects(
    () => runBackfill({ supabase: sb, apply: true, batchSize: 2, now: clock(), countRemaining: false }),
    (err) => err instanceof BackfillAbort && err.reason === "error_rate"
  );
  assert.equal(MAX_ERROR_RATE, 0.05);
});

test("14 & 15. no forbidden column is ever written", async () => {
  const sb = fakeSupabase([[row(1), row(2), row(3)]]);
  await runBackfill({ supabase: sb, apply: true, batchSize: 50, now: clock(), countRemaining: false });
  const forbidden = [
    "updated_at",
    "raw_payload",
    "validation",
    "match_status",
    "score_home",
    "score_away",
    "value_bet_validation",
    "recommended_pick",
    "saved_at"
  ];
  assert.ok(sb.calls.updates.length > 0);
  for (const call of sb.calls.updates) {
    for (const key of forbidden) {
      assert.ok(!(key in call.values), `${key} must never be written by the backfill`);
    }
    assert.deepEqual(Object.keys(call.values), ["hydration_payload"]);
  }
});

test("the select reads the document, and only the three columns it needs", () => {
  assert.equal(BACKFILL_SELECT, "fixture_id, hydration_payload, raw_payload");
});

test("planRowUpdate is pure and exhaustive", () => {
  assert.equal(planRowUpdate({ fixture_id: 1, hydration_payload: {}, raw_payload: payload() }).action, "skipNonNull");
  assert.equal(planRowUpdate({ fixture_id: 1, hydration_payload: null, raw_payload: null }).action, "skipEmpty");
  assert.equal(planRowUpdate({ fixture_id: 1, hydration_payload: null, raw_payload: payload() }).action, "update");
  const source = payload();
  const before = JSON.stringify(source);
  planRowUpdate({ fixture_id: 1, hydration_payload: null, raw_payload: source });
  assert.equal(JSON.stringify(source), before, "the source document is not mutated");
});
