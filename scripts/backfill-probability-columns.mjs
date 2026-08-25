/**
 * Backfill the promoted columns on predictions_history.
 *
 * Six 1X2 columns from migration 059 (D9b) and two valueBet columns from
 * migration 060 (D9c). The script name is historical; the column set comes from
 * PROMOTED_COLUMNS, so it follows whatever that list holds.
 *
 * DRY RUN BY DEFAULT. Writing requires an explicit --apply; without it this
 * process cannot issue a single UPDATE.
 *
 *   npm run dryrun:probability-columns                              # read only
 *   npm run backfill:probability-columns -- --max-batches=1 --apply # one page
 *   npm run backfill:probability-columns -- --apply                 # full run
 *   npm run backfill:probability-columns -- --after=<id> --apply    # resume
 *
 * Batch size defaults to 100 because that is the largest page D7 measured
 * committing on this table (limit=250 reached a 57014 statement timeout at
 * ~353 KB/row). Raise it only with evidence.
 *
 * Migrations 059 and 060 must already be applied — pre-flight probes every
 * column in PROMOTED_COLUMNS and fails loudly if any is absent, rather than
 * silently reporting zero coverage.
 *
 * Re-running after a completed backfill is safe and expected: an already-correct
 * row is compared column by column and skipped, so widening the column set
 * updates only the rows that are actually missing the new ones.
 */

import { createClient } from "@supabase/supabase-js";

import { preflight, runBackfill } from "../server-utils/backfill/probabilityColumns.js";

function parseArgs(argv) {
  const args = { batch: 100, after: 0, maxBatches: Infinity, apply: false, maxRows: 5000 };
  for (const raw of argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "batch") args.batch = Math.max(1, Math.min(Number(value) || 100, 500));
    else if (key === "after") args.after = Number(value) || 0;
    else if (key === "max-batches") args.maxBatches = Math.max(1, Number(value) || 1);
    else if (key === "apply") args.apply = true;
    else if (key === "max-rows") args.maxRows = Math.max(1, Number(value) || 5000);
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

  /*
    Preconditions run for BOTH modes. A dry run whose preconditions fail is
    reporting on a table it does not understand, which is exactly the report
    somebody would later approve an --apply against.
  */
  const pre = await preflight({ supabase, maxRows: args.maxRows });
  if (!pre.ok) {
    console.error(`PRE-FLIGHT FAILED: ${pre.reason}`);
    process.exit(1);
  }
  console.log(`pre-flight OK — population ${pre.population}, guardrail ${args.maxRows}`);

  const mode = args.apply ? "APPLY (writes enabled)" : "DRY RUN (read only)";
  console.log(`D9b-3 ${mode} — batch=${args.batch}, after=${args.after}`);

  let stats;
  try {
    stats = await runBackfill({
      supabase,
      batchSize: args.batch,
      after: args.after,
      maxBatches: args.maxBatches,
      apply: args.apply,
      onBatch: (s) =>
        console.log(
          `  …batch ${s.batches} — ${s.scanned} scanned, ${s.updated} updated, cursor ${s.lastFixtureId}`
        )
    });
  } catch (error) {
    // A failed chunk stops the run; the range and cursor make a retry safe.
    const st = error?.stats;
    console.error(`
BACKFILL FAILED: ${error.message}`);
    if (st) {
      console.error(`  scanned ${st.scanned}, updated ${st.updated}, chunks ${st.batches}`);
      console.error(`  resume with: --after=${st.lastFixtureId} --apply`);
    }
    process.exitCode = 1;
    return;
  }

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
  console.log("D9b-3 BACKFILL RESULT");
  console.log("---------------------");
  console.log(pad("scanned", stats.scanned));
  console.log(pad("candidates (would change)", stats.candidates));
  console.log(pad("updated", args.apply ? stats.updated : 0));
  console.log(pad("already correct (skipped)", stats.alreadyCorrect));
  console.log(pad("probs fallback", stats.hasProbsTriple - stats.hasBoth));
  console.log(pad("pick fallback", Math.max(0, stats.pickPresent - stats.hasEvaluationTriple)));
  console.log(pad("rows with NULL promoted fields", stats.wouldRemainNull));
  console.log(pad("values nulled out", stats.nulledOut));
  console.log(pad("malformed", stats.tripleMalformed));
  console.log(pad("failed", stats.failed));
  console.log(pad("chunks", stats.batches));
  console.log(pad("elapsed", `${stats.elapsedMs} ms`));

  console.log("");
  if (args.apply) {
    console.log(`APPLIED — ${stats.updated} row(s) written, ${stats.alreadyCorrect} left untouched.`);
    console.log("Only prob_1/prob_x/prob_2/model_method/model_data_quality/pick_1x2 were set.");
  } else {
    console.log("DRY RUN — nothing was written. Re-run with --apply to commit these changes.");
  }

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
