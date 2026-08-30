import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  classifyRecommendedMarket,
  classifyRecommendedMarketFromRow,
  isRecommendedSlotExcluded,
  RECOMMENDED_MARKET_INVALID_REASONS
} from "../server-utils/recommendedMarketValidity.js";
import { aggregateCardMarketStats } from "../server-utils/cardMarketSettlement.js";
import { resolvePublishedTip } from "../server-utils/backtest/TipEvent.js";
import { extractBetEvent } from "../server-utils/backtest/BacktestAnalytics.js";
import { computeMetrics } from "../server-utils/backtest/metricsReducer.js";
import { mapPredictionToDbRow } from "../server-utils/predictionsHistory.js";
import { runBackfill, inspectRow } from "../server-utils/backfill/recommendedMarketValidity.js";

/**
 * Migration 066 — analytics eligibility of the recommended pick.
 *
 * The invariant under test is a separation, not a filter: settlement says what
 * happened to the declared market and never changes; validity says whether the
 * recommendation counts in performance analytics. Every assertion below checks
 * one side of that line without disturbing the other.
 */

/** The persisted total-shots block of fixture 1557383 (λ 14 + 12.89 = 26.89). */
const LIVERPOOL_SHOTS_BLOCK = {
  total: { o18_5: 95.3, o20_5: 89.4, o22_5: 79.8, o24_5: 66.8 },
  lambdaHome: 14,
  lambdaAway: 12.89,
  correlation: 0.05
};
/** Fixture 1570355 (λ 6.13 + 14 = 20.13) — the row that defeated the 1% guard. */
const LOW_LAMBDA_SHOTS_BLOCK = {
  total: { o18_5: 62.9, o20_5: 45.3, o22_5: 29, o24_5: 16.5 },
  lambdaHome: 6.13,
  lambdaAway: 14,
  correlation: 0.05
};
const SOT_BLOCK = { total: { o6_5: 99.4, o7_5: 98.5 }, lambdaHome: 6.39, lambdaAway: 8.95 };
const CORNERS_BLOCK = { total: { o7_5: 99.1, o8_5: 97.9 }, lambdaHome: 7.09, lambdaAway: 9.06 };
const CARDS_BLOCK = { total: { o3_5: 62 }, lambdaHome: 2.1, lambdaAway: 2.1 };

/* ---------------------------------------------------------------- A / B / C / D / E */

test("[A] a malformed Total Shots recommendation is classified invalid, with the guard's own reason", () => {
  for (const [line, block] of [
    [10.5, LIVERPOOL_SHOTS_BLOCK], // ratio 0.390 — the Liverpool row
    [10.5, LOW_LAMBDA_SHOTS_BLOCK], // ratio 0.522 — cleared the 1% mass guard
    [6.5, { lambdaHome: 14, lambdaAway: 14 }] // ratio 0.232 — the extreme
  ]) {
    const out = classifyRecommendedMarket({
      family: "Shots",
      bookLine: line,
      pick: `Shots Over ${line}`,
      probs: { shotsTotal: block }
    });
    assert.equal(out.valid, false, `line ${line}`);
    assert.equal(out.reason, RECOMMENDED_MARKET_INVALID_REASONS.LINE_OFF_MODEL_SCALE);
    assert.equal(out.reason, "line_off_model_scale", "the stored string is stable");
  }
});

test("[B] legitimate Total Shots recommendations are classified valid", () => {
  for (const line of [17.5, 20.5, 21.5, 22.5, 24.5, 27.5, 29.5, 31.5]) {
    const out = classifyRecommendedMarket({
      family: "Shots",
      bookLine: line,
      pick: `Shots Over ${line}`,
      probs: { shotsTotal: LIVERPOOL_SHOTS_BLOCK }
    });
    assert.equal(out.valid, true, `line ${line}`);
    assert.equal(out.reason, null);
  }
  const under = classifyRecommendedMarket({
    family: "Shots",
    bookLine: 29.5,
    pick: "Shots Under 29.5",
    probs: { shotsTotal: LIVERPOOL_SHOTS_BLOCK }
  });
  assert.equal(under.valid, true);
});

test("[C][D][E] SOT, Corners and Cards are never classified invalid", () => {
  const cases = [
    ["Shots on Target", "shotsOnTarget", SOT_BLOCK, [6.5, 7.5, 8.5, 9.5]],
    ["Corners", "corners", CORNERS_BLOCK, [1.5, 2.5, 7.5, 12.5, 18.5]],
    ["Cards", "cards", CARDS_BLOCK, [0.5, 3.5, 5.5]]
  ];
  for (const [family, blockKey, block, lines] of cases) {
    for (const line of lines) {
      const out = classifyRecommendedMarket({
        family,
        bookLine: line,
        pick: `${family} Over ${line}`,
        probs: { [blockKey]: block }
      });
      assert.equal(out.valid, true, `${family} ${line}`);
      assert.equal(out.reason, null, `${family} ${line}`);
    }
  }
});

test("[A] the contestability arm catches the OTHER end: a line far ABOVE the model's scale", () => {
  /*
    The ratio rule is a lower bound only — it cannot see a line the model is
    equally certain about from above. λ_total 20 with a book line of 45 has a
    ratio of 2.25 (comfortably "on scale") while the model leaves ~0% for the
    Over: the live guard refuses that candidate on the 1% mass rule, so
    classification must refuse it too, or the two definitions disagree.
  */
  const block = { total: {}, lambdaHome: 10, lambdaAway: 10, correlation: 0.05 };
  const ratio = 45 / 20;
  assert.ok(ratio >= 0.6, "the ratio rule alone would call this valid");

  const over = classifyRecommendedMarket({
    family: "Shots",
    bookLine: 45,
    pick: "Shots Over 45",
    probs: { shotsTotal: block }
  });
  assert.equal(over.valid, false, "an unreachable Over is not a market position");
  assert.equal(over.reason, "line_off_model_scale");

  // ...and the hopeless certainty on the other side of the same line.
  const under = classifyRecommendedMarket({
    family: "Shots",
    bookLine: 45,
    pick: "Shots Under 45",
    probs: { shotsTotal: block }
  });
  assert.equal(under.valid, false, "the certain Under of the same line is refused too");

  // A line the model genuinely contests at the same ratio stays valid.
  assert.equal(
    classifyRecommendedMarket({
      family: "Shots",
      bookLine: 20.5,
      pick: "Shots Over 20.5",
      probs: { shotsTotal: block }
    }).valid,
    true
  );
});

test("classification is evidence-based: unknown family, absent lambdas or unparseable line stay VALID", () => {
  assert.equal(classifyRecommendedMarket({ family: null, pick: "1", probs: null }).valid, true);
  assert.equal(classifyRecommendedMarket({ family: "1X2", pick: "1", probs: null }).valid, true);
  assert.equal(
    classifyRecommendedMarket({
      family: "Shots",
      bookLine: 10.5,
      pick: "Shots Over 10.5",
      probs: { shotsTotal: { total: { o10_5: 97 } } } // ladder only, no lambdas
    }).valid,
    true,
    "a block whose ratio cannot be formed is not evidence of invalidity"
  );
  assert.equal(
    classifyRecommendedMarket({ family: "Shots", pick: "Shots", probs: { shotsTotal: LIVERPOOL_SHOTS_BLOCK } }).valid,
    true
  );
});

test("the line falls back to the pick text when recommended_book_line is null (legacy rows)", () => {
  const row = {
    recommended_family: "Shots",
    recommended_book_line: null,
    recommended_pick: "Shots Over 8.5",
    probs: { shotsTotal: LIVERPOOL_SHOTS_BLOCK }
  };
  assert.equal(classifyRecommendedMarketFromRow(row).valid, false);
  assert.equal(classifyRecommendedMarketFromRow({ ...row, recommended_pick: "Shots Over 24.5" }).valid, true);
});

test("isRecommendedSlotExcluded excludes ONLY an explicit false, in either row or entry shape", () => {
  assert.equal(isRecommendedSlotExcluded({ recommended_market_valid: false }), true);
  assert.equal(isRecommendedSlotExcluded({ recommendedMarketValid: false }), true);
  assert.equal(isRecommendedSlotExcluded({ recommended_market_valid: true }), false);
  assert.equal(isRecommendedSlotExcluded({ recommended_market_valid: null }), false, "NULL still counts");
  assert.equal(isRecommendedSlotExcluded({}), false, "unclassified still counts");
  assert.equal(isRecommendedSlotExcluded(null), false);
});

/* ------------------------------------------------------------------- write path */

test("the write path classifies from the same payload it persists, and changes nothing else", () => {
  const base = {
    id: 1557383,
    leagueId: 39,
    kickoff: "2026-08-29T11:30:00Z",
    status: "FT",
    score: { home: 2, away: 2 },
    odds: { home: 2.1, draw: 3.4, away: 3.6 },
    probs: { shotsTotal: LIVERPOOL_SHOTS_BLOCK },
    marketResults: { shotsTotal: 25 },
    recommended: { pick: "Shots Over 10.5", family: "Shots", bookLine: 10.5, confidence: 100, odd: 2.95 }
  };
  const bad = mapPredictionToDbRow(base);
  assert.equal(bad.recommended_market_valid, false);
  assert.equal(bad.recommended_market_invalid_reason, "line_off_model_scale");
  assert.equal(bad.validation, "win", "SETTLEMENT IS UNCHANGED: 25 shots is a win at 10.5");
  assert.equal(bad.recommended_pick, "Shots Over 10.5", "the recommendation text is untouched");
  assert.equal(bad.recommended_confidence, 100, "the confidence is untouched");

  const good = mapPredictionToDbRow({
    ...base,
    recommended: { ...base.recommended, pick: "Shots Over 24.5", bookLine: 24.5 }
  });
  assert.equal(good.recommended_market_valid, true);
  assert.equal(good.recommended_market_invalid_reason, null);
  assert.equal(good.validation, "win");
});

/* --------------------------------------------------------------- F / K / L aggregate */

/** A fixture with four graded slots; only `recommended` is in question. */
function fourSlotRow(overrides = {}) {
  return {
    fixture_id: 1,
    match_status: "FT",
    score_home: 2,
    score_away: 2,
    validation: "win",
    recommended_pick: "Shots Over 10.5",
    recommended_family: "Shots",
    // The shape aggregateCardMarketStats actually receives: a full row carries
    // the document, and the column path is rehydrated into exactly this by
    // rehydrateAggregateRow before it reaches the aggregate.
    raw_payload: {
      cardMarketValidations: { recommended: "win", goals: "loss", corners: "win", shots: "win" }
    },
    ...overrides
  };
}

test("[F][L] an invalid recommendation loses ONLY its recommended slot; the other three still count", () => {
  const counted = aggregateCardMarketStats([fourSlotRow()]);
  assert.deepEqual(
    { wins: counted.wins, losses: counted.losses, settled: counted.settled },
    { wins: 3, losses: 1, settled: 4 },
    "baseline: all four slots count"
  );

  const excluded = aggregateCardMarketStats([fourSlotRow({ recommended_market_valid: false })]);
  assert.equal(excluded.settled, 3, "one slot removed, not the fixture");
  assert.equal(excluded.wins, 2, "the recommended WIN is gone");
  assert.equal(excluded.losses, 1, "the goals LOSS still counts");
  assert.equal(Math.round(excluded.winRate), 67);
});

test("[K] valid and unclassified recommendations are counted exactly as before", () => {
  const before = aggregateCardMarketStats([fourSlotRow()]);
  for (const flag of [true, null, undefined]) {
    const after = aggregateCardMarketStats([fourSlotRow({ recommended_market_valid: flag })]);
    assert.deepEqual(after, before, `recommended_market_valid=${String(flag)} must not move the aggregate`);
  }
});

test("[L] a mixed batch removes only the invalid recommended slots", () => {
  const rows = [
    fourSlotRow({ fixture_id: 1, recommended_market_valid: false }),
    fourSlotRow({ fixture_id: 2, recommended_market_valid: true }),
    fourSlotRow({ fixture_id: 3 })
  ];
  const out = aggregateCardMarketStats(rows);
  assert.equal(out.settled, 11, "12 slots minus the one excluded recommended slot");
  assert.equal(out.wins, 8);
  assert.equal(out.losses, 3);
});

/* ------------------------------------------------------------------ H tip track */

test("[H] the tip track drops an invalid recommendation entirely — it is the recommended pick", () => {
  const row = {
    fixture_id: 1557383,
    recommended_pick: "Shots Over 10.5",
    recommended_odd: 2.95,
    recommended_confidence: 100,
    validation: "win",
    score_home: 2,
    score_away: 2
  };
  const kept = resolvePublishedTip(row);
  assert.ok(kept, "baseline: the tip exists");
  assert.equal(kept.won, true);

  assert.equal(resolvePublishedTip({ ...row, recommended_market_valid: false }), null);
  assert.ok(resolvePublishedTip({ ...row, recommended_market_valid: true }), "valid rows are unaffected");
  assert.ok(resolvePublishedTip({ ...row, recommended_market_valid: null }), "unclassified rows are unaffected");
});

/* ------------------------------------------------------- value-track alignment */

test("the value track no longer imports an invalid recommendation's outcome through the alignment fallback", () => {
  const row = {
    fixture_id: 1550097,
    recommended_pick: "Shots Over 10.5",
    value_bet_validation: null,
    validation: "win",
    score_home: 1,
    score_away: 1,
    odds_home: 1.37,
    odds_draw: 4.8,
    odds_away: 8.5,
    raw_payload: {
      valueBet: { type: "Shots Over 10.5", ev: 324.82, kelly: 2.7 },
      valueEngine: { bestMarket: { odds: 4.25 } }
    }
  };
  const admitted = extractBetEvent(row);
  assert.ok(admitted, "baseline: the alignment fallback admits this row today");
  assert.equal(admitted.won, true);

  assert.equal(
    extractBetEvent({ ...row, recommended_market_valid: false }),
    null,
    "an invalid recommendation may not grade a value bet"
  );
  assert.ok(extractBetEvent({ ...row, recommended_market_valid: true }));
});

/* ------------------------------------------------------------------ I / J the 1X2 metrics */

/** Finished fixture: home win, model picked "1" at 45%. */
function metricsRow(overrides = {}) {
  return {
    score_home: 2,
    score_away: 1,
    prob_1: 45,
    prob_x: 30,
    prob_2: 25,
    pick_1x2: "1",
    recommended_confidence: 45,
    model_method: "modular-engine",
    model_version: "v3",
    league_id: 39,
    ...overrides
  };
}

test("[I] a malformed recommendation never removes its fixture from Brier / log-loss", () => {
  const rows = [
    metricsRow(),
    metricsRow({ recommended_market_valid: false, score_home: 0, score_away: 1, pick_1x2: "2" })
  ];
  const out = computeMetrics(rows);
  assert.equal(out.nProb, 2, "both fixtures are scored; the 1X2 prediction is valid either way");
  assert.ok(Number.isFinite(out.brier1x2));
  assert.ok(Number.isFinite(out.logLoss1x2));
  const withoutFlag = computeMetrics([rows[0], { ...rows[1], recommended_market_valid: undefined }]);
  assert.equal(out.brier1x2, withoutFlag.brier1x2, "the flag is irrelevant to Brier");
  assert.equal(out.logLoss1x2, withoutFlag.logLoss1x2, "the flag is irrelevant to log-loss");
});

test("[J] ECE buckets on the 1X2 confidence, so a 100%-confidence Shots recommendation cannot move it", () => {
  const rows = [
    metricsRow({ recommended_confidence: 45 }),
    metricsRow({ recommended_confidence: 100, recommended_market_valid: false }),
    metricsRow({ recommended_confidence: 92 })
  ];
  const out = computeMetrics(rows);
  assert.equal(out.calibration1x2.length, 1, "one bucket: every row shares the same 1X2 confidence");
  const bucket = out.calibration1x2[0];
  assert.equal(bucket.n, 3);
  assert.equal(Math.round(bucket.avgConfidence), 45, "the 1X2 probability, not 45/100/92 averaged");
  assert.equal(bucket.accuracy1x2, 100, "all three picked the winner");

  const control = computeMetrics(rows.map((r) => ({ ...r, recommended_confidence: 1 })));
  assert.equal(out.ece1x2, control.ece1x2, "recommended_confidence no longer reaches ECE at all");
});

/* ------------------------------------------------------------------ M backfill */

/** Minimal in-memory Supabase double: keyset select + single-row update. */
function fakeSupabase(rows) {
  const store = new Map(rows.map((r) => [r.fixture_id, { ...r }]));
  const updates = [];
  return {
    store,
    updates,
    from() {
      const state = { limit: 100 };
      const builder = {
        select(sel) {
          state.mode = "select";
          state.select = sel;
          return builder;
        },
        order() {
          return builder;
        },
        limit(n) {
          state.limit = n;
          return builder;
        },
        gt(_col, value) {
          state.gt = Number(value);
          return builder;
        },
        update(payload) {
          state.mode = "update";
          state.payload = payload;
          return builder;
        },
        eq(_col, value) {
          state.eq = value;
          return builder;
        },
        then(resolve, reject) {
          try {
            if (state.mode === "update") {
              const row = store.get(state.eq);
              Object.assign(row, state.payload);
              updates.push({ fixture_id: state.eq, ...state.payload });
              return resolve({ data: null, error: null });
            }
            let list = [...store.values()].sort((a, b) => a.fixture_id - b.fixture_id);
            if (state.gt != null) list = list.filter((r) => r.fixture_id > state.gt);
            return resolve({ data: list.slice(0, state.limit), error: null });
          } catch (error) {
            return reject(error);
          }
        }
      };
      return builder;
    }
  };
}

function backfillRows() {
  return [
    {
      fixture_id: 10,
      recommended_family: "Shots",
      recommended_pick: "Shots Over 10.5",
      recommended_book_line: 10.5,
      recommended_market_valid: null,
      recommended_market_invalid_reason: null,
      probs: { shotsTotal: LIVERPOOL_SHOTS_BLOCK },
      validation: "win"
    },
    {
      fixture_id: 20,
      recommended_family: "Shots",
      recommended_pick: "Shots Under 24.5",
      recommended_book_line: 24.5,
      recommended_market_valid: null,
      recommended_market_invalid_reason: null,
      probs: { shotsTotal: LIVERPOOL_SHOTS_BLOCK },
      validation: "loss"
    },
    {
      fixture_id: 30,
      recommended_family: "Corners",
      recommended_pick: "Over 7.5",
      recommended_book_line: 7.5,
      recommended_market_valid: null,
      recommended_market_invalid_reason: null,
      probs: { corners: CORNERS_BLOCK },
      validation: "win"
    }
  ];
}

test("[M] the backfill is deterministic, idempotent, and writes only the two validity columns", async () => {
  const db = fakeSupabase(backfillRows());

  const dry = await runBackfill({ supabase: db, pageSize: 2 });
  assert.equal(dry.scanned, 3);
  assert.equal(dry.plannedInvalid, 1);
  assert.equal(dry.plannedValid, 2);
  assert.equal(dry.changed, 3, "all three are unclassified (NULL) today");
  assert.equal(dry.applied, 0, "a dry run writes nothing");
  assert.equal(db.updates.length, 0);
  assert.deepEqual(dry.byReason, { line_off_model_scale: 1 });
  assert.deepEqual(dry.changedFixtureIds, [10, 20, 30]);

  const dryAgain = await runBackfill({ supabase: fakeSupabase(backfillRows()), pageSize: 100 });
  assert.deepEqual(
    { ...dryAgain, pages: dry.pages },
    { ...dry, pages: dry.pages },
    "page size changes the walk, never the verdict"
  );

  const applied = await runBackfill({ supabase: db, pageSize: 2, apply: true });
  assert.equal(applied.applied, 3);
  assert.equal(db.store.get(10).recommended_market_valid, false);
  assert.equal(db.store.get(10).recommended_market_invalid_reason, "line_off_model_scale");
  assert.equal(db.store.get(20).recommended_market_valid, true);
  assert.equal(db.store.get(20).recommended_market_invalid_reason, null);
  assert.equal(db.store.get(30).recommended_market_valid, true);
  assert.equal(db.store.get(10).validation, "win", "settlement untouched");
  assert.equal(db.store.get(20).validation, "loss", "settlement untouched");
  for (const u of db.updates) {
    assert.deepEqual(
      Object.keys(u).sort(),
      ["fixture_id", "recommended_market_invalid_reason", "recommended_market_valid"],
      "no other column may ever be written"
    );
  }

  const writesBefore = db.updates.length;
  const second = await runBackfill({ supabase: db, pageSize: 2, apply: true });
  assert.equal(second.changed, 0);
  assert.equal(second.applied, 0);
  assert.equal(db.updates.length, writesBefore);
});

test("[M] the backfill resumes from a fixture id and reports its cursor", async () => {
  const db = fakeSupabase(backfillRows());
  const tail = await runBackfill({ supabase: db, pageSize: 100, startAfterFixtureId: 10 });
  assert.equal(tail.scanned, 2, "fixture 10 is skipped");
  assert.equal(tail.lastFixtureId, 30);
  assert.equal(tail.plannedInvalid, 0);
});

test("WIRING: every backtest query that grades the recommended pick projects the flag", () => {
  /*
    The exclusions in TipEvent / resolveBetOutcome read a COLUMN. A query whose
    select list omits it hands them `undefined`, `isRecommendedSlotExcluded`
    returns false, and the exclusion silently never fires on a real row — green
    unit tests, unchanged production numbers. That failure mode is invisible to
    a test that injects the flag as an object property, so it is pinned here
    against the handler source itself.
  */
  const source = readFileSync(new URL("../api/backtest.js", import.meta.url), "utf8");
  const selects = source.match(/"[^"]*\bvalidation\b[^"]*raw_payload"/g) || [];
  assert.ok(selects.length >= 5, `expected the graded-row projections, found ${selects.length}`);
  for (const select of selects) {
    assert.ok(
      select.includes("recommended_market_valid"),
      `a projection feeding the recommended-pick tracks omits recommended_market_valid: ${select.slice(0, 80)}...`
    );
  }
});

test("[M] the dry run reports rows it could not classify instead of calling them clean", async () => {
  const db = fakeSupabase([
    ...backfillRows(),
    {
      fixture_id: 40,
      recommended_family: null, // pre-056 legacy row
      recommended_pick: "1",
      recommended_book_line: null,
      recommended_market_valid: null,
      recommended_market_invalid_reason: null,
      probs: {},
      validation: "win"
    }
  ]);
  const dry = await runBackfill({ supabase: db, pageSize: 100 });
  assert.equal(dry.scanned, 4);
  assert.equal(dry.unclassifiable, 1, "the legacy row is reported, not hidden");
  assert.equal(dry.plannedValid, 3, "and it is still counted as valid — absent evidence never excludes");
  assert.equal(dry.skippedNoFixtureId, 0);
});

test("inspectRow reports the stored value alongside the plan, for auditability", () => {
  const [malformed] = backfillRows();
  const fresh = inspectRow(malformed);
  assert.deepEqual(fresh.planned, { valid: false, reason: "line_off_model_scale" });
  assert.deepEqual(fresh.stored, { valid: null, reason: null });
  assert.equal(fresh.changed, true);

  const settled = inspectRow({
    ...malformed,
    recommended_market_valid: false,
    recommended_market_invalid_reason: "line_off_model_scale"
  });
  assert.equal(settled.changed, false, "already correct -> not rewritten");
});
