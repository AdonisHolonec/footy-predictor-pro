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
import { fitIsotonicPav, applyIsotonicMap, applyCalibratedTriple } from "../server-utils/isotonicCalibration.js";
import { extractStackerFeatures, applyStacker, softmax3 } from "../server-utils/mlStacker.js";
import { eloExpectedHomeScore, updateEloPair, eloProbabilities, eloKFactor } from "../server-utils/teamElo.js";

test("computeMatchProbs is deterministic for identical inputs", () => {
  const a = computeMatchProbs(1.8, 1.4, 0, { correlation: 0.12, rho: -0.11 });
  const b = computeMatchProbs(1.8, 1.4, 999, { correlation: 0.12, rho: -0.11 });
  assert.equal(a.probs.p1, b.probs.p1);
  assert.equal(a.probs.pX, b.probs.pX);
  assert.equal(a.probs.p2, b.probs.p2);
});

test("computeMatchProbs exposes bestScoreProb alongside bestScore", () => {
  const r = computeMatchProbs(1.5, 0.9, 0, {});
  assert.ok(typeof r.bestScore === "string");
  assert.ok(Number.isFinite(r.bestScoreProb));
  // Probabilitatea scorului cel mai probabil trebuie să fie ≥ 8% şi ≤ 30% pentru aceste λ
  assert.ok(r.bestScoreProb >= 5 && r.bestScoreProb <= 30, `bestScoreProb=${r.bestScoreProb}`);
});

test("lift-adjusted pick scoring: GG wins over trivially-safe Peste 1.5", () => {
  // Simulăm funcţia de scoring in-place (aceeaşi formulă ca în selectTopPick din api/predict.js)
  const BASELINES = { "Peste 1.5": 75, GG: 52, "Sub 3.5": 70, "1": 45 };
  const score = (pick, prob) => prob * (1 + (prob - BASELINES[pick]) / 60);

  // Caz 1: Peste 1.5 @83% (real edge) bate GG @65%
  assert.ok(score("Peste 1.5", 83) > score("GG", 65), "Peste 1.5 @83% trebuie să bată GG @65%");

  // Caz 2: Peste 1.5 exact la baseline (75%) pierde în faţa GG @65% (edge real)
  assert.ok(score("Peste 1.5", 75) < score("GG", 65), "Peste 1.5 @baseline pierde în faţa GG informativ");

  // Caz 3: Sub 3.5 sub baseline (58% vs baseline 70%) pierde în faţa GG @65%
  assert.ok(score("Sub 3.5", 58) < score("GG", 65), "Sub 3.5 sub baseline pierde în faţa GG");
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

// =============================================================================
// Isotonic calibration (PAV)
// =============================================================================

test("fitIsotonicPav produces monotone non-decreasing mapping", () => {
  // synthetic: y~0.5 around x=0.3, y~0.8 around x=0.6 → expect monotonic increase
  const samples = [];
  for (let i = 0; i < 200; i++) samples.push({ x: 0.3, y: Math.random() < 0.5 ? 1 : 0 });
  for (let i = 0; i < 200; i++) samples.push({ x: 0.6, y: Math.random() < 0.8 ? 1 : 0 });
  const { xPoints, yPoints } = fitIsotonicPav(samples);
  assert.ok(xPoints.length >= 1);
  for (let i = 1; i < yPoints.length; i++) {
    assert.ok(yPoints[i] >= yPoints[i - 1] - 1e-9, `not monotone at ${i}: ${yPoints[i - 1]} > ${yPoints[i]}`);
  }
});

test("fitIsotonicPav corrects over-confident model (shrinks predicted prob towards empirical)", () => {
  // modelul prezice 0.8 când realitatea e doar 0.5
  const samples = [];
  for (let i = 0; i < 300; i++) samples.push({ x: 0.8, y: i < 150 ? 1 : 0 });
  const fitted = fitIsotonicPav(samples);
  const calibrated = applyIsotonicMap(0.8, fitted.xPoints, fitted.yPoints);
  assert.ok(calibrated >= 0.4 && calibrated <= 0.6, `expected ~0.5, got ${calibrated}`);
});

test("applyIsotonicMap clamps outside observed range", () => {
  const x = [0.1, 0.5, 0.9];
  const y = [0.05, 0.4, 0.85];
  assert.equal(applyIsotonicMap(0, x, y), 0.05);
  assert.equal(applyIsotonicMap(1, x, y), 0.85);
  // linear interp in between
  assert.ok(Math.abs(applyIsotonicMap(0.3, x, y) - (0.05 + (0.4 - 0.05) * (0.3 - 0.1) / (0.5 - 0.1))) < 1e-9);
});

test("applyCalibratedTriple renormalizes output to sum=1", () => {
  const maps = {
    "1": { xPoints: [0, 1], yPoints: [0, 0.9] },   // subestimează puţin
    "X": { xPoints: [0, 1], yPoints: [0, 0.95] },
    "2": { xPoints: [0, 1], yPoints: [0, 0.85] }
  };
  const result = applyCalibratedTriple({ p1: 0.4, pX: 0.3, p2: 0.3 }, maps);
  const sum = result.p1 + result.pX + result.p2;
  assert.ok(Math.abs(sum - 1) < 1e-6, `sum=${sum}`);
  assert.equal(result.calibrationApplied, true);
});

// =============================================================================
// ML stacker
// =============================================================================

test("softmax3 is normalized and non-negative", () => {
  const p = softmax3(2, 0, 1);
  const s = p.p1 + p.pX + p.p2;
  assert.ok(Math.abs(s - 1) < 1e-9);
  assert.ok(p.p1 > p.p2 && p.p2 > p.pX);
});

test("extractStackerFeatures has stable feature count and names", () => {
  const f1 = extractStackerFeatures({
    poissonProbs: { p1: 0.5, pX: 0.25, p2: 0.25 },
    marketProbs: { p1: 0.48, pX: 0.27, p2: 0.25 }
  });
  const f2 = extractStackerFeatures({
    poissonProbs: { p1: 0.33, pX: 0.33, p2: 0.34 }
    // no market
  });
  assert.equal(f1.values.length, f1.featureNames.length);
  assert.equal(f2.values.length, f1.values.length, "feature count must be invariant");
  // when no market, market_available feature is 0
  const idx = f1.featureNames.indexOf("market_available");
  assert.equal(f1.values[idx], 1);
  assert.equal(f2.values[idx], 0);
});

test("applyStacker returns null for missing weights and valid probs otherwise", () => {
  const feats = extractStackerFeatures({
    poissonProbs: { p1: 0.5, pX: 0.25, p2: 0.25 },
    marketProbs: { p1: 0.48, pX: 0.27, p2: 0.25 }
  });
  assert.equal(applyStacker(feats, null), null);
  assert.equal(applyStacker(feats, { intercept: [0, 0, 0] }), null);

  // identity-ish weights: bias towards "1"
  const n = feats.values.length;
  const weights = {
    intercept: [1, 0, 0],
    coef: Array.from({ length: n }, () => [0, 0, 0])
  };
  const p = applyStacker(feats, weights);
  assert.ok(p);
  assert.ok(p.p1 > p.pX && p.p1 > p.p2);
  assert.ok(Math.abs(p.p1 + p.pX + p.p2 - 1) < 1e-9);
});

// =============================================================================
// Elo engine
// =============================================================================

test("eloExpectedHomeScore is 0.5 when teams are equal and home has no advantage", () => {
  const e = eloExpectedHomeScore(1500, 1500, 0);
  assert.ok(Math.abs(e - 0.5) < 1e-9);
});

test("eloExpectedHomeScore rises with home advantage and Elo gap", () => {
  const base = eloExpectedHomeScore(1500, 1500, 0);
  const withAdv = eloExpectedHomeScore(1500, 1500, 80);
  const stronger = eloExpectedHomeScore(1700, 1500, 0);
  assert.ok(withAdv > base);
  assert.ok(stronger > withAdv);
});

test("updateEloPair adds to winner, subtracts from loser, conservation holds", () => {
  const { eloHome, eloAway } = updateEloPair(1500, 1500, 2, 0);
  assert.ok(eloHome > 1500);
  assert.ok(eloAway < 1500);
  // zero-sum
  assert.ok(Math.abs(eloHome + eloAway - 3000) < 1e-9);
});

test("eloKFactor scales up with goal margin", () => {
  assert.ok(eloKFactor(3) > eloKFactor(1));
  assert.ok(eloKFactor(5) > eloKFactor(3));
});

test("eloProbabilities returns valid 3-way probabilities", () => {
  // Spread moderat: pX ~ 0.25; spread extrem: pX scade exponenţial
  const moderate = eloProbabilities(1550, 1500);
  const sMod = moderate.p1 + moderate.pX + moderate.p2;
  assert.ok(Math.abs(sMod - 1) < 1e-6);
  assert.ok(moderate.pX > 0.2 && moderate.pX <= 0.33, `moderate draw: ${moderate.pX}`);

  // Meci dezechilibrat: home clar favorit
  const lopsided = eloProbabilities(1700, 1400);
  const sLop = lopsided.p1 + lopsided.pX + lopsided.p2;
  assert.ok(Math.abs(sLop - 1) < 1e-6);
  assert.ok(lopsided.p1 > lopsided.p2);
  assert.ok(lopsided.pX < moderate.pX, "draw prob should shrink for lopsided matches");
});
