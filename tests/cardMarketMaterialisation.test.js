import test from "node:test";
import assert from "node:assert/strict";

import {
  MATERIALISATION_SELECT,
  isEligible,
  planRowMaterialisation,
  runMaterialisation
} from "../server-utils/backfill/cardMarketMaterialisation.js";
import { resolveCardMarketValidations, aggregateCardMarketStats } from "../server-utils/cardMarketSettlement.js";

/**
 * Historical card-market materialisation.
 *
 * This is the only backfill in the programme allowed to write `raw_payload`,
 * so the invariants that matter are about what it does NOT do: it must persist
 * the document whole, touch exactly two keys, take its columns out of the
 * object it is about to store, and lose every race against a live writer.
 *
 * The supabase client is injected, so everything runs against fakes — no
 * Postgres, no network — the same shape the other backfill tests use.
 */

/** A heavy payload, shaped like a real pre-cbac70d9 row. */
function payload(overrides = {}) {
  return {
    id: 4242,
    status: "FT",
    score: { home: 2, away: 1 },
    teams: { home: "FCSB", away: "CFR" },
    recommended: { pick: "Over 2.5", odd: 1.85, confidence: 71, family: "Over/Under" },
    probs: {
      pO15: 88, pU15: 12, pO25: 64, pU25: 36, pU35: 61, pGG: 55,
      corners: { total: { o8_5: 61, o9_5: 48 } },
      shotsOnTarget: { total: { o7_5: 58, o8_5: 44 } },
      firstHalf: { pO15: 47 }
    },
    marketOdds: {
      corners: { pick: "Over 8.5", line: 8.5, odd: 1.9 },
      shotsOnTarget: { pick: "Over 7.5", line: 7.5, odd: 1.8 }
    },
    // Heavy analytical keys that must survive byte-for-byte.
    monteCarlo: { runs: 10000, distribution: [0.1, 0.2, 0.3], seed: "abc" },
    predictionLaboratory: { scenarios: [{ name: "high-press", delta: 0.12 }] },
    featureImportance: { topFeatures: [{ name: "xg_diff", weight: 0.31 }] },
    confidenceEngine: { base: 68, liveAdjustment: null, notes: ["stable"] },
    predictionContributions: { elo: 0.4, form: 0.35, rest: 0.25 },
    teamContext: { home: { rest: 4 }, away: { rest: 2 } },
    leagueProfile: { id: 283, tempo: 1.04 },
    odds: { home: 2.1, draw: 3.4, away: 3.2, bookmaker: "X" },
    lambdas: { home: 1.62, away: 1.14 },
    auditLog: { reasonCodes: ["R1", "R2"] },
    historyMeta: { generatedAt: "2026-05-01T10:00:00.000Z", source: "api/predict", schemaVersion: 2 },
    modelMeta: { version: "v3-dc-bp-shin-2026-04" },
    ...overrides
  };
}

/** A row as PostgREST returns it for MATERIALISATION_SELECT. */
function row(fixtureId, overrides = {}) {
  return {
    fixture_id: fixtureId,
    match_status: "FT",
    score_home: 2,
    score_away: 1,
    card_markets: null,
    card_market_validations: null,
    raw_payload: payload(),
    ...overrides
  };
}

/**
 * Records every query and mutation, and honours the eligibility filters on
 * UPDATE so the concurrency guard is exercised for real rather than assumed.
 */
function fakeSupabase(rows, { failWriteOn = null, mutateBeforeWrite = null } = {}) {
  const store = new Map(rows.map((r) => [r.fixture_id, JSON.parse(JSON.stringify(r))]));
  const calls = { selects: [], updates: [], forbidden: [] };
  const client = {
    from(table) {
      const state = { cursor: 0, limit: 50, isNull: [] };
      const builder = {
        select(cols) {
          if (cols) calls.selects.push(cols);
          return builder;
        },
        is(col, value) {
          state.isNull.push([col, value]);
          return builder;
        },
        gt(_col, value) {
          state.cursor = Number(value) || 0;
          return builder;
        },
        order() {
          return builder;
        },
        async limit(n) {
          state.limit = n;
          const page = [...store.values()]
            .filter((r) => Number(r.fixture_id) > state.cursor)
            .filter((r) => state.isNull.every(([col]) => r[col] === null || r[col] === undefined))
            .sort((a, b) => Number(a.fixture_id) - Number(b.fixture_id))
            .slice(0, n);
          return { data: JSON.parse(JSON.stringify(page)), error: null };
        },
        update(values) {
          const pending = { values, table, isNull: [] };
          const chain = {
            eq(col, value) {
              pending.eq = [col, value];
              return chain;
            },
            is(col, value) {
              pending.isNull.push([col, value]);
              return chain;
            },
            async select() {
              if (mutateBeforeWrite) mutateBeforeWrite(store, pending);
              const id = pending.eq ? pending.eq[1] : null;
              if (failWriteOn !== null && id === failWriteOn) {
                return { data: null, error: new Error("simulated write failure") };
              }
              const target = store.get(id);
              if (!target) return { data: [], error: null };
              const matches = pending.isNull.every(
                ([col]) => target[col] === null || target[col] === undefined
              );
              if (!matches) return { data: [], error: null };
              Object.assign(target, JSON.parse(JSON.stringify(pending.values)));
              calls.updates.push({ fixtureId: id, values: pending.values });
              return { data: [{ fixture_id: id }], error: null };
            }
          };
          return chain;
        },
        insert() {
          calls.forbidden.push("insert");
          throw new Error("insert is forbidden");
        },
        upsert() {
          calls.forbidden.push("upsert");
          throw new Error("upsert is forbidden");
        },
        delete() {
          calls.forbidden.push("delete");
          throw new Error("delete is forbidden");
        }
      };
      return builder;
    }
  };
  return { client, calls, store };
}

test("derivation goes through attachCardMarketsToPayload, not a local copy", () => {
  const source = row(1);
  const { update } = planRowMaterialisation(source);
  // The validations must equal what the authoritative read path produces for
  // the same input. Re-deriving with different rules would fail this.
  const viaResolver = resolveCardMarketValidations({
    fixture_id: 1,
    match_status: "FT",
    score_home: 2,
    score_away: 1,
    raw_payload: source.raw_payload
  });
  assert.deepEqual(update.card_market_validations, viaResolver);
  assert.ok(update.raw_payload.cardMarkets.goals, "no goals pick was derived");
});

test("the promoted columns are read out of the payload actually persisted", () => {
  const { update } = planRowMaterialisation(row(1));
  assert.deepEqual(update.card_markets, update.raw_payload.cardMarkets);
  assert.deepEqual(update.card_market_validations, update.raw_payload.cardMarketValidations);
});

test("the update touches only raw_payload and the two card-market columns", () => {
  const { update } = planRowMaterialisation(row(1));
  assert.deepEqual(Object.keys(update).sort(), ["card_market_validations", "card_markets", "raw_payload"]);
});

test("every unrelated raw_payload field survives byte for byte", () => {
  const source = row(1);
  const before = JSON.parse(JSON.stringify(source.raw_payload));
  const { update, changedKeys } = planRowMaterialisation(source);

  assert.deepEqual([...changedKeys].sort(), ["cardMarketValidations", "cardMarkets"]);

  const heavy = [
    "monteCarlo", "predictionLaboratory", "featureImportance", "confidenceEngine",
    "predictionContributions", "teamContext", "leagueProfile", "odds", "probs",
    "lambdas", "auditLog", "historyMeta", "modelMeta", "recommended", "marketOdds",
    "teams", "score", "status", "id"
  ];
  for (const key of heavy) {
    assert.equal(
      JSON.stringify(update.raw_payload[key]),
      JSON.stringify(before[key]),
      `raw_payload.${key} was altered`
    );
  }
  // And nothing was dropped.
  for (const key of Object.keys(before)) {
    assert.ok(key in update.raw_payload, `raw_payload.${key} disappeared`);
  }
});

test("the source row object is not mutated in place", () => {
  const source = row(1);
  const snapshot = JSON.stringify(source.raw_payload);
  planRowMaterialisation(source);
  assert.equal(JSON.stringify(source.raw_payload), snapshot, "planning mutated the caller row");
});

test("marketResults is untouched when the row carries no totals", () => {
  // The third assignment target inside attachCardMarketsToPayload only fires
  // when some total is non-null. This cohort has none, measured 324/324.
  const { update } = planRowMaterialisation(row(1));
  assert.ok(!("marketResults" in update.raw_payload), "marketResults was invented");
});

test("a row carrying market totals is refused rather than having marketResults rewritten", () => {
  /*
    attachCardMarketsToPayload has a THIRD assignment target: when any total is
    non-null it rewrites base.marketResults, folding in explicit nulls for the
    totals that are absent. Measured over all 324 eligible production rows that
    branch never fires, because the cohort carries no totals at all — but a row
    that did would have its marketResults silently reshaped by a job that is
    only supposed to touch two keys.

    So the guard refuses. Widening the blast radius of a historical repair is a
    different change and needs its own audit.
  */
  const withTotals = row(1, { raw_payload: payload({ marketResults: { cornersTotal: 9 } }) });
  const { update, error } = planRowMaterialisation(withTotals);
  assert.equal(update, null, "a row with totals was written anyway");
  assert.match(error, /unexpected keys/);
  assert.match(error, /marketResults/);
});

test("a row whose columns are already populated is skipped, never overwritten", () => {
  const existing = { recommended: "win", goals: "loss", corners: null, shots: null };
  const source = row(1, {
    card_markets: { recommended: { pick: "Over 2.5" } },
    card_market_validations: existing
  });
  const { update, skipped } = planRowMaterialisation(source);
  assert.equal(update, null);
  assert.equal(skipped, "already-materialised");
});

test("a half-materialised row is still treated as materialised", () => {
  // Only one of the two columns present: repairing it would mean deciding which
  // half is authoritative, which is not this job.
  for (const partial of [
    { card_markets: { recommended: { pick: "x" } } },
    { card_market_validations: { recommended: "win" } }
  ]) {
    const { update, skipped } = planRowMaterialisation(row(1, partial));
    assert.equal(update, null);
    assert.equal(skipped, "already-materialised");
  }
});

test("eligibility requires BOTH columns absent", () => {
  assert.equal(isEligible({ card_markets: null, card_market_validations: null }), true);
  assert.equal(isEligible({ card_markets: {}, card_market_validations: null }), false);
  assert.equal(isEligible({ card_markets: null, card_market_validations: {} }), false);
});

test("an absent payload is reported, not written", () => {
  const { update, error } = planRowMaterialisation(row(1, { raw_payload: null }));
  assert.equal(update, null);
  assert.match(error, /raw_payload is absent/);
});

test("a row with no derivable picks is reported rather than written blank", () => {
  const bare = row(1, { raw_payload: { status: "FT", score: { home: 0, away: 0 } } });
  const { update, error } = planRowMaterialisation(bare);
  if (update === null) assert.ok(error, "a refusal must carry a reason");
  else assert.ok(update.raw_payload.cardMarkets, "an empty cardMarkets was written");
});

test("a non-final row materialises with no settled outcome", () => {
  const source = row(1, {
    match_status: "NS",
    score_home: null,
    score_away: null,
    raw_payload: payload({ status: "NS", score: { home: null, away: null } })
  });
  const { update } = planRowMaterialisation(source);
  assert.ok(update, "a non-final row should still materialise its picks");
  const settled = Object.values(update.card_market_validations).filter((v) => v === "win" || v === "loss");
  assert.equal(settled.length, 0, "a non-final row produced a settled outcome");
});

test("a row without marketOdds still materialises model-line picks", () => {
  const source = row(1, { raw_payload: payload({ marketOdds: undefined }) });
  const { update } = planRowMaterialisation(source);
  assert.ok(update.raw_payload.cardMarkets.corners, "corners pick lost without a book quote");
  assert.ok(update.raw_payload.cardMarkets.shots, "shots pick lost without a book quote");
});

test("materialisation does not change what the read path resolves", () => {
  // The whole point: the stored document ends up saying what the read path has
  // been computing from probs all along.
  const source = row(1);
  const asRow = (payloadObject) => ({
    fixture_id: 1, match_status: "FT", score_home: 2, score_away: 1, raw_payload: payloadObject
  });
  const before = resolveCardMarketValidations(asRow(source.raw_payload));
  const { update } = planRowMaterialisation(source);
  const after = resolveCardMarketValidations(asRow(update.raw_payload));
  assert.deepEqual(after, before, "materialisation changed the resolved validations");

  // And the aggregate the counter is built from is unchanged.
  assert.deepEqual(
    aggregateCardMarketStats([asRow(update.raw_payload)]),
    aggregateCardMarketStats([asRow(source.raw_payload)])
  );
});

test("the walk materialises a batch and never issues insert, upsert or delete", async () => {
  const { client, calls, store } = fakeSupabase([row(1), row(2), row(3)]);
  const stats = await runMaterialisation({ supabase: client, batchSize: 2, apply: true });
  assert.equal(stats.scanned, 3);
  assert.equal(stats.changed, 3);
  assert.equal(stats.writeFailed, 0);
  assert.deepEqual(calls.forbidden, []);
  assert.equal(calls.updates.length, 3);
  for (const { values } of calls.updates) {
    assert.deepEqual(Object.keys(values).sort(), ["card_market_validations", "card_markets", "raw_payload"]);
  }
  for (const stored of store.values()) {
    assert.deepEqual(stored.card_markets, stored.raw_payload.cardMarkets);
  }
});

test("the projection reads only what the repair needs", () => {
  const cols = MATERIALISATION_SELECT.split(", ").map((c) => c.trim());
  assert.deepEqual([...cols].sort(), [
    "card_market_validations", "card_markets", "fixture_id",
    "match_status", "raw_payload", "score_away", "score_home"
  ]);
});

test("a second run changes nothing", async () => {
  const { client, calls } = fakeSupabase([row(1), row(2)]);
  const first = await runMaterialisation({ supabase: client, batchSize: 10, apply: true });
  assert.equal(first.changed, 2);
  const writesAfterFirst = calls.updates.length;

  const second = await runMaterialisation({ supabase: client, batchSize: 10, apply: true });
  assert.equal(second.scanned, 0, "the eligibility filter still returned repaired rows");
  assert.equal(second.changed, 0);
  assert.equal(calls.updates.length, writesAfterFirst, "the second run wrote again");
});

test("a row repaired mid-walk by a live writer is not clobbered", async () => {
  // The SELECT sees the row as eligible; a settlement pass populates it before
  // the UPDATE lands. The WHERE clause must then match zero rows.
  const live = { recommended: "win", goals: "win", corners: null, shots: null };
  const { client, calls, store } = fakeSupabase([row(1)], {
    mutateBeforeWrite: (s) => {
      const target = s.get(1);
      if (target && target.card_markets === null) {
        target.card_markets = { recommended: { pick: "LIVE" } };
        target.card_market_validations = live;
      }
    }
  });
  const stats = await runMaterialisation({ supabase: client, batchSize: 10, apply: true });
  assert.equal(stats.changed, 0, "the backfill overwrote a value written after it started");
  assert.equal(calls.updates.length, 0);
  assert.deepEqual(store.get(1).card_market_validations, live, "the live value was lost");
});

test("a write failure is counted against its fixture and does not abort the run", async () => {
  const { client, calls } = fakeSupabase([row(1), row(2), row(3)], { failWriteOn: 2 });
  const stats = await runMaterialisation({ supabase: client, batchSize: 10, apply: true });
  assert.equal(stats.writeFailed, 1);
  assert.equal(stats.changed, 2, "one failure stopped the rest of the batch");
  assert.equal(calls.updates.length, 2);
  const failure = stats.failures.find((f) => f.fixtureId === 2);
  assert.ok(failure, "the failing fixture was not identified");
  assert.equal(failure.stage, "write");
  assert.match(failure.reason, /simulated write failure/);
});

test("a dry run plans everything and writes nothing", async () => {
  const { client, calls, store } = fakeSupabase([row(1), row(2)]);
  const stats = await runMaterialisation({ supabase: client, batchSize: 10, apply: false });
  assert.equal(stats.changed, 2);
  assert.equal(calls.updates.length, 0);
  for (const stored of store.values()) assert.equal(stored.card_markets, null);
});

test("the keyset walk advances and terminates", async () => {
  const rows = [];
  for (let i = 1; i <= 25; i += 1) rows.push(row(i * 10));
  const { client } = fakeSupabase(rows);
  const stats = await runMaterialisation({ supabase: client, batchSize: 10, apply: true });
  assert.equal(stats.scanned, 25);
  assert.equal(stats.changed, 25);
  assert.equal(stats.batches, 3);
  assert.equal(stats.lastFixtureId, 250);
});

test("--after resumes past the fixtures already handled", async () => {
  const { client } = fakeSupabase([row(10), row(20), row(30)]);
  const stats = await runMaterialisation({ supabase: client, batchSize: 10, apply: true, after: 20 });
  assert.equal(stats.scanned, 1);
  assert.equal(stats.lastFixtureId, 30);
});

test("--max-batches stops the walk early and reports where to resume", async () => {
  const rows = [];
  for (let i = 1; i <= 20; i += 1) rows.push(row(i));
  const { client } = fakeSupabase(rows);
  const stats = await runMaterialisation({ supabase: client, batchSize: 5, apply: true, maxBatches: 2 });
  assert.equal(stats.batches, 2);
  assert.equal(stats.scanned, 10);
  assert.equal(stats.lastFixtureId, 10);
});

test("per-market pick counts reflect what was actually written", async () => {
  const { client } = fakeSupabase([row(1), row(2)]);
  const stats = await runMaterialisation({ supabase: client, batchSize: 10, apply: true });
  assert.equal(stats.picks.recommended, 2);
  assert.equal(stats.picks.goals, 2);
  assert.equal(stats.picks.corners, 2);
  assert.equal(stats.picks.shots, 2);
});
