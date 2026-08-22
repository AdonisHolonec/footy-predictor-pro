import type { PredictionRow } from "../types";
import { isFinalMatchStatus } from "./cardMarketOutcome";
import { isFixtureInPlay } from "./appUtils";

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

/**
 * How long after kickoff a persisted in-play status may still be read as
 * CURRENT live state. A football match — 90 minutes, half-time, stoppage,
 * extra time and penalties — is over well inside 3 hours; a status older than
 * that is a historical observation the sync cron has not refreshed yet (the
 * sync runs 2.5–8.5 h apart and writes whatever the provider said at that
 * moment), not a claim that the ball is still rolling.
 */
export const MAX_LIVE_AGE_MS = 3 * 60 * 60 * 1000;

/** The effective status of a demoted row: unresolved, neither live nor final. */
export const STALE_LIVE_STATUS = "TBD";

/**
 * Read-boundary freshness rule (live-state freshness audit).
 *
 * predictions_history is authoritative for the LAST OBSERVED provider status;
 * it says nothing about now. A row persisted as 1H/2H/HT… by a sync that ran
 * mid-match keeps that status until the next sync, hours later. This helper
 * answers one question only — "may this old status be treated as current live
 * UI?" — and when the answer is no it returns a copy whose `status` is
 * unresolved (TBD) with the provider value kept in `rawStatus`. It never
 * invents FT, a score, a minute or a validation, and never mutates its input.
 *
 * Boundary: stale strictly AFTER kickoff + MAX_LIVE_AGE_MS (exactly 3 h is
 * still fresh). No kickoff, or an unparseable one, never demotes.
 */
export function demoteStaleLiveStatus<T extends Pick<PredictionRow, "status" | "kickoff">>(row: T, nowMs: number = Date.now()): T {
  if (!isFixtureInPlay(row.status)) return row;
  const koMs = new Date(row.kickoff ?? "").getTime();
  if (!Number.isFinite(koMs)) return row;
  if (nowMs <= koMs + MAX_LIVE_AGE_MS) return row;
  return { ...row, rawStatus: row.status, status: STALE_LIVE_STATUS };
}

export function demoteStaleLiveStatuses<T extends Pick<PredictionRow, "status" | "kickoff">>(rows: T[], nowMs: number = Date.now()): T[] {
  return (rows || []).map((row) => demoteStaleLiveStatus(row, nowMs));
}

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
    // A status travels with its provenance: a demoted status without its
    // rawStatus would be indistinguishable from a provider "TBD".
    rawStatus: previous.status ? previous.rawStatus : incoming.rawStatus,
    score: previous.score ?? incoming.score,
    momentum: previous.momentum ?? incoming.momentum,
    liveEvents: previous.liveEvents ?? incoming.liveEvents,
    // liveAdjustment is a carried live field; it lives inside confidenceEngine.
    // A persisted row (history detail, hydration) carries no engine object at
    // all, so the previous one is kept whole — the same rule as momentum/events.
    confidenceEngine: incoming.confidenceEngine
      ? {
          ...incoming.confidenceEngine,
          liveAdjustment:
            previous.confidenceEngine?.liveAdjustment ?? incoming.confidenceEngine?.liveAdjustment
        }
      : previous.confidenceEngine ?? incoming.confidenceEngine
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

export default {
  CARRIED_LIVE_FIELDS,
  MAX_LIVE_AGE_MS,
  STALE_LIVE_STATUS,
  demoteStaleLiveStatus,
  demoteStaleLiveStatuses,
  carryForwardLiveState,
  applyLiveStateCarryForward
};
