/**
 * Seed `predictions_history.hydration_payload` for rows written before A2.
 *
 * DRY-RUN BY DEFAULT. Pass --apply to write.
 *
 * Every row carries the whole ~245 KB document, because the value is derived by
 * the SAME buildHydrationPayload() the live writer uses and that function needs
 * the document. Measured on this table, 100 rows of raw_payload is ~31 MB and
 * 2.2 s while 250 rows times out — hence --batch=50 by default.
 *
 *   npm run backfill:hydration-payload                              # dry run
 *   npm run backfill:hydration-payload -- --max-batches=1           # one page
 *   npm run backfill:hydration-payload -- --apply
 *   npm run backfill:hydration-payload -- --after=<lastFixtureId> --apply
 *
 * Safe to stop halfway. Rows already written stay valid; rows still NULL stay
 * eligible, so a restart (with or without --after) simply continues. Every
 * UPDATE carries `hydration_payload IS NULL`, so a row the live writer populated
 * in the meantime is counted as skippedNonNull rather than overwritten.
 *
 * Nothing reads this column yet — the read cutover is a separate change — so a
 * partial run cannot affect production behaviour.
 */

import { getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import {
  runBackfill,
  BackfillAbort,
  DEFAULT_BATCH,
  MAX_BATCH
} from "../server-utils/backfill/hydrationPayload.js";

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
  return `${String(label).padEnd(28)}${value}`;
}

/** Ids only — a payload fragment must never reach a log. */
function idList(ids, cap = 25) {
  if (!ids.length) return "(none)";
  const head = ids.slice(0, cap).join(", ");
  return ids.length > cap ? `${head}, … (+${ids.length - cap} more)` : head;
}

function summarise(stats, apply) {
  console.log("");
  console.log(pad("batches completed", stats.batches));
  console.log(pad("rows scanned", stats.scanned));
  console.log(pad("rows eligible", stats.eligible));
  console.log(pad(apply ? "rows updated" : "rows that WOULD update", stats.updated));
  console.log(pad("skipped (empty payload)", stats.skippedEmpty));
  console.log(pad("skipped (already populated)", stats.skippedNonNull));
  console.log(pad("failed", stats.failed));
  console.log(pad("last fixture_id", stats.lastFixtureId ?? "(none)"));
  console.log(pad("elapsed", `${stats.elapsedMs} ms`));
  console.log(pad("rows/sec", stats.rowsPerSec));
  if (stats.batchDurationMs.length) {
    const slowest = Math.max(...stats.batchDurationMs);
    console.log(pad("slowest batch", `${slowest} ms`));
  }
  console.log(pad("remaining NULL", stats.remainingNull ?? "(not counted)"));
  if (stats.skippedEmpty > 0) {
    console.log("");
    console.log(`skippedEmpty fixture_ids: ${idList(stats.skippedEmptyIds)}`);
    console.log(
      "These rows have no derivable hydration fields. They are left NULL rather than " +
        "written as NULL, so the read cutover must still handle a NULL column."
    );
  }
  if (stats.failed > 0) {
    console.log("");
    console.log(`failed fixture_ids: ${idList(stats.failedIds)}`);
  }
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
            `  updated=${String(s.updated).padStart(6)}  ${String(s.batchMs).padStart(6)}ms` +
            `  last_fixture_id=${s.lastFixtureId}`
        );
      }
    });
  } catch (error) {
    if (error instanceof BackfillAbort) {
      // A stop is not a data-integrity failure: written rows stay valid and the
      // rest stay eligible. Print the cursor so the operator can resume.
      console.error(`\nABORTED (${error.reason}): ${error.message}`);
      if (error.stats) summarise(error.stats, args.apply);
      console.error(
        `\nResume with: npm run backfill:hydration-payload -- --after=${error.lastFixtureId ?? 0}` +
          `${args.apply ? " --apply" : ""}`
      );
      process.exitCode = 1;
      return;
    }
    const message = error?.message || String(error);
    if (/does not exist/i.test(message)) {
      console.error(`\nMigration 067 does not appear to be deployed: ${message}`);
    } else {
      console.error(`\nBackfill failed: ${message}`);
    }
    process.exitCode = 1;
    return;
  }

  summarise(stats, args.apply);

  if (!args.apply) {
    console.log("");
    console.log("DRY RUN — nothing was written. Re-run with --apply to commit these changes.");
  }
}

main().catch((error) => {
  console.error("[backfill-hydration-payload]", error?.message || error);
  process.exitCode = 1;
});
