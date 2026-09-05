/**
 * Seed `predictions_history.ticket_candidates` for rows written before PR 2A.
 *
 * DRY-RUN BY DEFAULT. Pass --apply to write.
 *
 * The value is derived by the SAME buildTicketCandidates() the live writer uses.
 * Unlike the hydration backfill, the read is a SUBPATH projection rather than
 * the whole document: the helper dereferences exactly five `raw_payload` paths,
 * so those five are what the query transports. That narrows the wire; it does
 * not narrow the server-side de-TOAST, and `valueEngine.markets` — the bulk —
 * is irreducible, because the projection's rule is a filter over markets.
 *
 *   npm run dryrun:ticket-candidates                            # dry run, whole table
 *   npm run dryrun:ticket-candidates -- --max-batches=1         # one page only
 *   npm run dryrun:ticket-candidates -- --max-rows=50
 *   npm run backfill:ticket-candidates -- --apply
 *   npm run backfill:ticket-candidates -- --after=<lastFixtureId> --apply
 *
 * updated_at: predictions_history has a BEFORE UPDATE trigger that sets it on
 * ANY update. This script never writes that column, but every row it updates
 * will receive a new timestamp. `ticket_candidates IS NULL` is what bounds
 * that — a populated row is never touched, so a re-run bumps nothing.
 *
 * Safe to stop halfway. Rows already written stay valid; rows still NULL stay
 * eligible, so a restart (with or without --after) simply continues. Every
 * UPDATE carries `ticket_candidates IS NULL`, so a row the live writer populated
 * in the meantime is counted as skippedNonNull rather than overwritten.
 *
 * A partial run cannot break production: the GLOBAL loader skips NULL rows and
 * has no fallback, so an un-backfilled row is simply not yet a candidate. There
 * is no read path a half-finished backfill can make inconsistent.
 */

import { getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import {
  runBackfill,
  BackfillAbort,
  DEFAULT_BATCH,
  MAX_BATCH,
  percentile
} from "../server-utils/backfill/ticketCandidates.js";

function parseArgs(argv) {
  const args = { apply: false, batch: DEFAULT_BATCH, after: 0, maxBatches: Infinity, maxRows: Infinity };
  for (const raw of argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "apply") args.apply = true;
    else if (key === "batch") args.batch = Math.max(1, Math.min(Number(value) || DEFAULT_BATCH, MAX_BATCH));
    else if (key === "after") args.after = Math.max(0, Number(value) || 0);
    else if (key === "max-batches") args.maxBatches = Math.max(1, Number(value) || 1);
    else if (key === "max-rows") args.maxRows = Math.max(1, Number(value) || 1);
    else throw new Error(`unknown argument --${key}`);
  }
  return args;
}

const pad = (label, value) => `${String(label).padEnd(30)}${value}`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/** Ids only — a payload fragment must never reach a log. */
function idList(ids, cap = 25) {
  if (!ids.length) return "(none)";
  const head = ids.slice(0, cap).join(", ");
  return ids.length > cap ? `${head}, … (+${ids.length - cap} more)` : head;
}

async function main() {
  const args = parseArgs(process.argv);
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase admin client unavailable — check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");

  // The denominator every projection below is scaled by. Read BEFORE the walk,
  // so a partial run's estimates describe the population it actually faced.
  const { count: initialNull, error: countError } = await supabase
    .from("predictions_history")
    .select("fixture_id", { count: "exact", head: true })
    .is("ticket_candidates", null);
  if (countError) throw countError;

  /*
    The NULL population is NOT homogeneous, and scaling one average across all of
    it would lie in both directions at once. Rows whose document predates
    `valueEngine.markets` cost ~1 KB to read and can never be backfilled; rows
    that have markets cost ~86 KB and are the entire job. Counting them apart is
    one HEAD request and makes every projection below honest.
  */
  const { count: withMarkets, error: marketsCountError } = await supabase
    .from("predictions_history")
    .select("fixture_id", { count: "exact", head: true })
    .is("ticket_candidates", null)
    .not("raw_payload->valueEngine->markets", "is", null);
  if (marketsCountError) throw marketsCountError;
  const withoutMarkets = initialNull - withMarkets;

  console.log(args.apply ? "TICKET CANDIDATES BACKFILL — APPLY" : "TICKET CANDIDATES BACKFILL — DRY RUN");
  console.log(pad("initial NULL population", initialNull));
  console.log(pad("  with valueEngine.markets", `${withMarkets}  (the backfillable population)`));
  console.log(pad("  without markets", `${withoutMarkets}  (predate the field — always skipped)`));
  console.log(pad("batch size", args.batch));
  console.log(pad("resume after fixture_id", args.after || "(start)"));
  console.log(pad("max batches", args.maxBatches === Infinity ? "(all)" : args.maxBatches));
  console.log(pad("max rows", args.maxRows === Infinity ? "(all)" : args.maxRows));
  console.log("");

  const onBatch = (s) =>
    console.log(
      `LIVE BATCH batch_number=${s.batches} rows_read=${s.batchScanned} ` +
        `rows_updated=${s.updated} rows_skipped=${s.skippedNonNull + s.skippedNoSource} ` +
        `rows_failed=${s.failed + s.invalid} source_bytes=${s.batchSourceBytes} ` +
        `projected_bytes=${s.batchProjectedBytes} elapsed_ms=${s.batchMs} ` +
        `cursor=${s.lastFixtureId}`
    );

  let stats;
  try {
    stats = await runBackfill({
      supabase,
      batchSize: args.batch,
      apply: args.apply,
      after: args.after,
      maxBatches: args.maxBatches,
      maxRows: args.maxRows,
      onBatch
    });
  } catch (error) {
    if (error instanceof BackfillAbort) {
      console.error(`\nABORTED (${error.reason}): ${error.message}`);
      if (error.lastFixtureId != null) console.error(`resume with --after=${error.lastFixtureId}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const sampled = stats.payloadSizes.length;
  const avg = sampled ? Math.round(stats.projectedBytes / sampled) : 0;
  const avgSource = stats.scanned ? Math.round(stats.sourceBytes / stats.scanned) : 0;

  console.log("");
  console.log(args.apply ? "FINAL SUMMARY" : "BACKFILL DRY RUN");
  console.log(pad("initial_null_count", initialNull));
  console.log(pad("discovered (scanned)", stats.scanned));
  console.log(pad("eligible", stats.eligible));
  console.log(pad("updated_count", args.apply ? stats.updated : "0 (dry run — nothing written)"));
  console.log(pad("skipped_non_null", stats.skippedNonNull));
  console.log(pad("skipped_no_source", stats.skippedNoSource));
  console.log(pad("invalid (validation)", stats.invalid));
  console.log(pad("failed_count", stats.failed));
  console.log(pad("batches", stats.batches));
  console.log(pad("total_elapsed_ms", stats.elapsedMs));
  console.log(pad("rows/sec", stats.rowsPerSec));
  console.log(pad("final_null_count", stats.remainingNull ?? "(uncounted)"));

  console.log("");
  console.log("PROJECTED ticket_candidates BYTES (what would be WRITTEN)");
  console.log(pad("sampled rows", sampled));
  console.log(pad("total_projected_bytes", `${stats.projectedBytes} (${mb(stats.projectedBytes)})`));
  console.log(pad("avg_bytes", `${avg} (${kb(avg)})`));
  console.log(pad("min", percentile(stats.payloadSizes, 0)));
  console.log(pad("p50", percentile(stats.payloadSizes, 0.5)));
  console.log(pad("p95", sampled >= 20 ? percentile(stats.payloadSizes, 0.95) : "(too few samples)"));
  console.log(pad("max", percentile(stats.payloadSizes, 1)));

  console.log("");
  console.log("SOURCE READ BYTES (what the projection put on the WIRE)");
  console.log(pad("total_source_bytes", `${stats.sourceBytes} (${mb(stats.sourceBytes)})`));
  console.log(pad("avg_source_bytes/row", `${avgSource} (${kb(avgSource)})`));
  console.log(pad("per 25-row batch", mb(avgSource * 25)));

  // Scale by the population the SAMPLE actually represents. A sample drawn from
  // the backfillable range says nothing about the markets-less rows, so those
  // are charged at their own measured cost rather than at this average.
  const eligibleRate = stats.scanned ? stats.eligible / stats.scanned : 0;
  const CHEAP_ROW_BYTES = 1222; // measured: a document with no valueEngine.markets
  const estSource = avgSource * withMarkets + CHEAP_ROW_BYTES * withoutMarkets;

  console.log("");
  console.log("EXTRAPOLATION TO THE REMAINING WORK");
  console.log(pad("backfillable rows", withMarkets));
  console.log(pad("est. rows that will WRITE", Math.round(withMarkets * eligibleRate)));
  console.log(pad("est. source read", `${mb(estSource)}  (${withMarkets} x ${kb(avgSource)} + ${withoutMarkets} x ~1.2 KB)`));
  console.log(pad("est. written bytes", mb(avg * withMarkets * eligibleRate)));
  console.log(pad("projected batches @25", Math.ceil(initialNull / 25)));
  console.log(pad(`projected batches @${args.batch}`, Math.ceil(initialNull / args.batch)));
  console.log("  NOTE  these are CLIENT-SIDE measurements of wire payloads, extrapolated");
  console.log("        from the sampled rows. They are not Supabase billing figures, and");
  console.log("        the server still de-TOASTs the full document per row regardless.");

  if (stats.skippedNoSourceIds.length) {
    console.log("");
    console.log(`skipped — no valueEngine.markets in source (${stats.skippedNoSource}):`);
    console.log(`  ${idList(stats.skippedNoSourceIds)}`);
  }
  if (stats.invalidRows.length) {
    console.log("");
    console.log(`invalid — failed the contract check, NOT written (${stats.invalid}):`);
    for (const row of stats.invalidRows.slice(0, 25)) console.log(`  fixture_id=${row.fixtureId} ${row.reason}`);
  }
  if (stats.failedRows.length) {
    console.log("");
    console.log(`failed — write error, still NULL (${stats.failed}):`);
    for (const row of stats.failedRows.slice(0, 25)) console.log(`  fixture_id=${row.fixtureId} ${row.reason}`);
  }

  console.log("");
  if (!args.apply) {
    console.log("NO WRITE OCCURRED. This was a dry run; --apply is required to write.");
    console.log("Nothing in the database was modified.");
  } else if (stats.lastFixtureId != null) {
    console.log(`resume with --after=${stats.lastFixtureId}`);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
