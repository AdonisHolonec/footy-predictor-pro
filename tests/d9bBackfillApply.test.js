import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUpdate,
  columnMatches,
  preflight,
  runBackfill
} from "../server-utils/backfill/probabilityColumns.js";

/**
 * D9b-3 — the apply path.
 *
 * The property that matters most is that writing is opt-in: every invocation
 * that does not pass `apply` must issue zero UPDATEs, and that is asserted
 * against a stub which records every write rather than merely trusted.
 *
 * The rest is idempotency (an already-correct row is left alone, so re-running
 * is a no-op) and blast radius (only six columns, only by primary key, never a
 * statement that could create a row).
 */

const FULL = {
  evaluation: { modelProbs1x2Pct: { p1: 43.5, pX: 28.5, p2: 28 }, recommended1x2: "1" },
  modelMeta: { method: "modular-engine", dataQuality: 0.8 }
};

/** Records every write, so "zero writes" is provable rather than asserted. */
function writableStub(pages, { failOn = null } = {}) {
  const writes = [];
  let page = 0;
  const client = {
    from: () => {
      const chain = {
        select: () => chain,
        gt: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: pages[page++] ?? [], error: null }),
        update: (payload) => ({
          eq: (col, id) => {
            writes.push({ col, id, payload });
            return failOn === id
              ? Promise.resolve({ error: new Error("57014 statement timeout") })
              : Promise.resolve({ error: null });
          }
        })
      };
      return chain;
    }
  };
  return { client, writes };
}

const rowOf = (id, payload, stored = {}) => ({ fixture_id: id, raw_payload: payload, ...stored });

test("[M][N] the default walk issues ZERO writes", async () => {
  const { client, writes } = writableStub([[rowOf(1, FULL), rowOf(2, FULL)]]);
  const stats = await runBackfill({ supabase: client, batchSize: 10 });
  assert.equal(writes.length, 0, "writing must require an explicit apply");
  assert.equal(stats.updated, 0);
  assert.equal(stats.candidates, 2, "but the candidates are still reported");
});

test("[M] apply writes, and only for rows that would actually change", async () => {
  const { client, writes } = writableStub([[rowOf(1, FULL), rowOf(2, FULL)]]);
  const stats = await runBackfill({ supabase: client, batchSize: 10, apply: true });
  assert.equal(writes.length, 2);
  assert.equal(stats.updated, 2);
});

test("[H] an already-correct row is skipped — re-running is a no-op", async () => {
  const correct = rowOf(1, FULL, {
    prob_1: 43.5,
    prob_x: 28.5,
    prob_2: 28,
    model_method: "modular-engine",
    model_data_quality: 0.8,
    pick_1x2: "1"
  });
  const { client, writes } = writableStub([[correct]]);
  const stats = await runBackfill({ supabase: client, batchSize: 10, apply: true });

  assert.equal(writes.length, 0, "an already-correct row must not be rewritten");
  assert.equal(stats.updated, 0);
  assert.equal(stats.alreadyCorrect, 1);
  assert.equal(stats.candidates, 0);
});

test("[H] a numeric stored as a STRING still counts as already-correct", () => {
  // PostgREST can hand numeric back as a string; a raw === would rewrite every row.
  assert.equal(columnMatches("43.5", 43.5), true);
  assert.equal(columnMatches("37.36928211809955", 37.36928211809955), true);
  assert.equal(columnMatches(null, null), true);
  assert.equal(columnMatches(null, 43.5), false);
  assert.equal(columnMatches(43.5, null), false);
});

test("[I] the UPDATE carries exactly the eight promoted columns, keyed by fixture_id", async () => {
  const { client, writes } = writableStub([[rowOf(777, FULL)]]);
  await runBackfill({ supabase: client, batchSize: 10, apply: true });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].col, "fixture_id");
  assert.equal(writes[0].id, 777);
  // Six from D9b (migration 059) plus two from D9c (migration 060).
  assert.deepEqual(Object.keys(writes[0].payload).sort(), [
    "model_data_quality",
    "model_method",
    "pick_1x2",
    "prob_1",
    "prob_2",
    "prob_x",
    "value_bet_kelly",
    "value_bet_type"
  ]);
  // Nothing else may ride along.
  for (const forbidden of ["raw_payload", "saved_at", "updated_at", "fixture_id", "validation"]) {
    assert.ok(!(forbidden in writes[0].payload), `${forbidden} must never be written`);
  }
});

test("[A][C] the evaluation source wins and is what gets written", async () => {
  const { client, writes } = writableStub([
    [rowOf(1, { ...FULL, probs: { p1: 1, pX: 2, p2: 3 }, predictions: { oneXtwo: "2" } })]
  ]);
  await runBackfill({ supabase: client, batchSize: 10, apply: true });
  assert.equal(writes[0].payload.prob_1, 43.5);
  assert.equal(writes[0].payload.pick_1x2, "1");
});

test("[B][D] the fallbacks are written when the primary source is absent", async () => {
  const { client, writes } = writableStub([
    [rowOf(1, { probs: { p1: 50, pX: 30, p2: 20 }, predictions: { oneXtwo: "2" } })]
  ]);
  await runBackfill({ supabase: client, batchSize: 10, apply: true });
  assert.equal(writes[0].payload.prob_1, 50);
  assert.equal(writes[0].payload.pick_1x2, "2");
});

test("[E][F] NULL is written as NULL — never as zero", async () => {
  const { client, writes } = writableStub([[rowOf(1, { probs: { p1: 50, pX: null, p2: 20 } })]]);
  const stats = await runBackfill({ supabase: client, batchSize: 10, apply: true });

  // A partial triple yields nothing at all, and the row has no other source.
  assert.equal(stats.updated, 0, "a row with nothing to write must not be written");
  assert.equal(writes.length, 0);

  // And the builder itself never substitutes.
  const built = buildUpdate({
    prob_1: null,
    prob_x: null,
    prob_2: null,
    model_method: null,
    model_data_quality: null,
    pick_1x2: null,
    value_bet_kelly: null,
    value_bet_type: null
  });
  for (const value of Object.values(built)) assert.equal(value, null);
});

test("[G] a malformed payload is reported, not written", async () => {
  const { client, writes } = writableStub([[rowOf(1, { probs: { p1: "x", pX: "y", p2: "z" } })]]);
  const stats = await runBackfill({ supabase: client, batchSize: 10, apply: true });
  assert.equal(stats.tripleMalformed, 1);
  assert.equal(writes.length, 0);
});

test("[L] full float precision reaches the UPDATE payload unrounded", async () => {
  const exact = 37.36928211809955;
  const { client, writes } = writableStub([
    [
      rowOf(1, {
        evaluation: {
          modelProbs1x2Pct: { p1: exact, pX: 25.640971687182663, p2: 36.989746194717796 }
        }
      })
    ]
  ]);
  await runBackfill({ supabase: client, batchSize: 10, apply: true });
  assert.equal(writes[0].payload.prob_1, exact);
  assert.equal(String(writes[0].payload.prob_1), "37.36928211809955");
});

test("[J] apply uses the same keyset pagination as the dry run", async () => {
  const { client, writes } = writableStub([
    [rowOf(10, FULL), rowOf(20, FULL)],
    [rowOf(30, FULL)]
  ]);
  const stats = await runBackfill({ supabase: client, batchSize: 2, apply: true });
  assert.equal(stats.batches, 2);
  assert.equal(stats.lastFixtureId, 30);
  assert.deepEqual(
    writes.map((w) => w.id),
    [10, 20, 30]
  );
});

test("[K] a failed chunk stops the run and reports where to resume", async () => {
  const { client, writes } = writableStub([[rowOf(10, FULL), rowOf(20, FULL), rowOf(30, FULL)]], {
    failOn: 20
  });

  await assert.rejects(
    () => runBackfill({ supabase: client, batchSize: 10, apply: true }),
    (error) => {
      // The message names the fixture and the chunk range, so a retry is targeted.
      assert.match(error.message, /fixture 20/);
      assert.match(error.message, /chunk 10\.\.30/);
      assert.equal(error.stats.failed, 1);
      assert.equal(error.stats.updated, 1, "the row before the failure was written");
      return true;
    }
  );

  // It stopped: fixture 30 was never attempted.
  assert.deepEqual(
    writes.map((w) => w.id),
    [10, 20]
  );
});

test("[K] pre-flight refuses a population larger than the guardrail", async () => {
  const client = {
    from: () => ({
      select: (_cols, opts) =>
        opts?.head
          ? Promise.resolve({ count: 50000, error: null })
          : { limit: () => Promise.resolve({ data: [], error: null }) }
    })
  };
  const result = await preflight({ supabase: client, maxRows: 5000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /exceeds the --max-rows guardrail/);
});

test("pre-flight passes for the audited population and reports it", async () => {
  const client = {
    from: () => ({
      select: (_cols, opts) =>
        opts?.head
          ? Promise.resolve({ count: 914, error: null })
          : { limit: () => Promise.resolve({ data: [{}], error: null }) }
    })
  };
  const result = await preflight({ supabase: client, maxRows: 5000 });
  assert.equal(result.ok, true);
  assert.equal(result.population, 914);
});

test("pre-flight fails closed when the promoted columns are missing", async () => {
  const client = {
    from: () => ({
      select: () => ({
        limit: () =>
          Promise.resolve({ data: null, error: new Error("column prob_1 does not exist") })
      })
    })
  };
  const result = await preflight({ supabase: client });
  assert.equal(result.ok, false);
  assert.match(result.reason, /migrations 059 and 060/);
});
