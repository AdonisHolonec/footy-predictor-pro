/**
 * Select individual `raw_payload` blocks instead of the whole document.
 *
 * WHY THIS EXISTS — this is an outage fix, not an optimisation.
 *
 * `predictions_history.raw_payload` reached ~304 KB at the median (~338 KB in
 * the cron windows) and every reader that still selected the whole document now
 * dies. Measured against production on 2026-08-26, replaying the queries
 * verbatim:
 *
 *   daily-ml?mode=all   all FOUR document reads -> 57014 (22-42 s)
 *   ?view=snapshot      57014
 *   mode=model-selection 57014
 *
 * The damage is visible in what those jobs write: `calibration_runs` last
 * succeeded 2026-08-13 after 27 consecutive nightly runs, and `calibration_maps`
 * still holds the 7 global maps fitted that night. The model has been serving
 * two-week-old calibration.
 *
 * WHY PROJECTION AND NOT PROMOTED COLUMNS:
 *
 * Because the probabilities were never the expensive part. Measured over 20
 * documents, `valueEngine` alone is 267.7 KB — 87.96% of the row — and NOTHING
 * on the daily-ml path reads it. The whole path reads `evaluation` (789 B),
 * `probs` (2.5 KB), `odds` (118 B), `modelMeta` (9.6 KB), `featureImportance`
 * (1.2 KB) and `recommended`: about 4.8% of what Postgres de-TOASTs to serve it.
 * Promoting the two 1X2 triples to columns would have moved 136 B/row (0.044%)
 * and still left `raw_payload` in every one of these SELECTs, because calibration
 * also needs the side-market blocks and the stacker needs `odds` + `modelMeta`.
 * Net wire saving of that migration: zero. Hence no migration 061.
 *
 * WHY THE SHAPE IS REBUILT RATHER THAN THE CONSUMERS REWRITTEN:
 *
 * `rehydratePayloadBlocks` hands each consumer back a `raw_payload` object, so
 * `extractRawTriple`, `extractStackerModelTriple`, `extractSideMarketProbs` and
 * `extractSamplesFromHistory` are untouched. Not one precedence chain, fallback
 * order or NULL rule moves — which is the whole point, because those chains are
 * load-bearing:
 *
 *   - `PREDICT_TRAIN_USE_FINAL_PROBS=1` inverts rawPoisson/modelProbs and changes
 *     the resolved triple on 860 of 916 rows.
 *   - `extractStackerModelTriple` replays Stage06 maps at runtime for the 329
 *     rows with no stored `calibratedProbs1x2Pct`, so the RAW inputs must survive
 *     the projection, not just the calibrated ones.
 *
 * A projected block is byte-identical to the same block inside the full
 * document: verified on production at 150 rows x 6 blocks = 900 comparisons,
 * plus 300 deep triple comparisons, 0 mismatches.
 *
 * THE RULE FOR ADDING A BLOCK: a consumer that starts reading a new
 * `payload.<key>` MUST add that key to its block list here, or it will silently
 * read `undefined` instead of data. That is the one hazard this file introduces,
 * and the block lists are exported so tests can pin them against the source.
 */

/**
 * PostgREST projection for a set of top-level `raw_payload` keys.
 *
 * Produces `evaluation:raw_payload->evaluation, probs:raw_payload->probs`, which
 * returns each block as JSON under its own alias. `->` (not `->>`) is required:
 * `->>` would stringify the block and every consumer expects an object.
 *
 * @param {readonly string[]} blocks top-level keys of raw_payload
 * @returns {string} comma-separated PostgREST select fragment ("" when no blocks)
 */
export function payloadBlockSelect(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  return list.map((block) => `${block}:raw_payload->${block}`).join(", ");
}

/**
 * Build a `select` string from scalar columns plus projected payload blocks.
 *
 * @param {string} columns scalar column list, already comma-separated
 * @param {readonly string[]} blocks top-level raw_payload keys ([] selects no document data)
 */
export function selectWithPayloadBlocks(columns, blocks) {
  const projection = payloadBlockSelect(blocks);
  return projection ? `${columns}, ${projection}` : columns;
}

/**
 * Fold projected blocks back under `raw_payload`, returning a NEW row.
 *
 * Keys whose block came back null or undefined are omitted rather than stored as
 * null, so the rebuilt object is a strict subset of the stored document — that
 * is what makes an old-vs-new parity comparison exact rather than approximate.
 * Every consumer reads these through `payload?.x || {}` or `payload?.x`, for
 * which an absent key and a null key behave identically.
 *
 * @param {object} row row as returned by PostgREST, with one alias per block
 * @param {readonly string[]} blocks the same list passed to payloadBlockSelect
 */
export function rehydratePayloadBlocks(row, blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const scalars = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (!list.includes(key)) scalars[key] = value;
  }
  const payload = {};
  for (const block of list) {
    const value = row?.[block];
    if (value !== null && value !== undefined) payload[block] = value;
  }
  return { ...scalars, raw_payload: payload };
}

export default { payloadBlockSelect, selectWithPayloadBlocks, rehydratePayloadBlocks };
