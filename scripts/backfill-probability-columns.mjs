/**
 * D9b-2 — READ-ONLY dry run for the six promoted 1X2 columns (migration 059).
 *
 * There is deliberately NO --apply here. This script cannot write: the module it
 * calls contains no insert, update or upsert, and the apply path is a separate
 * change that should be reviewed against the numbers this produces.
 *
 *   npm run dryrun:probability-columns
 *   npm run dryrun:probability-columns -- --batch=100
 *   npm run dryrun:probability-columns -- --max-batches=1         # one page only
 *   npm run dryrun:probability-columns -- --after=<lastFixtureId>  # resume
 *
 * Batch size defaults to 100 because that is the largest page D7 measured
 * committing on this table (limit=250 reached a 57014 statement timeout at
 * ~353 KB/row). Raise it only with evidence.
 *
 * Migration 059 must already be applied — the script fails loudly if the columns
 * are absent rather than silently reporting zero coverage.
 */

import { createClient } from "@supabase/supabase-js";

import { PROMOTED_COLUMNS, runDryRun } from "../server-utils/backfill/probabilityColumns.js";

function parseArgs(argv) {
  const args = { batch: 100, after: 0, maxBatches: Infinity };
  for (const raw of argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "batch") args.batch = Math.max(1, Math.min(Number(value) || 100, 500));
    else if (key === "after") args.after = Number(value) || 0;
    else if (key === "max-batches") args.maxBatches = Math.max(1, Number(value) || 1);
    else if (key === "apply") {
      console.error(
        "This is the D9b-2 DRY RUN and has no --apply. Writing is a separate change (D9b-3)."
      );
      process.exit(2);
    }
  }
  return args;
}

function requireEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
    process.exit(1);
  }
  return { url, key };
}

const pad = (label, value) => `  ${String(label).padEnd(34)}${value}`;
const pct = (n, total) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "-");

async function main() {
  const args = parseArgs(process.argv);
  const { url, key } = requireEnv();
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Fail loudly if 059 is missing, rather than reporting a table of zeros.
  const probe = await supabase
    .from("predictions_history")
    .select(PROMOTED_COLUMNS.join(", "))
    .limit(1);
  if (probe.error) {
    console.error(
      `Cannot read the promoted columns — is migration 059 applied? ${probe.error.message}`
    );
    process.exit(1);
  }

  console.log(`D9b-2 dry run — batch=${args.batch}, after=${args.after}, READ ONLY`);
  const stats = await runDryRun({
    supabase,
    batchSize: args.batch,
    after: args.after,
    maxBatches: args.maxBatches,
    onBatch: (s) =>
      console.log(`  …batch ${s.batches} — ${s.scanned} rows, cursor ${s.lastFixtureId}`)
  });

  const n = stats.scanned;
  console.log("");
  console.log("1. SCAN");
  console.log(pad("rows scanned", n));
  console.log(pad("batches", stats.batches));
  console.log(pad("last fixture_id", stats.lastFixtureId ?? "(none)"));
  console.log(pad("elapsed", `${stats.elapsedMs} ms`));

  console.log("");
  console.log("2. PROBABILITY COVERAGE");
  console.log(pad("complete triples", `${stats.tripleComplete}  ${pct(stats.tripleComplete, n)}`));
  console.log(pad("partial triples", stats.triplePartial));
  console.log(pad("malformed (present, unusable)", stats.tripleMalformed));
  console.log(pad("missing triples", `${stats.tripleMissing}  ${pct(stats.tripleMissing, n)}`));

  console.log("");
  console.log("3. METADATA COVERAGE");
  console.log(pad("model_method present", `${stats.methodPresent}  ${pct(stats.methodPresent, n)}`));
  console.log(
    pad("model_data_quality present", `${stats.dataQualityPresent}  ${pct(stats.dataQualityPresent, n)}`)
  );
  console.log(pad("pick_1x2 present", `${stats.pickPresent}  ${pct(stats.pickPresent, n)}`));
  console.log(pad("fully complete rows", `${stats.fullyComplete}  ${pct(stats.fullyComplete, n)}`));
  console.log(pad("partially complete rows", stats.partiallyComplete));
  console.log(pad("rows with no source at all", stats.noSourceAtAll));

  console.log("");
  console.log("4. ALL-ZERO ANALYSIS");
  console.log(pad("all-zero triples", stats.allZeroTriple));
  console.log(pad("  …with insufficientData", stats.allZeroWithInsufficientData));
  console.log(pad("  …WITHOUT insufficientData", stats.allZeroWithoutInsufficientData));

  console.log("");
  console.log("5. LEGACY REPRESENTATION");
  console.log(pad("rows with evaluation triple", stats.hasEvaluationTriple));
  console.log(pad("rows with probs triple", stats.hasProbsTriple));
  console.log(pad("rows with both", stats.hasBoth));
  console.log(pad("evaluation DIFFERS from probs", stats.evaluationDiffersFromProbs));

  console.log("");
  console.log("6. PARITY (rows the dual-write already populated)");
  console.log(pad("rows already populated", stats.alreadyPopulated));
  for (const [column, count] of Object.entries(stats.mismatches)) {
    console.log(pad(`  mismatch ${column}`, count));
  }
  if (stats.mismatchSamples.length > 0) {
    console.log("  samples:");
    for (const s of stats.mismatchSamples) {
      console.log(`    fixture ${s.fixture_id} ${s.column}: stored=${s.stored} planned=${s.planned}`);
    }
  }

  console.log("");
  console.log("7. WHAT A BACKFILL WOULD DO");
  console.log(pad("rows it would update", stats.wouldUpdate));
  console.log(pad("rows that stay NULL (no source)", stats.wouldRemainNull));

  console.log("");
  console.log("DRY RUN — nothing was written, and this script cannot write.");

  if (stats.allZeroWithoutInsufficientData > 0) {
    console.log("");
    console.log(
      `WARNING: ${stats.allZeroWithoutInsufficientData} row(s) carry an all-zero triple WITHOUT ` +
        "insufficientData. Those are indistinguishable from a real 0% prediction once stored — " +
        "inspect them before applying."
    );
  }
  if (stats.evaluationDiffersFromProbs > 0) {
    console.log("");
    console.log(
      `NOTE: ${stats.evaluationDiffersFromProbs} row(s) have an evaluation triple that differs from ` +
        "probs. Precedence decides those, so the backfilled value will not always equal probs."
    );
  }
  const totalMismatches = Object.values(stats.mismatches).reduce((a, b) => a + b, 0);
  if (totalMismatches > 0) {
    console.log("");
    console.log(
      `WARNING: ${totalMismatches} mismatch(es) against rows the DUAL-WRITE already populated. ` +
        "That is a live disagreement, not a stale row — investigate before applying."
    );
  }
}

main().catch((error) => {
  console.error("[dryrun-probability-columns]", error?.message || error);
  process.exitCode = 1;
});
