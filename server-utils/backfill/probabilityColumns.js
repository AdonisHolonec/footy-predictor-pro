/**
 * D9b-2 — dry run for the six promoted 1X2 columns (migration 059).
 *
 * READ ONLY. This module contains no insert, update or upsert: it walks the
 * table, extracts what the backfill *would* write, and reports. The apply path
 * is deliberately a separate change, because the numbers this produces are what
 * decide whether applying is safe at all.
 *
 * Two things make the report trustworthy rather than merely plausible:
 *
 *   - extraction is `extractPromotedModelColumns`, THE function the dual-write
 *     uses. Reimplementing it here would measure a copy, and parity against a
 *     copy proves nothing about the rows Predict is writing right now.
 *   - the walk is the exact keyset/chunk strategy the real backfill will use, so
 *     "it completed" here means "it will complete there".
 *
 * Chunking is not a preference. raw_payload has grown to ~353 KB/row and D7
 * measured this table on production:
 *
 *   limit=100    2,161 ms   30,964 KB   200
 *   limit=250   10,441 ms          -    500  57014 statement timeout
 *
 * So 100 is the largest page demonstrated to commit, and OFFSET is refused: it
 * re-reads and re-discards every skipped row, which on a TOASTed table means
 * paying for the same documents again on every page.
 */

import { extractPromotedModelColumns } from "../predictionsHistory.js";

export const PROMOTED_COLUMNS = Object.freeze([
  "prob_1",
  "prob_x",
  "prob_2",
  "model_method",
  "model_data_quality",
  "pick_1x2"
]);

/**
 * The document plus the columns already written, so parity can be checked
 * against rows the dual-write has ALREADY populated — the only rows where a
 * mismatch would mean a live bug rather than a stale row.
 */
export const DRYRUN_SELECT = `fixture_id, raw_payload, ${PROMOTED_COLUMNS.join(", ")}`;

export function emptyStats() {
  return {
    batches: 0,
    scanned: 0,
    lastFixtureId: null,
    elapsedMs: 0,

    // Phase B — coverage
    tripleComplete: 0,
    triplePartial: 0,
    tripleMissing: 0,
    tripleMalformed: 0,
    methodPresent: 0,
    dataQualityPresent: 0,
    pickPresent: 0,
    fullyComplete: 0,
    partiallyComplete: 0,
    noSourceAtAll: 0,

    // Phase D — the zero question
    allZeroTriple: 0,
    allZeroWithInsufficientData: 0,
    allZeroWithoutInsufficientData: 0,

    // Phase C — legacy representation drift
    hasEvaluationTriple: 0,
    hasProbsTriple: 0,
    hasBoth: 0,
    evaluationDiffersFromProbs: 0,

    // Phase C — parity against what is already stored
    alreadyPopulated: 0,
    wouldUpdate: 0,
    wouldRemainNull: 0,

    // D9b-3 — apply
    candidates: 0,
    alreadyCorrect: 0,
    updated: 0,
    failed: 0,
    nulledOut: 0,
    failedRange: null,
    mismatches: {
      prob_1: 0,
      prob_x: 0,
      prob_2: 0,
      model_method: 0,
      model_data_quality: 0,
      pick_1x2: 0
    },
    mismatchSamples: []
  };
}

/** Finite number, with null/undefined/"" rejected before coercion (Number(null) === 0). */
function strictNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** How many of p1/pX/p2 are usable, and whether any were present-but-unusable. */
function tripleShape(source) {
  if (!source || typeof source !== "object") return { usable: 0, present: 0 };
  let usable = 0;
  let present = 0;
  for (const key of ["p1", "pX", "p2"]) {
    const raw = source[key];
    if (raw !== null && raw !== undefined && raw !== "") present += 1;
    if (strictNum(raw) !== null) usable += 1;
  }
  return { usable, present };
}

function readTriple(source) {
  const { usable } = tripleShape(source);
  if (usable !== 3) return null;
  return { p1: Number(source.p1), pX: Number(source.pX), p2: Number(source.p2) };
}

/**
 * Is the stored column already what the extractor would write?
 *
 * Null-aware and numeric-aware: PostgREST can hand back a `numeric` as a string,
 * so a raw `===` would report every already-correct row as needing an update and
 * turn an idempotent backfill into a full rewrite on every run.
 */
export function columnMatches(stored, planned) {
  const sNull = stored === null || stored === undefined;
  const pNull = planned === null || planned === undefined;
  if (sNull || pNull) return sNull && pNull;
  if (typeof planned === "number") return Number(stored) === planned;
  return String(stored) === String(planned);
}

/**
 * The SET clause — exactly the six promoted columns, never anything else.
 *
 * Built as its own object so the column set is a single readable list rather
 * than something assembled inside the write call. `raw_payload`, `saved_at`,
 * `fixture_id`, odds, settlement and every other column are absent by
 * construction, not by convention.
 *
 * `updated_at` is NOT here either — but the table carries
 * `trg_predictions_history_updated_at`, a BEFORE UPDATE trigger (migration 001),
 * so Postgres bumps it on any UPDATE regardless of what this sends. That cannot
 * be avoided without a schema change, and it is harmless: the staleness guard in
 * upsertPredictionsHistory compares an incoming `generatedAt` (now, at Predict
 * time) against the stored value, and a backfill timestamp is always in the past
 * relative to a later Predict.
 */
export function buildUpdate(planned) {
  return {
    prob_1: planned.prob_1,
    prob_x: planned.prob_x,
    prob_2: planned.prob_2,
    model_method: planned.model_method,
    model_data_quality: planned.model_data_quality,
    pick_1x2: planned.pick_1x2
  };
}

/**
 * Everything one row contributes, without deciding anything about it.
 *
 * `payload` is passed to the REAL extractor, so `planned` is byte-for-byte what
 * the dual-write would produce for this fixture today.
 */
export function inspectRow(row) {
  const payload = row?.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
  const planned = extractPromotedModelColumns(payload);

  const evalTriple = readTriple(payload?.evaluation?.modelProbs1x2Pct);
  const probsTriple = readTriple(payload?.probs);
  const evalShape = tripleShape(payload?.evaluation?.modelProbs1x2Pct);
  const probsShape = tripleShape(payload?.probs);

  const usable = Math.max(evalShape.usable, probsShape.usable);
  const present = Math.max(evalShape.present, probsShape.present);

  /*
    "Partial" means the row HAS some of a triple but not a usable three. It is
    reported separately from "missing" because the two need different answers: a
    missing triple is simply an old row, a partial one is a row whose document is
    shaped in a way nobody expected.
  */
  const tripleState =
    usable === 3
      ? "complete"
      : present === 0
        ? "missing"
        : usable === 0 && present > 0
          ? "malformed"
          : "partial";

  const chosen = evalTriple || probsTriple;
  const allZero = Boolean(chosen && chosen.p1 === 0 && chosen.pX === 0 && chosen.p2 === 0);

  const evaluationDiffers = Boolean(
    evalTriple &&
      probsTriple &&
      (evalTriple.p1 !== probsTriple.p1 ||
        evalTriple.pX !== probsTriple.pX ||
        evalTriple.p2 !== probsTriple.p2)
  );

  // Compare only where the column is ALREADY set: a NULL column is a row the
  // backfill has not reached, not a disagreement.
  const mismatches = [];
  for (const column of PROMOTED_COLUMNS) {
    const stored = row?.[column];
    if (stored === null || stored === undefined) continue;
    const wanted = planned[column];
    if (wanted === null) continue;
    const differs =
      typeof wanted === "number" ? Number(stored) !== wanted : String(stored) !== String(wanted);
    if (differs) mismatches.push({ column, stored, planned: wanted });
  }

  const plannedNonNull = PROMOTED_COLUMNS.map((c) => planned[c]).filter((v) => v !== null).length;
  const storedNonNull = PROMOTED_COLUMNS.filter(
    (c) => row?.[c] !== null && row?.[c] !== undefined
  ).length;

  /*
    A row is a candidate only if at least one column would actually change. The
    18 rows the dual-write already populated must therefore report updated = 0,
    which is what makes re-running the backfill a no-op rather than a rewrite.
  */
  const changed = PROMOTED_COLUMNS.filter((c) => !columnMatches(row?.[c], planned[c]));
  const nullsOut = changed.filter(
    (c) => planned[c] === null && row?.[c] !== null && row?.[c] !== undefined
  ).length;

  return {
    planned,
    changed,
    needsUpdate: changed.length > 0,
    nullsOut,
    tripleState,
    allZero,
    insufficientData: payload?.insufficientData === true,
    hasEvaluationTriple: Boolean(evalTriple),
    hasProbsTriple: Boolean(probsTriple),
    evaluationDiffers,
    methodPresent: planned.model_method !== null,
    dataQualityPresent: planned.model_data_quality !== null,
    pickPresent: planned.pick_1x2 !== null,
    plannedNonNull,
    storedNonNull,
    mismatches
  };
}

function accumulate(stats, row, seen) {
  stats.scanned += 1;

  if (seen.tripleState === "complete") stats.tripleComplete += 1;
  else if (seen.tripleState === "partial") stats.triplePartial += 1;
  else if (seen.tripleState === "malformed") stats.tripleMalformed += 1;
  else stats.tripleMissing += 1;

  if (seen.methodPresent) stats.methodPresent += 1;
  if (seen.dataQualityPresent) stats.dataQualityPresent += 1;
  if (seen.pickPresent) stats.pickPresent += 1;

  if (seen.plannedNonNull === PROMOTED_COLUMNS.length) stats.fullyComplete += 1;
  else if (seen.plannedNonNull > 0) stats.partiallyComplete += 1;
  else stats.noSourceAtAll += 1;

  if (seen.allZero) {
    stats.allZeroTriple += 1;
    if (seen.insufficientData) stats.allZeroWithInsufficientData += 1;
    else stats.allZeroWithoutInsufficientData += 1;
  }

  if (seen.hasEvaluationTriple) stats.hasEvaluationTriple += 1;
  if (seen.hasProbsTriple) stats.hasProbsTriple += 1;
  if (seen.hasEvaluationTriple && seen.hasProbsTriple) stats.hasBoth += 1;
  if (seen.evaluationDiffers) stats.evaluationDiffersFromProbs += 1;

  if (seen.needsUpdate) stats.candidates += 1;
  else stats.alreadyCorrect += 1;
  stats.nulledOut += seen.nullsOut;

  if (seen.storedNonNull > 0) stats.alreadyPopulated += 1;
  if (seen.plannedNonNull > 0 && seen.storedNonNull === 0) stats.wouldUpdate += 1;
  if (seen.plannedNonNull === 0 && seen.storedNonNull === 0) stats.wouldRemainNull += 1;

  for (const m of seen.mismatches) {
    stats.mismatches[m.column] += 1;
    // A handful of examples is enough to diagnose; the count is the finding.
    if (stats.mismatchSamples.length < 10) {
      stats.mismatchSamples.push({ fixture_id: row.fixture_id, ...m });
    }
  }
}

/**
 * Everything that must be true before the first write.
 *
 * Ordered cheapest-first, and every one of them fails CLOSED: a backfill that
 * cannot verify its preconditions must not start, because the failure mode of
 * guessing here is a partially-written table.
 *
 * The population guardrail is the one that matters most. The audited population
 * is ~914 rows; if the table has grown to something wildly different, the
 * evidence this backfill was approved against no longer describes it, and the
 * right response is to stop and re-audit rather than to write anyway.
 */
export async function preflight({ supabase, table = "predictions_history", maxRows = 5000 }) {
  if (!supabase) return { ok: false, reason: "supabase client is required" };

  const probe = await supabase.from(table).select(PROMOTED_COLUMNS.join(", ")).limit(1);
  if (probe.error) {
    return {
      ok: false,
      reason: `cannot read the promoted columns — is migration 059 applied? ${probe.error.message}`
    };
  }

  const { count, error } = await supabase
    .from(table)
    .select("fixture_id", { count: "exact", head: true });
  if (error) return { ok: false, reason: `cannot count ${table}: ${error.message}` };
  if (count > maxRows) {
    return {
      ok: false,
      reason: `population ${count} exceeds the --max-rows guardrail of ${maxRows}. The audited population was ~914; re-audit before writing.`
    };
  }

  return { ok: true, population: count };
}

/**
 * One walk, two behaviours.
 *
 * Candidate selection and extraction are shared by construction — `apply` only
 * decides whether the rows the dry run would have changed are actually written.
 * There is deliberately no second implementation of the mapping to drift from
 * the first.
 *
 * Writes are per-row `UPDATE ... WHERE fixture_id = ?`, not a bulk upsert. An
 * upsert would have to carry whole rows and could INSERT a fixture that no
 * longer exists; an UPDATE touches the six columns of one existing row and can
 * do nothing else. That is the same shape the 055/056/057 backfill already uses.
 *
 * PostgREST exposes no multi-statement transaction, so a chunk is not atomic.
 * Rather than invent a transaction abstraction for this one job, the operation
 * is idempotent: each row is atomic on its own, an interrupted run leaves only
 * correct rows behind, and re-running skips them.
 */
export async function runBackfill({
  supabase,
  batchSize = 100,
  after = 0,
  maxBatches = Infinity,
  apply = false,
  table = "predictions_history",
  now = () => Date.now(),
  onBatch = null
} = {}) {
  if (!supabase) throw new Error("supabase client is required");
  const started = now();
  const stats = emptyStats();
  let cursor = Number(after) || 0;

  while (stats.batches < maxBatches) {
    const { data, error } = await supabase
      .from(table)
      .select(DRYRUN_SELECT)
      .gt("fixture_id", cursor)
      .order("fixture_id", { ascending: true })
      .limit(batchSize);
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) break;

    const chunkFrom = Number(rows[0].fixture_id);
    const chunkTo = Number(rows[rows.length - 1].fixture_id);

    for (const row of rows) {
      const seen = inspectRow(row);
      accumulate(stats, row, seen);
      if (!apply || !seen.needsUpdate) continue;

      const { error: writeError } = await supabase
        .from(table)
        .update(buildUpdate(seen.planned))
        .eq("fixture_id", row.fixture_id);

      if (writeError) {
        /*
          Stop, do not continue. A database error mid-backfill means the next row
          is as likely to fail, and silently pressing on would leave a partially
          written table with no record of where it stopped. The cursor and the
          chunk range are reported so a retry can resume from a known point.
        */
        stats.failed += 1;
        stats.failedRange = { from: chunkFrom, to: chunkTo, fixture_id: row.fixture_id };
        stats.lastFixtureId = cursor;
        stats.elapsedMs = now() - started;
        const err = new Error(
          `update failed on fixture ${row.fixture_id} (chunk ${chunkFrom}..${chunkTo}): ${writeError.message}`
        );
        err.stats = stats;
        throw err;
      }
      stats.updated += 1;
    }

    /*
      Strictly increasing cursor, so the walk terminates even if a page comes
      back short, and a re-run resumes from exactly here. This is also why there
      is no OFFSET: on a TOASTed table OFFSET re-reads and discards every skipped
      document, so page N costs N pages' worth of detoasting.
    */
    cursor = chunkTo;
    stats.lastFixtureId = cursor;
    stats.batches += 1;
    if (onBatch) onBatch({ ...stats });
    if (rows.length < batchSize) break;
  }

  stats.elapsedMs = now() - started;
  return stats;
}

/**
 * Read-only walk. Kept as its own export so the D9b-2 dry run cannot acquire a
 * write path by accident: `apply` is not a parameter here, it is hard-coded off.
 */
export async function runDryRun(options = {}) {
  return runBackfill({ ...options, apply: false });
}

export default {
  runBackfill,
  runDryRun,
  preflight,
  inspectRow,
  buildUpdate,
  columnMatches,
  emptyStats,
  PROMOTED_COLUMNS,
  DRYRUN_SELECT
};
