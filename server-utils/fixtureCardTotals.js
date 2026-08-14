/**
 * Card counts from a /fixtures/statistics payload — the single place the
 * known-vs-unknown rule for bookings lives.
 *
 * MISSING ≠ ZERO, decided before any arithmetic. API-Football returns a structurally
 * complete statistics block with every value null for fixtures it does not cover; that
 * payload is what poisoned the corners rolling averages in #65, and the card path is
 * more exposed to it than corners are, because the aggregation used to coerce null to 0
 * before its own guard could reject it (`Number(null) === 0` is finite).
 *
 * The rule, in one sentence: **yellow is the anchor**. A populated block always carries a
 * numeric "Yellow Cards" — 0 included — so a null yellow means the block itself is empty
 * and the side is UNKNOWN. Once yellow is known the block is real, so a null "Red Cards"
 * is simply how the provider writes zero. Verified against a live payload: `Yellow Cards
 * = 2`, `Red Cards = null` on a match with no dismissals.
 *
 * Two quantities are produced because they are NOT interchangeable:
 *   · count  = yellow + red      — raw cards, the quantity bookmakers quote
 *   · points = red * 2 + yellow  — the weighted convention documented on
 *                                  team_market_rolling.cards_for_avg (migration 038)
 * Both are recorded so the unit question can be settled empirically later without a
 * second pass over historical fixtures.
 *
 * Leaf module: no imports, so any layer (API handlers, rolling aggregation) can use it
 * without creating a cycle.
 */

/**
 * Numeric value for a statistics row. Cards are plain integers or null — no percentages,
 * no decimals — so this stays deliberately narrower than the general-purpose stat parsers
 * in the API handlers.
 *
 * @returns {number|null} null for absent rows and for null/blank values alike
 */
function readCardStat(statistics, type) {
  if (!Array.isArray(statistics)) return null;
  const row = statistics.find((s) => String(s?.type || "").toLowerCase() === type.toLowerCase());
  if (!row) return null;
  const raw = row.value;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Apply the yellow-anchor rule to already-extracted counts.
 *
 * Exported so the rolling aggregation — which reads statistics through its own extractor
 * and therefore never sees the raw payload — decides "known" exactly the way the
 * settlement path does. One rule, one implementation.
 *
 * @param {number|null|undefined} yellow
 * @param {number|null|undefined} red
 * @returns {{ yellow: number, red: number, count: number, points: number }|null}
 */
export function cardsFromCounts(yellow, red) {
  if (yellow == null) return null;
  const y = Number(yellow);
  if (!Number.isFinite(y)) return null;
  const r = red == null ? 0 : Number(red);
  if (!Number.isFinite(r)) return null;
  return { yellow: y, red: r, count: y + r, points: r * 2 + y };
}

/**
 * Cards for ONE side of a fixture, or null when that side is unknown.
 *
 * @param {Array<{type: string, value: unknown}>|null|undefined} statistics
 * @returns {{ yellow: number, red: number, count: number, points: number }|null}
 */
export function parseSideCards(statistics) {
  return cardsFromCounts(readCardStat(statistics, "Yellow Cards"), readCardStat(statistics, "Red Cards"));
}

/**
 * Match totals across both sides. Both sides are required: a half-known total would
 * settle Over/Under lines against a number that is not the match's real card count.
 *
 * @returns {{ cardsTotal: number|null, cardsPoints: number|null }}
 */
export function computeCardTotals(homeStatistics, awayStatistics) {
  const home = parseSideCards(homeStatistics);
  const away = parseSideCards(awayStatistics);
  if (!home || !away) return { cardsTotal: null, cardsPoints: null };
  return { cardsTotal: home.count + away.count, cardsPoints: home.points + away.points };
}

export default { cardsFromCounts, parseSideCards, computeCardTotals };
