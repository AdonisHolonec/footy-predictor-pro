/**
 * The single definition of how `predictions_history.hydration_payload` is
 * derived from the prediction payload — migration 067.
 *
 * `raw_payload` is authoritative; this column is a cache that lets prediction
 * hydration be answered without detoasting the JSONB document. Measured on 184
 * real production rows: 244,969 -> 12,955 B/row, a 94.7% reduction.
 *
 * ── The one rule, inherited from historyListColumns.js ────────────────────────
 * A live writer derives this column from the EXACT payload object it is about to
 * persist — never from the previous database row. That is what makes it
 * impossible for the column to describe a payload that was not written.
 *
 * ── Why this list is a SUBSET of the board contract ───────────────────────────
 * PREDICTION_LIST_FIELDS is what the restored board reads. This column stores
 * only the part of it that is BOTH immutable and not already a promoted column:
 *
 *   dropped, already a column   id/fixture_id, leagueId, league, teams,
 *                               kickoff, status, score, validation, savedAt,
 *                               modelVersion, cardMarkets,
 *                               cardMarketValidations, marketResults, referee
 *   dropped, MUTABLE            momentum
 *
 * `logos` is the ONE apparent exception, and it is not one: 055 promoted
 * logo_home and logo_away but NOT the league crest, and `logos.league` is read
 * by MatchCard.tsx:222 and PredictionFocusCard.tsx:368 — both fed by `preds`,
 * which is exactly what hydration restores. Reconstructing `logos` from the two
 * columns would therefore silently drop the league crest on every restored row.
 * Verified on production: raw_payload.logos.{home,away,league} are present on
 * 1,094/1,094 rows, so the whole object is stored rather than a league-only key
 * that would be a second projection rule to keep in step.
 *
 * `predictionsHistory.js` LIVE_RESULT_FIELDS is the authority on what may move
 * after creation: status, score, marketResults, cardMarketValidations, momentum,
 * evaluation, elapsed. Every one of those that the board reads already has its
 * own column except `momentum` — so `momentum` is the ONE field this column
 * cannot carry, and the read cutover has to source it separately. Storing it
 * here would make an immutable column lie the moment a match went live.
 *
 * Everything that remains is frozen at kickoff by isPreKickoff(), which is why
 * no settlement writer has to maintain this column: the settlement paths build
 * partial updates (see api/history.js deriveMutableHistoryListColumns) and never
 * mention it, so `INSERT ... ON CONFLICT DO UPDATE` leaves it untouched.
 *
 * ── Why it delegates to projectPredictionListRow ──────────────────────────────
 * `valueEngine` is 85.3% of the document and `valueEngine.markets` alone is
 * 44.8%, so the narrowing rule (19 scalar fields, plus the FIRST entry of
 * `markets` that looks like a cards market) is the whole saving. That rule
 * already exists, is mirrored client-side, and is pinned by
 * src/utils/predictionContractDrift.test.ts. Re-implementing it here would
 * create a third copy to keep in step, so this derives FROM the projector rather
 * than beside it.
 *
 * THE RULE FOR ADDING A FIELD: if the board starts reading a new immutable
 * `payload.<key>`, add it to PREDICTION_LIST_FIELDS first (the drift guard
 * requires it), then here — or the read cutover will serve `undefined`.
 *
 * Pure: no database, no clock, no I/O.
 */

import { projectPredictionListRow } from "./predictionListProjection.js";

/**
 * The immutable, not-already-promoted subset of the board contract.
 *
 * `recommended` is listed even though recommended_pick / _confidence / _odd /
 * _family / _period / _scope / _book_line exist, because those columns are what
 * the LIST needs and rehydrateListRow reassembles a `recommended` from them.
 * The board reads the stored object itself, and a future key on it would be
 * silently dropped by a column-by-column reconstruction.
 *
 * `probs` is load-bearing beyond rendering: hasLegacyPredictionShape() reads
 * probs.corners / probs.shotsOnTarget for paid tiers and probs.firstHalf /
 * probs.shotsTotal for free. Migration 059 promoted prob_1/_x/_2 only — the 1X2
 * triple — and corners_total / shots_on_target_total are integer RESULTS, not
 * probabilities, so neither can stand in for it. Dropping `probs` would make
 * every restored row look stale and re-arm the rehydrate that produced it.
 */
export const HYDRATION_PAYLOAD_FIELDS = Object.freeze([
  "insufficientData",
  "insufficientReason",
  // Stored WHOLE, league crest included — see the header. logo_home/logo_away
  // cover two of the three; the third has no column and no other source.
  "logos",
  "recommended",
  "probs",
  "predictions",
  "marketOdds",
  "confidenceEngine",
  "explanation",
  "featureImportance",
  "teamContext",
  "valueBet"
]);

/**
 * Build the column value for one payload.
 *
 * @param {object} payload the prediction object about to be persisted
 * @returns {object|null} the column value, or null when there is nothing to store
 */
export function buildHydrationPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  // Same narrowing the response projection applies, so the column and the
  // wire shape can never disagree about what `valueEngine` means.
  const projected = projectPredictionListRow(payload);

  const out = {};
  for (const field of HYDRATION_PAYLOAD_FIELDS) {
    if (field in projected) out[field] = projected[field];
  }
  if (projected.valueEngine !== undefined) out.valueEngine = projected.valueEngine;

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The spreadable column patch, shaped like deriveHistoryListColumns so the two
 * sit side by side at the single creation site.
 *
 * @param {object} payload the prediction object about to be persisted
 * @returns {{hydration_payload: object|null}}
 */
export function deriveHydrationPayloadColumn(payload) {
  return { hydration_payload: buildHydrationPayload(payload) };
}

/**
 * Every column the hydration read projects. NO `raw_payload`, in any form.
 *
 * The whole point of A1-A3 was to make this list sufficient: the document is
 * ~245 KB and Postgres must detoast all of it to answer a board that renders a
 * scoreline, a crest and a value badge. Measured on 184 real rows, the stored
 * projection is 244,969 -> 12,955 B/row.
 *
 * A `raw_payload->key` subpath would NOT do: it narrows the wire but still
 * detoasts the document (055 measured 10,941 buffers / 1,822 ms with it against
 * 411 / 0.917 ms without). Hence a hard structural test that this string never
 * mentions raw_payload at all.
 */
export const HYDRATION_ROW_COLUMNS = Object.freeze([
  "fixture_id",
  "league_id",
  "league_name",
  "home_team",
  "away_team",
  "logo_home",
  "logo_away",
  "kickoff_at",
  "match_status",
  "score_home",
  "score_away",
  "validation",
  "value_bet_validation",
  "saved_at",
  "model_version",
  "referee_name",
  "card_markets",
  "card_market_validations",
  // All SIX totals canonicalMarketTotals reads. Projecting only corners and
  // shots-on-target would re-grade a PENDING Cards or Total Shots recommended
  // against nulls, because resolveCardMarketValidations re-settles from this bag
  // and those two families grade against cards_total / shots_total.
  "corners_total",
  "shots_on_target_total",
  "shots_total",
  "cards_total",
  "cards_points",
  "first_half_goals",
  "recommended_market_valid",
  "hydration_payload"
]);

export const HYDRATION_SELECT = HYDRATION_ROW_COLUMNS.join(", ");

/**
 * Present a hydration row under the key path the existing mapper and the
 * settlement helpers already expect, WITHOUT touching either of them.
 *
 * `mapDbRowToHistoryEntry` reads `row.raw_payload` and spreads it, then overlays
 * scalar columns. Setting `raw_payload := hydration_payload` therefore recovers
 * everything the payload carries — including the complete `logos` object, which
 * is why no logo injection happens here: logo_home/logo_away cover only two of
 * three crests and the payload now carries all three.
 *
 * Four values still have to be presented, traced field by field rather than
 * guessed, because the mapper reads them from the PAYLOAD and they live in
 * columns:
 *
 *   referee                 board contract; the mapper never overlays it
 *   cardMarkets             mapper: `payload.cardMarkets || null`
 *   cardMarketValidations   resolveCardMarketValidations reads payload.cardMarketValidations
 *   marketResults           canonicalMarketTotals(payload.marketResults) inside the same helper
 *
 * marketResults is synthesised from the SIX promoted totals canonicalMarketTotals
 * reads, and stays ABSENT when every one of them is NULL — an absent total must
 * never read as a real zero. All six are carried because that helper re-settles
 * markets still pending: cardsTotal grades a Cards recommended and shotsTotal a
 * Total Shots one, so dropping them would silently change settlement state.
 * `referee` is likewise injected only when the column holds a value, so an
 * absent crest/name is not coerced into an explicit null.
 *
 * @returns {object|null} the shimmed row, or null when there is no payload to
 *   reconstruct from. NULL is never papered over with raw_payload.
 */
export function rehydrateHydrationRow(row) {
  const stored = row?.hydration_payload;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;

  /*
    Key-for-key with canonicalMarketTotals' own shape — same names, same order,
    same null semantics — so the helper reads exactly what the document gave it.
    That function is settlement code and is NOT modified here.
  */
  const marketResults = {
    cornersTotal: row.corners_total ?? null,
    shotsOnTargetTotal: row.shots_on_target_total ?? null,
    shotsTotal: row.shots_total ?? null,
    cardsTotal: row.cards_total ?? null,
    cardsPoints: row.cards_points ?? null,
    firstHalfGoals: row.first_half_goals ?? null
  };
  // Absent, not a bag of nulls: a projected-but-empty total must not read as a
  // real zero, and an all-null object would be a value where there was none.
  const hasAnyTotal = Object.values(marketResults).some((v) => v !== null);

  return {
    ...row,
    raw_payload: {
      ...stored,
      ...(row.referee_name != null ? { referee: row.referee_name } : {}),
      cardMarkets: row.card_markets ?? null,
      cardMarketValidations: row.card_market_validations ?? null,
      ...(hasAnyTotal ? { marketResults } : {})
    }
  };
}

export default {
  HYDRATION_PAYLOAD_FIELDS,
  HYDRATION_ROW_COLUMNS,
  HYDRATION_SELECT,
  buildHydrationPayload,
  deriveHydrationPayloadColumn,
  rehydrateHydrationRow
};
