/**
 * The prediction hydration projection — server side.
 *
 * `/api/history` with `mine=1` and no `view` is the prediction hydration source:
 * usePredictionsCache.rehydratePredictionsFromHistory() pipes the response into
 * setPreds. Measured on one real user, one cold start: 184 items, 45,074,431 B,
 * 11.0 s — for a board that renders a scoreline, a recommendation and a value
 * badge.
 *
 * OPT-IN, exactly like the Phase 4I `view=list` token, and for the same reason:
 * narrowing is decided per caller, never globally. `historyService.loadHistory`
 * (the guest/admin observatory surface) now sends `view=list`; the remaining
 * full-shape consumer is the by-fixture detail route, which must keep the whole
 * document. So the server default stays full and each caller asks for the shape
 * it actually reads.
 *
 * MIRRORS src/utils/predictionListProjection.ts. The client never imports
 * server-utils — every cross-boundary rule in this repository is a mirrored
 * constant — so the two lists are kept identical by a drift guard test that
 * imports both and compares them, rather than by a comment asking future readers
 * to remember.
 *
 * What this does NOT do: it reads the mapped row, which came out of
 * `raw_payload`. Postgres still detoasts the document to build it. Narrowing the
 * response shrinks the wire and the client's parse, not the server's read — the
 * same distinction migration 055 measured. The kickoff window is what reduces
 * how many documents get detoasted at all.
 */

/** Every field the restored board reads. Mirrors PREDICTION_STORAGE_FIELDS. */
export const PREDICTION_LIST_FIELDS = Object.freeze([
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
  "insufficientData",
  "insufficientReason",
  "recommended",
  "probs",
  "predictions",
  "cardMarkets",
  "cardMarketValidations",
  "marketResults",
  "marketOdds",
  "confidenceEngine",
  "explanation",
  "featureImportance",
  "teamContext",
  "momentum",
  "valueBet",
  "referee"
]);

/** Mirrors VALUE_ENGINE_STORAGE_FIELDS. `markets` is handled separately. */
export const PREDICTION_LIST_VALUE_ENGINE_FIELDS = Object.freeze([
  "expectedValue",
  "edge",
  "signal",
  "detected",
  "recommendable",
  "negativeEV",
  "positiveEV",
  "kellyPct",
  "valueScore",
  "type",
  "family",
  "bestMarket",
  "positiveEvCount",
  "negativeEvCount",
  "familiesSupported",
  "familiesPresent",
  "rule",
  "highlighted",
  "explanation"
]);

/**
 * specialBet.ts reads valueEngine.markets in exactly one place and keeps the
 * FIRST entry that looks like a cards market. Shipping that one object instead
 * of the whole evaluated set is the single biggest saving here: ~108 KB/row of
 * markets collapses to well under a kilobyte, and the cards leg still renders.
 */
const CARD_MARKET = /card|booking|cartona/i;

function projectValueEngine(engine) {
  const out = {};
  for (const field of PREDICTION_LIST_VALUE_ENGINE_FIELDS) {
    if (field in engine) out[field] = engine[field];
  }
  if (Array.isArray(engine.markets)) {
    const cards = engine.markets.find((m) => CARD_MARKET.test(`${m?.type ?? ""} ${m?.family ?? ""}`));
    if (cards) out.markets = [cards];
  }
  return out;
}

/**
 * A copy of `row` carrying only what the prediction board needs.
 *
 * Pure and non-mutating: mapDbRowToHistoryEntry spreads `...payload`, so the
 * nested objects on a mapped row are the SAME references as the caller's
 * `raw_payload`. Deleting in place would corrupt the database row in memory.
 *
 * @param {object} row A mapped history entry.
 * @returns {object} The narrowed row.
 */
export function projectPredictionListRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;

  const out = {};
  for (const field of PREDICTION_LIST_FIELDS) {
    if (field in row) out[field] = row[field];
  }

  const engine = row.valueEngine;
  if (engine && typeof engine === "object" && !Array.isArray(engine)) {
    out.valueEngine = projectValueEngine(engine);
  }
  return out;
}

/**
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function projectPredictionListRows(rows) {
  return Array.isArray(rows) ? rows.map(projectPredictionListRow) : rows;
}

export default {
  PREDICTION_LIST_FIELDS,
  PREDICTION_LIST_VALUE_ENGINE_FIELDS,
  projectPredictionListRow,
  projectPredictionListRows
};
