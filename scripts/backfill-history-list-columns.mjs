/**
 * One-off backfill: populate the seven derived list columns added by migration
 * 055 from the `raw_payload` they already contain.
 *
 * DRY-RUN BY DEFAULT. Pass --apply to write.
 *
 *   npm run backfill:history-columns
 *   npm run backfill:history-columns -- --batch=200
 *   npm run backfill:history-columns -- --after=1234567     # resume
 *   npm run backfill:history-columns -- --max-batches=1     # one batch only
 *   npm run backfill:history-columns -- --apply
 *
 * Migration 055 must already be deployed — the script fails loudly if the
 * columns are absent rather than silently doing nothing.
 *
 * `raw_payload` is never written. Nothing reads these columns yet: this seeds
 * them, and the dual-write and read cutover are separate changes. Re-running is
 * safe — immutable columns are never replaced once populated, mutable ones only
 * ever refresh from a non-null payload, and rows whose values already match are
 * skipped rather than rewritten.
 *
 * Values that are present but fail their guard (a non-numeric odd, a fractional
 * corner total) are REPORTED in the summary and left NULL. They are never
 * coerced, and they never fail their batch.
 */

import { getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import { runBackfill } from "../server-utils/backfill/historyListColumns.js";

const DEFAULT_BATCH = 200;
const MAX_BATCH = 500;

function parseArgs(argv) {
  const args = { apply: false, batch: DEFAULT_BATCH, after: 0, maxBatches: Infinity };
  for (const raw of argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "apply") args.apply = true;
    else if (key === "batch") args.batch = Math.max(1, Math.min(Number(value) || DEFAULT_BATCH, MAX_BATCH));
    else if (key === "after") args.after = Math.max(0, Number(value) || 0);
    else if (key === "max-batches") args.maxBatches = Math.max(1, Number(value) || 1);
  }
  return args;
}

function pad(label, value) {
  return `${String(label).padEnd(26)}${value}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error("Supabase nu este configurat (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
    process.exitCode = 1;
    return;
  }

  console.log(pad("mode", args.apply ? "APPLY (writes)" : "DRY RUN (no writes)"));
  console.log(pad("batch size", args.batch));
  console.log(pad("resume after fixture_id", args.after || "(start)"));
  console.log(pad("batch limit", args.maxBatches === Infinity ? "(all)" : args.maxBatches));
  console.log("");

  let stats;
  try {
    stats = await runBackfill({
      supabase,
      batchSize: args.batch,
      apply: args.apply,
      after: args.after,
      maxBatches: args.maxBatches,
      onBatch: (s) => {
        console.log(
          `  batch ${String(s.batches).padStart(4)}  scanned=${String(s.scanned).padStart(6)}` +
            `  changed=${String(s.changed).padStart(6)}  last_fixture_id=${s.lastFixtureId}`
        );
      }
    });
  } catch (error) {
    // A missing column means 055 has not been applied to this database. Say so
    // rather than reporting a successful run that touched nothing.
    const message = error?.message || String(error);
    if (/does not exist/i.test(message)) {
      console.error(`\nMigration 055 does not appear to be deployed: ${message}`);
    } else {
      console.error(`\nBackfill failed: ${message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(pad("batches completed", stats.batches));
  console.log(pad("rows scanned", stats.scanned));
  console.log(pad("rows changed", stats.changed));
  console.log(pad("rows skipped (no change)", stats.skipped));
  console.log(pad("rows failed to write", stats.failed));
  console.log(pad("missing source values", stats.missingSource));
  console.log(pad("rejected by numeric guard", stats.numericRejected));
  console.log(pad("rejected by integer guard", stats.integerRejected));
  console.log(pad("last fixture_id", stats.lastFixtureId ?? "(none)"));
  console.log(pad("elapsed", `${stats.elapsedMs} ms`));
  console.log("");
  console.log("per-column populated:");
  for (const [column, count] of Object.entries(stats.populated)) {
    console.log(`  ${column.padEnd(26)}${count}`);
  }

  if (!args.apply) {
    console.log("");
    console.log("DRY RUN — nothing was written. Re-run with --apply to commit these changes.");
  }
  if (stats.numericRejected > 0 || stats.integerRejected > 0) {
    console.log("");
    console.log(
      `NOTE: ${stats.numericRejected + stats.integerRejected} value(s) were present but failed their guard. ` +
        "They were left NULL rather than coerced — inspect them before assuming the backfill is complete."
    );
  }
}

main().catch((error) => {
  console.error("[backfill-history-list-columns]", error?.message || error);
  process.exitCode = 1;
});
