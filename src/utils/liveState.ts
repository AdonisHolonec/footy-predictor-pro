import type { PredictionRow } from "../types";
import { isFinalMatchStatus } from "./cardMarketOutcome";

/**
 * Which parts of a prediction row only ever exist in memory.
 *
 * `predictionsByUser` (localStorage) and `/api/history` both describe a match as
 * it was *stored*. Neither carries live poll data: momentum, live events, the
 * minute and the live confidence nudge exist only on `preds`, written there by
 * `useLiveFixtureScorePoll`. So any code that rebuilds `preds` from a stored
 * source is, by default, a lost update.
 *
 * That is not hypothetical. `/api/fixtures?view=live` answers in a few hundred
 * ms; `/api/history?mine=1` takes seconds. The history response therefore lands
 * LAST and, replacing the row wholesale, erased the momentum the live poll had
 * just written — which is what turned a working momentum widget into
 * "Momentum unavailable" a couple of seconds after opening a live match.
 *
 * The rule was already written down and already implemented for the cache-filter
 * path; it simply was never applied to history rehydration. It lives here now so
 * there is exactly one copy of it.
 */

/**
 * Fields carried forward from the in-memory row. Enumerated deliberately rather
 * than spread wholesale: everything NOT on this list is a pre-kickoff decision
 * the stored row is authoritative about, and blanket-preserving the previous row
 * would silently pin stale predictions, odds and market data.
 */
export const CARRIED_LIVE_FIELDS = Object.freeze([
  "status",
  "score",
  "momentum",
  "liveEvents",
  "confidenceEngine.liveAdjustment"
] as const);

/**
 * Merge one stored row with whatever live state is already held for that fixture.
 *
 * @param previous the in-memory row, when one exists
 * @param incoming the stored row (localStorage cache or /api/history)
 */
export function carryForwardLiveState(
  previous: PredictionRow | undefined,
  incoming: PredictionRow
): PredictionRow {
  if (!previous) return incoming;

  // The freshly-settled escape: once the stored row says the match is over and
  // the in-memory one has not caught up, the persisted snapshot IS the record.
  // Carrying live state past that point would pin a 78' momentum onto a finished
  // match forever.
  if (isFinalMatchStatus(incoming.status) && !isFinalMatchStatus(previous.status)) return incoming;

  return {
    ...incoming,
    status: previous.status || incoming.status,
    score: previous.score ?? incoming.score,
    momentum: previous.momentum ?? incoming.momentum,
    liveEvents: previous.liveEvents ?? incoming.liveEvents,
    confidenceEngine: incoming.confidenceEngine
      ? {
          ...incoming.confidenceEngine,
          liveAdjustment:
            previous.confidenceEngine?.liveAdjustment ?? incoming.confidenceEngine?.liveAdjustment
        }
      : incoming.confidenceEngine
  };
}

/**
 * Apply {@link carryForwardLiveState} across a whole replacement list, matching
 * rows by fixture id. A fixture with no in-memory counterpart passes through
 * untouched, so a first load behaves exactly as a plain assignment would.
 */
export function applyLiveStateCarryForward(
  previous: PredictionRow[],
  incoming: PredictionRow[]
): PredictionRow[] {
  const previousById = new Map((previous || []).map((row) => [Number(row.id), row]));
  return (incoming || []).map((row) => carryForwardLiveState(previousById.get(Number(row.id)), row));
}

export default { CARRIED_LIVE_FIELDS, carryForwardLiveState, applyLiveStateCarryForward };
