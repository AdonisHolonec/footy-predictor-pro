/**
 * raw_payload paths scan 2 of the history sync (`scan_resettle`) actually
 * dereferences — the wire fix for the 15:20Z statement timeout.
 *
 * Scan 2 selected the full `raw_payload` column on every finished row whose
 * value-bet validation was still NULL/pending. Measured on production
 * (2026-09-09, one 100-row page, EXPLAIN ANALYZE SERIALIZE, cache-hot):
 *
 *   full raw_payload      308 ms server, 35,612 kB on the wire
 *   these seven paths     260 ms server,     14 kB on the wire
 *
 * PostgREST runs the sync under the `authenticator` login role, whose
 * statement_timeout is 8 s and covers pushing the result to the client. Three
 * ~35 MB pages per sync is what crossed it (SQLSTATE 57014, 2026-09-08 15:20Z).
 * The plan itself is an index scan on kickoff_at and is not the problem, so
 * there is no index or migration here — only the wire changes.
 *
 * WHY PATHS AND NOT THE PROMOTED COLUMNS: the loop resolves the value-bet pick
 * through a FALLBACK CHAIN, `valueBet.type || valueEngine.bestMarket.type ||
 * valueEngine.type`. The `value_bet_type` column (060) stores only the first
 * link, as NULL when the document holds "". Production carries 34 rows — 12 of
 * them written after the dual-write went live, the latest on 2026-09-08 — where
 * `valueBet.type` is "" and the fallback is a gradeable market ("Peste 3.5",
 * "1X", "GG"). Reading the column alone would stop grading those. The totals
 * columns are a strict SUPERSET of `marketResults` (settlement writes columns
 * only), so reading them would grade rows the document leaves pending. Both are
 * semantic changes; this is not. The document is read exactly as before, minus
 * the ~353 KB per row nothing here dereferences.
 *
 * The seven leaf paths below are every `raw.*` access in the scan-2 loop —
 * enumerated, not guessed. THE RULE (history/payloadProjection.js, verbatim): a
 * consumer that starts reading a new `payload.<key>` MUST add that path here,
 * or it will silently read `undefined` instead of data. tests/scan2PayloadPaths
 * .test.js pins this spec against the real loop.
 */

export const SCAN2_PAYLOAD_PATHS = Object.freeze({
  vbType: Object.freeze(["valueBet", "type"]),
  veBestMarketType: Object.freeze(["valueEngine", "bestMarket", "type"]),
  veType: Object.freeze(["valueEngine", "type"]),
  recFamily: Object.freeze(["recommended", "family"]),
  mrCornersTotal: Object.freeze(["marketResults", "cornersTotal"]),
  mrShotsOnTargetTotal: Object.freeze(["marketResults", "shotsOnTargetTotal"]),
  mrShotsTotal: Object.freeze(["marketResults", "shotsTotal"])
});

/** The scalar columns scan 2 always read — unchanged from the full-document select. */
export const SCAN2_SCALAR_COLUMNS =
  "fixture_id, recommended_pick, match_status, score_home, score_away, validation, value_bet_validation";

export default { SCAN2_PAYLOAD_PATHS, SCAN2_SCALAR_COLUMNS };
