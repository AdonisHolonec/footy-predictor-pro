import assert from "node:assert/strict";
import { test } from "node:test";
import { extractBenchmarkEvents } from "../../server-utils/backtest/benchmarkEvents.js";
import { computeAgreementRate, computeHeadToHead, computeOurPerformance } from "../../server-utils/backtest/benchmarkMetrics.js";

function row(overrides = {}) {
  return {
    fixture_id: 1,
    league_id: 39,
    kickoff_at: "2026-07-01T12:00:00Z",
    our_pick: "1",
    our_family: "1x2",
    our_confidence: 70,
    our_odd: 1.9,
    consensus: { familyComparable: true, apiPick: { inferredPick: "1", confidencePct: 55 } },
    agree: true,
    confidence_delta: 15,
    our_result: "win",
    api_result: "win",
    ...overrides
  };
}

test("computeAgreementRate: counts agree/disagree and groups by market family", () => {
  const events = extractBenchmarkEvents([
    row({ fixture_id: 1, agree: true }),
    row({ fixture_id: 2, agree: false }),
    row({ fixture_id: 3, our_family: "ou", agree: true }),
    row({ fixture_id: 4, consensus: { familyComparable: false, apiPick: {} }, agree: null })
  ]);
  const result = computeAgreementRate(events);
  assert.equal(result.comparableCount, 3);
  assert.equal(result.agreeCount, 2);
  assert.equal(result.disagreeCount, 1);
  assert.equal(result.agreementRate, 66.67);
  const oneXTwo = result.byMarketFamily.find((b) => b.family === "1x2");
  assert.equal(oneXTwo.comparable, 2);
  assert.equal(oneXTwo.agree, 1);
});

test("computeHeadToHead: builds the 2x2 contingency table", () => {
  const events = extractBenchmarkEvents([
    row({ fixture_id: 1, our_result: "win", api_result: "win" }),
    row({ fixture_id: 2, our_result: "loss", api_result: "loss" }),
    row({ fixture_id: 3, our_result: "win", api_result: "loss" }),
    row({ fixture_id: 4, our_result: "loss", api_result: "win" }),
    row({ fixture_id: 5, our_result: "pending", api_result: "pending" })
  ]);
  const h2h = computeHeadToHead(events);
  assert.equal(h2h.n, 4);
  assert.equal(h2h.bothCorrect, 1);
  assert.equal(h2h.bothWrong, 1);
  assert.equal(h2h.onlyOurCorrect, 1);
  assert.equal(h2h.onlyApiCorrect, 1);
  assert.equal(h2h.ourWinRate, 50);
  assert.equal(h2h.apiWinRate, 50);
});

test("computeOurPerformance: reuses computeBacktestMetrics for Win Rate/ROI", () => {
  const events = extractBenchmarkEvents([
    row({ fixture_id: 1, our_result: "win", our_odd: 2.0 }),
    row({ fixture_id: 2, our_result: "loss", our_odd: 1.8 })
  ]);
  const perf = computeOurPerformance(events);
  assert.equal(perf.settled, 2);
  assert.equal(perf.wins, 1);
  assert.equal(perf.losses, 1);
  assert.ok(Number.isFinite(perf.roi));
});
