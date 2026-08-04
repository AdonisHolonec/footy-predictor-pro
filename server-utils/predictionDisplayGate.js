/**
 * Global minimum-odds gate for user-facing predictions.
 *
 * Single source of truth for the "never display a prediction whose selected
 * market odds are below X" floor. Every endpoint that returns predictions to
 * end users (live predict, history, notifications) must filter through this
 * — never re-hardcode the threshold locally.
 */

export const MIN_DISPLAY_ODDS = 1.25;

/**
 * Unchanged from the original inline check this module replaces: `odd: undefined`
 * (no pick computed yet) fails open, but `odd: null` (pick computed, no bookmaker
 * quote resolved) coerces to 0 via `Number(null)` and is filtered — a pre-existing
 * distinction, not something this gate introduces.
 * @param {{ recommended?: { odd?: number | string | null } } | null | undefined} row
 * @returns {boolean}
 */
export function passesMinDisplayOdds(row) {
  const odd = Number(row?.recommended?.odd);
  if (!Number.isFinite(odd)) return true;
  return odd >= MIN_DISPLAY_ODDS;
}

/**
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function filterByMinDisplayOdds(rows) {
  return Array.isArray(rows) ? rows.filter(passesMinDisplayOdds) : rows;
}
