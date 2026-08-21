import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SETTLEMENT_ROW_COLUMNS,
  SETTLEMENT_SELECT,
  isSettlementRowComplete,
  rehydrateSettlementRow
} from "../server-utils/predictionsHistory.js";
import {
  attachCardMarketsToPayload,
  resolveRecommendedValidation
} from "../server-utils/cardMarketSettlement.js";
import {
  deriveMutableHistoryListColumns,
  MUTABLE_COLUMNS,
  IMMUTABLE_COLUMNS
} from "../server-utils/historyListColumns.js";

/**
 * D8 — settlement reads the promoted fixture snapshot, not raw_payload.
 *
 * D7 measured the failure: scan 3 selected raw_payload for all 472 FINAL rows in one
 * statement at ~353 KB/row, and production reproduces the abort at a quarter of that
 * (limit=250 → 10,441 ms → 57014 statement timeout, versus 269 ms for the promoted
 * projection). Scan 3 is the only pass that can settle Corners / Shots / SOT / Cards,
 * so when it threw those families stayed pending while score-derived families — settled
 * by the smaller scan 1 — went through. Every pending FINAL row in production was a
 * totals family; not one was score-derived.
 *
 * These tests pin the read path, and pin old-vs-new equality per family so the
 * projection cannot quietly change a verdict.
 */

const HISTORY_SOURCE = readFileSync(new URL("../api/history.js", import.meta.url), "utf8");

/**
 * Comments explain the very read these tests forbid, so they are stripped before any
 * assertion about what the CODE does. Otherwise a comment saying "never raw_payload"
 * would fail the test that checks raw_payload is never read.
 */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
}

/** The scan-3 block, isolated so assertions about it cannot match scans 1 or 2. */
function scanThreeSource() {
  const start = HISTORY_SOURCE.indexOf("const finishedRows = [];");
  assert.ok(start > 0, "scan 3 (finishedRows) not found in api/history.js");
  const end = HISTORY_SOURCE.indexOf("settlement.finishedScanned", start);
  assert.ok(end > start, "end of the scan-3 collection block not found");
  return codeOnly(HISTORY_SOURCE.slice(start, end));
}

/* ------------------------------------------------- 1. scan 3 reads no document */

test("scan 3 does not select raw_payload", () => {
  const block = scanThreeSource();
  assert.equal(
    /raw_payload/.test(block),
    false,
    "scan 3 reintroduced raw_payload — this is the exact read that produced 57014"
  );
  assert.ok(block.includes("SETTLEMENT_SELECT"), "scan 3 must project the promoted columns");
  assert.ok(
    block.includes("rehydrateSettlementRow"),
    "scan 3 must rebuild the settlement shape from columns"
  );
});

test("scan 3 does not write raw_payload back", () => {
  // Writing a payload rebuilt from columns would truncate every key the projection
  // does not carry (probs, marketOdds, valueEngine, momentum, ...).
  const start = HISTORY_SOURCE.indexOf("cardUpdates.push({");
  assert.ok(start > 0, "the scan-3 write was not found");
  const block = codeOnly(HISTORY_SOURCE.slice(start, HISTORY_SOURCE.indexOf("});", start)));
  assert.equal(
    /^\s*raw_payload:/m.test(block),
    false,
    "scan 3 writes raw_payload again — it no longer reads the full document, so it must not persist one"
  );
});

test("the settlement projection carries every column settlement reads, and no JSONB document", () => {
  for (const column of [
    "fixture_id",
    "match_status",
    "score_home",
    "score_away",
    "validation",
    "recommended_pick",
    "recommended_family",
    "card_markets",
    "card_market_validations",
    "corners_total",
    "shots_on_target_total",
    "shots_total",
    "cards_total",
    "cards_points",
    "first_half_goals",
    "has_first_half_probs"
  ]) {
    assert.ok(SETTLEMENT_ROW_COLUMNS.includes(column), `settlement select must keep: ${column}`);
  }
  const bareDocument = /(^|[\s,])raw_payload(\s*,|$)/;
  assert.equal(
    bareDocument.test(SETTLEMENT_SELECT),
    false,
    "SETTLEMENT_SELECT reintroduced a wholesale raw_payload read"
  );
});

test("every mutable settlement column is present in the projection", () => {
  // The interlock: promote a column that settlement writes but does not select and it
  // would be derived from an absent source and written back as null.
  for (const column of MUTABLE_COLUMNS) {
    assert.ok(
      SETTLEMENT_ROW_COLUMNS.includes(column),
      `MUTABLE_COLUMNS gained "${column}" but the settlement projection does not read it`
    );
  }
});

/* ------------------------------------------- 2. rehydration produces the shape */

const FULL_ROW = Object.freeze({
  fixture_id: 4242,
  kickoff_at: "2026-08-14T18:30:00+00:00",
  match_status: "FT",
  score_home: 2,
  score_away: 1,
  validation: "pending",
  recommended_pick: "Over 7.5",
  recommended_family: "Corners",
  card_markets: { recommended: { pick: "Over 7.5", family: "Corners" }, goals: null, corners: null, shots: null },
  card_market_validations: { recommended: "pending", goals: null, corners: null, shots: null },
  corners_total: 9,
  shots_on_target_total: 8,
  shots_total: 23,
  cards_total: 4,
  cards_points: 5,
  first_half_goals: 1,
  has_first_half_probs: true
});

test("rehydrateSettlementRow rebuilds the shape the settlement helpers expect", () => {
  const row = rehydrateSettlementRow(FULL_ROW);
  assert.equal(row.fixture_id, 4242);
  assert.equal(row.match_status, "FT");
  assert.equal(row.score_home, 2);
  assert.equal(row.score_away, 1);
  assert.equal(row.validation, "pending");
  assert.equal(row.recommended_pick, "Over 7.5");
  assert.deepEqual(row.raw_payload.recommended, { pick: "Over 7.5", family: "Corners" });
  assert.deepEqual(row.raw_payload.cardMarkets, FULL_ROW.card_markets);
  assert.deepEqual(row.raw_payload.cardMarketValidations, FULL_ROW.card_market_validations);
  assert.deepEqual(row.raw_payload.marketResults, {
    cornersTotal: 9,
    shotsOnTargetTotal: 8,
    shotsTotal: 23,
    cardsTotal: 4,
    cardsPoints: 5,
    firstHalfGoals: 1
  });
  assert.deepEqual(row.raw_payload.probs, { firstHalf: {} });
});

test("rehydration never carries probs or marketOdds beyond the first-half predicate", () => {
  const row = rehydrateSettlementRow(FULL_ROW);
  assert.equal(row.raw_payload.marketOdds, undefined);
  // probs exists ONLY to answer Boolean(probs?.firstHalf); it must carry no numbers.
  assert.deepEqual(Object.keys(row.raw_payload.probs), ["firstHalf"]);
  assert.deepEqual(row.raw_payload.probs.firstHalf, {});
});

test("a NULL total stays absent — it never becomes 0", () => {
  const row = rehydrateSettlementRow({ ...FULL_ROW, corners_total: null, cards_total: null });
  assert.equal(row.raw_payload.marketResults.cornersTotal, undefined);
  assert.equal(row.raw_payload.marketResults.cardsTotal, undefined);
  assert.equal(row.raw_payload.marketResults.shotsTotal, 23);
  // And the consequence that matters: an Under line cannot settle off a missing total.
  assert.equal(
    resolveRecommendedValidation({
      pick: "Under 11.5",
      family: "Corners",
      status: "FT",
      score: { home: 2, away: 1 },
      marketTotals: row.raw_payload.marketResults
    }),
    "pending"
  );
});

test("an observed zero survives rehydration as zero", () => {
  const row = rehydrateSettlementRow({ ...FULL_ROW, corners_total: 0, cards_total: 0, first_half_goals: 0 });
  assert.equal(row.raw_payload.marketResults.cornersTotal, 0);
  assert.equal(row.raw_payload.marketResults.cardsTotal, 0);
  assert.equal(row.raw_payload.marketResults.firstHalfGoals, 0);
  assert.equal(
    resolveRecommendedValidation({
      pick: "Under 11.5",
      family: "Corners",
      status: "FT",
      score: { home: 2, away: 1 },
      marketTotals: row.raw_payload.marketResults
    }),
    "win",
    "0 corners must settle Under 11.5 as a win, not hold it pending"
  );
});

test("no totals at all leaves marketResults absent, exactly as the payload had it", () => {
  const row = rehydrateSettlementRow({
    ...FULL_ROW,
    corners_total: null,
    shots_on_target_total: null,
    shots_total: null,
    cards_total: null,
    cards_points: null,
    first_half_goals: null
  });
  assert.equal(row.raw_payload.marketResults, undefined);
});

test("has_first_half_probs null or false yields no probs block", () => {
  assert.equal(rehydrateSettlementRow({ ...FULL_ROW, has_first_half_probs: null }).raw_payload.probs, undefined);
  assert.equal(rehydrateSettlementRow({ ...FULL_ROW, has_first_half_probs: false }).raw_payload.probs, undefined);
});

test("rehydrateSettlementRow tolerates null and undefined rows", () => {
  assert.deepEqual(rehydrateSettlementRow(null).raw_payload, {});
  assert.deepEqual(rehydrateSettlementRow(undefined).raw_payload, {});
});

/* ------------------------------------------------ 3. OLD vs NEW semantic parity */

/**
 * The parity harness. `payload` is the full document the OLD path read; `columns` is
 * the promoted snapshot the NEW path reads. Both go through the identical settlement
 * call, and the verdicts must match.
 */
function parity({ payload, columns, status, score }) {
  const oldEnriched = attachCardMarketsToPayload(
    { ...payload, status, score },
    { status, score, marketTotals: payload.marketResults || {} }
  );
  const rehydrated = rehydrateSettlementRow(columns);
  const newEnriched = attachCardMarketsToPayload(
    { ...rehydrated.raw_payload, status, score },
    { status, score, marketTotals: rehydrated.raw_payload.marketResults || {} }
  );
  return {
    old: oldEnriched.cardMarketValidations,
    fresh: newEnriched.cardMarketValidations,
    oldColumns: deriveMutableHistoryListColumns(oldEnriched),
    freshColumns: deriveMutableHistoryListColumns(newEnriched)
  };
}

/** One production-shaped case per family. */
const CASES = [
  {
    name: "Corners — Over 7.5 against 9 corners",
    family: "Corners",
    pick: "Over 7.5",
    status: "FT",
    score: { home: 1, away: 1 },
    results: { cornersTotal: 9 },
    expect: "win"
  },
  {
    name: "Corners — Under 11.5 against 16 corners",
    family: "Corners",
    pick: "Under 11.5",
    status: "FT",
    score: { home: 4, away: 3 },
    results: { cornersTotal: 16 },
    expect: "loss"
  },
  {
    name: "Shots — Under 32.5 against 35 shots",
    family: "Shots",
    pick: "Shots Under 32.5",
    status: "FT",
    score: { home: 3, away: 1 },
    results: { shotsTotal: 35 },
    expect: "loss"
  },
  {
    name: "Shots on Target — Over 6.5 against 6 SOT",
    family: "Shots on Target",
    pick: "SOT Over 6.5",
    status: "FT",
    score: { home: 1, away: 1 },
    results: { shotsOnTargetTotal: 6 },
    expect: "loss"
  },
  {
    name: "Cards — Under 3.5 against 3 cards",
    family: "Cards",
    pick: "Cards Under 3.5",
    status: "FT",
    score: { home: 1, away: 2 },
    results: { cardsTotal: 3, cardsPoints: 4 },
    expect: "win"
  },
  {
    name: "Over/Under — Peste 2.5 against 3 goals",
    family: "Over/Under",
    pick: "Peste 2.5",
    status: "FT",
    score: { home: 2, away: 1 },
    results: {},
    expect: "win"
  },
  {
    name: "Double Chance — 1X on a draw",
    family: "Double Chance",
    pick: "1X",
    status: "FT",
    score: { home: 1, away: 1 },
    results: {},
    expect: "win"
  },
  {
    name: "1X2 — 1 on an away win",
    family: "1X2",
    pick: "1",
    status: "FT",
    score: { home: 0, away: 2 },
    results: {},
    expect: "loss"
  },
  {
    name: "BTTS — GG on 0-0",
    family: "BTTS",
    pick: "GG",
    status: "FT",
    score: { home: 0, away: 0 },
    results: {},
    expect: "loss"
  },
  {
    name: "AET is final and settles",
    family: "Over/Under",
    pick: "Peste 2.5",
    status: "AET",
    score: { home: 2, away: 2 },
    results: {},
    expect: "win"
  },
  {
    name: "PEN is final and settles",
    family: "Double Chance",
    pick: "1X",
    status: "PEN",
    score: { home: 1, away: 1 },
    results: {},
    expect: "win"
  },
  {
    name: "non-final (1H) holds everything pending",
    family: "Corners",
    pick: "Over 7.5",
    status: "1H",
    score: { home: 1, away: 0 },
    results: { cornersTotal: 9 },
    expect: "pending"
  },
  {
    name: "missing total holds pending, both paths alike",
    family: "Corners",
    pick: "Over 7.5",
    status: "FT",
    score: { home: 1, away: 1 },
    results: {},
    expect: "pending"
  }
];

for (const c of CASES) {
  test(`old and new agree — ${c.name}`, () => {
    const cardMarkets = {
      recommended: { pick: c.pick, family: c.family },
      goals: null,
      corners: null,
      shots: null
    };
    const payload = {
      recommended: { pick: c.pick, family: c.family },
      cardMarkets,
      cardMarketValidations: { recommended: "pending", goals: null, corners: null, shots: null },
      marketResults: c.results,
      // Present in the document, absent from the projection by design — proving the
      // new path does not need them.
      probs: { firstHalf: { pO05: 60 }, corners: { total: { o8_5: 55 } } },
      marketOdds: { corners: { odd: 1.9, line: 8.5, pick: "Over" } }
    };
    const columns = {
      fixture_id: 1,
      match_status: c.status,
      score_home: c.score.home,
      score_away: c.score.away,
      validation: "pending",
      recommended_pick: c.pick,
      recommended_family: c.family,
      card_markets: cardMarkets,
      card_market_validations: payload.cardMarketValidations,
      corners_total: c.results.cornersTotal ?? null,
      shots_on_target_total: c.results.shotsOnTargetTotal ?? null,
      shots_total: c.results.shotsTotal ?? null,
      cards_total: c.results.cardsTotal ?? null,
      cards_points: c.results.cardsPoints ?? null,
      first_half_goals: c.results.firstHalfGoals ?? null,
      has_first_half_probs: true
    };

    const { old, fresh, oldColumns, freshColumns } = parity({
      payload,
      columns,
      status: c.status,
      score: c.score
    });

    assert.equal(old.recommended, c.expect, "the OLD path changed — the case itself is wrong");
    assert.equal(fresh.recommended, c.expect, "the promoted-column path graded differently");
    assert.deepEqual(fresh, old, "validation block diverged between document and columns");
    assert.deepEqual(freshColumns, oldColumns, "written columns diverged between the two paths");
  });
}

test("a legacy row with no recommended_family still routes by line shape", () => {
  // 511 production rows have recommended_family NULL. The non-goals-line heuristic in
  // resolveRecommendedValidation must survive the projection.
  const columns = {
    match_status: "FT",
    score_home: 1,
    score_away: 1,
    recommended_pick: "Over 7.5",
    recommended_family: null,
    card_markets: { recommended: { pick: "Over 7.5", family: null } },
    corners_total: 9,
    has_first_half_probs: true
  };
  const r = rehydrateSettlementRow(columns);
  assert.equal(r.raw_payload.recommended.family, null);
  assert.equal(
    resolveRecommendedValidation({
      pick: "Over 7.5",
      family: r.raw_payload.recommended.family,
      status: "FT",
      score: { home: 1, away: 1 },
      marketTotals: r.raw_payload.marketResults
    }),
    "win",
    "7.5 is not a goals line, so it must still be read as Corners"
  );
});

/* ------------------------------------------------------- 4. chunking guardrail */

test("the scan chunk default is small enough to commit", () => {
  const m = HISTORY_SOURCE.match(/HISTORY_SYNC_SCAN_CHUNK \|\| (\d+)/);
  assert.ok(m, "HISTORY_SYNC_SCAN_CHUNK default not found");
  const value = Number(m[1]);
  assert.ok(
    value <= 100,
    `scan chunk default is ${value}; 250 rows of raw_payload reproducibly returns 57014, ` +
      `and scans 1 and 2 still read the document — 100 is the largest page measured to commit`
  );
});

test("has_first_half_probs is immutable and cannot be written by settlement", () => {
  assert.ok(IMMUTABLE_COLUMNS.includes("has_first_half_probs"));
  assert.equal(MUTABLE_COLUMNS.includes("has_first_half_probs"), false);
  const written = deriveMutableHistoryListColumns({ probs: { firstHalf: { pO05: 60 } } });
  assert.equal(
    "has_first_half_probs" in written,
    false,
    "a settlement writer could overwrite a creation-time column"
  );
});

/* --------------------------------- 5. the backfill can actually seed the columns */

/**
 * A promoted column is only real once THREE places agree: the derivation knows how to
 * compute it, settlement selects it, and the backfill can seed it for historical rows.
 * Mutation testing found the third leg unguarded — dropping the new columns from
 * BACKFILL_SELECT left every suite green while silently making the backfill a no-op
 * for them, which is exactly the "backfill skips rows" failure it must not have.
 */
test("the backfill projects every promoted column it is expected to write", async () => {
  const { BACKFILL_SELECT } = await import("../server-utils/backfill/historyListColumns.js");
  for (const column of [...IMMUTABLE_COLUMNS, ...MUTABLE_COLUMNS]) {
    assert.ok(
      new RegExp(`(^|[\\s,])${column}(\\s*,|$)`).test(BACKFILL_SELECT),
      `BACKFILL_SELECT does not read "${column}" — the backfill cannot reconcile a column it never selects`
    );
  }
});

test("the backfill projects every payload source the derivation reads", async () => {
  const { BACKFILL_SELECT } = await import("../server-utils/backfill/historyListColumns.js");
  for (const [alias, source] of [
    ["src_recommended", "raw_payload->recommended"],
    ["src_logos", "raw_payload->logos"],
    ["src_card_market_validations", "raw_payload->cardMarketValidations"],
    ["src_card_markets", "raw_payload->cardMarkets"],
    // The four 057 totals all live inside marketResults, so this one projection
    // covers shots_total / cards_total / cards_points / first_half_goals.
    ["src_market_results", "raw_payload->marketResults"],
    ["src_probs_first_half", "raw_payload->probs->firstHalf"]
  ]) {
    assert.ok(
      BACKFILL_SELECT.includes(`${alias}:${source}`),
      `BACKFILL_SELECT lost the "${alias}" projection (${source})`
    );
  }
  // Still never the whole document — that read is the reason this work exists.
  assert.equal(
    /(^|[\s,])raw_payload(\s*,|$)/.test(BACKFILL_SELECT),
    false,
    "BACKFILL_SELECT reintroduced a wholesale raw_payload read"
  );
});

test("the backfill plans the new columns from a historical row", async () => {
  const { planRowUpdate } = await import("../server-utils/backfill/historyListColumns.js");
  const { update } = planRowUpdate({
    fixture_id: 7,
    // Columns as they are today: never seeded.
    shots_total: null,
    cards_total: null,
    cards_points: null,
    first_half_goals: null,
    has_first_half_probs: null,
    corners_total: null,
    shots_on_target_total: null,
    card_markets: null,
    card_market_validations: null,
    // Sources as the document has them.
    src_market_results: {
      cornersTotal: 9,
      shotsOnTargetTotal: 8,
      shotsTotal: 23,
      cardsTotal: 4,
      cardsPoints: 5,
      firstHalfGoals: 0
    },
    src_probs_first_half: { pO05: 60 }
  });
  assert.ok(update, "the backfill planned no write for a row whose sources are all present");
  assert.equal(update.shots_total, 23);
  assert.equal(update.cards_total, 4);
  assert.equal(update.cards_points, 5);
  assert.equal(update.first_half_goals, 0, "an observed 0 must be written, not treated as absent");
  assert.equal(update.has_first_half_probs, true);
});

test("the backfill is a no-op on a row it has already seeded (safe to re-run)", async () => {
  const { planRowUpdate } = await import("../server-utils/backfill/historyListColumns.js");
  const seeded = {
    fixture_id: 7,
    shots_total: 23,
    cards_total: 4,
    cards_points: 5,
    first_half_goals: 0,
    has_first_half_probs: true,
    corners_total: 9,
    shots_on_target_total: 8,
    card_markets: null,
    card_market_validations: null,
    src_market_results: {
      cornersTotal: 9,
      shotsOnTargetTotal: 8,
      shotsTotal: 23,
      cardsTotal: 4,
      cardsPoints: 5,
      firstHalfGoals: 0
    },
    src_probs_first_half: { pO05: 60 }
  };
  assert.equal(planRowUpdate(seeded).update, null, "a second backfill run would rewrite settled rows");
});

test("the backfill never nulls a seeded total from an absent source", async () => {
  const { planRowUpdate } = await import("../server-utils/backfill/historyListColumns.js");
  const { update } = planRowUpdate({
    fixture_id: 7,
    cards_total: 4,
    shots_total: 23,
    src_market_results: null,
    src_probs_first_half: null
  });
  assert.equal(update, null, "an absent source must never erase a value the column already holds");
});

/* ---------------------------------------------------------------------------
 * D8b — the allSettled skip must not hide an ungraded top-level validation.
 * Production shape from the D8 verification: fixture 1607172, Cards Under 3.5,
 * cards_total 3, card_market_validations all graded, validation still pending.
 * ------------------------------------------------------------------------- */

const CARDS_SKIPPED_ROW = Object.freeze({
  fixture_id: 1607172,
  kickoff_at: "2026-08-11T16:00:00+00:00",
  match_status: "FT",
  score_home: 4,
  score_away: 0,
  validation: "pending",
  recommended_pick: "Cards Under 3.5",
  recommended_family: "Cards",
  card_markets: { recommended: "Cards Under 3.5", goals: "Over 1.5", corners: "Over 8.5", shots: "Over 20.5" },
  card_market_validations: { goals: "win", shots: "win", corners: "win", recommended: "win" },
  corners_total: 11,
  shots_on_target_total: 12,
  shots_total: 43,
  cards_total: 3,
  cards_points: 30,
  first_half_goals: 2,
  has_first_half_probs: false
});

test("D8b: a row whose markets are graded but whose validation is pending is NOT complete", () => {
  const row = rehydrateSettlementRow(CARDS_SKIPPED_ROW);
  const complete = isSettlementRowComplete({
    picks: row.raw_payload.cardMarkets,
    storedValidations: row.raw_payload.cardMarketValidations,
    validation: row.validation
  });
  assert.equal(complete, false);
});

test("D8b: once the row falls through, the promoted cards total grades the pick", () => {
  const row = rehydrateSettlementRow(CARDS_SKIPPED_ROW);
  const validation = resolveRecommendedValidation({
    pick: row.recommended_pick,
    family: row.raw_payload.recommended.family,
    status: row.match_status,
    score: { home: row.score_home, away: row.score_away },
    marketTotals: { cardsTotal: row.raw_payload.marketResults.cardsTotal }
  });
  assert.equal(validation, "win");
  // And the sibling production row with 4 cards against Under 3.5 grades as a loss.
  assert.equal(
    resolveRecommendedValidation({ pick: "Cards Under 3.5", family: "Cards", status: "FT", score: { home: 1, away: 0 }, marketTotals: { cardsTotal: 4 } }),
    "loss"
  );
});

test("D8b: a fully graded row (markets AND validation) is complete and is skipped", () => {
  const row = rehydrateSettlementRow({ ...CARDS_SKIPPED_ROW, validation: "win" });
  assert.equal(
    isSettlementRowComplete({ picks: row.raw_payload.cardMarkets, storedValidations: row.raw_payload.cardMarketValidations, validation: "win" }),
    true
  );
  assert.equal(
    isSettlementRowComplete({ picks: row.raw_payload.cardMarkets, storedValidations: row.raw_payload.cardMarketValidations, validation: "loss" }),
    true
  );
});

test("D8b: a row with no recommended pick keeps the market-only completeness test", () => {
  const picks = { goals: "Over 1.5", corners: "Over 8.5" };
  assert.equal(isSettlementRowComplete({ picks, storedValidations: { goals: "win", corners: "loss" }, validation: "pending" }), true);
  assert.equal(isSettlementRowComplete({ picks, storedValidations: { goals: "win", corners: "pending" }, validation: "pending" }), false);
});

test("D8b: missing first-half data or absent stored validations are never complete", () => {
  const picks = { recommended: "Over 2.5" };
  assert.equal(isSettlementRowComplete({ picks, storedValidations: { recommended: "win" }, validation: "win", missingFirstHalf: true }), false);
  assert.equal(isSettlementRowComplete({ picks, storedValidations: null, validation: "win" }), false);
  assert.equal(isSettlementRowComplete({ picks, storedValidations: undefined, validation: "pending" }), false);
});

test("D8b: scan 3 uses the shared predicate and no longer carries the market-only allSettled block", () => {
  // The predicate must BE the skip condition — not be short-circuited beside it.
  assert.match(HISTORY_SOURCE, /if \(\s*isSettlementRowComplete\(\{/);
  assert.doesNotMatch(HISTORY_SOURCE, /(true|false)\s*(&&|\|\|)\s*isSettlementRowComplete/);
  assert.match(HISTORY_SOURCE, /validation: row\.validation,\s*missingFirstHalf: missingHt/);
  assert.doesNotMatch(HISTORY_SOURCE, /const allSettled =/);
});
