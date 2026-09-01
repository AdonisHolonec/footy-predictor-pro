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

/**
 * Nested-path variant of the block projection, for consumers whose top-level
 * block is too large to transport whole.
 *
 * The block functions above stop at `raw_payload->block`, which is exactly
 * wrong for `valueEngine`: measured above at 267.7 KB — 87.96% of the row —
 * while the readers this variant serves dereference five of its scalar fields
 * plus `bestMarket`. A path spec selects those five, not the 267 KB.
 *
 * A spec maps an alias to a path inside raw_payload:
 *
 *   { veBestMarket: ["valueEngine", "bestMarket"] }
 *   -> select fragment  veBestMarket:raw_payload->valueEngine->bestMarket
 *   -> rehydrated as    raw_payload.valueEngine.bestMarket
 *
 * `->` (never `->>`) keeps JSON types: objects stay objects, numbers stay
 * numbers. Same egress caveat as the block variant: the server still de-TOASTs
 * the whole document to evaluate a path — this narrows the WIRE, which is the
 * cost that is billed as egress. It can never be slower than selecting the
 * full column, because the de-TOAST is identical and the serialization is
 * strictly smaller.
 *
 * THE RULE FOR ADDING A PATH is the block rule verbatim: a consumer that
 * starts reading a new `payload.<a>.<b>` MUST add that path to its spec, or it
 * will silently read `undefined`. Specs are exported by their owners so tests
 * can pin them against the consumers.
 */

/**
 * PostgREST projection for a spec of `raw_payload` paths.
 *
 * @param {Readonly<Record<string, readonly string[]>>} spec alias -> path segments
 * @returns {string} comma-separated select fragment ("" for an empty spec)
 */
export function payloadPathSelect(spec) {
  return Object.entries(spec || {})
    .map(([alias, path]) => `${alias}:raw_payload->${path.join("->")}`)
    .join(", ");
}

/**
 * Build a `select` string from scalar columns plus projected payload paths.
 *
 * @param {string} columns scalar column list, already comma-separated
 * @param {Readonly<Record<string, readonly string[]>>} spec alias -> path segments
 */
export function selectWithPayloadPaths(columns, spec) {
  const projection = payloadPathSelect(spec);
  return projection ? `${columns}, ${projection}` : columns;
}

/**
 * Fold projected paths back under `raw_payload`, returning a NEW row.
 *
 * Same null contract as `rehydratePayloadBlocks`: a path that came back null or
 * undefined is omitted, so the rebuilt object is a strict subset of the stored
 * document. Every consumer reads these through `?.` / `|| {}` chains, for which
 * an absent key and a null key behave identically — and PostgREST's `->`
 * cannot distinguish a missing key from a stored null in the first place.
 *
 * @param {object} row row as returned by PostgREST, one alias per path
 * @param {Readonly<Record<string, readonly string[]>>} spec the spec passed to payloadPathSelect
 */
export function rehydratePayloadPaths(row, spec) {
  const safeSpec = spec || {};
  const scalars = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (!(key in safeSpec)) scalars[key] = value;
  }
  const payload = {};
  for (const [alias, path] of Object.entries(safeSpec)) {
    const value = row?.[alias];
    if (value === null || value === undefined) continue;
    let target = payload;
    for (let i = 0; i < path.length - 1; i += 1) {
      const segment = path[i];
      if (!target[segment] || typeof target[segment] !== "object" || Array.isArray(target[segment])) {
        target[segment] = {};
      }
      target = target[segment];
    }
    target[path[path.length - 1]] = value;
  }
  return { ...scalars, raw_payload: payload };
}

/** Row-array convenience over rehydratePayloadPaths. Non-arrays rehydrate to []. */
export function rehydratePayloadPathRows(rows, spec) {
  return (Array.isArray(rows) ? rows : []).map((row) => rehydratePayloadPaths(row, spec));
}

export default {
  payloadBlockSelect,
  selectWithPayloadBlocks,
  rehydratePayloadBlocks,
  payloadPathSelect,
  selectWithPayloadPaths,
  rehydratePayloadPaths,
  rehydratePayloadPathRows
};
