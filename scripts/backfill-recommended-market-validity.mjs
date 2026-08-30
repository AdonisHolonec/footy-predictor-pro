#!/usr/bin/env node
/**
 * CLI for the migration-066 analytics-eligibility backfill.
 *
 * DRY RUN IS THE DEFAULT. Writing requires `--apply` explicitly, because the
 * numbers the dry run prints are what decide whether applying is safe at all.
 *
 *   node --env-file=.env.local scripts/backfill-recommended-market-validity.mjs
 *   node --env-file=.env.local scripts/backfill-recommended-market-validity.mjs --apply
 *   node --env-file=.env.local scripts/backfill-recommended-market-validity.mjs --apply --after 1552148
 *
 * The walk is keyset by fixture_id, so `--after <id>` resumes an interrupted run
 * from the last id it reported. Re-running without `--after` is safe and is the
 * idempotence check: a completed backfill reports `changed: 0` on the next pass.
 *
 * It writes ONLY recommended_market_valid / recommended_market_invalid_reason.
 * Settlement (`validation`), card_market_validations and raw_payload are never
 * written and never modified.
 *
 * RUN IT WHEN PREDICT IS IDLE. Migration 001's BEFORE UPDATE trigger bumps
 * `updated_at` on every row an update touches, and upsertPredictionsHistory
 * skips a Predict write whose `updated_at` is older than the stored one — so a
 * backfill overlapping a Predict batch can cause that batch's rows to be dropped
 * as stale. Between cron windows, never during one.
 */

import { getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import { runBackfill } from "../server-utils/backfill/recommendedMarketValidity.js";

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function option(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const apply = flag("apply");
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error("Supabase admin client unavailable — check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    process.exitCode = 1;
    return;
  }

  const startAfterFixtureId = option("after");
  const pageSize = Number(option("page-size", "100")) || 100;
  console.log(
    `[066 backfill] mode=${apply ? "APPLY" : "DRY RUN"} pageSize=${pageSize}` +
      (startAfterFixtureId ? ` after=${startAfterFixtureId}` : "")
  );

  const stats = await runBackfill({ supabase, apply, pageSize, startAfterFixtureId });

  console.log(`scanned            ${stats.scanned} (${stats.pages} pages)`);
  console.log(`would be valid     ${stats.plannedValid}`);
  console.log(`would be invalid   ${stats.plannedInvalid} ${JSON.stringify(stats.byReason)}`);
  console.log(`unclassifiable     ${stats.unclassifiable} (no recommended_family — counted as valid)`);
  console.log(`differs from db    ${stats.changed}`);
  console.log(`already correct    ${stats.unchanged}`);
  console.log(`rows written       ${stats.applied}${apply ? "" : " (dry run — nothing written)"}`);
  console.log(`last fixture_id    ${stats.lastFixtureId}`);
  if (stats.changedFixtureIds.length) {
    console.log(`changed fixture ids: ${stats.changedFixtureIds.join(",")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
