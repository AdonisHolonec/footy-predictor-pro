/**
 * Sprint 1.5 — prints the validation/backtesting report for Sprint 1 features
 * (Cards, Motivation, Clean Sheet/BTTS, Correct Score) over settled history.
 * Report-only: reads predictions_history, never writes predictions.
 * Mirrors the connection pattern of scripts/backtest.js.
 */
import { createClient } from "@supabase/supabase-js";
import { buildSprint1ValidationReport } from "../server-utils/backtest/Sprint1FeatureReport.js";

function fmt(v, digits = 4) {
  return v == null ? "—" : Number(v).toFixed(digits);
}

function printMarket(m) {
  console.log(`\n--- ${m.market} ---`);
  console.log(`Sample count: ${m.sampleCount}`);
  if (m.verdict === "insufficient_sample" && m.reason) {
    console.log(`Verdict: insufficient_sample`);
    console.log(`Reason: ${m.reason}`);
    return;
  }
  console.log(`Verdict: ${m.verdict}`);
  console.log(
    `Baseline  — n:${m.baseline.n} brier:${fmt(m.baseline.brier)} logLoss:${fmt(m.baseline.logLoss)} ece:${fmt(m.baseline.ece)} acc:${fmt(m.baseline.accuracyPct, 2)}%`
  );
  console.log(
    `Enhanced  — n:${m.enhanced.n} brier:${fmt(m.enhanced.brier)} logLoss:${fmt(m.enhanced.logLoss)} ece:${fmt(m.enhanced.ece)} acc:${fmt(m.enhanced.accuracyPct, 2)}%`
  );
  console.log(
    `Delta     — brier:${fmt(m.delta.brier)} logLoss:${fmt(m.delta.logLoss)} acc:${fmt(m.delta.accuracyPct, 2)}pp`
  );
  if (Array.isArray(m.perLeague) && m.perLeague.length) {
    console.log("Per league:");
    for (const l of m.perLeague) {
      console.log(
        `  [${l.leagueId}] ${l.leagueName || "?"} — n:${l.sampleCount} verdict:${l.verdict} baseline.brier:${fmt(l.baseline.brier)} enhanced.brier:${fmt(l.enhanced.brier)}`
      );
    }
  }
}

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
    .select("fixture_id, kickoff_at, league_id, league_name, score_home, score_away, raw_payload")
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

  const report = buildSprint1ValidationReport(rows);

  console.log("=== Sprint 1.5 Validation Report ===");
  console.log(`Window: last ${days} days`);
  console.log(`Total settled rows: ${report.totalSettledRows}`);
  for (const m of report.markets) printMarket(m);
}

run().catch((err) => {
  console.error("Sprint 1.5 validation crashed:", err?.message || err);
  process.exit(1);
});
