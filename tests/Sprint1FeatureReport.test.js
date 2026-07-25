import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyCleanSheetApplication,
  extractCleanSheetPair,
  evaluateCleanSheetContribution,
  evaluateUnmeasurableFeature,
  buildSprint1ValidationReport
} from "../server-utils/backtest/Sprint1FeatureReport.js";

function row({ home, away, baseline, enhanced, leagueId = 39, leagueName = "EPL", extra = {} }) {
  return {
    score_home: home,
    score_away: away,
    league_id: leagueId,
    league_name: leagueName,
    raw_payload: {
      evaluation: baseline == null ? {} : { calibratedSideMarketsPct: { pGG: baseline } },
      probs: enhanced == null ? {} : { pGG: enhanced },
      ...extra
    }
  };
}

test("extractCleanSheetPair returns null when score, baseline or enhanced is missing", () => {
  assert.equal(extractCleanSheetPair({ score_home: null, score_away: 1 }), null);
  assert.equal(extractCleanSheetPair(row({ home: 1, away: 1, baseline: null, enhanced: 60 })), null);
  assert.equal(extractCleanSheetPair(row({ home: 1, away: 1, baseline: 60, enhanced: null })), null);
});

test("extractCleanSheetPair normalizes 0-100 to fractions and reads actual BTTS from score", () => {
  const pair = extractCleanSheetPair(row({ home: 1, away: 1, baseline: 55, enhanced: 62 }));
  assert.deepEqual(pair, {
    baseline: 0.55,
    enhanced: 0.62,
    actual: 1,
    leagueId: 39,
    leagueName: "EPL",
    featureApplied: true,
    applicationSource: "inferred_from_value_diff"
  });
});

test("classifyCleanSheetApplication: no debug metadata -> inferred from whether values differ", () => {
  const differing = classifyCleanSheetApplication({}, 0.5, 0.6);
  assert.equal(differing.featureApplied, true);
  assert.equal(differing.source, "inferred_from_value_diff");

  const identical = classifyCleanSheetApplication({}, 0.5, 0.5);
  assert.equal(identical.featureApplied, false);
  assert.equal(identical.source, "inferred_from_value_diff");
});

test("classifyCleanSheetApplication: debug metadata present but blendApplied=false -> not applied even if values differ (data-entry edge case)", () => {
  const payload = { modelMeta: { debug: { cleanSheet: { blendApplied: false, empiricalBttsRate: 0.4 } } } };
  const out = classifyCleanSheetApplication(payload, 0.5, 0.6);
  assert.equal(out.featureApplied, false);
  assert.equal(out.source, "debug_metadata");
});

test("classifyCleanSheetApplication: debug metadata present, blendApplied=true, rate available, values differ -> applied", () => {
  const payload = { modelMeta: { debug: { cleanSheet: { blendApplied: true, empiricalBttsRate: 0.4 } } } };
  const out = classifyCleanSheetApplication(payload, 0.5, 0.6);
  assert.equal(out.featureApplied, true);
  assert.equal(out.source, "debug_metadata");
});

test("classifyCleanSheetApplication: debug metadata says blendApplied=true but empiricalBttsRate missing -> not applied", () => {
  const payload = { modelMeta: { debug: { cleanSheet: { blendApplied: true, empiricalBttsRate: null } } } };
  const out = classifyCleanSheetApplication(payload, 0.5, 0.6);
  assert.equal(out.featureApplied, false);
});

test("evaluateCleanSheetContribution: enhanced Brier strictly lower than baseline -> improved", () => {
  // Both teams always score (actual=1). Enhanced is closer to 1 than baseline on every row.
  const rows = Array.from({ length: 40 }, () => row({ home: 1, away: 1, baseline: 50, enhanced: 80 }));
  const report = evaluateCleanSheetContribution(rows);
  assert.equal(report.sampleCount, 40);
  assert.equal(report.baseline.n, 40);
  assert.equal(report.enhanced.n, 40);
  assert.ok(report.enhanced.brier < report.baseline.brier);
  assert.equal(report.verdict, "improved");
  assert.ok(report.delta.brier < 0);
});

test("evaluateCleanSheetContribution: enhanced Brier strictly higher than baseline -> degraded", () => {
  const rows = Array.from({ length: 40 }, () => row({ home: 1, away: 1, baseline: 80, enhanced: 50 }));
  const report = evaluateCleanSheetContribution(rows);
  assert.equal(report.verdict, "degraded");
  assert.ok(report.delta.brier > 0);
});

test("evaluateCleanSheetContribution: below minSample -> insufficient_sample regardless of delta", () => {
  const rows = Array.from({ length: 5 }, () => row({ home: 1, away: 1, baseline: 50, enhanced: 90 }));
  const report = evaluateCleanSheetContribution(rows, { minSample: 30 });
  assert.equal(report.verdict, "insufficient_sample");
});

test("evaluateCleanSheetContribution: pre-deploy rows (identical baseline/enhanced) never count toward the evaluation sample, even in bulk (Sprint 4 real-data regression)", () => {
  // Mirrors the real production shape found in Sprint 4: 43 rows where the blend never
  // ran (baseline === enhanced, pre-feature code), plus 4 rows where it genuinely fired
  // and happened to move pGG the "wrong" way. Naive aggregation over all 47 falsely
  // reported "degraded" on n=47; the fix must report insufficient_sample on the true n=4.
  const preDeployRows = Array.from({ length: 43 }, () => row({ home: 0, away: 0, baseline: 42, enhanced: 42 }));
  const postDeployRows = Array.from({ length: 4 }, () => row({ home: 0, away: 0, baseline: 45, enhanced: 53 }));
  const rows = [...preDeployRows, ...postDeployRows];

  const report = evaluateCleanSheetContribution(rows, { minSample: 30 });
  assert.equal(report.totalRowsAnalyzed, 47);
  assert.equal(report.featureAvailableCount, 47);
  assert.equal(report.featureAppliedCount, 4);
  assert.equal(report.skippedCount, 43);
  assert.equal(report.sampleCount, 4);
  assert.equal(report.baseline.n, 4);
  assert.equal(report.enhanced.n, 4);
  // The true evaluation sample (4) is below minSample -> must not claim degraded/improved.
  assert.equal(report.verdict, "insufficient_sample");
});

test("evaluateCleanSheetContribution: no eligible rows -> zero-sample report, no throw", () => {
  const report = evaluateCleanSheetContribution([]);
  assert.equal(report.sampleCount, 0);
  assert.equal(report.baseline.n, 0);
  assert.equal(report.verdict, "insufficient_sample");
  assert.deepEqual(report.perLeague, []);
});

test("evaluateCleanSheetContribution: splits per league and verdicts independently", () => {
  const eplRows = Array.from({ length: 32 }, () =>
    row({ home: 1, away: 1, baseline: 50, enhanced: 85, leagueId: 39, leagueName: "EPL" })
  );
  // Tiny but nonzero delta: featureApplied=true (blend genuinely fired), yet the Brier
  // shift stays under the noise floor -> exercises the "neutral" verdict specifically,
  // distinct from a league where the blend never ran at all (excluded from perLeague).
  const ligaRows = Array.from({ length: 32 }, () =>
    row({ home: 1, away: 1, baseline: 50, enhanced: 50.01, leagueId: 140, leagueName: "La Liga" })
  );
  const report = evaluateCleanSheetContribution([...eplRows, ...ligaRows]);
  assert.equal(report.perLeague.length, 2);
  const epl = report.perLeague.find((l) => l.leagueId === 39);
  const liga = report.perLeague.find((l) => l.leagueId === 140);
  assert.equal(epl.verdict, "improved");
  assert.equal(liga.verdict, "neutral");
});

test("evaluateUnmeasurableFeature counts presence via the provided predicate and never fabricates a verdict", () => {
  const rows = [
    { raw_payload: { probs: { cards: { total: {} } } } },
    { raw_payload: { probs: {} } },
    { raw_payload: {} }
  ];
  const out = evaluateUnmeasurableFeature("Cards Market", "flag off by default", rows, (r) => r?.raw_payload?.probs?.cards != null);
  assert.equal(out.sampleCount, 1);
  assert.equal(out.verdict, "insufficient_sample");
  assert.equal(out.reason, "flag off by default");
});

test("buildSprint1ValidationReport assembles all four Sprint 1 markets and filters unsettled rows", () => {
  const rows = [
    row({ home: 1, away: 1, baseline: 50, enhanced: 70 }),
    { score_home: null, score_away: null, raw_payload: {} }, // unsettled, must be excluded
    row({
      home: 0,
      away: 0,
      baseline: 40,
      enhanced: 40,
      extra: { valueEngine: { bestMarket: { family: "Correct Score" } } }
    })
  ];
  const report = buildSprint1ValidationReport(rows);
  assert.equal(report.totalSettledRows, 2);
  assert.equal(report.markets.length, 4);
  const names = report.markets.map((m) => m.market);
  assert.ok(names.includes("BTTS (Clean Sheet / Failed-to-Score blend)"));
  assert.ok(names.includes("Motivation Enhancement"));
  assert.ok(names.includes("Correct Score Value Engine"));
  assert.ok(names.includes("Cards Market"));

  const motivation = report.markets.find((m) => m.market === "Motivation Enhancement");
  assert.equal(motivation.sampleCount, 0);
  assert.equal(motivation.verdict, "insufficient_sample");
  assert.ok(motivation.reason.length > 0);

  const correctScore = report.markets.find((m) => m.market === "Correct Score Value Engine");
  assert.equal(correctScore.sampleCount, 1);

  const cards = report.markets.find((m) => m.market === "Cards Market");
  assert.equal(cards.sampleCount, 0);
});
