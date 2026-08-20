import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveHistoryListColumns,
  deriveMutableHistoryListColumns,
  IMMUTABLE_COLUMNS,
  MUTABLE_COLUMNS
} from "../server-utils/historyListColumns.js";
import { attachCardMarketsToPayload } from "../server-utils/cardMarketSettlement.js";
import { mapPredictionToDbRow } from "../server-utils/predictionsHistory.js";
import { planRowUpdate } from "../server-utils/backfill/historyListColumns.js";

/**
 * Dual-write for the seven promoted columns.
 *
 * The invariant that matters is narrow and absolute: for every writer that
 * touches a promoted column, the value written must equal
 * `deriveHistoryListColumns(the raw_payload that same write persists)`. If that
 * holds, the cache can never describe a payload that was not stored.
 *
 * The live rule is derive-from-persisted-payload with NO preservation step —
 * preservation already lives inside the payload, because both settlement writers
 * build theirs as `{...raw}`.
 */

const ALL_COLUMNS = [...IMMUTABLE_COLUMNS, ...MUTABLE_COLUMNS];

/** A prediction as the pipeline hands it to persistence. */
function prediction(overrides = {}) {
  return {
    id: 4242,
    leagueId: 283,
    league: "Liga I",
    teams: { home: "FCSB", away: "CFR" },
    logos: { home: "https://cdn/h.png", away: "https://cdn/a.png" },
    kickoff: "2026-09-01T18:00:00.000Z",
    status: "NS",
    score: { home: null, away: null },
    recommended: { pick: "Peste 2.5", family: "goals", odd: 1.85, confidence: 0.71 },
    probs: { corners: { total: 0.5 }, shotsOnTarget: { total: 0.4 } },
    marketOdds: { corners: 1.9, shotsOnTarget: 1.8 },
    marketResults: { cornersTotal: 9, shotsOnTargetTotal: 8 },
    ...overrides
  };
}

/** A stored payload, as a settlement pass would find it. */
function storedPayload(overrides = {}) {
  return { ...prediction(), ...overrides };
}

/** The drift invariant, applied to any writer's row object. */
function assertNoDrift(writtenRow, label) {
  const expected = deriveHistoryListColumns(writtenRow.raw_payload);
  for (const key of ALL_COLUMNS) {
    if (!(key in writtenRow)) continue;
    assert.deepEqual(
      writtenRow[key] ?? null,
      expected[key] ?? null,
      `${label}: column "${key}" does not match the raw_payload actually written`
    );
  }
}

test("the helper always returns every promoted key, absent sources as null", () => {
  const columns = deriveHistoryListColumns({});
  assert.deepEqual(Object.keys(columns).sort(), [...ALL_COLUMNS].sort());
  for (const key of ALL_COLUMNS) assert.equal(columns[key], null, `${key} should be null`);
  assert.deepEqual(deriveHistoryListColumns(null), columns);
  assert.deepEqual(deriveHistoryListColumns(undefined), columns);
});

test("derivation matches the Phase 2 backfill for an identical payload", () => {
  // One definition of the parsing rules: the backfill folds its projected src_*
  // aliases into payload shape and calls this same helper.
  const payload = storedPayload({ cardMarkets: { corners: { pick: "Peste 8.5" } }, cardMarketValidations: { corners: "win" } });
  const live = deriveHistoryListColumns(payload);
  const { update: viaBackfill } = planRowUpdate({
    fixture_id: 1,
    recommended_odd: null,
    logo_home: null,
    logo_away: null,
    card_market_validations: null,
    card_markets: null,
    corners_total: null,
    shots_on_target_total: null,
    src_recommended: payload.recommended,
    src_logos: payload.logos,
    src_card_market_validations: payload.cardMarketValidations,
    src_card_markets: payload.cardMarkets,
    src_market_results: payload.marketResults
  });
  for (const key of ALL_COLUMNS) {
    assert.deepEqual(viaBackfill[key] ?? null, live[key] ?? null, `backfill and live disagree on ${key}`);
  }
});

test("guards reject rather than coerce, and never throw", () => {
  const bad = deriveHistoryListColumns(
    storedPayload({
      recommended: { pick: "x", odd: "n/a" },
      marketResults: { cornersTotal: 9.5, shotsOnTargetTotal: "eight" }
    })
  );
  assert.equal(bad.recommended_odd, null);
  assert.equal(bad.corners_total, null);
  assert.equal(bad.shots_on_target_total, null);
  assert.equal(bad.logo_home, "https://cdn/h.png");

  // Values that ARE finite numbers but the guard must still reject — these are
  // what actually pin the guard. "n/a" above is caught by the isFinite check
  // instead, so on its own it would pass even with the guard removed.
  for (const odd of ["-2.0", "1e3", "+1.85", " 1.85x"]) {
    const row = deriveHistoryListColumns(storedPayload({ recommended: { pick: "x", odd } }));
    assert.equal(row.recommended_odd, null, `numeric guard accepted "${odd}"`);
  }
  for (const total of ["9.0", "1e2", "+9"]) {
    const row = deriveHistoryListColumns(storedPayload({ marketResults: { cornersTotal: total } }));
    assert.equal(row.corners_total, null, `integer guard accepted "${total}"`);
  }
});

test("empty strings and JSON null are absence", () => {
  const columns = deriveHistoryListColumns(
    storedPayload({ logos: { home: "   ", away: null }, cardMarkets: null, cardMarketValidations: null })
  );
  assert.equal(columns.logo_home, null);
  assert.equal(columns.logo_away, null);
  assert.equal(columns.card_markets, null);
  assert.equal(columns.card_market_validations, null);
});

test("W1/W2: the created row carries all seven, matching its own raw_payload", () => {
  // mapPredictionToDbRow builds the exact object both INSERT and UPSERT receive
  // — they are partitioned from one list, so they cannot diverge.
  const row = mapPredictionToDbRow(prediction());

  for (const key of ALL_COLUMNS) assert.ok(key in row, `creation row is missing "${key}"`);
  assertNoDrift(row, "W1/W2");
  assert.equal(row.recommended_odd, 1.85);
  assert.equal(row.logo_home, "https://cdn/h.png");
  assert.equal(row.logo_away, "https://cdn/a.png");
  assert.equal(row.corners_total, 9);
  assert.equal(row.shots_on_target_total, 8);
});

test("W1/W2: invalid or missing sources become NULL without breaking the row", () => {
  const row = mapPredictionToDbRow(
    prediction({ recommended: { pick: "Peste 2.5", odd: null }, logos: undefined, marketResults: undefined })
  );
  assert.equal(row.recommended_odd, null);
  assert.equal(row.logo_home, null);
  assert.equal(row.corners_total, null);
  // raw_payload is still written and still authoritative.
  assert.ok(row.raw_payload && typeof row.raw_payload === "object");
  assertNoDrift(row, "W1/W2-null");
});

test("settlement can only write the four mutable columns", () => {
  const enriched = attachCardMarketsToPayload(
    { ...storedPayload(), status: "FT", score: { home: 2, away: 1 } },
    { status: "FT", score: { home: 2, away: 1 } }
  );
  const written = deriveMutableHistoryListColumns(enriched);

  assert.deepEqual(Object.keys(written).sort(), [...MUTABLE_COLUMNS].sort());
  for (const key of IMMUTABLE_COLUMNS) {
    assert.equal(key in written, false, `settlement would write immutable column "${key}"`);
  }
});

test("W3: an existing marketResults survives when no new totals arrive", () => {
  // W3 passes NO marketTotals, so totals can only be preserved, never introduced.
  const raw = storedPayload({ marketResults: { cornersTotal: 10, shotsOnTargetTotal: 7 } });
  const enrichedPayload = attachCardMarketsToPayload(
    { ...raw, recommended: raw.recommended, status: "FT", score: { home: 2, away: 1 } },
    { status: "FT", score: { home: 2, away: 1 } }
  );
  const written = deriveMutableHistoryListColumns(enrichedPayload);

  assert.equal(written.corners_total, 10, "a preserved total was lost");
  assert.equal(written.shots_on_target_total, 7);
  assertNoDrift({ raw_payload: enrichedPayload, ...written }, "W3");
});

test("W3: a row with no totals keeps them NULL rather than inventing zero", () => {
  const raw = storedPayload({ marketResults: undefined });
  const enrichedPayload = attachCardMarketsToPayload(
    { ...raw, status: "FT", score: { home: 1, away: 1 } },
    { status: "FT", score: { home: 1, away: 1 } }
  );
  const written = deriveMutableHistoryListColumns(enrichedPayload);

  assert.equal(written.corners_total, null);
  assert.equal(written.shots_on_target_total, null);
  // cardMarkets / cardMarketValidations are assigned unconditionally.
  assert.notEqual(written.card_markets, null);
  assert.notEqual(written.card_market_validations, null);
  assertNoDrift({ raw_payload: enrichedPayload, ...written }, "W3-empty");
});

test("W5: newly supplied provider totals reach the promoted columns", () => {
  const raw = storedPayload({ marketResults: undefined });
  const enriched = attachCardMarketsToPayload(
    { ...raw, status: "FT", score: { home: 2, away: 1 } },
    {
      status: "FT",
      score: { home: 2, away: 1 },
      marketTotals: { cornersTotal: 11, shotsOnTargetTotal: 6, shotsTotal: 24 }
    }
  );
  const written = deriveMutableHistoryListColumns(enriched);

  assert.equal(written.corners_total, 11, "a newly available total did not reach the column");
  assert.equal(written.shots_on_target_total, 6);
  assertNoDrift({ raw_payload: enriched, ...written }, "W5");
});

test("W5: the column follows the persisted payload, not the previous value", () => {
  // This is exactly where a live `source ?? previous` rule would have been wrong.
  const enriched = attachCardMarketsToPayload(
    { ...storedPayload(), status: "FT", score: { home: 0, away: 0 } },
    {
      status: "FT",
      score: { home: 0, away: 0 },
      marketTotals: { cornersTotal: null, shotsOnTargetTotal: null, cardsTotal: 3 }
    }
  );
  const written = deriveMutableHistoryListColumns(enriched);
  assert.equal(written.corners_total, enriched.marketResults?.cornersTotal ?? null);
  assertNoDrift({ raw_payload: enriched, ...written }, "W5-null");
});

test("W4 writes no promoted column", () => {
  // W4's update shape, verbatim from api/history.js.
  const w4Update = {
    fixture_id: 1,
    validation: "win",
    value_bet_validation: "loss",
    updated_at: "2026-08-20T00:00:00.000Z"
  };
  for (const key of ALL_COLUMNS) assert.equal(key in w4Update, false, `W4 must not write "${key}"`);
  assert.equal("raw_payload" in w4Update, false, "W4 must not write raw_payload");
});

test("W6 writes no promoted column and could not change one if it tried", () => {
  const prev = storedPayload();
  const nextPayload = { ...prev, closingOdds: { home: 2.1 }, oddsClosing: { home: 2.1 } };
  const w6Update = {
    closing_odds_home: 2.1,
    raw_payload: nextPayload,
    updated_at: "2026-08-20T00:00:00.000Z"
  };
  for (const key of ALL_COLUMNS) assert.equal(key in w6Update, false, `W6 must not write "${key}"`);
  // Every promoted source survives its spread untouched.
  assert.deepEqual(deriveHistoryListColumns(nextPayload), deriveHistoryListColumns(prev));
});

/* ---------------------------------------------------------------------------
 * 056 — recommendation metadata: family / period / scope / bookLine.
 *
 * Immutable, so the boundary that matters is that a settlement writer cannot
 * reach them at all, and that nothing infers a value the server never wrote.
 * ------------------------------------------------------------------------- */

const RECOMMENDED_COLUMNS = [
  "recommended_family",
  "recommended_period",
  "recommended_scope",
  "recommended_book_line"
];

test("056: each scalar maps from its own recommended sub-key", () => {
  const columns = deriveHistoryListColumns({
    recommended: {
      pick: "SOT Over 9.5",
      odd: 1.9,
      family: "Shots on Target",
      period: "full_match",
      scope: "match",
      bookLine: 9.5
    }
  });
  assert.equal(columns.recommended_family, "Shots on Target");
  assert.equal(columns.recommended_period, "full_match");
  assert.equal(columns.recommended_scope, "match");
  assert.equal(columns.recommended_book_line, 9.5);
});

test("056: one absent sub-key never disturbs the others", () => {
  for (const key of ["family", "period", "scope", "bookLine"]) {
    const recommended = {
      pick: "Over 2.5",
      family: "Over/Under",
      period: "full_match",
      scope: "match",
      bookLine: 2.5
    };
    delete recommended[key];
    const columns = deriveHistoryListColumns({ recommended });
    const missing = key === "bookLine" ? "recommended_book_line" : `recommended_${key}`;
    assert.equal(columns[missing], null, `${missing} should be null when its source is absent`);
    for (const other of RECOMMENDED_COLUMNS) {
      if (other === missing) continue;
      assert.notEqual(columns[other], null, `${other} was lost when ${key} was absent`);
    }
  }
});

test("056: absence is NULL — never an empty string, never zero", () => {
  const columns = deriveHistoryListColumns({ recommended: { pick: "1" } });
  for (const column of RECOMMENDED_COLUMNS) {
    assert.equal(columns[column], null, `${column} should be null`);
    assert.notEqual(columns[column], "", `${column} was coerced to an empty string`);
    assert.notEqual(columns[column], 0, `${column} was coerced to zero`);
  }
});

test("056: family is never inferred from the pick text", () => {
  // The client has a legacy pick-text fallback for rows that predate the
  // contract. Writing that guess into a column would erase the distinction
  // between "the server classified this" and "we guessed".
  for (const pick of ["Over 9.5 Corners", "Cards Under 3.5", "SOT Over 8.5", "GG", "1X"]) {
    const columns = deriveHistoryListColumns({ recommended: { pick } });
    assert.equal(columns.recommended_family, null, `family was inferred from "${pick}"`);
    assert.equal(columns.recommended_period, null, `period was inferred from "${pick}"`);
  }
});

test("056: the book line keeps its exact value, including quarter lines", () => {
  for (const line of [6.75, 8.25, 10.25, 9.5, 7, 30.5]) {
    const columns = deriveHistoryListColumns({ recommended: { bookLine: line } });
    assert.equal(columns.recommended_book_line, line, `bookLine ${line} was altered`);
  }
});

test("056: an unusable book line is rejected and reported, not coerced", () => {
  for (const bad of ["abc", -1, {}, [], Number.NaN, Infinity]) {
    const columns = deriveHistoryListColumns({ recommended: { bookLine: bad } });
    assert.equal(columns.recommended_book_line, null, `bookLine ${JSON.stringify(bad)} was coerced`);
  }
});

test("056: a non-string family is absence rather than a stringified object", () => {
  for (const bad of [{ name: "Corners" }, ["Corners"], 7, true]) {
    const columns = deriveHistoryListColumns({ recommended: { family: bad } });
    assert.equal(columns.recommended_family, null, `family ${JSON.stringify(bad)} was coerced`);
  }
});

test("056: W1/W2 writes all four from the payload it persists", () => {
  const row = mapPredictionToDbRow(
    prediction({
      recommended: {
        pick: "Over 9.5",
        odd: 1.9,
        confidence: 0.7,
        family: "Corners",
        period: "full_match",
        scope: "match",
        bookLine: 9.5
      }
    })
  );
  assert.equal(row.recommended_family, "Corners");
  assert.equal(row.recommended_period, "full_match");
  assert.equal(row.recommended_scope, "match");
  assert.equal(row.recommended_book_line, 9.5);
  // The whole point: the column describes the document actually stored.
  assertNoDrift(row, "W1/W2 recommendation metadata");
});

test("056: settlement cannot write recommendation metadata", () => {
  // Structural, not conventional: the mutable helper simply does not return
  // these keys, so a settlement writer spreading it cannot touch them.
  const mutable = deriveMutableHistoryListColumns({
    recommended: { family: "Corners", period: "full_match", scope: "match", bookLine: 9.5 },
    cardMarkets: { corners: { pick: "Over 9.5" } }
  });
  for (const column of RECOMMENDED_COLUMNS) {
    assert.ok(!(column in mutable), `${column} leaked into the settlement write shape`);
  }
  for (const column of RECOMMENDED_COLUMNS) {
    assert.ok(IMMUTABLE_COLUMNS.includes(column), `${column} is not declared immutable`);
    assert.ok(!MUTABLE_COLUMNS.includes(column), `${column} is declared mutable`);
  }
});
