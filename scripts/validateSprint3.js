/**
 * Sprint 3 — prints the market validation / feature performance report
 * (Cards, Clean Sheet/BTTS, Motivation, Correct Score) over settled history.
 * Report-only: reads predictions_history, never writes predictions.
 * Mirrors the connection pattern of scripts/backtest.js / scripts/validateSprint1.js.
 */
import { createClient } from "@supabase/supabase-js";
import { buildSprint3MarketValidationReport } from "../server-utils/backtest/Sprint3MarketValidation.js";

function fmt(v, digits = 2) {
  return v == null ? "—" : Number(v).toFixed(digits);
}

function printFeature(f) {
  console.log(`\n--- ${f.market} ---`);
  console.log(`Coverage: ${f.coverage} rows (${fmt(f.coveragePct)}% of settled sample)`);
  console.log(`Sample count: ${f.sampleCount} | min required: ${f.minSampleThreshold}`);
  console.log(`Verdict: ${f.verdict} -> Recommendation: ${f.recommendation}`);
  if (f.reason) console.log(`Reason: ${f.reason}`);
  if (f.brier != null) console.log(`Brier: ${fmt(f.brier, 5)} | LogLoss: ${fmt(f.logLoss, 5)} | ECE: ${fmt(f.ece, 5)} | Accuracy: ${fmt(f.accuracyPct)}%`);
  if (f.baseline && f.enhanced) {
    console.log(
      `Baseline vs Enhanced Brier: ${fmt(f.baseline.brier, 5)} -> ${fmt(f.enhanced.brier, 5)} (delta ${fmt(f.delta?.brier, 5)})`
    );
  }
  if (f.activatedCount != null) {
    console.log(`Activated: ${f.activatedCount} | Inactive: ${f.inactiveCount}`);
    console.log(`Active accuracy: ${fmt(f.activeAccuracyPct)}% | Inactive accuracy: ${fmt(f.inactiveAccuracyPct)}%`);
    if (Array.isArray(f.byKeyword)) {
      console.log("By keyword:");
      for (const k of f.byKeyword) console.log(`  ${k.keyword}: n=${k.sampleCount} acc=${fmt(k.accuracyPct)}%`);
    }
  }
  if (f.roiSimulation) {
    console.log(
      `Top1 acc: ${fmt(f.top1AccuracyPct)}% | Top3 acc: ${fmt(f.top3AccuracyPct)}% | Avg assigned prob: ${fmt(f.avgAssignedProbabilityPct)}%`
    );
    console.log(
      `Recommended bets: ${f.roiSimulation.stakedBets} | Losses: ${f.roiSimulation.lossCount} | ROI: ${fmt(f.roiSimulation.roiPct)}%`
    );
  }
  console.log(`Improvement: ${fmt(f.improvementPct)} | Degraded cases: ${f.degradedCases}`);
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

  const report = buildSprint3MarketValidationReport(rows);

  console.log("=== Sprint 3 Market Validation Report ===");
  console.log(`Window: last ${days} days`);
  console.log(`Total settled rows: ${report.totalSamples}`);
  for (const f of report.features) printFeature(f);
}

run().catch((err) => {
  console.error("Sprint 3 validation crashed:", err?.message || err);
  process.exit(1);
});
