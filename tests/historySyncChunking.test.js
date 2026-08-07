/**
 * History-sync upsert chunking.
 *
 * predictions_history rows carry a ~134KB raw_payload at the median, so a single upsert
 * across the cron's 45-day window reached ~29MB in one statement and Postgres cancelled
 * it: "canceling statement due to statement timeout". The handler threw, settlement never
 * finished, and finished fixtures sat ungraded for days while the Corners tile showed a
 * result the Recommended tile could not.
 *
 * These tests pin the properties that matter: every row is written exactly once, no
 * statement exceeds the chunk size, and a mid-run failure still propagates.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { upsertHistoryChunked } from "../api/history.js";

/** Records the size and contents of every upsert statement issued. */
function fakeSupabase({ failOnBatch = -1 } = {}) {
  const batches = [];
  return {
    batches,
    from() {
      return {
        upsert(rows) {
          batches.push(rows);
          if (batches.length - 1 === failOnBatch) {
            return Promise.resolve({ error: { message: "statement timeout" } });
          }
          return Promise.resolve({ error: null });
        }
      };
    }
  };
}

const rows = (n) => Array.from({ length: n }, (_, i) => ({ fixture_id: i + 1 }));

test("rows are split into statements no larger than the chunk size", async () => {
  const sb = fakeSupabase();
  const written = await upsertHistoryChunked(sb, rows(246), 25);

  assert.equal(written, 246);
  assert.equal(sb.batches.length, 10); // 9 x 25 + 1 x 21
  for (const b of sb.batches) assert.ok(b.length <= 25, "no statement may exceed the chunk size");
  assert.equal(sb.batches.at(-1).length, 21);
});

test("every row is written exactly once, in order", async () => {
  const sb = fakeSupabase();
  await upsertHistoryChunked(sb, rows(57), 10);

  const ids = sb.batches.flat().map((r) => r.fixture_id);
  assert.equal(ids.length, 57);
  assert.deepEqual(
    ids,
    rows(57).map((r) => r.fixture_id)
  );
  assert.equal(new Set(ids).size, 57, "no row may be written twice");
});

test("a set smaller than one chunk issues a single statement", async () => {
  const sb = fakeSupabase();
  await upsertHistoryChunked(sb, rows(3), 25);
  assert.equal(sb.batches.length, 1);
  assert.equal(sb.batches[0].length, 3);
});

test("an empty set issues no statement at all", async () => {
  const sb = fakeSupabase();
  const written = await upsertHistoryChunked(sb, [], 25);
  assert.equal(written, 0);
  assert.equal(sb.batches.length, 0);
});

test("a failing chunk still throws, and stops rather than continuing", async () => {
  // Chunking must not swallow errors: the caller's catch is what records the failed sync.
  const sb = fakeSupabase({ failOnBatch: 2 });
  // Supabase errors are plain objects, not Error instances. The original code threw them
  // as-is (`throw updateError`) and the helper preserves that, so the assertion matches
  // the shape actually thrown rather than pretending it is an Error.
  await assert.rejects(
    () => upsertHistoryChunked(sb, rows(100), 10),
    (err) => err?.message === "statement timeout"
  );
  assert.equal(sb.batches.length, 3, "must stop at the failing statement");
});
