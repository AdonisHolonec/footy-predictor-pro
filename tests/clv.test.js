import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClvReport, computeClvPct } from "../server-utils/backtest/ClvReport.js";

test("computeClvPct is positive when staked odd beats closing", () => {
  assert.ok(computeClvPct(2.2, 2.0) > 0);
  assert.ok(computeClvPct(1.8, 2.0) < 0);
  assert.equal(computeClvPct(1.0, 2.0), null);
  assert.equal(computeClvPct(2.0, null), null);
});

test("buildClvReport aggregates coverage and groupings", () => {
  const report = buildClvReport([
    {
      settled: true,
      clvPct: 5,
      leagueId: 39,
      market: "recommended",
      modelVersion: "v3",
      kickoffAt: "2026-07-01T12:00:00Z"
    },
    {
      settled: true,
      clvPct: -2,
      leagueId: 39,
      market: "recommended",
      modelVersion: "v3",
      kickoffAt: "2026-07-02T12:00:00Z"
    },
    {
      settled: true,
      clvPct: null,
      leagueId: 140,
      market: "recommended",
      modelVersion: "v3",
      kickoffAt: "2026-07-03T12:00:00Z"
    }
  ]);
  assert.equal(report.settled, 3);
  assert.equal(report.withClosing, 2);
  assert.ok(report.coverage > 60 && report.coverage < 70);
  assert.ok(report.avgClv != null);
  assert.ok(report.byLeague.some((r) => r.key === "39" && r.n === 2));
  assert.ok(report.byMonth.some((r) => r.key === "2026-07"));
});
