import test, { mock } from "node:test";
import assert from "node:assert/strict";

/**
 * RELIABILITY-006 — Predict-path history persistence in bounded batches.
 *
 * On 2026-09-11 13:24Z one Predict sent 46 existing rows (~190KB of JSON each,
 * ~8-9MB in all) as a SINGLE upsert. Postgres cancelled it with statement timeout
 * (57014) and the refresh was lost. These tests drive the real
 * `upsertPredictionsHistory` against a scripted Supabase client and pin:
 * partitioning, insert-then-update order, fixture identity, the stop-at-first-
 * failure policy (original error rethrown, no snapshots after a failure), replay
 * safety, and the telemetry that tells a partial write from a complete failure.
 */

const FUTURE = new Date(Date.now() + 6 * 3600_000).toISOString();
const OLD = "2026-01-01T00:00:00.000Z";
const TIMEOUT = { code: "57014", message: "canceling statement due to statement timeout" };

const prediction = (id) => ({
  id,
  kickoff: FUTURE,
  status: "NS",
  probs: { p1: 50, pX: 30, p2: 20 },
  recommended: { pick: "Over 2.5", confidence: 70 }
});
const ids = (from, count) => Array.from({ length: count }, (_, i) => from + i);

/**
 * @param {number[]} newIds fixtures absent from the table
 * @param {number[]} existingIds fixtures already present (pre-kickoff, older)
 * @param {{ failOn?: { op: "insert"|"upsert", call: number }, finalIds?: number[] }} [opts]
 */
async function persist(newIds, existingIds, opts = {}) {
  const ops = [];
  const lines = { info: [], warn: [], error: [] };
  const calls = { insert: 0, upsert: 0 };
  const existing = [
    ...existingIds.map((id) => ({ fixture_id: id, match_status: "NS", updated_at: OLD })),
    ...(opts.finalIds || []).map((id) => ({ fixture_id: id, match_status: "FT", updated_at: OLD }))
  ];

  mock.reset();
  mock.method(console, "info", (line) => lines.info.push(String(line)));
  mock.method(console, "warn", (line) => lines.warn.push(String(line)));
  mock.method(console, "error", (line) => lines.error.push(String(line)));
  mock.module("../server-utils/supabaseAdmin.js", {
    namedExports: {
      assertSupabaseConfigured: () => ({ ok: true }),
      getSupabaseAdmin: () => ({
        from: (table) => {
          const chain = {
            select: () => chain,
            in: (_col, wanted) => {
              ops.push({ table, op: "select", ids: wanted });
              return Promise.resolve({ data: existing, error: null });
            },
            insert: (rows) => {
              ops.push({ table, op: "insert", rows });
              if (table !== "predictions_history") return Promise.resolve({ error: null });
              calls.insert += 1;
              const fail = opts.failOn?.op === "insert" && opts.failOn.call === calls.insert;
              return Promise.resolve({ error: fail ? TIMEOUT : null });
            },
            upsert: (rows, options) => {
              ops.push({ table, op: "upsert", rows, options });
              calls.upsert += 1;
              const fail = opts.failOn?.op === "upsert" && opts.failOn.call === calls.upsert;
              return Promise.resolve({ error: fail ? TIMEOUT : null });
            }
          };
          return chain;
        }
      })
    }
  });

  const mod = await import(`../server-utils/predictionsHistory.js?r006=${Math.random()}`);
  let result;
  let error;
  try {
    result = await mod.upsertPredictionsHistory([...newIds, ...existingIds, ...(opts.finalIds || [])].map(prediction));
  } catch (err) {
    error = err;
  }
  const history = ops.filter((o) => o.table === "predictions_history" && o.op !== "select");
  return {
    batch: mod.PREDICT_HISTORY_WRITE_BATCH,
    result,
    error,
    ops,
    history,
    sizes: (op) => history.filter((o) => o.op === op).map((o) => o.rows.length),
    snapshots: ops.filter((o) => o.table === "prediction_snapshots"),
    written: history.flatMap((o) => o.rows.map((r) => r.fixture_id)),
    lines,
    event: (name) => lines.warn.filter((l) => l.includes(`"${name}"`)).map((l) => JSON.parse(l)),
    persistLine: () => lines.info.map((l) => JSON.parse(l)).find((l) => l.historyPersist)
  };
}

test("the batch size is a small fixed constant", async () => {
  const { batch } = await persist([], []);
  assert.equal(batch, 10);
});

test("1. fewer rows than a batch: exactly one statement per logical operation", async () => {
  const run = await persist(ids(1, 3), ids(100, 2));
  assert.deepEqual(run.sizes("insert"), [3]);
  assert.deepEqual(run.sizes("upsert"), [2]);
  assert.equal(run.error, undefined);
});

test("2. exactly one batch of new rows: a single insert of 10", async () => {
  const run = await persist(ids(1, 10), []);
  assert.deepEqual(run.sizes("insert"), [10]);
  assert.deepEqual(run.sizes("upsert"), []);
});

test("3. several full batches are partitioned in order", async () => {
  const run = await persist(ids(1, 30), []);
  assert.deepEqual(run.sizes("insert"), [10, 10, 10]);
  assert.deepEqual(run.written, ids(1, 30), "rows keep their original order across batches");
});

test("4. batch size + 1 leaves a remainder batch of one", async () => {
  const run = await persist(ids(1, 11), []);
  assert.deepEqual(run.sizes("insert"), [10, 1]);
});

test("5/7. the failed production shape — 46 existing rows — goes out as 5 bounded upserts keyed on fixture_id", async () => {
  const run = await persist([], ids(1000, 46));
  assert.deepEqual(run.sizes("upsert"), [10, 10, 10, 10, 6]);
  assert.ok(run.history.every((o) => o.op === "upsert" && o.options?.onConflict === "fixture_id"));
  assert.deepEqual(run.written, ids(1000, 46));
  assert.deepEqual(run.result, { count: 46, skipped: 0, inserted: 0, updated: 46, skippedFinal: 0, skippedStale: 0 });
});

test("6/8. mixed: 7 new + 42 existing (the successful 13:23Z shape) — inserts first, then updates, each batched", async () => {
  const run = await persist(ids(1, 7), ids(1000, 42));
  assert.deepEqual(run.history.map((o) => `${o.op}:${o.rows.length}`), [
    "insert:7",
    "upsert:10",
    "upsert:10",
    "upsert:10",
    "upsert:10",
    "upsert:2"
  ]);
  assert.equal(run.ops.filter((o) => o.op === "select").length, 1, "one existence query for the whole run, not one per batch");
  assert.deepEqual(run.result, { count: 49, skipped: 0, inserted: 7, updated: 42, skippedFinal: 0, skippedStale: 0 });
});

test("9. a failing update batch stops the rest, rethrows the original error, and writes no snapshots", async () => {
  const run = await persist([], ids(1000, 46), { failOn: { op: "upsert", call: 2 } });
  assert.equal(run.error?.code, "57014", "the original database error reaches Stage10 unchanged");
  assert.deepEqual(run.sizes("upsert"), [10, 10], "batches 3-5 are never attempted");
  assert.equal(run.snapshots.length, 0, "snapshots follow a complete history write only");
  assert.equal(run.persistLine(), undefined, "no success line after a failure");
});

test("9. a failing insert batch never reaches the update phase", async () => {
  const run = await persist(ids(1, 15), ids(1000, 5), { failOn: { op: "insert", call: 1 } });
  assert.equal(run.error?.code, "57014");
  assert.deepEqual(run.sizes("insert"), [10]);
  assert.deepEqual(run.sizes("upsert"), []);
  assert.equal(run.snapshots.length, 0);
});

test("10. every eligible fixture is written exactly once; final rows are still never overwritten", async () => {
  const run = await persist(ids(1, 13), ids(1000, 24), { finalIds: [9001, 9002] });
  const written = run.written;
  assert.equal(new Set(written).size, written.length, "no fixture appears in two batches");
  assert.deepEqual([...written].sort((a, b) => a - b), [...ids(1, 13), ...ids(1000, 24)]);
  assert.ok(!written.includes(9001) && !written.includes(9002));
  assert.equal(run.result.skippedFinal, 2);
});

test("11. replay is safe: rerunning after a partial failure only upserts, keyed on fixture_id, with no duplicate rows", async () => {
  const first = await persist([], ids(1000, 46), { failOn: { op: "upsert", call: 3 } });
  assert.ok(first.error);
  // Every one of the 46 rows existed before the failure, so a replay sees them all as existing.
  const replay = await persist([], ids(1000, 46));
  assert.equal(replay.error, undefined);
  assert.deepEqual(replay.sizes("insert"), [], "a replay never inserts a fixture a second time");
  assert.deepEqual(replay.written, ids(1000, 46));
  assert.ok(replay.history.every((o) => o.options?.onConflict === "fixture_id"));
});

test("13. success telemetry records batch size, batch count and duration", async () => {
  const run = await persist(ids(1, 7), ids(1000, 42));
  const line = run.persistLine();
  assert.equal(line.batchSize, 10);
  assert.equal(line.batches, 6);
  assert.equal(typeof line.durationMs, "number");
  assert.equal(line.inserted, 7);
  assert.equal(line.updated, 42);
  assert.equal(run.event("predict.history_persist_failed").length, 0);
});

test("13. a partial failure is distinguishable from a complete failure, without logging any payload", async () => {
  const partial = await persist([], ids(1000, 46), { failOn: { op: "upsert", call: 2 } });
  const [p] = partial.event("predict.history_persist_failed");
  assert.equal(p.phase, "update");
  assert.equal(p.partial, true);
  assert.equal(p.rowsPersisted, 10);
  assert.equal(p.batchesCompleted, 1);
  assert.equal(p.failedBatchIndex, 1);
  assert.equal(p.batches, 5);
  assert.equal(p.rowsAttempted, 46);
  assert.equal(p.batchSize, 10);
  assert.equal(p.errorCode, "57014");
  assert.deepEqual(p.failedFixtureIds, ids(1010, 10));

  const complete = await persist([], ids(1000, 46), { failOn: { op: "upsert", call: 1 } });
  const [c] = complete.event("predict.history_persist_failed");
  assert.equal(c.partial, false);
  assert.equal(c.rowsPersisted, 0);
  assert.equal(c.failedBatchIndex, 0);

  for (const line of [...partial.lines.warn, ...complete.lines.warn]) {
    assert.ok(!line.includes("raw_payload") && !line.includes("hydration_payload"), "no row payload in telemetry");
    assert.ok(line.length < 1_000, `failure line stays small (${line.length} chars)`);
  }
});
