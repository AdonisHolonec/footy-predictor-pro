import test from "node:test";
import assert from "node:assert/strict";

import {
  DRYRUN_SELECT,
  PROMOTED_COLUMNS,
  inspectRow,
  runDryRun
} from "../server-utils/backfill/probabilityColumns.js";

/**
 * D9b-2 — the dry run that decides whether the backfill is safe.
 *
 * Its numbers are only worth acting on if the walk is the same one the real
 * backfill will perform and the extraction is the same one the dual-write uses.
 * These tests pin both, plus the classifications the verdict rests on: a partial
 * triple must not read as complete, an all-zero triple must be separable from a
 * real prediction, and drift between the two legacy representations must be
 * counted rather than smoothed over.
 */

const triple = (p1, pX, p2) => ({ p1, pX, p2 });

function row(fixtureId, payload, stored = {}) {
  return { fixture_id: fixtureId, raw_payload: payload, ...stored };
}

/** PostgREST chain: .select().gt().order().limit() is awaited. */
function stubClient(pages) {
  const calls = { selects: [], cursors: [], limits: [] };
  let page = 0;
  const client = {
    from: () => {
      const chain = {
        select: (projection) => {
          calls.selects.push(projection);
          return chain;
        },
        gt: (_col, cursor) => {
          calls.cursors.push(cursor);
          return chain;
        },
        order: () => chain,
        limit: (n) => {
          calls.limits.push(n);
          const data = pages[page] ?? [];
          page += 1;
          return Promise.resolve({ data, error: null });
        }
      };
      return chain;
    }
  };
  return { client, calls };
}

test("the projection asks for the document, the key and the promoted columns — nothing else", () => {
  assert.equal(DRYRUN_SELECT, `fixture_id, raw_payload, ${PROMOTED_COLUMNS.join(", ")}`);
  // The stored columns are needed for parity; anything wider would re-detoast for nothing.
  assert.ok(!DRYRUN_SELECT.includes("*"));
});

test("a complete triple is classified complete and planned in full", () => {
  const seen = inspectRow(
    row(1, {
      evaluation: { modelProbs1x2Pct: triple(43.5, 28.5, 28), recommended1x2: "1" },
      modelMeta: { method: "modular-engine", dataQuality: 0.8 }
    })
  );
  assert.equal(seen.tripleState, "complete");
  assert.equal(seen.planned.prob_1, 43.5);
  assert.equal(seen.planned.pick_1x2, "1");
  assert.equal(seen.plannedNonNull, 6);
});

test("a PARTIAL triple is reported as partial and plans nothing — never as complete", () => {
  for (const probs of [
    { p1: 50, pX: null, p2: 20 },
    { p1: 50, p2: 20 },
    { p1: 50, pX: "", p2: 20 }
  ]) {
    const seen = inspectRow(row(1, { probs }));
    assert.equal(seen.tripleState, "partial", JSON.stringify(probs));
    // The whole point of the NULL rule: a half-triple must not be stored.
    assert.equal(seen.planned.prob_1, null);
    assert.equal(seen.planned.prob_x, null);
    assert.equal(seen.planned.prob_2, null);
  }
});

test("a present-but-unusable triple is malformed, not merely missing", () => {
  const seen = inspectRow(row(1, { probs: { p1: "abc", pX: "def", p2: "ghi" } }));
  assert.equal(seen.tripleState, "malformed");
  assert.equal(seen.planned.prob_1, null);
});

test("an absent triple is missing", () => {
  assert.equal(inspectRow(row(1, {})).tripleState, "missing");
  assert.equal(inspectRow(row(1, {})).plannedNonNull, 0);
});

test("[Phase D] an all-zero triple is flagged, and insufficientData is recorded separately", () => {
  const abort = inspectRow(row(1, { probs: triple(0, 0, 0), insufficientData: true }));
  assert.equal(abort.allZero, true);
  assert.equal(abort.insufficientData, true);

  // The dangerous case: all-zero WITHOUT the marker is indistinguishable from a
  // real 0% prediction once it is a column, so it must be counted on its own.
  const bare = inspectRow(row(1, { probs: triple(0, 0, 0) }));
  assert.equal(bare.allZero, true);
  assert.equal(bare.insufficientData, false);

  assert.equal(inspectRow(row(1, { probs: triple(0, 50, 50) })).allZero, false);
});

test("[Phase C] drift between evaluation and probs is counted, not reconciled", () => {
  const drifted = inspectRow(
    row(1, { evaluation: { modelProbs1x2Pct: triple(60, 25, 15) }, probs: triple(0.6, 0.25, 0.15) })
  );
  assert.equal(drifted.evaluationDiffers, true);
  // Precedence still decides — the dry run reports the disagreement, it does not fix it.
  assert.equal(drifted.planned.prob_1, 60);

  const agreeing = inspectRow(
    row(1, { evaluation: { modelProbs1x2Pct: triple(60, 25, 15) }, probs: triple(60, 25, 15) })
  );
  assert.equal(agreeing.evaluationDiffers, false);
});

test("[Phase C] parity compares only columns that are ALREADY populated", () => {
  const payload = { evaluation: { modelProbs1x2Pct: triple(60, 25, 15), recommended1x2: "1" } };

  // Unpopulated columns are rows the backfill has not reached — not disagreements.
  assert.deepEqual(inspectRow(row(1, payload)).mismatches, []);

  const agreeing = inspectRow(row(1, payload, { prob_1: 60, pick_1x2: "1" }));
  assert.deepEqual(agreeing.mismatches, []);

  const conflicting = inspectRow(row(1, payload, { prob_1: 59, pick_1x2: "2" }));
  assert.deepEqual(conflicting.mismatches.map((m) => m.column).sort(), ["pick_1x2", "prob_1"]);
});

test("the walk is keyset, not OFFSET, and the cursor strictly advances", async () => {
  const { client, calls } = stubClient([
    [row(10, { probs: triple(50, 30, 20) }), row(20, { probs: triple(50, 30, 20) })],
    [row(30, { probs: triple(50, 30, 20) })],
    []
  ]);

  const stats = await runDryRun({ supabase: client, batchSize: 2 });

  assert.equal(stats.scanned, 3);
  /*
    Page 1 starts at 0, page 2 past the highest id seen — no OFFSET anywhere.
    Only two queries: page 2 came back short of batchSize, which ends the walk,
    so the empty third page is never requested. On a TOASTed table that saved
    round trip is the point.
  */
  assert.deepEqual(calls.cursors, [0, 20]);
  assert.deepEqual(calls.limits, [2, 2]);
  assert.equal(stats.lastFixtureId, 30);
});

test("a short page ends the walk without asking for another", async () => {
  const { client, calls } = stubClient([[row(10, { probs: triple(50, 30, 20) })]]);
  const stats = await runDryRun({ supabase: client, batchSize: 100 });
  assert.equal(stats.batches, 1);
  assert.equal(calls.limits.length, 1, "a short page means the table ended");
});

test("resuming from a cursor starts past it, so a restart re-reads nothing", async () => {
  const { client, calls } = stubClient([[row(500, { probs: triple(50, 30, 20) })]]);
  await runDryRun({ supabase: client, batchSize: 100, after: 499 });
  assert.equal(calls.cursors[0], 499);
});

test("maxBatches stops the walk early, so one page can be sampled safely", async () => {
  const page = Array.from({ length: 2 }, (_, i) => row(i + 1, { probs: triple(50, 30, 20) }));
  const { client } = stubClient([page, page, page]);
  const stats = await runDryRun({ supabase: client, batchSize: 2, maxBatches: 1 });
  assert.equal(stats.batches, 1);
  assert.equal(stats.scanned, 2);
});

test("the aggregate separates would-update from stays-NULL", async () => {
  const { client } = stubClient([
    [
      row(1, { probs: triple(50, 30, 20) }), // has source, no column yet
      row(2, {}), // no source at all
      row(3, { probs: triple(50, 30, 20) }, { prob_1: 50 }) // already populated
    ]
  ]);
  const stats = await runDryRun({ supabase: client, batchSize: 10 });

  assert.equal(stats.wouldUpdate, 1);
  assert.equal(stats.wouldRemainNull, 1);
  assert.equal(stats.alreadyPopulated, 1);
  assert.equal(stats.noSourceAtAll, 1);
});

test("a read error surfaces instead of being reported as an empty table", async () => {
  const failing = {
    from: () => {
      const chain = {
        select: () => chain,
        gt: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: null, error: new Error("57014 statement timeout") })
      };
      return chain;
    }
  };
  await assert.rejects(() => runDryRun({ supabase: failing }), /57014/);
});
