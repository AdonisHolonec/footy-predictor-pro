import { buildHydrationPayload } from "../hydrationPayloadColumn.js";

/**
 * One-off backfill for `predictions_history.hydration_payload` — migration 067.
 *
 * A2 populates the column on every NEW prediction write. This seeds the rows
 * that predate it. Nothing reads the column yet: the read cutover is a separate
 * change, so this backfill is invisible to production until then.
 *
 * `raw_payload` REMAINS AUTHORITATIVE. This column is a cache that exists so
 * prediction hydration can be answered without detoasting the document — the
 * measured difference on this table was 10,941 buffers / 1,822 ms with
 * `raw_payload->key` versus 411 buffers / 0.917 ms without it (055).
 *
 * ── ONE projection, never two ─────────────────────────────────────────────────
 * The derived value comes from `buildHydrationPayload` — the SAME function A2
 * calls at the creation site. This file does not know which fields the column
 * holds and must never learn: a second implementation would drift from A2 the
 * first time the board contract moved, and the drift would be invisible because
 * both sides would still "work".
 *
 * That is also why the walk reads the FULL `raw_payload` rather than a set of
 * `alias:raw_payload->key` projections the way historyListColumns' backfill
 * does. Reproducing projectValueEngine's rule (19 scalars plus the first
 * cards-looking entry of `markets`) from subpaths would BE that second
 * implementation, and it would still have to pull `valueEngine.markets` — 44.8%
 * of the document — to pick the cards leg. The detoast is paid either way; only
 * the correctness differs.
 *
 * ── Why batched, and why keyset ───────────────────────────────────────────────
 * A single unbounded UPDATE would detoast every row in one statement — exactly
 * the operation whose statement_timeout this effort exists to remove. The work
 * is chunked by `fixture_id` (the primary key) using keyset pagination: each
 * batch is independently executable, resumable from `--after`, and cannot loop,
 * because the cursor is strictly greater than the last id seen. OFFSET is
 * deliberately not used — it re-scans a growing prefix on every page.
 *
 * Batches are small (default 50) because each row carries the whole document:
 * measured on this table, 100 rows of raw_payload is ~31 MB and 2.2 s while 250
 * rows times out.
 *
 * ── Why UPDATE and not upsert ─────────────────────────────────────────────────
 * PostgREST can only bulk-write through upsert, and an upsert whose conflict
 * target misses would INSERT a half-empty row into predictions_history — a row
 * that would then appear in the History list. Per-row
 * `UPDATE ... WHERE fixture_id = ? AND hydration_payload IS NULL` cannot invent
 * a fixture, and cannot touch a row A2 has already populated.
 *
 * ── What it must never write ──────────────────────────────────────────────────
 * `hydration_payload` and nothing else. Not `updated_at` (the settlement and
 * sync scans key on it, and churning it table-wide would corrupt their
 * predicates), not `raw_payload`, not status/score/validation, not any
 * prediction field.
 */

/**
 * Rows are read whole: `buildHydrationPayload` needs the document, and asking
 * for subpaths would mean re-deriving its field list here. `hydration_payload`
 * is selected so a row A2 populated between the scan and the write can be
 * counted rather than silently retried.
 */
export const BACKFILL_SELECT = "fixture_id, hydration_payload, raw_payload";

/** Full documents, so pages stay far below the 250-row read that timed out. */
export const DEFAULT_BATCH = 50;
export const MAX_BATCH = 200;

/** Abort thresholds. Production safety, not throughput. */
export const MAX_BATCH_MS = 30_000;
export const MAX_ERROR_RATE = 0.05;
export const MAX_CONSECUTIVE_BATCH_FAILURES = 2;

/** Postgres statement timeout — never worth retrying at the same batch size. */
const STATEMENT_TIMEOUT_CODE = "57014";

export class BackfillAbort extends Error {
  constructor(message, { reason, lastFixtureId, stats } = {}) {
    super(message);
    this.name = "BackfillAbort";
    this.reason = reason;
    this.lastFixtureId = lastFixtureId ?? null;
    this.stats = stats ?? null;
  }
}

function isStatementTimeout(error) {
  if (!error) return false;
  if (String(error.code || "") === STATEMENT_TIMEOUT_CODE) return true;
  return /statement timeout/i.test(String(error.message || ""));
}

/**
 * Decide what one scanned row needs.
 *
 * Pure: no database, no clock. The three outcomes are disjoint and exhaustive,
 * which is what lets the caller's counters add up to `scanned`.
 *
 * @returns {{action: "update"|"skipNonNull"|"skipEmpty", value: object|null}}
 */
export function planRowUpdate(row) {
  // A2 (or an earlier run) already populated it. Never overwrite: the live
  // writer derived its value from the payload it actually persisted, which is a
  // stronger guarantee than re-deriving from a row read back later.
  if (row?.hydration_payload !== null && row?.hydration_payload !== undefined) {
    return { action: "skipNonNull", value: null };
  }

  const value = buildHydrationPayload(row?.raw_payload);

  // A malformed or field-less document yields null. Writing that null would be
  // indistinguishable from "not yet backfilled" and would stop the audit ever
  // converging, so the row is skipped and reported by id instead.
  if (value === null) return { action: "skipEmpty", value: null };

  return { action: "update", value };
}

function emptyStats() {
  return {
    scanned: 0,
    eligible: 0,
    updated: 0,
    skippedEmpty: 0,
    skippedNonNull: 0,
    failed: 0,
    batches: 0,
    lastFixtureId: null,
    /** fixture_id only — never payload content. */
    skippedEmptyIds: [],
    failedIds: [],
    batchDurationMs: [],
    rowsPerSec: 0,
    remainingNull: null,
    elapsedMs: 0
  };
}

/**
 * Keyset walk over the table. `apply: false` plans without writing.
 *
 * `now` is injected so elapsed figures are testable; `supabase` is injected so
 * the whole loop runs against fakes.
 */
export async function runBackfill({
  supabase,
  batchSize = DEFAULT_BATCH,
  apply = false,
  after = 0,
  maxBatches = Infinity,
  table = "predictions_history",
  now = () => Date.now(),
  onBatch = null,
  countRemaining = true
} = {}) {
  if (!supabase) throw new Error("supabase client is required");
  const started = now();
  const stats = emptyStats();
  let cursor = Number(after) || 0;
  let consecutiveBatchFailures = 0;

  while (stats.batches < maxBatches) {
    const batchStarted = now();
    const batchBefore = { scanned: stats.scanned, failed: stats.failed };

    let data;
    try {
      const res = await supabase
        .from(table)
        .select(BACKFILL_SELECT)
        // Eligibility, applied server-side so a re-run does not re-read rows it
        // has already done. The per-row guard below still covers the race.
        .is("hydration_payload", null)
        .not("raw_payload", "is", null)
        .gt("fixture_id", cursor)
        .order("fixture_id", { ascending: true })
        .limit(batchSize);
      if (res.error) throw res.error;
      data = res.data;
      consecutiveBatchFailures = 0;
    } catch (error) {
      consecutiveBatchFailures += 1;
      if (isStatementTimeout(error)) {
        throw new BackfillAbort(`statement timeout reading batch (${batchSize} rows) — lower --batch`, {
          reason: "statement_timeout",
          lastFixtureId: stats.lastFixtureId,
          stats
        });
      }
      if (consecutiveBatchFailures >= MAX_CONSECUTIVE_BATCH_FAILURES) {
        throw new BackfillAbort(`${consecutiveBatchFailures} consecutive batch failures: ${error?.message || error}`, {
          reason: "consecutive_batch_failures",
          lastFixtureId: stats.lastFixtureId,
          stats
        });
      }
      continue;
    }

    const rows = data || [];
    if (rows.length === 0) break;

    for (const row of rows) {
      stats.scanned += 1;
      const { action, value } = planRowUpdate(row);

      if (action === "skipNonNull") {
        stats.skippedNonNull += 1;
        continue;
      }
      if (action === "skipEmpty") {
        stats.skippedEmpty += 1;
        stats.skippedEmptyIds.push(row.fixture_id);
        continue;
      }

      stats.eligible += 1;
      if (!apply) {
        stats.updated += 1;
        continue;
      }

      try {
        // ONE column. The `is(hydration_payload, null)` predicate is what makes
        // a concurrent A2 write win rather than be clobbered; `select` lets an
        // empty result be counted as that race instead of a silent success.
        const { data: written, error: upErr } = await supabase
          .from(table)
          .update({ hydration_payload: value })
          .eq("fixture_id", row.fixture_id)
          .is("hydration_payload", null)
          .select("fixture_id");
        if (upErr) throw upErr;
        if (Array.isArray(written) && written.length === 0) {
          stats.skippedNonNull += 1;
          continue;
        }
        stats.updated += 1;
      } catch (error) {
        // Isolated: one bad row never aborts its neighbours. It stays NULL and
        // is eligible again on the next run.
        stats.failed += 1;
        stats.failedIds.push(row.fixture_id);
        if (isStatementTimeout(error)) {
          throw new BackfillAbort(`statement timeout writing fixture_id=${row.fixture_id}`, {
            reason: "statement_timeout",
            lastFixtureId: stats.lastFixtureId,
            stats
          });
        }
      }
    }

    // Strictly increasing: the next page starts past the highest id seen, so the
    // walk terminates even if a batch comes back short.
    cursor = Number(rows[rows.length - 1].fixture_id);
    stats.lastFixtureId = cursor;
    stats.batches += 1;

    const batchMs = now() - batchStarted;
    stats.batchDurationMs.push(batchMs);

    const batchScanned = stats.scanned - batchBefore.scanned;
    const batchFailed = stats.failed - batchBefore.failed;
    const batchErrorRate = batchScanned > 0 ? batchFailed / batchScanned : 0;

    if (onBatch) onBatch({ ...stats, batchMs, batchErrorRate });

    if (batchErrorRate > MAX_ERROR_RATE) {
      throw new BackfillAbort(
        `batch error rate ${(batchErrorRate * 100).toFixed(1)}% exceeded ${(MAX_ERROR_RATE * 100).toFixed(0)}%`,
        { reason: "error_rate", lastFixtureId: stats.lastFixtureId, stats }
      );
    }
    if (batchMs > MAX_BATCH_MS) {
      throw new BackfillAbort(`batch took ${batchMs} ms, above the ${MAX_BATCH_MS} ms ceiling — lower --batch`, {
        reason: "batch_duration",
        lastFixtureId: stats.lastFixtureId,
        stats
      });
    }

    if (rows.length < batchSize) break;
  }

  stats.elapsedMs = now() - started;
  stats.rowsPerSec = stats.elapsedMs > 0 ? Number((stats.scanned / (stats.elapsedMs / 1000)).toFixed(2)) : 0;

  if (countRemaining) {
    try {
      const { count } = await supabase
        .from(table)
        .select("fixture_id", { count: "exact", head: true })
        .is("hydration_payload", null);
      stats.remainingNull = typeof count === "number" ? count : null;
    } catch {
      // Telemetry only — a failed count must not fail a completed backfill.
      stats.remainingNull = null;
    }
  }

  return stats;
}
