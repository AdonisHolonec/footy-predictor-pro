/**
 * Sprint 4.5 — prints the "Feature Validation Status" report (Clean Sheet applied-vs-
 * skipped fix, Correct Score engine/odds diagnostic, Motivation observability,
 * Cards blocked-status confirmation) over settled history.
 * Report-only: reads predictions_history, never writes predictions.
 * Mirrors the connection pattern of scripts/backtest.js / scripts/validateSprint1.js.
 */
import { createClient } from "@supabase/supabase-js";
import { buildSprint4ValidationStatus, printSprint4ValidationStatus } from "../server-utils/backtest/Sprint4ValidationStatus.js";

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const days = Math.max(7, Math.min(Number(process.env.VALIDATE_DAYS || 90), 400));

  if (!url || !key) {
    console.error("Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("predictions_history")
    .select("fixture_id, kickoff_at, saved_at, league_id, league_name, score_home, score_away, raw_payload")
    .gte("kickoff_at", cutoff)
    .not("score_home", "is", null)
    .not("score_away", "is", null)
    .order("kickoff_at", { ascending: true })
    .limit(5000);

  if (error) {
    console.error("Supabase query failed:", error.message);
    process.exit(1);
  }

  const rows = data || [];
  if (!rows.length) {
    console.log(`No settled rows found in last ${days} days.`);
    return;
  }

  const status = buildSprint4ValidationStatus(rows);
  console.log(`Window: last ${days} days`);
  console.log(printSprint4ValidationStatus(status));
}

run().catch((err) => {
  console.error("Sprint 4.5 validation crashed:", err?.message || err);
  process.exit(1);
});
