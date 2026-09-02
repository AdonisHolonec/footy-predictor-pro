import test from "node:test";
import assert from "node:assert/strict";

import {
  HYDRATION_SELECT,
  HYDRATION_ROW_COLUMNS,
  buildHydrationPayload,
  rehydrateHydrationRow
} from "../server-utils/hydrationPayloadColumn.js";
import { mapDbRowToHistoryEntry } from "../server-utils/predictionsHistory.js";
import { aggregateCardMarketStats, canonicalMarketTotals } from "../server-utils/cardMarketSettlement.js";
import { filterByMinDisplayOdds } from "../server-utils/predictionDisplayGate.js";
import { stripDeadValueEngineArraysFromRows } from "../server-utils/valueEngineTransport.js";
import { projectPredictionListRows } from "../server-utils/predictionListProjection.js";

/**
 * A4: the hydration read cutover.
 *
 * The claim under test is narrow and total — prediction hydration no longer
 * touches `raw_payload` in ANY form, and the board row it reconstructs is the
 * same one the full-document path produced, momentum excepted.
 *
 * "Same" is asserted by building BOTH rows from one source document and
 * comparing them field by field, rather than by trusting that the projection
 * covers everything. That is the only construction that would have caught the
 * logos.league gap, which a field list alone did not.
 */

const FULL_DOC = Object.freeze({
  id: 101,
  leagueId: 39,
  league: "Premier League",
  teams: { home: "Home FC", away: "Away FC" },
  logos: { home: "h.png", away: "a.png", league: "l.png" },
  kickoff: "2026-09-02T18:00:00.000Z",
  status: "NS",
  score: { home: null, away: null },
  momentum: { series: [1, 2, 3], trend: "up" },
  referee: "A. Referee",
  cardMarkets: { corners: { line: 9.5, pick: "over" } },
  cardMarketValidations: { corners: "pending", recommended: "pending" },
  marketResults: {
    cornersTotal: 9,
    shotsOnTargetTotal: 11,
    shotsTotal: 35,
    cardsTotal: 2,
    cardsPoints: 3,
    firstHalfGoals: 1
  },
  recommended: { pick: "1", confidence: 61, odd: 1.9, family: "1x2" },
  probs: {
    p1: 51,
    pX: 25,
    p2: 24,
    corners: { over: 55 },
    shotsOnTarget: { over: 48 },
    firstHalf: { p1: 40 },
    shotsTotal: { over: 52 }
  },
  predictions: { gg: "GG", over25: "Peste 2.5", marketTiers: ["a"], cards: { pick: "over" } },
  marketOdds: { closing: { home: 1.8 } },
  confidenceEngine: { score: 72, liveAdjustment: null },
  explanation: { summary: "because" },
  featureImportance: { topFeatures: ["elo"] },
  teamContext: { home: { form: "WWD" } },
  valueBet: { type: "1", kellyPct: 2.1 },
  insufficientData: false,
  insufficientReason: null,
  modelVersion: "v3-test",
  valueEngine: {
    expectedValue: 0.07,
    edge: 1.4,
    type: "1",
    bestMarket: { type: "1" },
    markets: [
      { type: "over_2_5", family: "goals" },
      { type: "cards_over", family: "cards" }
    ]
  }
});

/** The columns the RPC returns, as production stores them. */
function dbRow(overrides = {}) {
  return {
    fixture_id: 101,
    league_id: 39,
    league_name: "Premier League",
    home_team: "Home FC",
    away_team: "Away FC",
    logo_home: "h.png",
    logo_away: "a.png",
    kickoff_at: "2026-09-02T18:00:00.000Z",
    match_status: "NS",
    score_home: null,
    score_away: null,
    validation: "pending",
    value_bet_validation: "pending",
    saved_at: "2026-09-02T10:00:00.000Z",
    model_version: "v3-test",
    referee_name: "A. Referee",
    card_markets: FULL_DOC.cardMarkets,
    card_market_validations: FULL_DOC.cardMarketValidations,
    corners_total: 9,
    shots_on_target_total: 11,
    shots_total: 35,
    cards_total: 2,
    cards_points: 3,
    first_half_goals: 1,
    recommended_market_valid: true,
    hydration_payload: buildHydrationPayload(FULL_DOC),
    ...overrides
  };
}

/**
 * What the path looked like BEFORE the cutover: the whole document.
 *
 * `payloadOverrides` exists because the two paths source settlement state from
 * DIFFERENT places - the old one from raw_payload.cardMarketValidations, the new
 * one from the card_market_validations column. A fixture that moved only the
 * column would describe two different worlds and prove nothing. Production keeps
 * them in step by dual-writing both from the same object; these helpers do the
 * same so the comparison is honest.
 */
function oldRow(overrides = {}, payloadOverrides = {}) {
  const { hydration_payload: _hp, ...columns } = dbRow(overrides);
  return { ...columns, raw_payload: { ...FULL_DOC, ...payloadOverrides } };
}

const mapOld = (o = {}, po = {}) => mapDbRowToHistoryEntry(oldRow(o, po));
const mapNew = (o = {}) => mapDbRowToHistoryEntry(rehydrateHydrationRow(dbRow(o)));

/**
 * The FULL reader pipeline, exactly as readPredictionsForHydration runs it.
 *
 * Comparing mapper output alone is not the contract: projectPredictionListRows
 * narrows valueEngine on BOTH paths afterwards, so an intermediate diff there is
 * expected and meaningless. What the caller receives is what must match.
 */
const pipeline = (rows) =>
  projectPredictionListRows(stripDeadValueEngineArraysFromRows(filterByMinDisplayOdds(rows.map(mapDbRowToHistoryEntry))));

const oldItems = (o = {}, po = {}) => pipeline([oldRow(o, po)]);
const newItems = (o = {}) => pipeline([rehydrateHydrationRow(dbRow(o))].filter(Boolean));

/* -- 1-4: the select itself ------------------------------------------------- */

test("1. HYDRATION_SELECT projects hydration_payload", () => {
  assert.ok(HYDRATION_SELECT.includes("hydration_payload"));
  // 22 originally; +4 when the missing market totals were found in review.
  assert.equal(HYDRATION_ROW_COLUMNS.length, 26);
});

test("2. HYDRATION_SELECT never mentions raw_payload", () => {
  assert.equal(/raw_payload/.test(HYDRATION_SELECT), false);
});

test("3. HYDRATION_SELECT uses no raw_payload-> subpath", () => {
  // A subpath narrows the wire but still detoasts the document (055), so it
  // would defeat the entire point of the cutover.
  assert.equal(/raw_payload\s*->/.test(HYDRATION_SELECT), false);
});

test("4. HYDRATION_SELECT is explicit, never a star", () => {
  assert.equal(HYDRATION_SELECT.includes("*"), false);
});

/* -- 7-18: contract parity, old path vs new -------------------------------- */

const NON_MOMENTUM_FIELDS = [
  "id",
  "leagueId",
  "league",
  "teams",
  "logos",
  "kickoff",
  "status",
  "score",
  "validation",
  "savedAt",
  "modelVersion",
  "referee",
  "cardMarkets",
  "cardMarketValidations",
  "recommendedMarketValid",
  "recommended",
  "probs",
  "predictions",
  "marketResults",
  "marketOdds",
  "confidenceEngine",
  "explanation",
  "featureImportance",
  "teamContext",
  "valueBet",
  "valueEngine",
  "insufficientData",
  "insufficientReason"
];

test("7. every non-momentum board field is deep-equal across the cutover", () => {
  // The reader's OUTPUT, not an intermediate stage.
  const [before] = oldItems();
  const [after] = newItems();
  for (const field of NON_MOMENTUM_FIELDS) {
    assert.deepEqual(after[field], before[field], `${field} diverged across the cutover`);
  }
});

test("7b. the two pipelines return the same number of rows", () => {
  assert.equal(newItems().length, oldItems().length);
});

test("8-10. logos survive whole - home, away AND the league crest", () => {
  const after = mapNew();
  assert.equal(after.logos.home, "h.png");
  assert.equal(after.logos.away, "a.png");
  // The one with no column. Losing it silently is what blocked A4 the first time.
  assert.equal(after.logos.league, "l.png");
  assert.deepEqual(after.logos, mapOld().logos);
});

test("11. referee is reconstructed from its promoted column", () => {
  assert.equal(mapNew().referee, "A. Referee");
  assert.equal(mapNew().referee, mapOld().referee);
});

test("12-13. cardMarkets and cardMarketValidations survive", () => {
  const after = mapNew();
  assert.deepEqual(after.cardMarkets, mapOld().cardMarkets);
  assert.deepEqual(after.cardMarketValidations, mapOld().cardMarketValidations);
});

test("14. marketResults carries all SIX totals canonicalMarketTotals reads", () => {
  const shimmed = rehydrateHydrationRow(dbRow());
  assert.deepEqual(shimmed.raw_payload.marketResults, {
    cornersTotal: 9,
    shotsOnTargetTotal: 11,
    shotsTotal: 35,
    cardsTotal: 2,
    cardsPoints: 3,
    firstHalfGoals: 1
  });
});

test("15. marketResults stays ABSENT when every total is NULL", () => {
  const shimmed = rehydrateHydrationRow(dbRow(ALL_TOTALS_NULL));
  assert.ok(
    !("marketResults" in shimmed.raw_payload),
    "an absent total must never read as a real zero"
  );
});

test("15b. one present total is enough to synthesise", () => {
  const shimmed = rehydrateHydrationRow(dbRow({ ...ALL_TOTALS_NULL, cards_total: 4 }));
  assert.equal(shimmed.raw_payload.marketResults.cardsTotal, 4);
  assert.equal(shimmed.raw_payload.marketResults.cornersTotal, null);
});

test("16. recommended preserves absent-vs-null exactly", () => {
  const absent = buildHydrationPayload({ ...FULL_DOC, recommended: { pick: "1", confidence: 61 } });
  assert.ok(!("odd" in absent.recommended), "an omitted odd stays omitted");

  const nulled = buildHydrationPayload({ ...FULL_DOC, recommended: { pick: "1", odd: null } });
  assert.equal(nulled.recommended.odd, null, "an explicit null stays null");
});

test("17. valueEngine matches the old path exactly, after the shared projection", () => {
  const [before] = oldItems();
  const [after] = newItems();
  assert.deepEqual(after.valueEngine, before.valueEngine);
  // and the projection really did narrow the evaluated set on both sides
  assert.equal(after.valueEngine.markets.length, 1);
  assert.equal(after.valueEngine.markets[0].family, "cards");
});

test("18. prediction analytics fields match", () => {
  const before = mapOld();
  const after = mapNew();
  assert.deepEqual(after.predictions.marketTiers, before.predictions.marketTiers);
  assert.deepEqual(after.predictions.cards, before.predictions.cards);
  assert.deepEqual(after.probs, before.probs);
  assert.deepEqual(after.marketOdds, before.marketOdds);
  assert.deepEqual(after.confidenceEngine, before.confidenceEngine);
  assert.deepEqual(after.teamContext, before.teamContext);
  assert.deepEqual(after.featureImportance, before.featureImportance);
  assert.deepEqual(after.explanation, before.explanation);
  assert.equal(after.insufficientData, before.insufficientData);
  assert.equal(after.insufficientReason, before.insufficientReason);
});

/* -- 19-21: the loop guard and momentum ------------------------------------ */

/** Mirrors src/pages/userDashboard/helpers.ts hasLegacyPredictionShape. */
function hasLegacyPredictionShape(rows, accessTier) {
  const tier = String(accessTier || "free").toLowerCase();
  return rows.some((row) => {
    if (row?.insufficientData) return false;
    const probs = row?.probs;
    if (tier === "ultra") return !probs?.corners || !probs?.shotsOnTarget;
    if (tier === "premium") return !probs?.corners;
    if (row?.modelVersion) return false;
    const hasExactConfidence =
      row?.recommended?.confidence != null && Number.isFinite(Number(row?.recommended?.confidence));
    if (hasExactConfidence) return !probs?.firstHalf || !probs?.corners || !probs?.shotsOnTarget;
    return !probs?.firstHalf && !probs?.corners && !probs?.shotsOnTarget && !probs?.shotsTotal;
  });
}

test("19. a reconstructed row never looks legacy - free, premium and ultra", () => {
  const row = mapNew();
  assert.ok(row.probs.corners && row.probs.shotsOnTarget && row.probs.firstHalf && row.probs.shotsTotal);
  assert.ok(row.modelVersion);
  for (const tier of ["free", "premium", "ultra"]) {
    assert.equal(hasLegacyPredictionShape([row], tier), false, `${tier} saw a legacy row`);
  }
});

test("20. momentum is omitted from the reconstructed row", () => {
  const after = mapNew();
  assert.equal(after.momentum, undefined);
  // and the old path DID carry it - so this is a real, deliberate difference
  assert.ok(mapOld().momentum);
});

/** Mirrors useLiveFixtureScorePoll.mergeLiveMomentum for the no-previous case. */
function mergeLiveMomentum(previous, incoming) {
  if (incoming) {
    const history = [];
    if (!previous) return { ...incoming, history };
    return { ...incoming, trend: "stable", history };
  }
  return previous || null;
}

test("21. the first live poll restores momentum in full", () => {
  const restored = mapNew();
  const incoming = { homeMomentum: 62, awayMomentum: 38, trend: "up", confidence: 70 };
  const merged = mergeLiveMomentum(restored.momentum, incoming);
  assert.equal(merged.homeMomentum, 62);
  assert.equal(merged.trend, "up", "the server's own trend, not one diffed from stale state");
  assert.deepEqual(merged.history, []);
});

/* -- 22: NULL safety -------------------------------------------------------- */

test("22. a NULL hydration_payload is skipped, never partially rebuilt", () => {
  for (const bad of [null, undefined, "x", 42, []]) {
    assert.equal(rehydrateHydrationRow(dbRow({ hydration_payload: bad })), null);
  }
});

test("22b. a skipped row can never re-arm the rehydrate loop", () => {
  // The failure mode: a partial row missing `probs` reads as legacy, which
  // re-triggers the very fetch that produced it. Skipping is what prevents it.
  const rows = [dbRow(), dbRow({ fixture_id: 2, hydration_payload: null })]
    .map(rehydrateHydrationRow)
    .filter(Boolean);
  assert.equal(rows.length, 1);
  assert.equal(hasLegacyPredictionShape(rows.map(mapDbRowToHistoryEntry), "ultra"), false);
});

/* -- 23: stats parity ------------------------------------------------------- */

test("23. aggregateCardMarketStats is identical on old and new rows", () => {
  const before = aggregateCardMarketStats([oldRow()]);
  const after = aggregateCardMarketStats([rehydrateHydrationRow(dbRow())]);
  assert.deepEqual(after, before);
});

test("23b. stats parity holds on a settled fixture too", () => {
  const validations = { corners: "win", recommended: "win" };
  const settled = {
    match_status: "FT",
    score_home: 2,
    score_away: 1,
    validation: "win",
    card_market_validations: validations
  };
  // Column AND document moved together, exactly as the dual-write keeps them.
  const before = aggregateCardMarketStats([oldRow(settled, { cardMarketValidations: validations })]);
  const after = aggregateCardMarketStats([rehydrateHydrationRow(dbRow(settled))]);
  assert.deepEqual(after, before);
  assert.ok(before.settled > 0, "the fixture must actually settle, or this proves nothing");
});

test("23c. settlement state is sourced from the COLUMN after the cutover", () => {
  /*
    A real and deliberate difference worth pinning: the old path read
    cardMarketValidations out of raw_payload; the new one reads the promoted
    column. Production dual-writes both from the same object, so they agree - but
    if they ever diverged, THIS is the behaviour that would change, and a future
    reader should see that stated rather than discover it.
  */
  const validations = { corners: "win", recommended: "win" };
  const stats = aggregateCardMarketStats([
    rehydrateHydrationRow(
      dbRow({ match_status: "FT", score_home: 2, score_away: 1, card_market_validations: validations })
    )
  ]);
  assert.equal(stats.settled, 2);
  assert.equal(stats.wins, 2);
});

/* -- shim discipline -------------------------------------------------------- */


/* -- SIX-TOTAL PARITY -------------------------------------------------------
   canonicalMarketTotals reads cornersTotal, shotsOnTargetTotal, shotsTotal,
   cardsTotal, cardsPoints and firstHalfGoals. resolveCardMarketValidations
   re-settles markets still PENDING from that bag, and the Cards and Total Shots
   families grade against cards_total / shots_total specifically.

   Projecting only corners + shots-on-target therefore re-graded those two
   families against nulls. Every test below fails against that implementation.
   ------------------------------------------------------------------------- */

const ALL_TOTALS_NULL = {
  corners_total: null,
  shots_on_target_total: null,
  shots_total: null,
  cards_total: null,
  cards_points: null,
  first_half_goals: null
};

/**
 * A row whose RECOMMENDED slot is a still-pending market of the given family.
 *
 * Cards and Total Shots do NOT have their own market keys - MARKET_KEYS is
 * ["recommended","goals","corners","shots"] - so both grade through the
 * recommended slot via resolveRecommendedValidation, which reads cardsTotal /
 * shotsTotal out of the totals bag. Verified against settleCardMarkets: with all
 * six totals a pending Cards pick resolves "win"; with only corners and
 * shots-on-target it stays "pending". That difference is what these tests catch.
 */
function pendingFamily(family, pick) {
  const cardMarkets = { recommended: { pick, family }, goals: null, corners: null, shots: null };
  const cardMarketValidations = { recommended: "pending", goals: null, corners: null, shots: null };
  const doc = { ...FULL_DOC, recommended: { pick, confidence: 61, odd: 1.9, family }, cardMarkets, cardMarketValidations };
  const cols = {
    match_status: "FT",
    score_home: 2,
    score_away: 1,
    recommended_pick: pick,
    card_markets: cardMarkets,
    card_market_validations: cardMarketValidations,
    hydration_payload: buildHydrationPayload(doc)
  };
  return { doc, cols };
}

function comparePaths(family, pick) {
  const { doc, cols } = pendingFamily(family, pick);
  const before = aggregateCardMarketStats([oldRow(cols, doc)]);
  const after = aggregateCardMarketStats([rehydrateHydrationRow(dbRow(cols))]);
  return { before, after };
}

test("T1. pending CARDS recommended settles identically on both paths", () => {
  const { before, after } = comparePaths("Cards", "Cards Over 4.5");
  assert.deepEqual(after, before, "cards_total must reach canonicalMarketTotals");
  // Without cards_total the slot stays pending and settles nothing - so a
  // non-zero settled count is what proves this fixture actually exercises it.
  assert.ok(before.settled > 0, "the Cards slot must really settle, or this proves nothing");
});

test("T2. pending TOTAL SHOTS recommended settles identically on both paths", () => {
  const { before, after } = comparePaths("Shots", "Shots Over 30.5");
  assert.deepEqual(after, before, "shots_total must reach canonicalMarketTotals");
  assert.ok(before.settled > 0, "the Shots slot must really settle, or this proves nothing");
});

test("T3. pending FIRST HALF market - firstHalfGoals survives", () => {
  const shimmed = rehydrateHydrationRow(dbRow());
  assert.equal(shimmed.raw_payload.marketResults.firstHalfGoals, 1);
});

test("T4. cardsPoints is preserved even though no market settles against it", () => {
  const shimmed = rehydrateHydrationRow(dbRow());
  assert.equal(shimmed.raw_payload.marketResults.cardsPoints, 3);
});

test("T5. settled CARDS agrees across the cutover", () => {
  const validations = { recommended: "win", goals: null, corners: null, shots: null };
  const cols = { match_status: "FT", score_home: 2, score_away: 1, card_market_validations: validations };
  const before = aggregateCardMarketStats([oldRow(cols, { cardMarketValidations: validations })]);
  const after = aggregateCardMarketStats([rehydrateHydrationRow(dbRow(cols))]);
  assert.deepEqual(after, before);
  assert.ok(before.settled > 0);
});

test("T6. settled TOTAL SHOTS agrees across the cutover", () => {
  const validations = { recommended: "win", goals: null, corners: null, shots: "win" };
  const cols = { match_status: "FT", score_home: 1, score_away: 1, card_market_validations: validations };
  const before = aggregateCardMarketStats([oldRow(cols, { cardMarketValidations: validations })]);
  const after = aggregateCardMarketStats([rehydrateHydrationRow(dbRow(cols))]);
  assert.deepEqual(after, before);
  assert.ok(before.settled > 0);
});

test("T7. all six totals populated - shim matches the document exactly", () => {
  const shimmed = rehydrateHydrationRow(dbRow());
  assert.deepEqual(shimmed.raw_payload.marketResults, FULL_DOC.marketResults);
});

test("T8. only corners + shotsOnTarget populated - the other four stay null, not absent", () => {
  const shimmed = rehydrateHydrationRow(dbRow({ ...ALL_TOTALS_NULL, corners_total: 9, shots_on_target_total: 11 }));
  assert.deepEqual(shimmed.raw_payload.marketResults, {
    cornersTotal: 9,
    shotsOnTargetTotal: 11,
    shotsTotal: null,
    cardsTotal: null,
    cardsPoints: null,
    firstHalfGoals: null
  });
});

test("T9. all six NULL - marketResults is absent, never a bag of nulls", () => {
  const shimmed = rehydrateHydrationRow(dbRow(ALL_TOTALS_NULL));
  assert.ok(!("marketResults" in shimmed.raw_payload));
});

test("T10. column/document disagreement proves A4 reads the COLUMN", () => {
  /*
    hydration_payload never stores marketResults, so the column is the only
    possible source. Production cannot actually disagree: mapPredictionToDbRow
    writes `raw_payload: payloadWithMeta` alongside
    `...deriveHistoryListColumns(payloadWithMeta)`, and the settlement writer
    pairs `raw_payload: enrichedPayload` with
    `...deriveMutableHistoryListColumns(enrichedPayload)`. Both values come from
    ONE canonical in-memory object in a single statement, which is the invariant
    this parity rests on.
  */
  const shimmed = rehydrateHydrationRow(dbRow({ cards_total: 2 }));
  assert.equal(shimmed.raw_payload.marketResults.cardsTotal, 2);
  assert.ok(!("marketResults" in dbRow().hydration_payload), "the payload must not carry totals");
});

test("T11. the full board pipeline still agrees with all six totals in play", () => {
  const [before] = oldItems();
  const [after] = newItems();
  for (const field of NON_MOMENTUM_FIELDS) {
    assert.deepEqual(after[field], before[field], `${field} diverged`);
  }
});

test("T12. COUPLING GUARD - the shim carries exactly the totals canonicalMarketTotals reads", () => {
  /*
    The gap this suite exists for: HYDRATION_SELECT and canonicalMarketTotals are
    two lists with no automatic link between them. Projecting a subset silently
    re-grades pending markets against nulls rather than erroring.

    This asserts the two agree BY DERIVATION rather than by a hand-copied list,
    so adding a seventh total to canonicalMarketTotals fails here until
    HYDRATION_ROW_COLUMNS and the shim carry it too.
  */
  const canonicalKeys = Object.keys(canonicalMarketTotals({})).sort();
  const shimKeys = Object.keys(rehydrateHydrationRow(dbRow()).raw_payload.marketResults).sort();
  assert.deepEqual(shimKeys, canonicalKeys, "HYDRATION_SELECT is out of step with the settlement total contract");

  // and each one must be backed by a projected column, not invented here
  const COLUMN_FOR = {
    cornersTotal: "corners_total",
    shotsOnTargetTotal: "shots_on_target_total",
    shotsTotal: "shots_total",
    cardsTotal: "cards_total",
    cardsPoints: "cards_points",
    firstHalfGoals: "first_half_goals"
  };
  for (const key of canonicalKeys) {
    assert.ok(COLUMN_FOR[key], `no promoted column mapped for ${key}`);
    assert.ok(HYDRATION_ROW_COLUMNS.includes(COLUMN_FOR[key]), `${COLUMN_FOR[key]} missing from HYDRATION_SELECT`);
  }
});

test("the shim injects exactly four values, and no logos among them", () => {
  const shimmed = rehydrateHydrationRow(dbRow());
  const stored = dbRow().hydration_payload;
  const injected = Object.keys(shimmed.raw_payload).filter((k) => !(k in stored));
  assert.deepEqual(injected.sort(), ["cardMarketValidations", "cardMarkets", "marketResults", "referee"]);
  // logos comes from the payload, NOT from logo_home/logo_away.
  assert.ok("logos" in stored);
});

test("the shim does not mutate the row or the stored payload", () => {
  const row = dbRow();
  const before = JSON.stringify(row);
  rehydrateHydrationRow(row);
  assert.equal(JSON.stringify(row), before);
});

test("referee is injected only when the column holds a value", () => {
  const shimmed = rehydrateHydrationRow(dbRow({ referee_name: null }));
  assert.ok(!("referee" in shimmed.raw_payload), "a missing name must not become an explicit null");
});
