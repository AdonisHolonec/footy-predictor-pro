/**
 * Dry run and backfill for the two analytics-eligibility columns of migration 066.
 *
 * WHAT IT WRITES, AND WHAT IT REFUSES TO WRITE
 *
 * The payload contains only `recommended_market_valid` and
 * `recommended_market_invalid_reason`, and is sent only for rows whose stored
 * value differs from the classification. There is no delete and no whole-row
 * upsert, so `validation`, `card_market_validations`, `card_markets`, the odds
 * and `raw_payload` cannot be touched even by accident. A malformed
 * recommendation that won remains a recorded win; it simply stops counting in
 * performance analytics.
 *
 * ONE COLUMN CHANGES THAT THE PAYLOAD DOES NOT NAME: `updated_at`. Migration 001
 * installs `trg_predictions_history_updated_at`, a BEFORE UPDATE trigger that
 * sets `updated_at = now()` on every row this touches. That matters
 * operationally, because `upsertPredictionsHistory` skips a Predict write when
 * `existing.updated_at > row.updated_at` (its staleness guard): a backfill
 * running concurrently with a Predict batch can therefore cause that batch's
 * rows to be counted as `skippedStale` and dropped.
 *
 * So: RUN THIS WHEN PREDICT IS IDLE — between cron windows, never during one.
 * The same is true of every other backfill in this directory; it is stated here
 * because the operator needs it, not because this module is special.
 *
 * DETERMINISTIC — the verdict is `classifyRecommendedMarketFromRow`, THE
 * function the write path uses. There is no second predicate to drift from, so
 * "what the backfill would write" and "what Predict writes today" are the same
 * computation over the same fields.
 *
 * IDEMPOTENT — the plan is a pure function of the row, and rows already holding
 * the planned value are not written. A second run therefore reports
 * `changed: 0` and issues zero updates. Re-running is a no-op, not a rewrite.
 *
 * RESUMABLE — the walk is keyset by `fixture_id` ascending (`startAfterFixtureId`),
 * never OFFSET. On a table whose raw_payload has grown to ~353 KB/row, OFFSET
 * re-reads and re-discards every skipped row, and D7 measured limit=250 hitting
 * a 57014 statement timeout on this table. 100 is the page size demonstrated to
 * commit.
 *
 * THE PROJECTION IS NOT CHEAP, AND PRETENDING OTHERWISE WOULD BE WRONG.
 * `raw_payload->probs` narrows what crosses the wire, not what Postgres reads:
 * the document still comes out of TOAST and is decompressed. This repo measured
 * that cost directly (predictionsHistory.js: 0.278 s columns-only vs 3.381 s for
 * key extractions on identical rows, ~12x), which is why the aggregate path
 * forbids `raw_payload->key` outright. The backfill accepts it because it has no
 * choice: the lambdas the predicate needs exist only inside the document — there
 * is no promoted lambda column — and this is a one-off maintenance walk, not a
 * request path. Budget ~3-4 s per 100-row page, a few dozen pages, run off-peak.
 *
 * AUDITABLE — the dry run reports the exact fixture ids it would change, split
 * by direction and reason, so the plan can be inspected before anything is
 * applied. Applying is an explicit `apply: true`, never the default.
 */

import { classifyRecommendedMarketFromRow } from "../recommendedMarketValidity.js";

export const VALIDITY_COLUMNS = Object.freeze([
  "recommended_market_valid",
  "recommended_market_invalid_reason"
]);

/**
 * The narrow projection the walk reads. `probs` is the JSON sub-path the
 * predicate needs (lambdaHome / lambdaAway of the recommendation's own block);
 * the rest are promoted columns.
 */
export const BACKFILL_SELECT = [
  "fixture_id",
  "recommended_family",
  "recommended_pick",
  "recommended_book_line",
  ...VALIDITY_COLUMNS,
  "probs:raw_payload->probs"
].join(", ");

export function emptyStats() {
  return {
    scanned: 0,
    pages: 0,
    changed: 0,
    unchanged: 0,
    plannedValid: 0,
    plannedInvalid: 0,
    /*
      Rows the predicate could not evaluate at all — no recommendation family on
      the row. They are counted as valid (absent evidence never excludes), but
      they are reported separately so a dry run cannot present "all clear" when
      what it really means is "could not tell".
    */
    unclassifiable: 0,
    /** Rows with no fixture_id — impossible today, counted rather than ignored. */
    skippedNoFixtureId: 0,
    byReason: {},
    /** fixture ids whose classification differs from what is stored. */
    changedFixtureIds: [],
    lastFixtureId: null,
    applied: 0
  };
}

/**
 * Classify one row and compare with what is stored.
 *
 * @param {object} row a BACKFILL_SELECT projection
 * @returns {{ fixtureId: number|null, planned: {valid: boolean, reason: string|null},
 *   stored: {valid: unknown, reason: unknown}, changed: boolean }}
 */
export function inspectRow(row) {
  const source = row && typeof row === "object" ? row : {};
  const planned = classifyRecommendedMarketFromRow(source);
  const stored = {
    valid: source.recommended_market_valid ?? null,
    reason: source.recommended_market_invalid_reason ?? null
  };
  const changed = stored.valid !== planned.valid || (stored.reason ?? null) !== planned.reason;
  return {
    fixtureId: source.fixture_id ?? null,
    planned,
    stored,
    changed,
    /*
      No family means the predicate had nothing to judge — pre-056 rows, whose
      recommended_family column predates the recommendation columns. The verdict
      is still `valid` (absent evidence never excludes), but the operator is told
      how many of those the plan contains rather than being shown a clean sheet.
      The projection is column-only, so the document fallback inside
      classifyRecommendedMarketFromRow is unreachable here by construction.
    */
    unclassifiable: !source.recommended_family
  };
}

/** The update payload for one row — the two columns and nothing else. */
export function buildUpdate(planned) {
  return {
    recommended_market_valid: planned.valid,
    recommended_market_invalid_reason: planned.reason
  };
}

function accumulate(stats, inspected) {
  stats.scanned += 1;
  stats.lastFixtureId = inspected.fixtureId;
  if (inspected.unclassifiable) stats.unclassifiable += 1;
  if (inspected.planned.valid) stats.plannedValid += 1;
  else {
    stats.plannedInvalid += 1;
    const key = inspected.planned.reason || "unknown";
    stats.byReason[key] = (stats.byReason[key] || 0) + 1;
  }
  if (inspected.changed) {
    stats.changed += 1;
    if (stats.changedFixtureIds.length < 500) stats.changedFixtureIds.push(inspected.fixtureId);
  } else {
    stats.unchanged += 1;
  }
}

/**
 * Walk the table and report — and, only when `apply` is true, write.
 *
 * @param {{ supabase: object, table?: string, pageSize?: number, maxRows?: number,
 *   apply?: boolean, startAfterFixtureId?: number|null }} options
 * @returns {Promise<ReturnType<typeof emptyStats>>}
 */
export async function runBackfill({
  supabase,
  table = "predictions_history",
  pageSize = 100,
  maxRows = Infinity,
  apply = false,
  startAfterFixtureId = null
} = {}) {
  if (!supabase) throw new Error("supabase client is required");
  const stats = emptyStats();
  /*
    `Number(null)` is 0, not NaN — so the obvious form of this line silently
    turns "no cursor" into `.gt("fixture_id", 0)`. Harmless with positive bigint
    ids, but then the documented "first page is unfiltered" is not what runs, and
    `--after 0` becomes indistinguishable from no flag. Treat absent as absent.
  */
  const cursorSeed =
    startAfterFixtureId === null || startAfterFixtureId === undefined || startAfterFixtureId === ""
      ? Number.NaN
      : Number(startAfterFixtureId);
  let cursor = Number.isFinite(cursorSeed) ? cursorSeed : null;

  for (;;) {
    let query = supabase
      .from(table)
      .select(BACKFILL_SELECT)
      .order("fixture_id", { ascending: true })
      .limit(pageSize);
    if (cursor !== null) query = query.gt("fixture_id", cursor);

    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) break;
    stats.pages += 1;

    let stopped = false;
    for (const row of rows) {
      if (stats.scanned >= maxRows) {
        stopped = true;
        break;
      }
      const inspected = inspectRow(row);
      accumulate(stats, inspected);
      if (inspected.fixtureId == null) {
        /*
          Unreachable while fixture_id is the primary key (migration 001), but a
          page of null ids would otherwise leave the cursor unmoved and the walk
          would re-fetch the same page forever. Counted, never silently skipped.
        */
        stats.skippedNoFixtureId += 1;
        continue;
      }
      if (apply && inspected.changed) {
        const { error: updateError } = await supabase
          .from(table)
          .update(buildUpdate(inspected.planned))
          .eq("fixture_id", inspected.fixtureId);
        if (updateError) throw updateError;
        stats.applied += 1;
      }
      cursor = inspected.fixtureId;
    }

    if (stopped || rows.length < pageSize) break;
  }

  return stats;
}

/** READ-ONLY walk. Never writes, whatever else is passed. */
export async function runDryRun(options = {}) {
  return runBackfill({ ...options, apply: false });
}

export default { runDryRun, runBackfill, inspectRow, buildUpdate, BACKFILL_SELECT, VALIDITY_COLUMNS };
