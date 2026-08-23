/**
 * Cards C2 — settlement / read-path completion.
 *
 * A Cards recommendation must travel prediction → promoted cards_total → validation →
 * final status through the SAME code the other totals families use: rehydrated rows from
 * promoted columns (never raw_payload), the canonical totals bag, the existing Asian O/U
 * grader, and the idempotent column write. Every test here uses production-shaped rows —
 * the exact column projections scan 3 and the aggregate select.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  canonicalMarketTotals,
  attachCardMarketsToPayload,
  resolveCardMarketValidations,
  resolveRecommendedValidation,
  needsMarketTotalsForSettlement,
  aggregateCardMarketStats
} from "../server-utils/cardMarketSettlement.js";
import {
  AGGREGATE_STATS_SELECT,
  SETTLEMENT_SELECT,
  rehydrateAggregateRow,
  rehydrateSettlementRow,
  isSettlementRowComplete
} from "../server-utils/predictionsHistory.js";
import { deriveMutableHistoryListColumns, MUTABLE_COLUMNS } from "../server-utils/historyListColumns.js";
import { MISSING_STATS_VOID_AFTER_MS } from "../server-utils/globalSpecialBetSettlement.js";
import { SETTLEABLE_VALUE_FAMILIES } from "../server-utils/value/valueMarkets.js";
import { SETTLEABLE_MARKET_FAMILIES } from "../server-utils/globalSpecialBetEngine.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, "..", rel), "utf8");

/** A scan-3 row exactly as SETTLEMENT_SELECT returns it for a Cards recommendation. */
const settlementRow = (over = {}) => ({
  fixture_id: 1377872,
  kickoff_at: "2025-08-23T16:30:00+00:00",
  match_status: "FT",
  score_home: 0,
  score_away: 2,
  validation: "pending",
  recommended_pick: "Cards Over 4.5",
  recommended_family: "Cards",
  card_markets: { recommended: { pick: "Cards Over 4.5", family: "Cards" }, goals: null, corners: null, shots: null },
  card_market_validations: { recommended: "pending", goals: null, corners: null, shots: null },
  corners_total: 9,
  shots_on_target_total: 7,
  shots_total: 21,
  cards_total: null,
  cards_points: null,
  first_half_goals: 1,
  has_first_half_probs: false,
  ...over
});

/** Run the pure core of scan 3 on a rehydrated row: attach → validation → column write. */
function settleOnce(row, marketTotalsOverride = null) {
  const raw = rehydrateSettlementRow(row).raw_payload;
  const score = { home: row.score_home, away: row.score_away };
  const picks = raw.cardMarkets;
  // Scan 3 skips a finished row with nothing left to grade before it compares anything.
  if (isSettlementRowComplete({ picks, storedValidations: raw.cardMarketValidations, validation: row.validation })) {
    return { validation: row.validation, enriched: null, write: null, skipped: true, needsStats: false };
  }
  const marketTotals = canonicalMarketTotals(raw.marketResults, marketTotalsOverride);
  const enriched = attachCardMarketsToPayload(
    { ...raw, recommended: raw.recommended, cardMarkets: picks, status: row.match_status, score },
    { status: row.match_status, score, marketTotals }
  );
  const validation =
    row.validation === "win" || row.validation === "loss"
      ? row.validation
      : resolveRecommendedValidation({
          pick: row.recommended_pick,
          family: raw.recommended?.family || null,
          status: row.match_status,
          score,
          marketTotals
        });
  const cardChanged =
    JSON.stringify(raw.cardMarketValidations || null) !== JSON.stringify(enriched.cardMarketValidations || null) ||
    JSON.stringify(canonicalMarketTotals(raw.marketResults)) !== JSON.stringify(canonicalMarketTotals(enriched.marketResults));
  const validationChanged = String(validation) !== String(row.validation || "");
  const write = cardChanged || validationChanged ? { validation, ...deriveMutableHistoryListColumns(enriched) } : null;
  return { validation, enriched, write, needsStats: needsMarketTotalsForSettlement(enriched.cardMarketValidations, picks) };
}

/** Apply a column write back onto the row, as the upsert would. */
const applyWrite = (row, write) => (write ? { ...row, ...write } : row);

// ---------------------------------------------------------------- 1 / 11 / 12. promoted source

test("1. a promoted cards_total is what settlement grades a Cards pick against", () => {
  const row = settlementRow({ cards_total: 5 });
  const { validation, write } = settleOnce(row);
  assert.equal(validation, "win");
  assert.equal(write.validation, "win");
  assert.equal(write.card_market_validations.recommended, "win");
  assert.equal(write.cards_total, 5, "the promoted total is carried forward, not dropped");
});

test("11. both projections carry cards_total; 12. neither selects raw_payload", () => {
  assert.match(SETTLEMENT_SELECT, /\bcards_total\b/);
  assert.match(AGGREGATE_STATS_SELECT, /\bcards_total\b/);
  assert.match(AGGREGATE_STATS_SELECT, /\bshots_total\b/);
  assert.doesNotMatch(SETTLEMENT_SELECT, /raw_payload/);
  assert.doesNotMatch(AGGREGATE_STATS_SELECT, /raw_payload/);
  assert.ok(MUTABLE_COLUMNS.includes("cards_total"));
  // The canonical bag never reaches into a document: it reads marketResults it is handed.
  const src = read("server-utils/cardMarketSettlement.js");
  const fn = src.slice(src.indexOf("export function canonicalMarketTotals"), src.indexOf("export function attachCardMarketsToPayload"));
  assert.doesNotMatch(fn, /raw_payload/);
});

test("11b. the aggregate read path grades a cron-settled Cards pick from columns, not pending", () => {
  // After scan 3: validation promoted, markets graded, total promoted. The aggregate must
  // count it — before C2 it re-settled without cardsTotal and read "pending" forever.
  const graded = rehydrateAggregateRow({
    validation: "win", match_status: "FT", score_home: 0, score_away: 2,
    recommended_pick: "Cards Over 4.5", recommended_family: "Cards",
    card_markets: { recommended: { pick: "Cards Over 4.5", family: "Cards" }, goals: null, corners: null, shots: null },
    // markets still "pending" in the column — the exact D8b production shape
    card_market_validations: { recommended: "pending", goals: null, corners: null, shots: null },
    corners_total: 9, shots_on_target_total: 7, shots_total: 21, cards_total: 5
  });
  assert.equal(graded.raw_payload.marketResults.cardsTotal, 5);
  assert.equal(resolveCardMarketValidations(graded).recommended, "win");
  assert.deepEqual(aggregateCardMarketStats([graded]), { wins: 1, losses: 0, settled: 1, winRate: 100 });
});

// ---------------------------------------------------------------- 2 / 3 / 9. NULL semantics

test("2. NULL cards_total keeps a Cards pick pending, end to end", () => {
  const row = settlementRow({ cards_total: null });
  const { validation, enriched, write } = settleOnce(row);
  assert.equal(validation, "pending");
  assert.equal(enriched.cardMarketValidations.recommended, "pending");
  assert.equal(write, null, "nothing changed → nothing written");
  const agg = rehydrateAggregateRow({ ...row, cards_total: null });
  assert.equal(resolveCardMarketValidations(agg).recommended, "pending");
  assert.equal("cardsTotal" in (agg.raw_payload.marketResults || {}), false, "NULL is absent, never 0");
});

test("3. cards_total = 0 is a real total: Under wins, Over loses", () => {
  assert.equal(settleOnce(settlementRow({ cards_total: 0, recommended_pick: "Cards Under 3.5", card_markets: { recommended: { pick: "Cards Under 3.5", family: "Cards" } } })).validation, "win");
  assert.equal(settleOnce(settlementRow({ cards_total: 0 })).validation, "loss");
  assert.equal(settleOnce(settlementRow({ cards_total: 1 })).validation, "loss");
  const bag = canonicalMarketTotals({ cardsTotal: 0 }, { cardsTotal: null });
  assert.equal(bag.cardsTotal, 0, "an override of null does not erase a real zero");
  assert.equal(canonicalMarketTotals({ cardsTotal: null }).cardsTotal, null);
  assert.equal(canonicalMarketTotals({}).cardsTotal, null);
  assert.equal(canonicalMarketTotals(null, { cardsTotal: "" }).cardsTotal, "", "falsy string is left for the grader to reject, never coerced");
  assert.equal(resolveRecommendedValidation({ pick: "Cards Under 3.5", family: "Cards", status: "FT", score: { home: 1, away: 1 }, marketTotals: { cardsTotal: "" } }), "pending");
});

// ---------------------------------------------------------------- 4 / 5. grader

test("4. Cards WIN: Over 4.5 at 5, Under 3.5 at 3; Asian whole line 4 pushes at 4", () => {
  assert.equal(settleOnce(settlementRow({ cards_total: 5 })).validation, "win");
  assert.equal(settleOnce(settlementRow({ cards_total: 3, recommended_pick: "Cards Under 3.5", card_markets: { recommended: { pick: "Cards Under 3.5", family: "Cards" } } })).validation, "win");
  const whole = settlementRow({ cards_total: 4, recommended_pick: "Cards Over 4", card_markets: { recommended: { pick: "Cards Over 4", family: "Cards" } } });
  assert.equal(settleOnce(whole).validation, "push", "whole-number line at exactly the total is a push (existing Asian grader)");
  assert.equal(settleOnce({ ...whole, cards_total: 5 }).validation, "win");
});

test("5. Cards LOSS: Over 4.5 at 4, Under 3.5 at 4; Asian quarter line half outcomes", () => {
  assert.equal(settleOnce(settlementRow({ cards_total: 4 })).validation, "loss");
  assert.equal(settleOnce(settlementRow({ cards_total: 4, recommended_pick: "Cards Under 3.5", card_markets: { recommended: { pick: "Cards Under 3.5", family: "Cards" } } })).validation, "loss");
  const quarter = settlementRow({ cards_total: 4, recommended_pick: "Cards Over 4.25", card_markets: { recommended: { pick: "Cards Over 4.25", family: "Cards" } } });
  assert.equal(settleOnce(quarter).validation, "half_loss");
  assert.equal(settleOnce({ ...quarter, cards_total: 5 }).validation, "win");
});

// ---------------------------------------------------------------- 6. idempotency

test("6. re-running with the same cards_total never rewrites or flips a settled verdict", () => {
  for (const [total, expected] of [[5, "win"], [4, "loss"]]) {
    const first = settleOnce(settlementRow({ cards_total: total }));
    assert.equal(first.validation, expected);
    assert.ok(first.write, "first run writes");
    const settled = applyWrite(settlementRow({ cards_total: total }), first.write);
    const second = settleOnce(settled);
    assert.equal(second.validation, expected, "verdict stable");
    assert.equal(second.skipped, true, "scan 3 skips a complete row before grading");
    assert.equal(second.write, null, "second run writes nothing — no updated_at churn, no reopen");
    assert.equal(isSettlementRowComplete({ picks: settled.card_markets, storedValidations: settled.card_market_validations, validation: settled.validation }), true, "scan 3 skips it");
    // A later, different total must NOT flip a settled verdict.
    const contradicted = settleOnce(settled, { cardsTotal: total === 5 ? 4 : 5 });
    assert.equal(contradicted.validation, expected);
  }
  // pending + NULL, re-run: still pending, still nothing written.
  const nullRow = settlementRow({ cards_total: null });
  assert.equal(settleOnce(nullRow).write, null);
  assert.equal(settleOnce(nullRow).validation, "pending");
  assert.equal(isSettlementRowComplete({ picks: nullRow.card_markets, storedValidations: nullRow.card_market_validations, validation: nullRow.validation }), false, "still a gap → scan 3 keeps trying");
});

// ---------------------------------------------------------------- 7 / 8 / 9. other markets

test("7/8/9. Goals, Corners, Shots settle exactly as before and ignore cards_total", () => {
  const base = settlementRow({ cards_total: 9 });
  const goals = { ...base, recommended_pick: "Over 1.5", recommended_family: "Goals", card_markets: { recommended: { pick: "Over 1.5", family: "Goals" }, goals: { pick: "Over 1.5", side: "over", line: 1.5 }, corners: { pick: "Over 8.5", side: "over", line: 8.5 }, shots: { pick: "Over 6.5", side: "over", line: 6.5 } }, card_market_validations: { recommended: "pending", goals: "pending", corners: "pending", shots: "pending" } };
  const out = settleOnce(goals);
  assert.equal(out.validation, "win", "0-2 → Over 1.5 goals wins on the score");
  assert.equal(out.enriched.cardMarketValidations.goals, "win");
  assert.equal(out.enriched.cardMarketValidations.corners, "win", "9 corners > 8.5");
  assert.equal(out.enriched.cardMarketValidations.shots, "win", "7 SOT > 6.5");
  // Corners recommended uses cornersTotal, never cardsTotal (9 cards vs 9 corners here is a coincidence — break it).
  const corners = { ...base, cards_total: 20, recommended_pick: "Over 9.5", recommended_family: "Corners", card_markets: { recommended: { pick: "Over 9.5", family: "Corners" } } };
  assert.equal(settleOnce(corners).validation, "loss", "9 corners < 9.5 even though 20 cards > 9.5");
  const shots = { ...base, cards_total: 30, recommended_pick: "Total Shots Over 22.5", recommended_family: "Shots", card_markets: { recommended: { pick: "Total Shots Over 22.5", family: "Shots" } } };
  assert.equal(settleOnce(shots).validation, "loss", "21 shots < 22.5 even though 30 cards > 22.5");
  // And a Cards pick never reads corners/shots totals.
  assert.equal(settleOnce(settlementRow({ cards_total: null, corners_total: 12, shots_total: 30 })).validation, "pending");
  // Totals arriving from the fetch (override path): every family still reads its own key.
  const fetched = { cornersTotal: 9, shotsOnTargetTotal: 7, shotsTotal: 21, cardsTotal: 20, cardsPoints: 25, firstHalfGoals: 1 };
  assert.equal(settleOnce({ ...corners, corners_total: null, cards_total: null }, fetched).validation, "loss", "9 corners < 9.5 with 20 cards in the same bag");
  assert.equal(settleOnce({ ...shots, shots_total: null, cards_total: null }, fetched).validation, "loss");
  assert.equal(settleOnce(settlementRow({ cards_total: null }), fetched).validation, "win", "20 cards > 4.5");
  const bag = canonicalMarketTotals({}, fetched);
  assert.deepEqual(bag, fetched, "the bag is a per-key copy, never a cross-key substitution");
});

// ---------------------------------------------------------------- 10. fetch only when needed

test("10. Cards statistics are requested only for a pending Cards recommendation", () => {
  const picksCards = { recommended: { pick: "Cards Over 4.5", family: "Cards" }, goals: null, corners: null, shots: null };
  assert.equal(needsMarketTotalsForSettlement({ recommended: "pending" }, picksCards), true);
  assert.equal(needsMarketTotalsForSettlement({ recommended: null }, picksCards), true);
  assert.equal(needsMarketTotalsForSettlement({ recommended: "win" }, picksCards), false, "graded → no fetch");
  assert.equal(needsMarketTotalsForSettlement({ recommended: "loss" }, picksCards), false);
  const picksGoals = { recommended: { pick: "Over 2.5", family: "Goals" }, goals: { pick: "Over 2.5" }, corners: null, shots: null };
  assert.equal(needsMarketTotalsForSettlement({ recommended: "pending", goals: "pending" }, picksGoals), false, "a goals row never fetches statistics");
  assert.equal(needsMarketTotalsForSettlement(null, null), false);
  // End to end: a Cards row with NULL total asks for stats; once graded it stops asking.
  const pendingRow = settlementRow({ cards_total: null });
  assert.equal(settleOnce(pendingRow).needsStats, true);
  const gradedRow = applyWrite(pendingRow, settleOnce(pendingRow, { cardsTotal: 6 }).write);
  assert.equal(settleOnce(gradedRow).needsStats, false);
});

// ---------------------------------------------------------------- 13 / 14. untouched policies

test("13. the 48h void policy and the GSB family set are untouched by C2", () => {
  assert.equal(MISSING_STATS_VOID_AFTER_MS, 48 * 60 * 60 * 1000);
  assert.equal(SETTLEABLE_MARKET_FAMILIES.has("cards"), false);
  assert.equal(SETTLEABLE_VALUE_FAMILIES.Cards, false, "Cards stays OFF in the decision layer");
});

test("14. legacy rows: stored verdicts are kept; a payload-only legacy row still settles its recommended", () => {
  // Stored win/loss from an earlier path is never re-derived.
  const stored = rehydrateAggregateRow({ validation: "loss", match_status: "FT", score_home: 1, score_away: 1, recommended_pick: "Cards Over 4.5", recommended_family: "Cards", card_markets: { recommended: { pick: "Cards Over 4.5", family: "Cards" } }, card_market_validations: { recommended: "loss", goals: null, corners: null, shots: null }, corners_total: null, shots_on_target_total: null, shots_total: null, cards_total: 9 });
  assert.equal(resolveCardMarketValidations(stored).recommended, "loss", "stored loss beats a contradicting total");
  // Legacy entry shape (no columns, payload-style marketResults): still read through the canonical bag.
  const legacy = { status: "FT", score: { home: 1, away: 1 }, recommended: { pick: "Cards Over 4.5", family: "Cards" }, marketResults: { cardsTotal: 5 } };
  assert.equal(resolveCardMarketValidations(legacy).recommended, "win");
  const legacyNull = { status: "FT", score: { home: 1, away: 1 }, recommended: { pick: "Cards Over 4.5", family: "Cards" }, marketResults: { cardsPoints: 7 } };
  assert.equal(resolveCardMarketValidations(legacyNull).recommended, "pending", "cardsPoints never stands in for cardsTotal");
  // Pre-C2 aggregate rows keep their exact rehydrated shape.
  const pre = rehydrateAggregateRow({ corners_total: 11, shots_on_target_total: null });
  assert.deepEqual(pre.raw_payload.marketResults, { cornersTotal: 11, shotsOnTargetTotal: null });
});
