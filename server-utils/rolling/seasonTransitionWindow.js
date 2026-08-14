/**
 * Season transition rolling window.
 *
 * At the start of a new season a team has almost no matches, so a rolling average built
 * from the current season alone sits below the sample gate and the market silently falls
 * back to the league baseline. When the season's fourth match lands the gate opens and λ
 * jumps in one step — measured at +3.837 corners for Rapid and −3.026 for Csikszereda,
 * each after three consecutive zero-change matches. That step function is what this window
 * removes: the same simulation over the same fixtures caps the worst single-match move at
 * 1.015 and eliminates every move above 2.0.
 *
 * The rule, and nothing beyond it: take the most recent CURRENT-season matches first, then
 * top up to `target` with the most recent PREVIOUS-season matches. Never more than
 * `target`. Once the current season supplies `target` matches the previous season stops
 * contributing entirely, so a team mid-season behaves exactly as it does today.
 *
 * Deliberately absent:
 *   · recency weighting — every match in the window counts once, as it does today
 *   · any season older than `currentSeason - 1`
 *   · any cross-league or cross-team substitution
 *   · fabricated matches for a promoted side: its window is simply short, and the existing
 *     MIN_MARKET_SAMPLES gate decides what happens next, unchanged
 *
 * CALLERS MUST PRE-FILTER BY LEAGUE. A team-scoped provider query returns cups and
 * continental fixtures too, and for a promoted side the previous season is a second-division
 * one. Mixing those in would answer a different question than "how does this team behave in
 * this competition". This module cannot enforce it — it never sees a league id — so the
 * filtering is the caller's contract, applied at the integration point.
 */

/** Most recent first; ties broken by fixtureId so the same input always yields the same order. */
function sortRecentFirst(matches) {
  return [...(Array.isArray(matches) ? matches : [])].sort((a, b) => {
    const da = new Date(a?.fixture?.date ?? a?.date ?? 0).getTime();
    const db = new Date(b?.fixture?.date ?? b?.date ?? 0).getTime();
    if (da !== db) return db - da;
    const ia = Number(a?.fixture?.id ?? a?.fixtureId ?? 0);
    const ib = Number(b?.fixture?.id ?? b?.fixtureId ?? 0);
    return ib - ia;
  });
}

export const DEFAULT_TRANSITION_TARGET = 10;

/**
 * @param {Array<object>} currentMatches matches from the CURRENT season, same league
 * @param {Array<object>} previousMatches matches from the PREVIOUS season, same league
 * @param {{ target?: number }} [opts]
 * @returns {{ matches: Array<object>, fromCurrent: number, fromPrevious: number,
 *   source: "current_only"|"transition"|"previous_only"|"insufficient" }}
 */
export function buildSeasonTransitionWindow(currentMatches, previousMatches, opts = {}) {
  const rawTarget = Number(opts.target);
  const target =
    Number.isFinite(rawTarget) && rawTarget > 0 ? Math.floor(rawTarget) : DEFAULT_TRANSITION_TARGET;

  // Each list is ordered and truncated on its own. Merging first would let a previous-season
  // match outrank a current-season one, which is the opposite of the policy.
  const current = sortRecentFirst(currentMatches).slice(0, target);
  const shortfall = Math.max(0, target - current.length);
  const previous = shortfall > 0 ? sortRecentFirst(previousMatches).slice(0, shortfall) : [];

  const matches = [...current, ...previous];
  const fromCurrent = current.length;
  const fromPrevious = previous.length;

  let source;
  if (fromCurrent === 0 && fromPrevious === 0) source = "insufficient";
  else if (fromPrevious === 0) source = "current_only";
  else if (fromCurrent === 0) source = "previous_only";
  else source = "transition";

  return { matches, fromCurrent, fromPrevious, source };
}

export default { buildSeasonTransitionWindow, DEFAULT_TRANSITION_TARGET };
