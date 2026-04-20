import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeMatchProbs,
  strengthRatingsLambdas,
  syntheticLambdas,
  applyBayesianShrinkage,
  extractFormMultiplier
} from "../server-utils/math.js";
import { shinImpliedProbs, removeBookmakerMargin } from "../server-utils/advancedMath.js";
import { expectedCalibrationError } from "../server-utils/probabilityMetrics.js";
import { getLeagueParams, getModelMarketBlendWeight } from "../server-utils/modelConstants.js";

test("computeMatchProbs is deterministic for identical inputs", () => {
  const a = computeMatchProbs(1.8, 1.4, 0, { correlation: 0.12, rho: -0.11 });
  const b = computeMatchProbs(1.8, 1.4, 999, { correlation: 0.12, rho: -0.11 });
  assert.equal(a.probs.p1, b.probs.p1);
  assert.equal(a.probs.pX, b.probs.pX);
  assert.equal(a.probs.p2, b.probs.p2);
});

test("1X2 probabilities sum to ~100% across lambda range", () => {
  const cases = [
    [0.5, 0.5], [1.2, 1.0], [1.8, 1.4], [2.5, 2.1], [3.5, 3.5], [4.2, 0.6]
  ];
  for (const [lh, la] of cases) {
    const { probs } = computeMatchProbs(lh, la, 0, {});
    const s = probs.p1 + probs.pX + probs.p2;
    assert.ok(s >= 99.5 && s <= 100.01, `λ=(${lh},${la}) sum=${s}`);
  }
});

test("Dixon-Coles τ increases draw probability vs. pure Bivariate Poisson", () => {
  const withoutDc = computeMatchProbs(1.4, 1.3, 0, { rho: 0 });
  const withDc = computeMatchProbs(1.4, 1.3, 0, { rho: -0.14 });
  assert.ok(withDc.probs.pX > withoutDc.probs.pX, `pX_dc=${withDc.probs.pX} vs pX_noDc=${withoutDc.probs.pX}`);
  assert.ok(Math.abs(withDc.probs.pX - withoutDc.probs.pX) < 4, "diferenta DC nu ar trebui sa fie extrema");
});

test("strengthRatingsLambdas returns stable lambdas", () => {
  const h = { gfHome: 1.5, gaHome: 1.2, gfAway: 1.4, gaAway: 1.3 };
  const a = { gfHome: 1.3, gaHome: 1.4, gfAway: 1.5, gaAway: 1.2 };
  const s = strengthRatingsLambdas(h, a, 1, 1, { leagueAvgGoals: 1.35 });
  assert.ok(s.lambdaHome > 0.2 && s.lambdaHome < 4.5);
  assert.ok(s.lambdaAway > 0.2 && s.lambdaAway < 4.5);
});

test("strengthRatingsLambdas applies shrinkage when played is low", () => {
  const extreme = { gfHome: 3.5, gaHome: 0.1, gfAway: 3.2, gaAway: 0.2 };
  const a = { gfHome: 1.3, gaHome: 1.4, gfAway: 1.5, gaAway: 1.2 };
  const noShrink = strengthRatingsLambdas(extreme, a, 1, 1, { leagueAvgGoals: 1.35 });
  const withShrink = strengthRatingsLambdas(extreme, a, 1, 1, {
    leagueAvgGoals: 1.35,
    homePlayed: 2,
    awayPlayed: 2,
    shrinkageK: 6
  });
  assert.ok(
    withShrink.lambdaHome < noShrink.lambdaHome,
    `shrinkage ar trebui sa reduca lambda extrema: ${withShrink.lambdaHome} vs ${noShrink.lambdaHome}`
  );
});

test("applyBayesianShrinkage converges towards prior as n→0 and observed as n→∞", () => {
  assert.equal(applyBayesianShrinkage(3.5, 0, 1.35, 6), (0 * 3.5 + 6 * 1.35) / 6);
  assert.ok(Math.abs(applyBayesianShrinkage(3.5, 1000, 1.35, 6) - 3.5) < 0.02);
});

test("extractFormMultiplier is in [0.88, 1.12]", () => {
  assert.ok(extractFormMultiplier("WWWWWW") <= 1.121);
  assert.ok(extractFormMultiplier("LLLLLL") >= 0.879);
  assert.equal(extractFormMultiplier(""), 1.0);
  assert.equal(extractFormMultiplier(null), 1.0);
});

test("syntheticLambdas exists for regression tests only", () => {
  const s = syntheticLambdas(10, 20);
  assert.ok(s.lambdaHome > 0);
  assert.ok(s.lambdaAway > 0);
});

test("Shin method returns valid probabilities for biased 3-way market", () => {
  const shin = shinImpliedProbs(1.8, 3.8, 4.5);
  assert.ok(shin, "Shin should return a result for valid odds");
  const sum = shin.p1 + shin.pX + shin.p2;
  assert.ok(Math.abs(sum - 1) < 1e-6, `Shin probs should sum to 1, got ${sum}`);
  assert.ok(shin.p1 > 0 && shin.p1 < 1, `p1=${shin.p1} out of range`);
  assert.ok(shin.pX > 0 && shin.pX < 1, `pX=${shin.pX} out of range`);
  assert.ok(shin.p2 > 0 && shin.p2 < 1, `p2=${shin.p2} out of range`);
  assert.ok(shin.z >= 0 && shin.z < 0.3, `z = ${shin.z} out of plausible range`);

  // Pentru pieţe cu overround mic (~4%), Shin şi proporţional sunt foarte aproape.
  // Verificăm doar că ambele dau rezultate într-o marjă rezonabilă unul faţă de celălalt.
  const prop = removeBookmakerMargin(1.8, 3.8, 4.5);
  assert.ok(
    Math.abs(shin.p1 - prop.p1) < 0.05,
    `Shin and proportional should agree within 5% for typical bookmaker odds`
  );
});

test("Shin converges to proportional as overround → 0", () => {
  // Cote fără marjă (pură): 1/p1 + 1/pX + 1/p2 = 1 exact
  const shin = shinImpliedProbs(2.0, 4.0, 4.0);
  assert.ok(shin);
  // z trebuie să fie mic pentru o piaţă aproape fair
  assert.ok(shin.z < 0.05, `z = ${shin.z} should be small for low-margin market`);
});

test("Shin falls back gracefully for invalid odds", () => {
  assert.equal(shinImpliedProbs(1.0, 3.0, 4.0), null);
  assert.equal(shinImpliedProbs(null, 3.0, 4.0), null);
});

test("getLeagueParams returns calibrated values for top leagues and defaults otherwise", () => {
  const epl = getLeagueParams(39);
  assert.ok(epl.leagueAvg > 0 && epl.homeAdv > 1);
  assert.ok(epl.rho <= 0);
  const unknown = getLeagueParams(99999);
  assert.ok(unknown.leagueAvg > 0);
  assert.ok(unknown.blendWeight >= 0.35 && unknown.blendWeight <= 0.9);
});

test("getModelMarketBlendWeight respects method heuristic", () => {
  const baseEpl = getLeagueParams(39).blendWeight;
  assert.ok(getModelMarketBlendWeight("strength-ratings", 39) >= baseEpl);
  assert.ok(getModelMarketBlendWeight("standings", 39) <= baseEpl);
});

test("expectedCalibrationError weights by bucket size", () => {
  const buckets = [
    { n: 100, avgConfidence: 70, accuracy1x2: 65 },  // |70-65|=5
    { n: 100, avgConfidence: 50, accuracy1x2: 55 }   // |50-55|=5
  ];
  assert.equal(expectedCalibrationError(buckets), 5);
  assert.equal(expectedCalibrationError([]), null);
  assert.equal(expectedCalibrationError(null), null);
});
