import test, { mock } from "node:test";
import assert from "node:assert/strict";

import {
  extractPromotedModelColumns,
  mapPredictionToDbRow
} from "../server-utils/predictionsHistory.js";

/**
 * D9b-1 — the six promoted 1X2 columns, write side only.
 *
 * Nothing reads them yet. What these tests defend is the contract the future
 * read path will depend on:
 *
 *   - units are PRESERVED, not converted (prob_* are percentages 0-100, because
 *     Stage07 compares them against a 24 percentage-point threshold);
 *   - precedence matches the metrics endpoint exactly, so switching that read
 *     later cannot move a published number;
 *   - absent data stays NULL. Never 0, never "". A stored 0 is scored as a real
 *     prediction of "no chance" and would silently move the Brier score.
 *
 * The third one is not hypothetical: `Number(null)` is 0 and passes
 * `Number.isFinite`, so the obvious implementation writes zeros for missing
 * probabilities. Several cases below exist purely to keep that from coming back.
 */

const TRIPLE = { p1: 43.21739130434783, pX: 28.5, p2: 28.28260869565217 };

const promoted = (prediction) => extractPromotedModelColumns({ id: 1, ...prediction });

test("[1] evaluation.modelProbs1x2Pct maps to prob_1/x/2", () => {
  const out = promoted({ evaluation: { modelProbs1x2Pct: TRIPLE } });
  assert.equal(out.prob_1, TRIPLE.p1);
  assert.equal(out.prob_x, TRIPLE.pX);
  assert.equal(out.prob_2, TRIPLE.p2);
});

test("[2] probs is the fallback when evaluation carries no triple", () => {
  const out = promoted({ probs: { p1: 50, pX: 30, p2: 20 } });
  assert.deepEqual([out.prob_1, out.prob_x, out.prob_2], [50, 30, 20]);
});

test("[3] evaluation wins over probs when both are present", () => {
  const out = promoted({
    evaluation: { modelProbs1x2Pct: { p1: 60, pX: 25, p2: 15 } },
    probs: { p1: 1, pX: 2, p2: 3 }
  });
  assert.deepEqual([out.prob_1, out.prob_x, out.prob_2], [60, 25, 15]);
});

test("[3] a non-finite evaluation triple falls through to probs rather than blocking it", () => {
  const out = promoted({
    evaluation: { modelProbs1x2Pct: { p1: NaN, pX: 25, p2: 15 } },
    probs: { p1: 50, pX: 30, p2: 20 }
  });
  assert.deepEqual([out.prob_1, out.prob_x, out.prob_2], [50, 30, 20]);
});

test("[4] probabilities keep 0-100 semantics and full float precision", () => {
  const out = promoted({ evaluation: { modelProbs1x2Pct: TRIPLE } });
  // Not divided by 100 anywhere: Stage07's drift threshold is 24 PERCENTAGE POINTS.
  assert.ok(out.prob_1 > 1.5, "a fraction here would silently disable the drift penalty");
  assert.equal(out.prob_1 + out.prob_x + out.prob_2, 100);
  // Byte-identical, so unbounded numeric round-trips and the Brier score cannot move.
  assert.equal(out.prob_1, 43.21739130434783);
});

test("[5] model_method maps from modelMeta.method", () => {
  assert.equal(promoted({ modelMeta: { method: "modular-engine" } }).model_method, "modular-engine");
});

test("[6] model_data_quality maps from modelMeta.dataQuality, as a 0-1 fraction", () => {
  const out = promoted({ modelMeta: { dataQuality: 0.812 } });
  assert.equal(out.model_data_quality, 0.812);
  assert.ok(out.model_data_quality <= 1, "dataQuality is a fraction, unlike prob_*");
});

test("[7] pick_1x2 maps from evaluation.recommended1x2", () => {
  assert.equal(promoted({ evaluation: { recommended1x2: "1" } }).pick_1x2, "1");
});

test("[8] predictions.oneXtwo is the fallback", () => {
  assert.equal(promoted({ predictions: { oneXtwo: "2" } }).pick_1x2, "2");
  // Empty is not a pick, so it must not shadow a usable fallback.
  assert.equal(
    promoted({ evaluation: { recommended1x2: "" }, predictions: { oneXtwo: "X" } }).pick_1x2,
    "X"
  );
});

test("[7] evaluation wins over predictions for the pick too", () => {
  const out = promoted({
    evaluation: { recommended1x2: "1" },
    predictions: { oneXtwo: "X" }
  });
  assert.equal(out.pick_1x2, "1");
});

test("[9] a prediction carrying nothing leaves every promoted field NULL", () => {
  assert.deepEqual(promoted({}), {
    prob_1: null,
    prob_x: null,
    prob_2: null,
    model_method: null,
    model_data_quality: null,
    pick_1x2: null,
    // D9c (migration 060)
    value_bet_kelly: null,
    value_bet_type: null
  });
});

test("[D9c] valueBet.kelly and .type map to their own columns", () => {
  const out = promoted({ valueBet: { kelly: 1.9, type: "X2" } });
  assert.equal(out.value_bet_kelly, 1.9);
  assert.equal(out.value_bet_type, "X2");
});

test("[D9c] the two are INDEPENDENT — one present does not require the other", () => {
  // Production carries kelly on 914/914 rows but type on only 641. Pairing them
  // all-or-nothing, the way the probability triple is paired, would discard 273
  // real stakes.
  const kellyOnly = promoted({ valueBet: { kelly: 2.4 } });
  assert.equal(kellyOnly.value_bet_kelly, 2.4);
  assert.equal(kellyOnly.value_bet_type, null);

  const typeOnly = promoted({ valueBet: { type: "1" } });
  assert.equal(typeOnly.value_bet_kelly, null);
  assert.equal(typeOnly.value_bet_type, "1");
});

test("[D9c] a kelly of ZERO survives — it is a real stake, not a missing one", () => {
  assert.equal(promoted({ valueBet: { kelly: 0 } }).value_bet_kelly, 0);
  // …whereas each way of being absent stays NULL, never 0.
  for (const kelly of [null, undefined, ""]) {
    assert.equal(promoted({ valueBet: { kelly } }).value_bet_kelly, null, String(kelly));
  }
  assert.equal(promoted({ valueBet: { kelly: "abc" } }).value_bet_kelly, null);
});

test("[D9c] type is stored VERBATIM — it is market text, not a 1X2 pick", () => {
  // 56 distinct values appear in production; normalising would change which odds
  // estimateRollingDrawdown prices the row at.
  for (const type of ["X2", "1X", "Peste 3.5", "Cards Under 3.5", "Correct Score 0-0"]) {
    assert.equal(promoted({ valueBet: { type } }).value_bet_type, type);
  }
  // Trimmed, and an empty string is NULL rather than a real selection.
  assert.equal(promoted({ valueBet: { type: "  Over 2.5  " } }).value_bet_type, "Over 2.5");
  assert.equal(promoted({ valueBet: { type: "   " } }).value_bet_type, null);
});

test("[D9c] a non-object valueBet does not throw", () => {
  for (const valueBet of [null, undefined, "nope", 7]) {
    const out = promoted({ valueBet });
    assert.equal(out.value_bet_kelly, null);
    assert.equal(out.value_bet_type, null);
  }
});

test("[10] a PARTIAL triple populates none of it", () => {
  // Each of these is a different way to be missing, and Number() turns the first
  // two into 0 — the substitution that must never reach the column.
  for (const probs of [
    { p1: 50, pX: null, p2: 20 },
    { p1: 50, pX: "", p2: 20 },
    { p1: 50, p2: 20 },
    { p1: 50, pX: NaN, p2: 20 },
    { p1: 50, pX: "abc", p2: 20 }
  ]) {
    const out = promoted({ probs });
    assert.deepEqual(
      [out.prob_1, out.prob_x, out.prob_2],
      [null, null, null],
      `partial triple leaked: ${JSON.stringify(probs)}`
    );
  }
});

test("[9] missing is NULL, but a genuine zero survives", () => {
  // The distinction the NULL rule exists to protect.
  assert.equal(promoted({ modelMeta: { dataQuality: null } }).model_data_quality, null);
  assert.equal(promoted({ modelMeta: { dataQuality: 0 } }).model_data_quality, 0);
  assert.equal(promoted({ modelMeta: { method: "" } }).model_method, null);
  assert.equal(promoted({ modelMeta: { method: "   " } }).model_method, null);

  const zeroProb = promoted({ probs: { p1: 0, pX: 50, p2: 50 } });
  assert.deepEqual([zeroProb.prob_1, zeroProb.prob_x, zeroProb.prob_2], [0, 50, 50]);
});

test("[9] a pick that is not 1/X/2 is NULL, matching what the metrics reducer already ignores", () => {
  for (const value of ["", "  ", "Over 2.5", "1X", "0", null, undefined, {}]) {
    assert.equal(promoted({ evaluation: { recommended1x2: value } }).pick_1x2, null);
  }
  /*
    A numeric 1 IS accepted, deliberately. The metrics reducer already does
    `String(ev.recommended1x2 || ...).trim()` and treats it as "1", so rejecting
    it here would make the column disagree with the consumer it exists to feed.
  */
  assert.equal(promoted({ evaluation: { recommended1x2: 1 } }).pick_1x2, "1");
});

test("[11] the fields ride the SAME row object the bulk write receives", () => {
  const row = mapPredictionToDbRow({
    id: 777,
    evaluation: { modelProbs1x2Pct: TRIPLE, recommended1x2: "1" },
    modelMeta: { method: "standings", dataQuality: 0.6 },
    recommended: { pick: "Over 2.5", confidence: 72 }
  });

  for (const key of [
    "prob_1",
    "prob_x",
    "prob_2",
    "model_method",
    "model_data_quality",
    "pick_1x2"
  ]) {
    assert.ok(key in row, `${key} missing from the persisted row`);
  }
  assert.equal(row.fixture_id, 777);
  // pick_1x2 is the 1X2 pick; recommended_pick stays the MARKET pick.
  assert.equal(row.pick_1x2, "1");
  assert.equal(row.recommended_pick, "Over 2.5");
});

test("[11] no pre-existing column was renamed or dropped by the addition", () => {
  const row = mapPredictionToDbRow({ id: 1, recommended: { pick: "Over 2.5", confidence: 72 } });
  for (const key of [
    "fixture_id",
    "league_id",
    "kickoff_at",
    "recommended_pick",
    "recommended_confidence",
    "match_status",
    "validation",
    "model_version",
    "raw_payload"
  ]) {
    assert.ok(key in row, `${key} disappeared from the persisted row`);
  }
});

/* --------------------------------------------------------------------------
 * [12] The write count — the requirement that must be exactly zero new writes.
 * ----------------------------------------------------------------------- */

async function persistWith(predictions) {
  const ops = [];
  mock.reset();
  mock.module("../server-utils/supabaseAdmin.js", {
    namedExports: {
      assertSupabaseConfigured: () => ({ ok: true }),
      getSupabaseAdmin: () => ({
        from: (table) => {
          const chain = {
            select: () => chain,
            in: () => Promise.resolve({ data: [], error: null }),
            insert: (rows) => {
              ops.push({ table, op: "insert", rows });
              return Promise.resolve({ error: null });
            },
            upsert: (rows) => {
              ops.push({ table, op: "upsert", rows });
              return Promise.resolve({ error: null });
            }
          };
          return chain;
        }
      })
    }
  });
  const mod = await import(`../server-utils/predictionsHistory.js?d9b=${Math.random()}`);
  await mod.upsertPredictionsHistory(predictions);
  return ops;
}

test("[12] persisting many predictions still issues exactly ONE write, carrying the new columns", async () => {
  const kickoff = new Date(Date.now() + 6 * 3600_000).toISOString();
  const predictions = Array.from({ length: 20 }, (_, i) => ({
    id: 1000 + i,
    kickoff,
    status: "NS",
    evaluation: { modelProbs1x2Pct: TRIPLE, recommended1x2: "1" },
    modelMeta: { method: "modular-engine", dataQuality: 0.8 },
    recommended: { pick: "Over 2.5", confidence: 70 }
  }));

  const ops = await persistWith(predictions);
  const historyWrites = ops.filter(
    (o) => o.table === "predictions_history" && (o.op === "insert" || o.op === "upsert")
  );

  // One bulk statement for twenty fixtures — not twenty, and not one extra.
  assert.equal(historyWrites.length, 1, `expected 1 bulk write, saw ${historyWrites.length}`);
  assert.equal(historyWrites[0].rows.length, 20);

  // Every row in that single statement carries the promoted values.
  for (const row of historyWrites[0].rows) {
    assert.equal(row.prob_1, TRIPLE.p1);
    assert.equal(row.model_method, "modular-engine");
    assert.equal(row.pick_1x2, "1");
  }
});

test("[12] the set of tables written is exactly the pre-existing one — D9b adds none", async () => {
  const kickoff = new Date(Date.now() + 6 * 3600_000).toISOString();
  const ops = await persistWith([
    {
      id: 1,
      kickoff,
      status: "NS",
      probs: { p1: 50, pX: 30, p2: 20 },
      recommended: { pick: "Over 2.5", confidence: 70 }
    }
  ]);

  /*
    Two tables, and both predate D9b: the history upsert and the model-version
    snapshot insert that `upsertPredictionsHistory` has always issued. Pinned as
    a SET rather than a count so a third table — the shape a "just add one more
    write" regression takes — fails here.
  */
  assert.deepEqual([...new Set(ops.map((o) => o.table))].sort(), [
    "predictions_history",
    "prediction_snapshots"
  ].sort());
});
