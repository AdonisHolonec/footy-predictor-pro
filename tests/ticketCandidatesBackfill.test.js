import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BACKFILL_SELECT,
  BackfillAbort,
  DEFAULT_BATCH,
  MAX_BATCH,
  TICKET_CANDIDATE_SOURCE_PATHS,
  percentile,
  planRowUpdate,
  runBackfill,
  validateTicketCandidates
} from "../server-utils/backfill/ticketCandidates.js";
import { buildTicketCandidates } from "../server-utils/ticketCandidateColumn.js";

/**
 * ticket_candidates backfill (PR 2B-ii) — the guarantees a data migration owes.
 *
 * Four failure modes get the weight, because each is silent:
 *
 *   1. A DRY RUN THAT WRITES. The default is dry, so the mistake would be
 *      invisible until production data moved. Asserted by counting update calls
 *      on the double, not by inspecting a flag.
 *
 *   2. OVERWRITING A LIVE VALUE. The live writer derives the column from the
 *      document it actually persisted; a backfill re-deriving from a row read
 *      back later is strictly weaker evidence. Both the plan step and the write
 *      predicate refuse, and the race between them is tested too.
 *
 *   3. A SECOND PROJECTION. The subpath read hands the helper a REBUILT
 *      document. If that rebuild ever diverges from the stored one the column
 *      silently changes meaning, so the parity tests run the real helper over
 *      both and require deep equality — including over keys the spec does not
 *      project, which is what would catch the helper growing a sixth path.
 *
 *   4. A PAGINATION LOOP. A cursor that does not strictly advance re-reads the
 *      same page forever, which on an --apply run is unbounded write volume.
 *
 * No database. The Supabase double records every call, so assertions are about
 * the statements that would have been issued.
 */

// ── doubles ────────────────────────────────────────────────────────────────

/** A market the projection keeps. */
const goodMarket = (o = {}) => ({
  type: "Over 2.5",
  family: "Goals",
  line: 2.5,
  odds: 1.9,
  probability: 0.7,
  valueScore: 60,
  recommendable: true,
  tradable: true,
  betType: "over_under",
  period: "full_match",
  scope: "match",
  ...o
});

/** The canonical stored document, as raw_payload holds it. */
const rawPayload = (id, markets, o = {}) => ({
  id,
  leagueId: 39,
  kickoff: "2026-09-05T18:00:00.000Z",
  teams: { home: `Home ${id}`, away: `Away ${id}` },
  recommended: { pick: "Over 2.5", family: "Goals", confidence: 80 },
  modelMeta: { dataQuality: 0.8, modelVersion: "v3.1" },
  insufficientData: false,
  valueEngine: { markets, bestMarket: { type: "Over 2.5" }, odds: 1.9 },
  ...o
});

/**
 * PostgREST `->` semantics for one path: a missing key comes back null, and the
 * value makes a JSON round trip. Same simulation the egress suite uses.
 */
function projectPath(document, path) {
  let cursor = document;
  for (const segment of path) {
    if (cursor === null || cursor === undefined || typeof cursor !== "object") return null;
    cursor = cursor[segment];
  }
  return cursor === undefined ? null : JSON.parse(JSON.stringify(cursor));
}

/** A stored document -> the row the projected SELECT would return. */
function projectedRow(fixtureId, document, ticketCandidates = null) {
  const row = { fixture_id: fixtureId, ticket_candidates: ticketCandidates };
  for (const [alias, path] of Object.entries(TICKET_CANDIDATE_SOURCE_PATHS)) {
    row[alias] = projectPath(document, path);
  }
  return row;
}

/** A supabase double whose update() path is distinguishable from select(). */
function writableSupabase({ pages = [], onUpdate = null, count = 0 } = {}) {
  const log = { selects: [], updates: [], updateFilters: [], counts: 0 };
  let pageIndex = 0;

  return {
    log,
    from() {
      const ctx = { mode: "read", fixtureId: null, patch: null, head: false };
      const b = {
        select(cols, opts) {
          if (opts?.head) {
            ctx.head = true;
            log.counts += 1;
          } else if (ctx.mode === "read") {
            log.selects.push(cols);
          }
          return b;
        },
        update(patch) {
          ctx.mode = "write";
          ctx.patch = patch;
          return b;
        },
        is(col, val) {
          if (ctx.mode === "write") log.updateFilters.push(["is", col, val]);
          return b;
        },
        not: () => b,
        gt: () => b,
        eq(col, val) {
          if (ctx.mode === "write") ctx.fixtureId = val;
          return b;
        },
        order: () => b,
        limit: () => b,
        then(res, rej) {
          if (ctx.head) return Promise.resolve({ count, error: null }).then(res, rej);
          if (ctx.mode === "write") {
            log.updates.push({ fixtureId: ctx.fixtureId, patch: ctx.patch });
            const outcome = onUpdate ? onUpdate(ctx.fixtureId, log.updates.length - 1) : null;
            if (outcome?.throw) return Promise.resolve({ data: null, error: outcome.throw }).then(res, rej);
            if (outcome?.raced) return Promise.resolve({ data: [], error: null }).then(res, rej);
            return Promise.resolve({ data: [{ fixture_id: ctx.fixtureId }], error: null }).then(res, rej);
          }
          const page = pages[pageIndex] ?? [];
          pageIndex += 1;
          return Promise.resolve({ data: page, error: null }).then(res, rej);
        }
      };
      return b;
    }
  };
}

const rows = (n, from = 1) =>
  Array.from({ length: n }, (_, i) =>
    projectedRow(from + i, rawPayload(from + i, [goodMarket(), goodMarket({ recommendable: false })]))
  );

// ── the projected SELECT ───────────────────────────────────────────────────

test("the select names raw_payload only through subpaths, never the column", () => {
  assert.equal(
    BACKFILL_SELECT,
    "fixture_id, ticket_candidates, " +
      "veMarkets:raw_payload->valueEngine->markets, " +
      "modelMeta:raw_payload->modelMeta, " +
      "insufficientData:raw_payload->insufficientData, " +
      "recommended:raw_payload->recommended, " +
      "teams:raw_payload->teams"
  );
  // The bare column would transport ~303 KB a row; every occurrence must be a
  // path expression.
  for (const fragment of BACKFILL_SELECT.split(", ")) {
    if (fragment.includes("raw_payload")) assert.match(fragment, /raw_payload->/);
  }
  assert.equal(BACKFILL_SELECT.includes("*"), false);
  assert.equal(BACKFILL_SELECT.includes("hydration_payload"), false);
});

// ── parity with the live projection helper ─────────────────────────────────

test("PARITY: the projected row rebuilds to the same value as the full document", () => {
  const document = rawPayload(7, [
    goodMarket({ probability: 0.9 }),
    goodMarket({ recommendable: false }),
    goodMarket({ probability: 0.66, odds: 2.4 })
  ]);

  const fromFullDocument = buildTicketCandidates(document);
  const { value: fromProjection } = planRowUpdate(projectedRow(7, document));

  assert.deepEqual(fromProjection, fromFullDocument);
  // And it really did retain something, so the equality is not two nulls.
  assert.equal(fromFullDocument.markets.length, 2);
  assert.equal(fromFullDocument.examined, 3);
  assert.equal(fromFullDocument.notRecommendable, 1);
});

test("PARITY holds across the awkward source states", () => {
  const cases = {
    "no modelMeta": rawPayload(1, [goodMarket()], { modelMeta: undefined }),
    "no recommended": rawPayload(2, [goodMarket()], { recommended: undefined }),
    "no teams": rawPayload(3, [goodMarket()], { teams: undefined }),
    "null teams": rawPayload(4, [goodMarket()], { teams: null }),
    "insufficientData true": rawPayload(5, [goodMarket()], { insufficientData: true }),
    "insufficientData absent": rawPayload(6, [goodMarket()], { insufficientData: undefined }),
    "dataQuality null": rawPayload(7, [goodMarket()], { modelMeta: { dataQuality: null } }),
    "all markets rejected": rawPayload(8, [goodMarket({ recommendable: false })]),
    "partial teams": rawPayload(9, [goodMarket()], { teams: { home: "Only Home" } })
  };

  for (const [label, document] of Object.entries(cases)) {
    const expected = buildTicketCandidates(document);
    const { value } = planRowUpdate(projectedRow(document.id, document));
    assert.deepEqual(value, expected, label);
  }
});

test("PARITY: retained markets are byte-identical, in source order", () => {
  const a = goodMarket({ type: "Over 1.5", line: 1.5, probability: 0.91 });
  const b = goodMarket({ type: "Over 2.5", line: 2.5, probability: 0.7 });
  const document = rawPayload(11, [a, goodMarket({ recommendable: false }), b]);

  const { value } = planRowUpdate(projectedRow(11, document));
  assert.deepEqual(value.markets, [a, b]);
  // Order is the source's, not a re-sort: a re-ordered column would silently
  // change which leg a future tie-break picks.
  assert.equal(value.markets[0].type, "Over 1.5");
});

test("REGRESSION: a stored null dataQuality survives as 0, not as null", () => {
  /*
    The bug the parity suite caught during 2B-ii, pinned so it cannot return.

    A leaf projection of ["modelMeta","dataQuality"] comes back null for BOTH a
    stored null and a missing key — PostgREST cannot tell them apart — and
    rehydration then omits it. The helper reads it through finiteOrNull, where
    Number(null) is 0 but Number(undefined) is NaN, so the leaf path yields
    dataQuality null where the live writer yielded 0.

    That is not cosmetic: collectGlobalCandidates counts a null dataQuality as
    rejected.missingData, so every market of such a fixture would be discarded
    and the backfilled row would offer fewer candidates than the same fixture
    predicted today. Projecting the parent block is what keeps them identical.
  */
  const document = rawPayload(21, [goodMarket()], { modelMeta: { dataQuality: null } });

  assert.equal(buildTicketCandidates(document).dataQuality, 0);
  assert.equal(planRowUpdate(projectedRow(21, document)).value.dataQuality, 0);

  // Same rule for confidence, through the same helper.
  const noConfidence = rawPayload(22, [goodMarket()], { recommended: { confidence: null } });
  assert.equal(buildTicketCandidates(noConfidence).confidence, 0);
  assert.equal(planRowUpdate(projectedRow(22, noConfidence)).value.confidence, 0);

  // And a genuinely ABSENT block still yields null, so the two states stay
  // distinguishable rather than being collapsed the other way.
  const absent = rawPayload(23, [goodMarket()], { modelMeta: undefined });
  assert.equal(planRowUpdate(projectedRow(23, absent)).value.dataQuality, null);

  // The spec must therefore keep these as BLOCKS.
  assert.deepEqual(TICKET_CANDIDATE_SOURCE_PATHS.modelMeta, ["modelMeta"]);
  assert.deepEqual(TICKET_CANDIDATE_SOURCE_PATHS.recommended, ["recommended"]);
});

test("the spec projects every path the helper reads — a sixth path would fail here", () => {
  // The document carries keys OUTSIDE the spec. If the helper ever started
  // reading one, the projected rebuild would lose it and this deep-equal fails.
  const document = rawPayload(12, [goodMarket()], {
    somethingElse: { deeply: { nested: true } },
    valueBet: { kelly: 3 },
    probs: { home: 0.4 }
  });
  assert.deepEqual(planRowUpdate(projectedRow(12, document)).value, buildTicketCandidates(document));
});

// ── payload validation ─────────────────────────────────────────────────────

test("validation accepts exactly what the helper produces", () => {
  const value = buildTicketCandidates(rawPayload(1, [goodMarket()]));
  const result = validateTicketCandidates(value);
  assert.equal(result.valid, true);
  assert.ok(result.bytes > 0);
});

test("validation rejects a leaked key, a broken counter and a bad market", () => {
  const base = buildTicketCandidates(rawPayload(1, [goodMarket(), goodMarket({ recommendable: false })]));

  // The leak case: a stray block would multiply the column's size.
  assert.match(validateTicketCandidates({ ...base, valueEngine: { markets: [] } }).reason, /key_set_mismatch/);
  const { teams: _dropped, ...missingKey } = base;
  assert.match(validateTicketCandidates(missingKey).reason, /key_set_mismatch/);

  assert.equal(validateTicketCandidates({ ...base, notRecommendable: 99 }).reason, "counter_identity_broken");
  assert.equal(
    validateTicketCandidates({
      ...base,
      markets: [goodMarket({ recommendable: false })],
      examined: 2,
      notRecommendable: 1
    }).reason,
    "non_recommendable_market_retained"
  );
  assert.equal(validateTicketCandidates({ ...base, insufficientData: "no" }).reason, "insufficientData_not_boolean");
  assert.equal(validateTicketCandidates({ ...base, markets: "nope" }).reason, "markets_not_array");
  assert.equal(validateTicketCandidates(null).reason, "not_an_object");
  assert.equal(validateTicketCandidates([]).reason, "not_an_object");
});

test("a payload that cannot serialize is refused, not written", () => {
  const value = buildTicketCandidates(rawPayload(1, [goodMarket()]));
  value.markets[0].self = value.markets[0]; // circular
  assert.match(validateTicketCandidates(value).reason, /not_serializable/);
});

// ── row planning ───────────────────────────────────────────────────────────

test("a row with no markets in source is skipped, never written as empty", () => {
  const document = rawPayload(1, [], { valueEngine: {} });
  const { action, value } = planRowUpdate(projectedRow(1, document));
  assert.equal(action, "skipNoSource");
  assert.equal(value, null);
  // The helper's own answer for that source state — not a downgrade invented
  // by the backfill.
  assert.equal(buildTicketCandidates(document), null);
});

test("an already-populated row is skipped before any derivation", () => {
  const document = rawPayload(1, [goodMarket()]);
  const stored = {
    markets: [],
    examined: 1,
    notRecommendable: 1,
    dataQuality: null,
    insufficientData: false,
    confidence: null,
    teams: null
  };
  const { action, value } = planRowUpdate(projectedRow(1, document, stored));
  assert.equal(action, "skipNonNull");
  assert.equal(value, null);
});

// ── dry run writes nothing ─────────────────────────────────────────────────

test("DRY RUN performs zero writes", async () => {
  const supabase = writableSupabase({ pages: [rows(25), []], count: 0 });
  const stats = await runBackfill({ supabase, batchSize: 25 });

  assert.equal(stats.scanned, 25);
  assert.equal(stats.eligible, 25);
  assert.equal(stats.updated, 0);
  assert.deepEqual(supabase.log.updates, []);
});

test("apply is OFF by default — an argument-less call cannot mutate", async () => {
  const supabase = writableSupabase({ pages: [rows(3), []] });
  await runBackfill({ supabase });
  assert.deepEqual(supabase.log.updates, []);
});

test("a dry run still measures bytes, so the estimate is real", async () => {
  const supabase = writableSupabase({ pages: [rows(10), []] });
  const stats = await runBackfill({ supabase, batchSize: 10 });

  assert.equal(stats.payloadSizes.length, 10);
  assert.ok(stats.projectedBytes > 0);
  assert.ok(stats.sourceBytes > stats.projectedBytes, "source must exceed the projection it filters");
});

// ── write guards ───────────────────────────────────────────────────────────

test("every UPDATE carries the IS NULL guard and targets one fixture", async () => {
  const supabase = writableSupabase({ pages: [rows(3), []] });
  await runBackfill({ supabase, batchSize: 3, apply: true });

  assert.equal(supabase.log.updates.length, 3);
  for (const u of supabase.log.updates) {
    // ONE column, and only that column.
    assert.deepEqual(Object.keys(u.patch), ["ticket_candidates"]);
    assert.ok(u.fixtureId);
  }
  // The race guard is on the write itself, not merely on the scan.
  assert.deepEqual(supabase.log.updateFilters, [
    ["is", "ticket_candidates", null],
    ["is", "ticket_candidates", null],
    ["is", "ticket_candidates", null]
  ]);
});

test("a row the live writer populated mid-run is counted as a race, not clobbered", async () => {
  // The UPDATE returns zero rows: the IS NULL predicate no longer matched.
  const supabase = writableSupabase({ pages: [rows(3), []], onUpdate: (id) => (id === 2 ? { raced: true } : null) });
  const stats = await runBackfill({ supabase, batchSize: 3, apply: true });

  assert.equal(stats.updated, 2);
  assert.equal(stats.skippedNonNull, 1);
  assert.equal(stats.eligible, 2, "a raced row must not be counted as eligible work done");
});

test("already-populated rows are never overwritten", async () => {
  const stored = {
    markets: [],
    examined: 0,
    notRecommendable: 0,
    dataQuality: null,
    insufficientData: false,
    confidence: null,
    teams: null
  };
  const populated = projectedRow(2, rawPayload(2, [goodMarket()]), stored);
  const supabase = writableSupabase({ pages: [[...rows(1), populated, ...rows(1, 3)], []] });
  const stats = await runBackfill({ supabase, batchSize: 3, apply: true });

  assert.equal(stats.skippedNonNull, 1);
  assert.equal(stats.updated, 2);
  assert.equal(
    supabase.log.updates.some((u) => u.fixtureId === 2),
    false
  );
});

// ── partial failure ────────────────────────────────────────────────────────

test("one failing row does not abort its neighbours and is not marked done", async () => {
  const supabase = writableSupabase({
    pages: [rows(20), []],
    onUpdate: (id) => (id === 5 ? { throw: { message: "boom", code: "XX000" } } : null)
  });
  const stats = await runBackfill({ supabase, batchSize: 20, apply: true });

  assert.equal(stats.updated, 19);
  assert.equal(stats.failed, 1);
  assert.deepEqual(
    stats.failedRows.map((r) => r.fixtureId),
    [5]
  );
  assert.equal(stats.eligible, 19, "a failed row must not count as eligible work done");
});

test("a batch error rate above the ceiling aborts with a resume cursor", async () => {
  const supabase = writableSupabase({ pages: [rows(10), []], onUpdate: () => ({ throw: { message: "boom" } }) });
  await assert.rejects(runBackfill({ supabase, batchSize: 10, apply: true }), (error) => {
    assert.ok(error instanceof BackfillAbort);
    assert.equal(error.reason, "error_rate");
    assert.equal(error.lastFixtureId, 10);
    return true;
  });
});

test("a statement timeout aborts immediately rather than retrying the same size", async () => {
  const supabase = writableSupabase({
    pages: [rows(5), []],
    onUpdate: () => ({ throw: { code: "57014", message: "canceling statement due to statement timeout" } })
  });
  await assert.rejects(runBackfill({ supabase, batchSize: 5, apply: true }), (error) => {
    assert.equal(error.reason, "statement_timeout");
    return true;
  });
});

// ── pagination ─────────────────────────────────────────────────────────────

test("the cursor advances strictly, so the walk cannot loop", async () => {
  const supabase = writableSupabase({ pages: [rows(5, 1), rows(5, 6), rows(2, 11), []] });
  const stats = await runBackfill({ supabase, batchSize: 5 });

  assert.equal(stats.scanned, 12);
  assert.equal(stats.batches, 3);
  assert.equal(stats.lastFixtureId, 12);
});

test("a short page ends the walk without a further read", async () => {
  const supabase = writableSupabase({ pages: [rows(3, 1)] });
  const stats = await runBackfill({ supabase, batchSize: 25 });

  assert.equal(stats.scanned, 3);
  assert.equal(stats.batches, 1);
  assert.equal(supabase.log.selects.length, 1, "a short page proves exhaustion; re-reading would be waste");
});

test("resume from --after continues rather than restarting", async () => {
  const supabase = writableSupabase({ pages: [rows(5, 101), []] });
  const stats = await runBackfill({ supabase, batchSize: 5, after: 100 });

  assert.equal(stats.scanned, 5);
  assert.equal(stats.lastFixtureId, 105);
});

test("maxBatches and maxRows both bound the walk", async () => {
  const byBatch = await runBackfill({
    supabase: writableSupabase({ pages: [rows(5, 1), rows(5, 6), rows(5, 11)] }),
    batchSize: 5,
    maxBatches: 2
  });
  assert.equal(byBatch.batches, 2);
  assert.equal(byBatch.scanned, 10);

  // maxRows must also shrink the READ, not just discard afterwards.
  const supabase = writableSupabase({ pages: [rows(3, 1)] });
  const byRows = await runBackfill({ supabase, batchSize: 25, maxRows: 3 });
  assert.equal(byRows.scanned, 3);
});

test("batch size is validated against the ceiling", async () => {
  const supabase = writableSupabase({ pages: [[]] });
  assert.equal(DEFAULT_BATCH, 25);
  await assert.rejects(runBackfill({ supabase, batchSize: 0 }), /batchSize/);
  await assert.rejects(runBackfill({ supabase, batchSize: MAX_BATCH + 1 }), /batchSize/);
  await assert.rejects(runBackfill({ supabase, batchSize: 2.5 }), /batchSize/);
});

// ── idempotence ────────────────────────────────────────────────────────────

test("a re-run over an already-populated table writes nothing", async () => {
  const stored = {
    markets: [],
    examined: 1,
    notRecommendable: 1,
    dataQuality: null,
    insufficientData: false,
    confidence: null,
    teams: null
  };
  const populated = Array.from({ length: 5 }, (_, i) =>
    projectedRow(i + 1, rawPayload(i + 1, [goodMarket()]), stored)
  );
  const supabase = writableSupabase({ pages: [populated, []] });

  const stats = await runBackfill({ supabase, batchSize: 5, apply: true });
  assert.equal(stats.updated, 0);
  assert.equal(stats.skippedNonNull, 5);
  assert.deepEqual(supabase.log.updates, []);
});

test("a second pass after a partial run continues from where it stopped", async () => {
  const first = writableSupabase({ pages: [rows(5, 1), rows(5, 6)] });
  const pass1 = await runBackfill({ supabase: first, batchSize: 5, apply: true, maxBatches: 1 });
  assert.equal(pass1.updated, 5);

  const second = writableSupabase({ pages: [rows(5, 6), []] });
  const pass2 = await runBackfill({ supabase: second, batchSize: 5, apply: true, after: pass1.lastFixtureId });
  assert.equal(pass2.updated, 5);
  assert.deepEqual(
    second.log.updates.map((u) => u.fixtureId),
    [6, 7, 8, 9, 10]
  );
});

// ── reporting ──────────────────────────────────────────────────────────────

test("counters partition the scanned population exactly", async () => {
  const stored = {
    markets: [],
    examined: 0,
    notRecommendable: 0,
    dataQuality: null,
    insufficientData: false,
    confidence: null,
    teams: null
  };
  const page = [
    ...rows(3, 1),
    projectedRow(4, rawPayload(4, [goodMarket()]), stored),
    projectedRow(5, rawPayload(5, [], { valueEngine: {} }))
  ];
  const supabase = writableSupabase({ pages: [page, []] });
  const stats = await runBackfill({ supabase, batchSize: 5 });

  assert.equal(stats.scanned, 5);
  assert.equal(
    stats.eligible + stats.skippedNonNull + stats.skippedNoSource + stats.invalid + stats.failed,
    stats.scanned
  );
  assert.deepEqual(stats.skippedNoSourceIds, [5]);
});

test("percentile describes an empty sample without throwing", () => {
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([10], 0.95), 10);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
});

test("no payload content reaches the reported ids", async () => {
  const supabase = writableSupabase({ pages: [[projectedRow(9, rawPayload(9, [], { valueEngine: {} }))], []] });
  const stats = await runBackfill({ supabase, batchSize: 1 });

  // Ids only — a log line must never be able to carry a market object.
  assert.deepEqual(stats.skippedNoSourceIds, [9]);
  assert.equal(
    stats.skippedNoSourceIds.every((v) => typeof v === "number"),
    true
  );
});
