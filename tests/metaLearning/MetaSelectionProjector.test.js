import test from "node:test";
import assert from "node:assert/strict";

import {
  detectSettlementDisagreement,
  gradeSelection,
  priceFromOurRecord,
  projectMetaRows
} from "../../server-utils/metaLearning/MetaSelectionProjector.js";
import { resolveMarketFamily, resolveLine } from "../../server-utils/metaLearning/marketFamily.js";
import { isAbstention, extractTeamIds } from "../../server-utils/metaLearning/providers/apiFootballProvider.js";
import { resolveOwnPrice } from "../../server-utils/metaLearning/providers/predictorV3Provider.js";

const PROVIDER_IDS = new Map([
  ["predictor_v3", 1],
  ["api_football", 2]
]);

function historyRow(overrides = {}) {
  return {
    fixture_id: 555,
    league_id: 39,
    league_name: "Premier League",
    kickoff_at: "2026-08-05T18:00:00.000Z",
    recommended_pick: "1",
    recommended_confidence: 68,
    odds_home: 1.75,
    odds_draw: 3.8,
    odds_away: 4.6,
    closing_odds_home: 1.7,
    match_status: "FT",
    score_home: 2,
    score_away: 1,
    validation: "win",
    updated_at: "2026-08-05T20:00:00.000Z",
    raw_payload: { recommended: { pick: "1", family: "1X2", odd: 1.75, confidence: 68 } },
    ...overrides
  };
}

function benchmarkRow(overrides = {}) {
  return {
    fixture_id: 555,
    league_id: 39,
    kickoff_at: "2026-08-05T18:00:00.000Z",
    api_result: "loss",
    settled_at: "2026-08-05T20:00:00.000Z",
    api_prediction: { winPercent: { home: 30, draw: 25, away: 45 }, underOver: "+2.5" },
    api_raw: { teams: { home: { id: 33 }, away: { id: 40 } } },
    agree: false,
    consensus: {
      familyComparable: true,
      agree: false,
      apiPick: { inferredPick: "2", family: "1x2", confidencePct: 45, source: "winner" },
      perFamilyBreakdown: {
        "1x2": { agree: false, ourSide: "1", apiSide: "2", lineMismatch: false },
        ou: { agree: null, ourSide: null, apiSide: "over", lineMismatch: false }
      }
    },
    ...overrides
  };
}

// --- market family -----------------------------------------------------------------

test("declared family wins over the lossy pick-string derivation", () => {
  assert.equal(resolveMarketFamily("1", "1X2"), "1x2");
  assert.equal(resolveMarketFamily("1X", "Double Chance"), "dc");
  assert.equal(resolveMarketFamily("GG", "BTTS"), "btts");
  assert.equal(resolveMarketFamily("Over 8.5", "Corners"), "corners");
});

test("a goals O/U line stays 'ou' but any other total becomes 'ou_other'", () => {
  assert.equal(resolveMarketFamily("Over 2.5", "Goals"), "ou");
  assert.equal(resolveMarketFamily("Under 3.5", "Over/Under"), "ou");
  // A totals market on a non-goals line must never line up against API-Football's goals
  // under_over — that was the whole point of splitting ou_other out.
  assert.equal(resolveMarketFamily("Over 9.5", "Goals"), "ou_other");
});

test("Romanian pick wording parses the same as English", () => {
  assert.equal(resolveMarketFamily("Peste 2.5", "Goals"), "ou");
  assert.equal(resolveLine("Peste 2.5"), 2.5);
  assert.equal(resolveLine("Sub 3.5"), 3.5);
  assert.equal(resolveLine("1"), null);
});

// --- pricing -----------------------------------------------------------------------

test("our own selection prefers the quote the recommendation carried", () => {
  const priced = resolveOwnPrice(historyRow());
  assert.equal(priced.pricedOdd, 1.75);
  assert.equal(priced.pricedFrom, "own_quote");
});

test("our own selection falls back to the recorded 1X2 column when no quote was stored", () => {
  const priced = resolveOwnPrice(historyRow({ raw_payload: { recommended: { pick: "1", family: "1X2" } } }));
  assert.equal(priced.pricedOdd, 1.75);
  assert.equal(priced.pricedFrom, "our_recorded_1x2");
});

test("a missing price is 'unpriced', never zero", () => {
  const priced = resolveOwnPrice(
    historyRow({
      recommended_pick: "GG",
      odds_home: null,
      odds_draw: null,
      odds_away: null,
      raw_payload: { recommended: { pick: "GG", family: "BTTS" } }
    })
  );
  assert.equal(priced.pricedOdd, null);
  assert.equal(priced.pricedFrom, "unpriced");
});

test("a provider 1X2 selection is priced counterfactually from our recorded odds", () => {
  const priced = priceFromOurRecord(historyRow(), "2");
  assert.equal(priced.pricedOdd, 4.6);
  assert.equal(priced.pricedFrom, "our_recorded_1x2");
});

test("CLV is computed only when a closing price exists for that side", () => {
  const home = priceFromOurRecord(historyRow(), "1");
  assert.equal(home.closingOdd, 1.7);
  assert.ok(home.clvPct > 0, "1.75 taken vs 1.70 close is positive CLV");

  const away = priceFromOurRecord(historyRow(), "2");
  assert.equal(away.closingOdd, null);
  assert.equal(away.clvPct, null);
});

test("a provider selection in a market we never priced stays unpriced", () => {
  const priced = priceFromOurRecord(historyRow(), "Over 2.5");
  assert.equal(priced.pricedOdd, null);
  assert.equal(priced.pricedFrom, "unpriced");
});

// --- grading -----------------------------------------------------------------------

test("grading settles the score-derivable families", () => {
  const row = historyRow();
  assert.equal(gradeSelection("1", row, "1x2"), "win");
  assert.equal(gradeSelection("2", row, "1x2"), "loss");
  assert.equal(gradeSelection("Over 2.5", row, "ou"), "win"); // 2-1 = 3 goals
  assert.equal(gradeSelection("Under 2.5", row, "ou"), "loss");
  assert.equal(gradeSelection("GG", row, "btts"), "win");
});

test("a corners line is never graded against the goal count", () => {
  // evaluateTopPick() parses any "Over 7.5" as a goals total, so without the family guard
  // a corners bet would be scored against the 2-1 scoreline and marked a loss.
  assert.equal(gradeSelection("Over 7.5", historyRow(), "corners"), "ungradeable");
  assert.equal(gradeSelection("Over 9.5", historyRow(), "ou_other"), "ungradeable");
  assert.equal(gradeSelection("2-1", historyRow(), "correct_score"), "ungradeable");
});

test("an unfinished match grades to pending, not loss", () => {
  const row = historyRow({ match_status: "NS", score_home: null, score_away: null });
  assert.equal(gradeSelection("1", row, "1x2"), "pending");
});

// --- settlement integrity ----------------------------------------------------------

test("a stored validation that contradicts re-grading is flagged", () => {
  assert.equal(detectSettlementDisagreement(historyRow()), false);
  // Stored 'loss' but 2-1 means a home pick won.
  assert.equal(detectSettlementDisagreement(historyRow({ validation: "loss" })), true);
});

test("a market evaluateTopPick cannot grade is not a disagreement", () => {
  // Corners settle through resolveRecommendedValidation(), not evaluateTopPick — the
  // stored validation is authoritative and must not be second-guessed here.
  const row = historyRow({
    recommended_pick: "Over 8.5",
    validation: "win",
    raw_payload: { recommended: { pick: "Over 8.5", family: "Corners", odd: 1.9 } }
  });
  assert.equal(detectSettlementDisagreement(row), false);
});

// --- provider adapter --------------------------------------------------------------

test("team ids are recovered from the stored raw response", () => {
  assert.deepEqual(extractTeamIds(benchmarkRow()), { homeTeamId: 33, awayTeamId: 40 });
  assert.deepEqual(extractTeamIds({}), { homeTeamId: null, awayTeamId: null });
});

test("a tied percent triple with no inferred pick is an abstention", () => {
  const row = benchmarkRow({
    consensus: { apiPick: { inferredPick: null }, perFamilyBreakdown: {} },
    api_prediction: { winPercent: { home: 33, draw: 33, away: 33 } }
  });
  assert.equal(isAbstention(row), true);
  assert.equal(isAbstention(benchmarkRow()), false);
});

// --- projection --------------------------------------------------------------------

test("projection emits our selection, the provider's primary and its secondary opinion", () => {
  const { contexts, selections, diagnostics } = projectMetaRows({
    historyRows: [historyRow()],
    benchmarkRows: [benchmarkRow()],
    modelVersion: "v3-test",
    providerIdByKey: PROVIDER_IDS
  });

  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].home_team_id, 33, "team ids come from the benchmark payload, not a refetch");
  assert.equal(diagnostics.ourSelections, 1);
  assert.equal(diagnostics.providerSelections, 2, "primary 1x2 plus the secondary ou opinion");
  assert.equal(diagnostics.providerSecondarySelections, 1);

  const ours = selections.find((s) => s.provider_id === 1);
  assert.equal(ours.market_family, "1x2");
  assert.equal(ours.result, "win");
  assert.equal(ours.priced_from, "own_quote");
  assert.equal(ours.pnl_units, 0.75);

  const primary = selections.find((s) => s.provider_id === 2 && s.is_primary);
  assert.equal(primary.selection, "2");
  assert.equal(primary.result, "loss");
  assert.equal(primary.priced_from, "our_recorded_1x2");
  assert.equal(primary.pnl_units, -1);
  assert.equal(primary.stated_confidence, 45);

  const secondary = selections.find((s) => s.provider_id === 2 && !s.is_primary);
  assert.equal(secondary.market_family, "ou");
  assert.equal(
    secondary.stated_confidence,
    null,
    "winPercent maps onto 1X2 only — a secondary family must not borrow it"
  );
});

test("a fixture whose settlement paths disagree is dropped entirely", () => {
  const { contexts, selections, diagnostics } = projectMetaRows({
    historyRows: [historyRow({ validation: "loss" })],
    benchmarkRows: [benchmarkRow()],
    modelVersion: "v3-test",
    providerIdByKey: PROVIDER_IDS
  });

  assert.equal(diagnostics.settlementDisagreementsDropped, 1);
  assert.equal(contexts.length, 0);
  assert.equal(selections.length, 0, "a pair settled by two different rules is not a valid observation");
});

test("a fixture with no benchmark row still yields our own selection", () => {
  const { selections, diagnostics } = projectMetaRows({
    historyRows: [historyRow()],
    benchmarkRows: [],
    modelVersion: "v3-test",
    providerIdByKey: PROVIDER_IDS
  });
  assert.equal(diagnostics.ourSelections, 1);
  assert.equal(diagnostics.providerSelections, 0);
  assert.equal(selections.length, 1);
});

test("projection is deterministic and re-runnable on the same input", () => {
  const input = {
    historyRows: [historyRow()],
    benchmarkRows: [benchmarkRow()],
    modelVersion: "v3-test",
    providerIdByKey: PROVIDER_IDS
  };
  const first = projectMetaRows(input);
  const second = projectMetaRows(input);
  assert.equal(first.selections.length, second.selections.length);
  assert.deepEqual(
    first.selections.map((s) => `${s.provider_id}|${s.market_family}|${s.selection}`).sort(),
    second.selections.map((s) => `${s.provider_id}|${s.market_family}|${s.selection}`).sort()
  );
});

test("an unregistered provider key yields no rows rather than a null provider_id", () => {
  const { selections } = projectMetaRows({
    historyRows: [historyRow()],
    benchmarkRows: [benchmarkRow()],
    modelVersion: "v3-test",
    providerIdByKey: new Map()
  });
  assert.equal(selections.length, 0);
});
