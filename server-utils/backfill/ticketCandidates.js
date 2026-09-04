import { buildTicketCandidates } from "../ticketCandidateColumn.js";
import { rehydratePayloadPaths, selectWithPayloadPaths } from "../history/payloadProjection.js";

/**
 * One-off backfill for `predictions_history.ticket_candidates` — migration 069.
 *
 * PR 2A populates the column on every NEW prediction write. This seeds the rows
 * that predate it. The GLOBAL loader (2B-i) SKIPS a NULL row rather than falling
 * back to raw_payload, so until this runs the admin ticket pool is limited to
 * fixtures predicted after #230 — correct behaviour, but a thin pool.
 *
 * `raw_payload` REMAINS AUTHORITATIVE and is not modified. This column is a
 * projection of it.
 *
 * ── ONE projection, never two ────────────────────────────────────────────────
 * The derived value comes from `buildTicketCandidates` — the SAME function the
 * creation site calls. This file does not know which markets the column keeps
 * and must never learn: a second implementation would drift from the live
 * writer the first time the rule moved, and the drift would be invisible
 * because both sides would still "work".
 *
 * ── WHY SUBPATHS HERE, WHERE hydrationPayload READS THE WHOLE DOCUMENT ───────
 * The hydration backfill reads full `raw_payload` on the explicit grounds that
 * reproducing its narrowing rule from subpaths would BE a second implementation.
 * That reasoning does not apply here, because `buildTicketCandidates` takes a
 * DOCUMENT and reads exactly five paths from it. Projecting those five and
 * folding them back under `raw_payload` (through the shared mechanism from the
 * egress PR, not a bespoke one) hands the helper the same document shape it
 * would have received anyway. The projection logic stays entirely inside the
 * helper; only the transport narrows.
 *
 * That equivalence is asserted, not assumed: the suite runs the real helper over
 * a full document and over a projected-then-rehydrated row and requires
 * deep-equal output, simulating jsonb `->` semantics the way the egress tests
 * do. If the helper ever starts reading a sixth path, that test fails before
 * production silently projects `undefined`.
 *
 * ── WHAT THE SUBPATHS DO AND DO NOT SAVE ─────────────────────────────────────
 * They narrow the WIRE, which is what is billed as egress. They do NOT reduce
 * the server-side read: Postgres still de-TOASTs the whole document to evaluate
 * a path. And the saving is bounded by physics — `valueEngine.markets` is the
 * bulk of the document and is IRREDUCIBLE here, because the projection's one
 * rule is a filter over markets and nothing can know which are recommendable
 * without reading them all. Expect a modest reduction, not an order of
 * magnitude; the run measures it rather than claiming it.
 *
 * ── Why batched, and why keyset ──────────────────────────────────────────────
 * A single unbounded UPDATE would de-TOAST every row in one statement — the
 * operation whose statement_timeout this whole effort exists to remove. Work is
 * chunked by `fixture_id` (the primary key) using keyset pagination: each batch
 * is independently executable, resumable from `--after`, and cannot loop,
 * because the cursor is strictly greater than the last id seen. OFFSET is
 * deliberately not used — it re-scans a growing prefix on every page.
 *
 * ORDER. `fixture_id` ascending, which is broadly oldest-first because ids are
 * issued by the provider in time order — but it is NOT a chronological
 * guarantee, and this module does not claim one. Ordering by `kickoff_at`
 * instead would be truly chronological and would break resumability: it is not
 * unique, so a cursor on it either skips or repeats rows at a tie. A unique,
 * stable, indexed key is what makes "resume from --after" safe, and that is the
 * property worth more here.
 *
 * ── Why UPDATE and not upsert ────────────────────────────────────────────────
 * PostgREST can only bulk-write through upsert, and an upsert whose conflict
 * target missed would INSERT a half-empty row into predictions_history — a row
 * that would then appear in the History list. Per-row
 * `UPDATE ... WHERE fixture_id = ? AND ticket_candidates IS NULL` cannot invent
 * a fixture, and cannot touch a row the live writer has already populated.
 *
 * ── What it must never write ─────────────────────────────────────────────────
 * `ticket_candidates` and nothing else. Not `raw_payload`, not
 * `hydration_payload`, not status/score/validation, not any prediction field.
 *
 * NOTE ON updated_at: predictions_history carries a BEFORE UPDATE trigger
 * (`trg_predictions_history_updated_at`, migration 001) that sets
 * updated_at = now() on ANY update. This module never writes that column, but
 * every row it updates WILL receive a new timestamp. That is expected and must
 * not be described as "updated_at unchanged". The `IS NULL` eligibility is what
 * keeps the blast radius honest: a populated row is never touched, so a re-run
 * bumps nothing.
 */

/**
 * The `raw_payload` paths `buildTicketCandidates` dereferences — and only those.
 *
 *   payload.valueEngine.markets        the population the rule filters
 *   payload.modelMeta                  block, for dataQuality
 *   payload.insufficientData           scalar
 *   payload.recommended                block, for confidence
 *   payload.teams                      {home, away}
 *
 * THE RULE (from history/payloadProjection.js, verbatim): a consumer that starts
 * reading a new `payload.<key>` MUST add that path here, or it will silently
 * read `undefined` instead of data. The parity test in
 * tests/ticketCandidatesBackfill.test.js is what enforces it.
 *
 * `valueEngine.markets` rather than the `valueEngine` block on purpose: the
 * block is ~87.96% of the row and its siblings are read by nobody here.
 *
 * ── WHY modelMeta AND recommended ARE BLOCKS, NOT LEAF PATHS ─────────────────
 * `["modelMeta", "dataQuality"]` would be the tighter projection and it is
 * WRONG, because it cannot round-trip a stored null.
 *
 * `rehydratePayloadPaths` omits a path that came back null — it has to, since
 * PostgREST's `->` cannot distinguish a missing key from a stored null. For
 * every other field here that is harmless: absent and null reach the helper as
 * the same answer. For these two it is not, because the helper reads them
 * through `finiteOrNull`, and `Number(null)` is 0 while `Number(undefined)` is
 * NaN. A document storing `modelMeta: {dataQuality: null}` therefore yields
 * dataQuality 0 from the live writer and dataQuality null from a leaf
 * projection — and those are not cosmetic variants of each other: the candidate
 * engine treats a null dataQuality as `rejected.missingData` and a 0 as present,
 * so the backfilled row would offer FEWER candidates than the same fixture
 * predicted today.
 *
 * Projecting the parent OBJECT fixes it: `{dataQuality: null}` is a non-null
 * value, so it survives rehydration intact and the helper sees the null it would
 * have seen in the stored document.
 *
 * The cost is the rest of those two blocks — modelMeta measured at ~9.6 KB — set
 * against `valueEngine.markets`, which dominates the read. Correctness is worth
 * far more than that here, and the parity suite is what discovered the
 * difference rather than a reviewer noticing it later.
 */
export const TICKET_CANDIDATE_SOURCE_PATHS = Object.freeze({
  veMarkets: Object.freeze(["valueEngine", "markets"]),
  modelMeta: Object.freeze(["modelMeta"]),
  insufficientData: Object.freeze(["insufficientData"]),
  recommended: Object.freeze(["recommended"]),
  teams: Object.freeze(["teams"])
});

/**
 * `ticket_candidates` is selected so a row the live writer populated between the
 * scan and the write is COUNTED as that race rather than silently retried.
 */
export const BACKFILL_SELECT = selectWithPayloadPaths(
  "fixture_id, ticket_candidates",
  TICKET_CANDIDATE_SOURCE_PATHS
);

/**
 * Small by default: each row still carries every market of the source document,
 * which is the bulk of a ~303 KB payload. 25 is the brief's starting size and
 * the run reports actual bytes so it can be revised from evidence.
 */
export const DEFAULT_BATCH = 25;
export const MAX_BATCH = 100;

/** Abort thresholds. Production safety, not throughput. */
export const MAX_BATCH_MS = 30_000;
export const MAX_ERROR_RATE = 0.05;
export const MAX_CONSECUTIVE_BATCH_FAILURES = 2;

/** Postgres statement timeout — never worth retrying at the same batch size. */
const STATEMENT_TIMEOUT_CODE = "57014";

/** Exactly the keys buildTicketCandidates emits. A payload with more is a leak. */
const REQUIRED_KEYS = Object.freeze([
  "confidence",
  "dataQuality",
  "examined",
  "insufficientData",
  "markets",
  "notRecommendable",
  "teams"
]);

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
 * The contract check every payload passes before it may be written.
 *
 * Structural, not statistical: it re-derives what the helper claims rather than
 * trusting it. `notRecommendable` is checked as an identity against `examined`
 * and the retained count, which is the one arithmetic relation the column
 * promises and the one a future edit could silently break.
 *
 * @returns {{valid: boolean, reason?: string, bytes?: number}}
 */
export function validateTicketCandidates(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reason: "not_an_object" };
  }

  const keys = Object.keys(value).sort();
  if (keys.length !== REQUIRED_KEYS.length || keys.some((k, i) => k !== REQUIRED_KEYS[i])) {
    // Catches BOTH a missing key and an extra one. An extra key is the leak
    // case: a stray `valueEngine` or `raw_payload` would multiply the column's
    // size and reintroduce the egress this projection removes.
    return { valid: false, reason: `key_set_mismatch:${keys.join(",")}` };
  }

  if (!Array.isArray(value.markets)) return { valid: false, reason: "markets_not_array" };
  if (value.markets.some((m) => m?.recommendable !== true)) {
    return { valid: false, reason: "non_recommendable_market_retained" };
  }

  if (!Number.isInteger(value.examined) || value.examined < 0) {
    return { valid: false, reason: "examined_not_a_count" };
  }
  if (!Number.isInteger(value.notRecommendable) || value.notRecommendable < 0) {
    return { valid: false, reason: "notRecommendable_not_a_count" };
  }
  if (value.examined - value.markets.length !== value.notRecommendable) {
    return { valid: false, reason: "counter_identity_broken" };
  }

  if (typeof value.insufficientData !== "boolean") {
    return { valid: false, reason: "insufficientData_not_boolean" };
  }
  if (value.dataQuality !== null && !Number.isFinite(value.dataQuality)) {
    return { valid: false, reason: "dataQuality_not_finite_or_null" };
  }
  if (value.confidence !== null && !Number.isFinite(value.confidence)) {
    return { valid: false, reason: "confidence_not_finite_or_null" };
  }
  if (value.teams !== null && (typeof value.teams !== "object" || Array.isArray(value.teams))) {
    return { valid: false, reason: "teams_not_object_or_null" };
  }

  // It has to survive the wire. A payload that cannot serialize would fail at
  // the write with a far less legible error.
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value));
  } catch (error) {
    return { valid: false, reason: `not_serializable:${error?.message || "unknown"}` };
  }
  if (!Number.isFinite(bytes) || bytes <= 0) return { valid: false, reason: "unmeasurable_bytes" };

  return { valid: true, bytes };
}

/**
 * Decide what one scanned row needs.
 *
 * Pure: no database, no clock. The outcomes are disjoint and exhaustive, which
 * is what lets the caller's counters add up to `scanned`.
 *
 * @returns {{action: string, value: object|null, bytes: number, reason?: string}}
 */
export function planRowUpdate(row) {
  // Never overwrite. The live writer derived its value from the payload it
  // actually persisted, which is a stronger guarantee than re-deriving from a
  // row read back later.
  const stored = row?.ticket_candidates;
  if (stored !== null && stored !== undefined) {
    return { action: "skipNonNull", value: null, bytes: 0 };
  }

  // Fold the projected paths back under raw_payload, then hand the helper the
  // document shape it expects. The helper is the only thing that decides what
  // the column contains.
  const { raw_payload: document } = rehydratePayloadPaths(row, TICKET_CANDIDATE_SOURCE_PATHS);
  const value = buildTicketCandidates(document);

  /*
    null means the source cannot support a projection — no markets array at all.
    Production has such rows: the oldest fixtures predate valueEngine.markets
    entirely. Writing null would be indistinguishable from "not yet backfilled"
    and would stop the audit ever converging, so the row is SKIPPED and reported
    by id. This is the helper's own answer for that source state, not a
    downgrade invented here.
  */
  if (value === null) return { action: "skipNoSource", value: null, bytes: 0 };

  const check = validateTicketCandidates(value);
  if (!check.valid) {
    return { action: "invalid", value: null, bytes: 0, reason: check.reason };
  }

  return { action: "update", value, bytes: check.bytes };
}

function emptyStats() {
  return {
    scanned: 0,
    eligible: 0,
    updated: 0,
    skippedNonNull: 0,
    skippedNoSource: 0,
    invalid: 0,
    failed: 0,
    batches: 0,
    lastFixtureId: null,
    /** fixture_id only — never payload content. */
    skippedNoSourceIds: [],
    invalidRows: [],
    failedRows: [],
    /** Byte accounting, kept apart so the report can distinguish read from write. */
    projectedBytes: 0,
    sourceBytes: 0,
    payloadSizes: [],
    batchDurationMs: [],
    rowsPerSec: 0,
    remainingNull: null,
    elapsedMs: 0
  };
}

/**
 * Measured source bytes for one scanned row.
 *
 * This is what the PROJECTION put on the wire — not the size of the full
 * `raw_payload` document, which this query never transports. Serialising the
 * received aliases is the closest honest measure available client-side; it is
 * not a Supabase billing figure and must not be presented as one.
 */
function measureSourceBytes(row) {
  try {
    const projected = {};
    for (const alias of Object.keys(TICKET_CANDIDATE_SOURCE_PATHS)) projected[alias] = row?.[alias];
    return Buffer.byteLength(JSON.stringify(projected));
  } catch {
    return 0;
  }
}

/**
 * Keyset walk over the table. `apply: false` plans without writing — and is the
 * DEFAULT, so an accidental invocation cannot mutate anything.
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
  maxRows = Infinity,
  table = "predictions_history",
  now = () => Date.now(),
  onBatch = null,
  countRemaining = true
} = {}) {
  if (!supabase) throw new Error("supabase client is required");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH) {
    throw new Error(`batchSize must be an integer in 1..${MAX_BATCH}`);
  }

  const started = now();
  const stats = emptyStats();
  let cursor = Number(after) || 0;
  let consecutiveBatchFailures = 0;

  while (stats.batches < maxBatches && stats.scanned < maxRows) {
    const batchStarted = now();
    const batchBefore = {
      scanned: stats.scanned,
      failed: stats.failed,
      projected: stats.projectedBytes,
      source: stats.sourceBytes
    };

    // Never read past the row ceiling: a --max-rows of 10 must cost one 10-row
    // read, not a full batch that is then discarded.
    const readSize = Math.min(batchSize, maxRows - stats.scanned);

    let data;
    try {
      // Eligibility applied SERVER-SIDE so a re-run does not re-read rows it has
      // already done. The per-row guard below still covers the race.
      const res = await supabase
        .from(table)
        .select(BACKFILL_SELECT)
        .is("ticket_candidates", null)
        .not("raw_payload", "is", null)
        .gt("fixture_id", cursor)
        .order("fixture_id", { ascending: true })
        .limit(readSize);
      if (res.error) throw res.error;
      data = res.data;
      consecutiveBatchFailures = 0;
    } catch (error) {
      consecutiveBatchFailures += 1;
      if (isStatementTimeout(error)) {
        throw new BackfillAbort(`statement timeout reading batch (${readSize} rows) — lower --batch`, {
          reason: "statement_timeout",
          lastFixtureId: stats.lastFixtureId,
          stats
        });
      }
      if (consecutiveBatchFailures >= MAX_CONSECUTIVE_BATCH_FAILURES) {
        throw new BackfillAbort(
          `${consecutiveBatchFailures} consecutive batch failures: ${error?.message || error}`,
          { reason: "consecutive_batch_failures", lastFixtureId: stats.lastFixtureId, stats }
        );
      }
      continue;
    }

    const rows = data || [];
    if (rows.length === 0) break;

    for (const row of rows) {
      stats.scanned += 1;
      stats.sourceBytes += measureSourceBytes(row);

      const { action, value, bytes, reason } = planRowUpdate(row);

      if (action === "skipNonNull") {
        stats.skippedNonNull += 1;
        continue;
      }
      if (action === "skipNoSource") {
        stats.skippedNoSource += 1;
        stats.skippedNoSourceIds.push(row.fixture_id);
        continue;
      }
      if (action === "invalid") {
        // A payload that failed the contract check is NEVER written and NEVER
        // counted as done. Recorded by id and reason so it can be investigated.
        stats.invalid += 1;
        stats.invalidRows.push({ fixtureId: row.fixture_id, reason });
        continue;
      }

      stats.eligible += 1;
      stats.projectedBytes += bytes;
      stats.payloadSizes.push(bytes);

      if (!apply) continue;

      try {
        // ONE column. The `is(ticket_candidates, null)` predicate is what makes
        // a concurrent live write WIN rather than be clobbered; `select` lets an
        // empty result be counted as that race instead of a silent success.
        const { data: written, error: upErr } = await supabase
          .from(table)
          .update({ ticket_candidates: value })
          .eq("fixture_id", row.fixture_id)
          .is("ticket_candidates", null)
          .select("fixture_id");
        if (upErr) throw upErr;
        if (Array.isArray(written) && written.length === 0) {
          // Lost the race: the live writer got there first. Its value stands.
          stats.skippedNonNull += 1;
          stats.eligible -= 1;
          continue;
        }
        stats.updated += 1;
      } catch (error) {
        // Isolated: one bad row never aborts its neighbours. It stays NULL and
        // is eligible again on the next run.
        stats.failed += 1;
        stats.failedRows.push({ fixtureId: row.fixture_id, reason: error?.message || String(error) });
        stats.eligible -= 1;
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

    if (onBatch) {
      onBatch({
        ...stats,
        batchMs,
        batchErrorRate,
        batchScanned,
        batchProjectedBytes: stats.projectedBytes - batchBefore.projected,
        batchSourceBytes: stats.sourceBytes - batchBefore.source
      });
    }

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

    if (rows.length < readSize) break;
  }

  stats.elapsedMs = now() - started;
  stats.rowsPerSec = stats.elapsedMs > 0 ? Number((stats.scanned / (stats.elapsedMs / 1000)).toFixed(2)) : 0;

  if (countRemaining) {
    try {
      const { count } = await supabase
        .from(table)
        .select("fixture_id", { count: "exact", head: true })
        .is("ticket_candidates", null);
      stats.remainingNull = typeof count === "number" ? count : null;
    } catch {
      // Telemetry only — a failed count must not fail a completed backfill.
      stats.remainingNull = null;
    }
  }

  return stats;
}

/** p-th percentile of a byte sample, or 0 when there is nothing to describe. */
export function percentile(sizes, p) {
  const sorted = [...(sizes || [])].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}
