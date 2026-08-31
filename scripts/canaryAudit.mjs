#!/usr/bin/env node
/**
 * Canary checkpoint audit — READ-ONLY measurement of the post-fix (era C) cohort.
 *
 *   node scripts/canaryAudit.mjs [--era C] [--blend 0.20] [--json] [--out FILE]
 *                                [--era-start ISO] [--limit N]
 *
 * Prints model-only vs market-only vs blend on the SAME settled fixtures, with
 * the checkpoint status the sample size earns:
 *
 *   < 100 settled   INSUFFICIENT SAMPLE — NO DECISION
 *   100-199         CANARY CHECKPOINT
 *   >= 200          FULL POST-FIX AUDIT
 *
 * It makes no recommendation. It never promotes, rolls back, tunes, writes or
 * deploys anything, and it issues only GETs.
 *
 * DISK IO: the cohort needs the RAW Poisson triple, which migration 059 did not
 * promote to a column, so the query asks for narrow JSON sub-paths rather than
 * `raw_payload`. PostgREST still detoasts the value server-side, but only the
 * slice crosses the wire. Everything else comes from promoted columns.
 *
 * PROVENANCE: every run prints the git SHA, era definition, data source,
 * timestamp, sample and exclusion counts, metric version and blend weight, so a
 * checkpoint can be reproduced weeks later.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { shinImpliedProbs } from "../server-utils/advancedMath.js";
import {
  ERA_BOUNDARIES,
  METRICS_VERSION,
  buildCohort,
  normaliseTriple,
  runCheckpoint
} from "../server-utils/validation/canaryCohort.js";

const TABLE = "predictions_history";

function parseArgs(argv) {
  const out = { era: "C", blend: 0.2, json: false, outFile: null, eraStart: null, limit: 5000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--era") out.era = String(argv[++i] || "C").toUpperCase();
    else if (a === "--blend") out.blend = Number(argv[++i]);
    else if (a === "--out") out.outFile = String(argv[++i] || "");
    else if (a === "--era-start") out.eraStart = String(argv[++i] || "");
    else if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function gitSha() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Market probabilities from decimal odds, via the production Shin de-vig. */
function marketProbsFromRow(row) {
  const h = Number(row.odds_home);
  const d = Number(row.odds_draw);
  const a = Number(row.odds_away);
  if (!(h > 1 && d > 1 && a > 1)) return null;
  const shin = shinImpliedProbs(h, d, a);
  if (!shin || !Number.isFinite(shin.p1)) return null;
  return normaliseTriple({ p1: shin.p1, pX: shin.pX, p2: shin.p2 });
}

/**
 * Promoted columns + the narrow JSON paths the cohort needs. Deliberately NOT
 * `raw_payload`: see the DISK IO note above.
 */
const SELECT = [
  "fixture_id",
  "league_id",
  "league_name",
  "kickoff_at",
  "match_status",
  "score_home",
  "score_away",
  "prob_1",
  "prob_x",
  "prob_2",
  "pick_1x2",
  "odds_home",
  "odds_draw",
  "odds_away",
  "recommended_market_valid",
  "generatedAt:raw_payload->historyMeta->>generatedAt",
  "rawPoisson:raw_payload->evaluation->rawPoissonProbs1x2Pct",
  "lambdas:raw_payload->lambdas",
  "strengthMeta:raw_payload->modelMeta->strengthMeta"
].join(",");

async function fetchRows({ url, key, limit }) {
  const rows = [];
  const pageSize = 1000; // PostgREST caps a single response; page explicitly.
  for (let offset = 0; offset < limit; offset += pageSize) {
    const to = Math.min(offset + pageSize, limit) - 1;
    const qs = new URLSearchParams({ select: SELECT, order: "saved_at.asc" });
    const res = await fetch(`${url}/rest/v1/${TABLE}?${qs}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${to}`,
        "Range-Unit": "items"
      }
    });
    if (!res.ok) throw new Error(`PostgREST ${res.status} while reading ${TABLE}`);
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < to - offset + 1) break;
  }
  // The era filter is applied in the cohort builder, on generatedAt — never on
  // updated_at and never in SQL, so every exclusion stays visible and counted.
  return rows;
}

const pct = (v) => (v == null ? "   -  " : `${(100 * v).toFixed(1)}%`);
const f4 = (v) => (v == null ? "  -   " : v.toFixed(4));

function printReport(report, provenance) {
  const L = (s = "") => console.log(s);
  L("=".repeat(78));
  L(`CANARY CHECKPOINT — ${report.status}`);
  L("=".repeat(78));
  L();
  L("PROVENANCE");
  for (const [k, v] of Object.entries(provenance)) L(`  ${k.padEnd(22)} ${v}`);
  L();
  L(`COHORT  era=${provenance.era}  clean=${report.sampleSize}  considered=${report.rowsConsidered}  excluded=${report.excludedCount}`);
  for (const [reason, n] of Object.entries(report.exclusionCounts).sort((a, b) => b[1] - a[1])) {
    L(`  excluded: ${reason.padEnd(26)} ${n}`);
  }
  L(`  rows whose RECOMMENDED slot is invalid (#215), carried not dropped: ${report.recommendationExcludedCount}`);
  L();

  if (report.sampleSize === 0) {
    L("No clean era-C rows yet. Nothing further to report.");
    return;
  }

  L("ARMS (same fixtures)");
  L("| arm         |    n | Brier  | LogLoss | Accuracy |  ECE   | P(home) | P(draw) | P(away) |");
  L("|-------------|-----:|-------:|--------:|---------:|-------:|--------:|--------:|--------:|");
  for (const [label, a] of Object.entries(report.arms)) {
    if (!a) continue;
    L(
      `| ${label.padEnd(11)} | ${String(a.n).padStart(4)} | ${f4(a.brier)} | ${f4(a.logLoss)}  | ${pct(a.accuracy).padStart(8)} | ${f4(a.ece)} | ${pct(a.meanProb.home).padStart(7)} | ${pct(a.meanProb.draw).padStart(7)} | ${pct(a.meanProb.away).padStart(7)} |`
    );
  }
  L(`  blend weight (MODEL share) = ${report.blendWeight}`);
  L();

  L("OUTCOMES vs PICKS");
  L(`  actual   home=${pct(report.outcomeRate.home)}  draw=${pct(report.outcomeRate.draw)}  away=${pct(report.outcomeRate.away)}`);
  for (const [label, a] of Object.entries(report.arms)) {
    if (!a) continue;
    L(`  ${label.padEnd(9)} picks home=${pct(a.pickRate.home)}  draw=${pct(a.pickRate.draw)}  away=${pct(a.pickRate.away)}`);
  }
  L(`  mean lambda_home=${report.lambda.home?.toFixed(3) ?? "-"}  lambda_away=${report.lambda.away?.toFixed(3) ?? "-"}`);
  L();

  L("MARKET DISAGREEMENT  |P(home)model - P(home)market|");
  L("| bucket    |    n | model Brier | market Brier | blend Brier |");
  L("|-----------|-----:|------------:|-------------:|------------:|");
  for (const b of report.disagreement) {
    const label = b.hi == null ? `${b.lo}+ pp` : `${b.lo}-${b.hi} pp`;
    L(
      `| ${label.padEnd(9)} | ${String(b.n).padStart(4)} | ${f4(b.model?.brier).padStart(11)} | ${f4(b.market?.brier).padStart(12)} | ${f4(b.blend?.brier).padStart(11)} |`
    );
  }
  L();

  L("RELIABILITY (blend) — predicted confidence vs empirical frequency");
  L("| bin        |    n | mean confidence | empirical |");
  L("|------------|-----:|----------------:|----------:|");
  for (const b of report.reliability.blend) {
    if (!b.n) continue;
    L(
      `| ${`${(100 * b.lo).toFixed(0)}-${(100 * b.hi).toFixed(0)}%`.padEnd(10)} | ${String(b.n).padStart(4)} | ${pct(b.meanConfidence).padStart(15)} | ${pct(b.empiricalFrequency).padStart(9)} |`
    );
  }
  L();
  L("This report is measurement only. It makes no promotion or rollback recommendation.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "usage: node scripts/canaryAudit.mjs [--era C] [--blend 0.20] [--json] [--out FILE] [--era-start ISO] [--limit N]"
    );
    return;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (read-only use).");
    process.exitCode = 2;
    return;
  }
  const boundaries = args.eraStart ? { ...ERA_BOUNDARIES, C_START: args.eraStart } : ERA_BOUNDARIES;

  const rows = await fetchRows({ url, key, limit: args.limit });
  const cohort = buildCohort(rows, { era: args.era, boundaries, marketProbs: marketProbsFromRow });
  const report = runCheckpoint(cohort, { blendWeight: args.blend });

  const provenance = {
    gitSha: gitSha(),
    era: args.era,
    eraDefinition: `generatedAt >= ${boundaries.C_START} (temporal) + venue-formula structural check`,
    dataSource: `${TABLE} via PostgREST (promoted columns + narrow JSON paths)`,
    generatedAt: new Date().toISOString(),
    rowsFetched: rows.length,
    sampleSize: report.sampleSize,
    exclusionCount: report.excludedCount,
    metricsVersion: METRICS_VERSION,
    blendWeight: report.blendWeight
  };

  if (args.outFile) {
    fs.writeFileSync(args.outFile, JSON.stringify({ provenance, report }, null, 2), "utf8");
    console.log(`written: ${args.outFile}`);
  }
  if (args.json) {
    console.log(JSON.stringify({ provenance, report }, null, 2));
    return;
  }
  printReport(report, provenance);
}

main().catch((err) => {
  console.error(`canaryAudit failed: ${err.message}`);
  process.exitCode = 1;
});
