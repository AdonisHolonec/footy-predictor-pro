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

  return {
    planned,
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
 * Walk the table and report. Writes nothing, ever.
 *
 * @returns {Promise<object>} stats
 */
export async function runDryRun({
  supabase,
  batchSize = 100,
  after = 0,
  maxBatches = Infinity,
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

    for (const row of rows) accumulate(stats, row, inspectRow(row));

    /*
      Strictly increasing cursor, so the walk terminates even if a page comes
      back short, and a re-run resumes from exactly here. This is also why there
      is no OFFSET: on a TOASTed table OFFSET re-reads and discards every skipped
      document, so page N costs N pages' worth of detoasting.
    */
    cursor = Number(rows[rows.length - 1].fixture_id);
    stats.lastFixtureId = cursor;
    stats.batches += 1;
    if (onBatch) onBatch({ ...stats });
    if (rows.length < batchSize) break;
  }

  stats.elapsedMs = now() - started;
  return stats;
}

export default { runDryRun, inspectRow, emptyStats, PROMOTED_COLUMNS, DRYRUN_SELECT };
