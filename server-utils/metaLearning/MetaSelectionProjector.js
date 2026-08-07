/**
 * Projects predictions_history + prediction_benchmarks into the selection grain
 * (meta_provider_selections) plus the derived context rows (meta_fixture_context).
 *
 * PURE + READ-ONLY: takes already-fetched rows, returns rows to upsert. No Supabase
 * access, no upstream calls, no import from PredictorV3 / PredictionEngine / pipeline /
 * confidence / value. Settlement is delegated to predictionsHistory.js — the single
 * grading authority in this repo — and never re-implemented.
 *
 * Counterfactual pricing (the reason a provider that publishes no odds can still have a
 * ROI): a provider selection is priced at the market odd WE recorded for that same
 * selection on that same fixture. That is a real, auditable counterfactual — "if we had
 * staked 1u on their pick at the price our feed showed when we published, the P&L would
 * have been X" — not a fabricated quote. Every row carries `priced_from` provenance, and
 * anything unpriceable stays `unpriced` so ROI aggregates can exclude it instead of
 * silently treating a missing price as a zero.
 */

import { evaluateTopPick, isFinalStatus } from "../predictionsHistory.js";
import { resolveMarketFamily } from "./marketFamily.js";
import { buildFixtureContext } from "./MetaContextBuilder.js";
import * as predictorV3Provider from "./providers/predictorV3Provider.js";
import * as apiFootballProvider from "./providers/apiFootballProvider.js";

function toNumber(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const SIDE_TO_ODDS_COLUMN = { "1": "odds_home", x: "odds_draw", "2": "odds_away" };
const SIDE_TO_CLOSING_COLUMN = {
  "1": "closing_odds_home",
  x: "closing_odds_draw",
  "2": "closing_odds_away"
};

/**
 * Price a provider selection from our own recorded market data.
 * @returns {{ pricedOdd: number|null, pricedFrom: string, closingOdd: number|null, clvPct: number|null }}
 */
export function priceFromOurRecord(historyRow, selection) {
  const empty = { pricedOdd: null, pricedFrom: "unpriced", closingOdd: null, clvPct: null };
  if (!historyRow) return empty;

  const key = String(selection || "").trim().toLowerCase();
  const column = SIDE_TO_ODDS_COLUMN[key];

  let pricedOdd = null;
  let pricedFrom = "unpriced";

  if (column) {
    const odd = toNumber(historyRow[column]);
    if (odd != null && odd > 1) {
      pricedOdd = odd;
      pricedFrom = "our_recorded_1x2";
    }
  }

  if (pricedOdd == null) {
    const payload =
      historyRow.raw_payload && typeof historyRow.raw_payload === "object" ? historyRow.raw_payload : {};
    const quoteType = String(payload.valueEngine?.bestMarket?.type ?? payload.valueBet?.type ?? "")
      .trim()
      .toLowerCase();
    const quote = toNumber(payload.valueEngine?.bestMarket?.odds ?? payload.valueBet?.odds);
    if (quote != null && quote > 1 && quoteType && quoteType === key) {
      pricedOdd = quote;
      pricedFrom = "our_value_quote";
    }
  }

  if (pricedOdd == null) return empty;

  const closingColumn = SIDE_TO_CLOSING_COLUMN[key];
  const closingOdd = closingColumn ? toNumber(historyRow[closingColumn]) : null;
  const clvPct =
    closingOdd != null && closingOdd > 1 ? Number(((pricedOdd / closingOdd - 1) * 100).toFixed(4)) : null;

  return { pricedOdd, pricedFrom, closingOdd, clvPct };
}

/**
 * Families evaluateTopPick() settles from the final score alone. `ou` is GOALS over/under
 * only — this guard is load-bearing, because evaluateTopPick() parses any "Over 7.5" as a
 * goals total, so handing it a corners or cards line would silently grade a corners bet
 * against the goal count and score it a loss almost every time.
 */
const SCORE_GRADEABLE_FAMILIES = new Set(["1x2", "dc", "btts", "ou"]);

/**
 * Grade a selection from the stored score. Returns 'ungradeable' rather than 'loss' for
 * markets that cannot be settled this way (corners/cards/shots/correct score, and any
 * non-goals O/U line) — recording a miss for a market we simply cannot grade would poison
 * every hit rate downstream.
 */
export function gradeSelection(selection, historyRow, marketFamily) {
  if (!historyRow) return "pending";
  if (marketFamily != null && !SCORE_GRADEABLE_FAMILIES.has(marketFamily)) return "ungradeable";
  if (!isFinalStatus(historyRow.match_status)) return "pending";
  const outcome = evaluateTopPick(selection, {
    home: historyRow.score_home,
    away: historyRow.score_away
  });
  if (outcome === true) return "win";
  if (outcome === false) return "loss";
  return "ungradeable";
}

/**
 * Our own pick, graded independently of `validation`.
 *
 * The sweep copies our_result from predictions_history.validation (which routes through
 * resolveRecommendedValidation() and therefore handles card/corner markets) but grades the
 * API side with evaluateTopPick() directly. For the comparable families the two agree; we
 * ASSERT that rather than assume it, and drop any pair where they disagree, because a pair
 * settled by two different rules is not a valid head-to-head observation.
 */
export function detectSettlementDisagreement(historyRow) {
  if (!historyRow) return false;
  if (!isFinalStatus(historyRow.match_status)) return false;
  const stored = historyRow.validation;
  if (stored !== "win" && stored !== "loss") return false;

  // Family guard first, and it is load-bearing. evaluateTopPick() parses ANY over/under
  // as a goals total, so a corners "Over 8.5" gets graded against the goal count and
  // comes back false — which would flag every winning corners pick as a settlement
  // conflict and drop its whole fixture. Those markets settle through
  // resolveRecommendedValidation(); `validation` is authoritative and is not re-derived.
  const family = resolveMarketFamily(historyRow.recommended_pick, historyRow.raw_payload?.recommended?.family);
  if (!SCORE_GRADEABLE_FAMILIES.has(family)) return false;

  const recomputed = evaluateTopPick(historyRow.recommended_pick, {
    home: historyRow.score_home,
    away: historyRow.score_away
  });
  // null => not gradeable from the score after all; defer to the stored validation.
  if (recomputed == null) return false;
  return (recomputed ? "win" : "loss") !== stored;
}

function toSelectionRow(selection, providerIdByKey) {
  const providerId = providerIdByKey.get(selection.providerKey);
  if (providerId == null) return null;
  return {
    fixture_id: selection.fixtureId,
    provider_id: providerId,
    model_version: selection.modelVersion,
    market_family: selection.marketFamily,
    selection: selection.selection,
    line: selection.line,
    is_primary: selection.isPrimary,
    stated_confidence: selection.statedConfidence,
    signal_source: selection.signalSource,
    signal_quality: selection.signalQuality,
    priced_odd: selection.pricedOdd ?? null,
    priced_from: selection.pricedFrom || "unpriced",
    closing_odd: selection.closingOdd ?? null,
    clv_pct: selection.clvPct ?? null,
    result: selection.result || "pending",
    pnl_units: selection.pnlUnits ?? null,
    kickoff_at: selection.kickoffAt,
    settled_at: selection.settledAt ?? null,
    source_row: selection.sourceRow ?? null
  };
}

function computePnl(result, pricedOdd) {
  if (pricedOdd == null || pricedOdd <= 1) return null;
  if (result === "win") return Number((pricedOdd - 1).toFixed(6));
  if (result === "loss") return -1;
  return null;
}

/**
 * @param {{ historyRows: object[], benchmarkRows: object[], modelVersion: string,
 *   providerIdByKey: Map<string, number> }} input
 * @returns {{ contexts: object[], selections: object[], diagnostics: object }}
 */
export function projectMetaRows({ historyRows = [], benchmarkRows = [], modelVersion, providerIdByKey }) {
  const historyByFixture = new Map();
  for (const row of historyRows) {
    const id = toNumber(row?.fixture_id);
    if (id != null) historyByFixture.set(id, row);
  }

  const benchmarkByFixture = new Map();
  for (const row of benchmarkRows) {
    const id = toNumber(row?.fixture_id);
    if (id != null) benchmarkByFixture.set(id, row);
  }

  const diagnostics = {
    historyRows: historyRows.length,
    benchmarkRows: benchmarkRows.length,
    contexts: 0,
    ourSelections: 0,
    providerSelections: 0,
    providerSecondarySelections: 0,
    providerAbstentions: 0,
    settlementDisagreementsDropped: 0,
    unpricedProviderSelections: 0,
    adviceSourcedSelections: 0,
    teamIdsRecovered: 0
  };

  const contexts = [];
  const selections = [];
  const droppedFixtures = new Set();

  for (const [fixtureId, historyRow] of historyByFixture.entries()) {
    if (detectSettlementDisagreement(historyRow)) {
      diagnostics.settlementDisagreementsDropped += 1;
      droppedFixtures.add(fixtureId);
      continue;
    }

    const benchmarkRow = benchmarkByFixture.get(fixtureId) || null;
    const teamIds = benchmarkRow
      ? apiFootballProvider.extractTeamIds(benchmarkRow)
      : { homeTeamId: null, awayTeamId: null };
    if (teamIds.homeTeamId != null) diagnostics.teamIdsRecovered += 1;

    const context = buildFixtureContext(historyRow, {
      modelVersion,
      homeTeamId: teamIds.homeTeamId,
      awayTeamId: teamIds.awayTeamId
    });
    if (context) {
      contexts.push(context);
      diagnostics.contexts += 1;
    }

    for (const selection of predictorV3Provider.extractSelections(historyRow, { modelVersion })) {
      const row = toSelectionRow(
        { ...selection, pnlUnits: computePnl(selection.result, selection.pricedOdd) },
        providerIdByKey
      );
      if (row) {
        selections.push(row);
        diagnostics.ourSelections += 1;
      }
    }

    if (!benchmarkRow) continue;

    if (apiFootballProvider.isAbstention(benchmarkRow)) diagnostics.providerAbstentions += 1;

    for (const selection of apiFootballProvider.extractSelections(benchmarkRow, { modelVersion })) {
      const priced = priceFromOurRecord(historyRow, selection.selection);
      const result =
        selection.result ?? gradeSelection(selection.selection, historyRow, selection.marketFamily);
      const enriched = {
        ...selection,
        ...priced,
        result,
        pnlUnits: computePnl(result, priced.pricedOdd),
        settledAt: selection.settledAt ?? (result === "pending" ? null : historyRow.updated_at || null)
      };

      const row = toSelectionRow(enriched, providerIdByKey);
      if (!row) continue;
      selections.push(row);
      diagnostics.providerSelections += 1;
      if (!selection.isPrimary) diagnostics.providerSecondarySelections += 1;
      if (enriched.pricedFrom === "unpriced") diagnostics.unpricedProviderSelections += 1;
      if (selection.signalQuality === 3) diagnostics.adviceSourcedSelections += 1;
    }
  }

  diagnostics.droppedFixtures = droppedFixtures.size;
  return { contexts, selections, diagnostics };
}

export default {
  projectMetaRows,
  priceFromOurRecord,
  gradeSelection,
  detectSettlementDisagreement
};
