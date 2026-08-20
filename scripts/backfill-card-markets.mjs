/**
 * One-off historical repair: materialise card markets on the rows that predate
 * the creation-time attachCardMarketsToPayload path.
 *
 * DRY-RUN BY DEFAULT. Pass --apply to write.
 *
 *   npm run backfill:card-markets
 *   npm run backfill:card-markets -- --batch=50
 *   npm run backfill:card-markets -- --after=1490376     # resume
 *   npm run backfill:card-markets -- --max-batches=1     # one batch only
 *   npm run backfill:card-markets -- --apply
 *
 * This is the ONLY backfill in the programme that writes `raw_payload`, and it
 * writes the complete enriched document — never a partial object. The two
 * promoted columns are read back out of that same document in the same
 * statement, so they cannot describe a payload that was not persisted.
 *
 * Eligibility is `card_markets IS NULL AND card_market_validations IS NULL`,
 * enforced in the page query, again per row, and once more in the UPDATE
 * WHERE clause — so a settlement or creation write that lands mid-walk wins
 * and this job silently steps aside rather than clobbering it.
 *
 * Migration 055 must already be deployed. Rows are never inserted, upserted or
 * deleted: the only statement is UPDATE ... WHERE fixture_id = ?.
 */

import { getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import { runMaterialisation } from "../server-utils/backfill/cardMarketMaterialisation.js";

const DEFAULT_BATCH = 50;
const MAX_BATCH = 200;

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

async function main() {
  const args = parseArgs(process.argv);
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error("Supabase nu este configurat (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
    process.exitCode = 1;
    return;
  }

  console.log(pad("mode", args.apply ? "APPLY (writes raw_payload)" : "DRY RUN (no writes)"));
  console.log(pad("batch size", args.batch));
  console.log(pad("resume after fixture_id", args.after || "(start)"));
  console.log(pad("batch limit", args.maxBatches === Infinity ? "(all)" : args.maxBatches));
  console.log("");

  let stats;
  try {
    stats = await runMaterialisation({
      supabase,
      batchSize: args.batch,
      apply: args.apply,
      after: args.after,
      maxBatches: args.maxBatches,
      onBatch: (s) => {
        console.log(
          `  batch ${String(s.batches).padStart(4)}  scanned=${String(s.scanned).padStart(5)}` +
            `  changed=${String(s.changed).padStart(5)}  last_fixture_id=${s.lastFixtureId}`
        );
      }
    });
  } catch (error) {
    const message = error?.message || String(error);
    if (/does not exist/i.test(message)) {
      console.error(`\nMigration 055 does not appear to be deployed: ${message}`);
    } else {
      console.error(`\nMaterialisation failed: ${message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(pad("batches completed", stats.batches));
  console.log(pad("rows scanned", stats.scanned));
  console.log(pad("eligible", stats.eligible));
  console.log(pad("rows changed", stats.changed));
  console.log(pad("already materialised", stats.alreadyMaterialised));
  console.log(pad("source missing", stats.sourceMissing));
  console.log(pad("derivation failures", stats.derivationFailed));
  console.log(pad("write failures", stats.writeFailed));
  console.log(pad("last fixture_id", stats.lastFixtureId ?? "(none)"));
  console.log(pad("elapsed", `${stats.elapsedMs} ms`));
  console.log("");
  console.log("card-market picks materialised:");
  for (const [market, count] of Object.entries(stats.picks)) {
    console.log(`  ${market.padEnd(16)}${count}`);
  }
  console.log("");
  console.log("validation outcomes written:");
  for (const [outcome, count] of Object.entries(stats.outcomes)) {
    if (count > 0) console.log(`  ${outcome.padEnd(16)}${count}`);
  }

  if (stats.failures.length > 0) {
    console.log("");
    console.log(`failures (${stats.failures.length}), by fixture:`);
    for (const failure of stats.failures.slice(0, 25)) {
      console.log(`  ${String(failure.fixtureId).padEnd(12)}${failure.stage.padEnd(8)}${failure.reason}`);
    }
    if (stats.failures.length > 25) console.log(`  ... and ${stats.failures.length - 25} more`);
  }

  if (!args.apply) {
    console.log("");
    console.log("DRY RUN — nothing was written. Re-run with --apply to commit these changes.");
  }
  if (stats.derivationFailed > 0 || stats.writeFailed > 0 || stats.sourceMissing > 0) {
    console.log("");
    console.log(
      "NOTE: some rows did not materialise. They were reported by fixture_id above and left " +
        "untouched — inspect them before assuming the repair is complete."
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[backfill-card-markets]", error?.message || error);
  process.exitCode = 1;
});
