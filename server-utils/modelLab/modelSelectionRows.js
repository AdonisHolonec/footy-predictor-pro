/**
 * The one row shape the ModelLab / model-selection path reads.
 *
 * WHY THIS EXISTS — three production handlers issue the SAME query and feed it to
 * the SAME consumer (`reconstructSources`):
 *
 *   api/cron/daily-ml.js   mode=model-selection   03:35 cron, limit 12000
 *   api/backtest.js        handleModelSelect      view=model-select, limit 12000
 *   api/backtest.js        handleModelLab         view=model-lab, limit 6000
 *
 * All three selected the whole `raw_payload` and all three therefore died on
 * 57014. Measured against production on 2026-08-26, replaying the query verbatim:
 * 840 rows, ~309 KB/row, ~254 MB implied, `canceling statement due to statement
 * timeout` at 19.85 s. Projecting the three blocks below returns the same 840 rows
 * in ~2.1-3.9 s and 6.23 MB.
 *
 * Keeping the select in ONE place is the point: the block list is derived from
 * `reconstructSources`, so three hand-maintained copies would drift the moment
 * that function reads one more key.
 *
 * WHY PROJECTION AND NOT PROMOTED COLUMNS: `valueEngine` is 272.56 KB/row (88.21%)
 * and this path never reads it. The three blocks below are 3.31% of the document.
 * The six promoted probability columns (migrations 059/060) cover exactly ONE of
 * the nine dependencies here, and imperfectly — `prob_1/x/2` is
 * `modelProbs1x2Pct` with a `probs` fallback, whereas `sources.everything` falls
 * back to `calibratedProbs1x2Pct`. Even a new migration promoting all four triples
 * would leave `modelMeta.elo`, `leagueParams` and `modularScores.injuries` in the
 * document, so `raw_payload` stays in the SELECT and the wire saving is ~zero.
 * Hence no migration 061, and none here either.
 *
 * THE RULE FOR ADDING A BLOCK: if `reconstructSources` starts reading a new
 * `payload.<key>`, add that key to MODEL_SELECTION_PAYLOAD_BLOCKS or it will
 * silently read `undefined`. Both lists are exported so tests can pin them.
 */

import {
  rehydratePayloadBlocks,
  selectWithPayloadBlocks
} from "../history/payloadProjection.js";

/**
 * Scalar columns the path reads directly off the row (never from the document):
 * `reconstructSources` uses luck_hxg/luck_axg (xG lambdas, the payload is only
 * their fallback), fixture_id (Poisson seed) and odds_* (Shin de-vig); ModelLab
 * and BlendRecipeSelection use score_home/score_away (actual outcome) and
 * kickoff_at (30/90/365d window slicing). league_id is carried through unchanged.
 */
export const MODEL_SELECTION_COLUMNS =
  "fixture_id, league_id, kickoff_at, score_home, score_away, odds_home, odds_draw, odds_away, luck_hxg, luck_axg";

/**
 * Top-level `raw_payload` keys `reconstructSources` reads — derived from source:
 *
 *   evaluation -> rawPoissonProbs1x2Pct (poisson), modelProbs1x2Pct +
 *                 calibratedProbs1x2Pct (everything, and its fallback),
 *                 calibratedProbs1x2Pct (calibrated), stackerProbs1x2Pct (stacker)
 *   modelMeta  -> elo.home / elo.away (elo), leagueParams.homeAdv (elo home edge),
 *                 leagueParams.rho (xG), modularScores.injuries.detail/.details
 *   luckStats  -> hXG / aXG, the fallback behind the luck_hxg / luck_axg columns
 *
 * The WHOLE `evaluation` block is projected, including the entries no registry
 * model currently selects (`stacker` is 0/840 in production and unreferenced;
 * `calibrated` is unreferenced as a source but is still live as the `everything`
 * fallback). This is a projection change only — removing dead sources is a
 * separate logic review.
 */
export const MODEL_SELECTION_PAYLOAD_BLOCKS = Object.freeze([
  "evaluation",
  "modelMeta",
  "luckStats"
]);

/** The `select` string all three handlers use. */
export function modelSelectionSelect() {
  return selectWithPayloadBlocks(MODEL_SELECTION_COLUMNS, MODEL_SELECTION_PAYLOAD_BLOCKS);
}

/**
 * Fold the projected blocks back under `raw_payload` so `reconstructSources`,
 * `homeAdvElo` and every ModelLab consumer keep reading `row.raw_payload.*`
 * unchanged. Returns NEW rows; the input is not mutated.
 *
 * @param {Array<object>|null} data rows as returned by PostgREST
 */
export function rehydrateModelSelectionRows(data) {
  return (data || []).map((row) => rehydratePayloadBlocks(row, MODEL_SELECTION_PAYLOAD_BLOCKS));
}

export default {
  MODEL_SELECTION_COLUMNS,
  MODEL_SELECTION_PAYLOAD_BLOCKS,
  modelSelectionSelect,
  rehydrateModelSelectionRows
};
