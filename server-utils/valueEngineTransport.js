/**
 * Transport trimming for `valueEngine` — what a client is sent, never what is stored.
 *
 * `buildValueEngine` (server-utils/value/ValueEngine.js) returns three arrays built
 * from the same `evaluated` set:
 *
 *   markets          every evaluated market
 *   positiveMarkets  the EV > 0 subset
 *   negativeMarkets  the EV <= 0 subset that was rejected
 *
 * Measured over the 184 rows one real user's hydration returns:
 *
 *   markets           108,774 B/row   51.8% of valueEngine
 *   negativeMarkets    82,876 B/row   39.4%
 *   positiveMarkets    17,590 B/row    8.4%
 *
 * and, by canonical-JSON identity on those same rows, positiveMarkets and
 * negativeMarkets are each a strict subset of markets on 184/184, mutually
 * disjoint on 184/184, split on the sign of expectedValue.
 *
 * Nothing reads either array. The whole repository — src/, server-utils/, api/ —
 * reads only the derived scalars `positiveEvCount` and `negativeEvCount`, which
 * buildValueEngine already emits as separate fields. So ~100 KB per row crosses
 * the wire for no consumer.
 *
 * `markets` is deliberately NOT touched here, at any layer. It has real readers:
 * globalSpecialBetEngine.js reads valueEngine.markets[].probability, the Correct
 * Score backtest reads it out of raw_payload, and the match modal builds its
 * correct-score candidates from it. This module exists precisely so the two dead
 * arrays can be dropped from a response WITHOUT anyone reaching for the blunter
 * and irreversible option of dropping them from the stored document.
 *
 * PURE AND NON-MUTATING, and that is load-bearing rather than stylistic:
 * mapDbRowToHistoryEntry spreads `...payload`, so the `valueEngine` on a mapped
 * row is the SAME object as `row.raw_payload.valueEngine`. Deleting keys in place
 * would corrupt the caller's own database row in memory and could travel to any
 * other consumer holding that reference. Every function here copies first.
 */

/** Emitted by buildValueEngine, read by nothing. Their counts survive as scalars. */
export const DEAD_VALUE_ENGINE_ARRAYS = Object.freeze(["positiveMarkets", "negativeMarkets"]);

/**
 * Copy of `row` whose `valueEngine` carries no dead arrays.
 *
 * Returns the input unchanged (same reference) when there is nothing to remove,
 * so a row without a valueEngine, or one already trimmed, costs nothing.
 *
 * @param {object} row A client-facing prediction row.
 * @returns {object} The row, or a copy with the two arrays absent.
 */
export function stripDeadValueEngineArrays(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;

  const valueEngine = row.valueEngine;
  if (!valueEngine || typeof valueEngine !== "object" || Array.isArray(valueEngine)) return row;

  const present = DEAD_VALUE_ENGINE_ARRAYS.filter((key) => key in valueEngine);
  if (present.length === 0) return row;

  const trimmed = { ...valueEngine };
  for (const key of present) delete trimmed[key];

  return { ...row, valueEngine: trimmed };
}

/**
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function stripDeadValueEngineArraysFromRows(rows) {
  return Array.isArray(rows) ? rows.map(stripDeadValueEngineArrays) : rows;
}

export default { DEAD_VALUE_ENGINE_ARRAYS, stripDeadValueEngineArrays, stripDeadValueEngineArraysFromRows };
