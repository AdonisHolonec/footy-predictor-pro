import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLeagueProfileRecalibration } from "../../server-utils/leagueProfiles/computeLeagueProfileRecalibration.js";
import { applyBayesianShrinkage } from "../../server-utils/math.js";

const staticDefaults = {
  overFrequency: 0.52,
  bttsRate: 0.5,
  drawFrequency: 0.26,
  goalFrequency: 2.76,
  homeAdvantage: 1.07
};

function makeRows(leagueId, entries) {
  return entries.map(([home, away]) => ({ league_id: leagueId, score_home: home, score_away: away }));
}

test("computeLeagueProfileRecalibration returns null below minSamples", () => {
  const rows = makeRows(39, Array.from({ length: 59 }, () => [2, 1]));
  const out = computeLeagueProfileRecalibration(rows, staticDefaults, { minSamples: 60, shrinkageK: 80 });
  assert.equal(out, null);
});

test("computeLeagueProfileRecalibration computes exact empirical rates and matches applyBayesianShrinkage", () => {
  // 300 x (2,1): over 2.5 yes, btts yes, draw no
  // 300 x (1,0): over 2.5 no, btts no, draw no
  const rows = [...makeRows(39, Array.from({ length: 300 }, () => [2, 1])), ...makeRows(39, Array.from({ length: 300 }, () => [1, 0]))];
  const out = computeLeagueProfileRecalibration(rows, staticDefaults, { minSamples: 60, shrinkageK: 80 });
  assert.ok(out);
  assert.equal(out.leagueId, 39);
  assert.equal(out.sampleSize, 600);

  assert.equal(out.metrics.empirical.overFrequency, 0.5);
  assert.equal(out.metrics.empirical.bttsRate, 0.5);
  assert.equal(out.metrics.empirical.drawFrequency, 0);
  assert.equal(out.metrics.empirical.goalFrequency, 2);

  for (const field of ["overFrequency", "bttsRate", "drawFrequency", "goalFrequency", "homeAdvantage"]) {
    const expected = applyBayesianShrinkage(out.metrics.empirical[field], 600, staticDefaults[field], 80);
    assert.ok(Math.abs(out.values[field] - expected) < 1e-9, `${field} shrinkage mismatch`);
  }
});

test("computeLeagueProfileRecalibration shrinks a small sample noticeably toward the static prior", () => {
  // All 60 matches (right at the minSamples gate) are extreme high-scoring -> empirical overFrequency = 1.
  const rows = makeRows(140, Array.from({ length: 60 }, () => [4, 3]));
  const out = computeLeagueProfileRecalibration(rows, staticDefaults, { minSamples: 60, shrinkageK: 80 });
  assert.ok(out);
  assert.equal(out.metrics.empirical.overFrequency, 1);
  // n=60, k=80 -> shrunk should sit closer to the prior (0.52) than to the raw empirical (1).
  const distToEmpirical = Math.abs(out.values.overFrequency - 1);
  const distToPrior = Math.abs(out.values.overFrequency - staticDefaults.overFrequency);
  assert.ok(distToPrior < distToEmpirical, "small sample should shrink toward the prior");
  assert.notEqual(out.values.overFrequency, 1);
});

test("computeLeagueProfileRecalibration's homeAdvantage inversion round-trips LeagueProfile's own goal-share formula", () => {
  // homeShare = 0.5 + (homeAdv - 1) * 0.9  =>  for homeAdv=1.15, homeShare=0.635
  const rows = makeRows(78, Array.from({ length: 100 }, () => [6.35, 3.65]));
  const out = computeLeagueProfileRecalibration(rows, staticDefaults, { minSamples: 60, shrinkageK: 80 });
  assert.ok(out);
  assert.ok(Math.abs(out.metrics.empirical.homeAdvantage - 1.15) < 1e-9);
});
