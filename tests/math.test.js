import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeMatchProbs,
  strengthRatingsLambdas,
  syntheticLambdas,
  applyBayesianShrinkage,
  extractFormMultiplier,
  extractFirstHalfFractions,
  deriveFirstHalfLambdas,
  FIRST_HALF_GOALS_BASELINE,
  poissonCDF,
  poissonOverLine,
  extractAdvancedGoalsAverages,
  computeEmpiricalBttsRate,
  blendBttsWithEmpirical
} from "../server-utils/math.js";
import {
  extractFixtureMarketStats,
  aggregateRollingForTeam,
  deriveMarketLambdas
} from "../server-utils/teamMarketRolling.js";
import { shinImpliedProbs, removeBookmakerMargin } from "../server-utils/advancedMath.js";
import { expectedCalibrationError } from "../server-utils/probabilityMetrics.js";
import {
  getLeagueParams,
  getModelMarketBlendWeight,
  getLeagueConfidenceMultiplier,
  getLeagueStakeCap,
  TOP_LEAGUE_IDS
} from "../server-utils/modelConstants.js";
import {
  fitIsotonicPav,
  applyIsotonicMap,
  applyCalibratedTriple,
  pickCalibrationMapForLeague
} from "../server-utils/isotonicCalibration.js";
import {
  fitPlatt,
  applyPlatt,
  fitTemperature,
  applyTemperature,
  fitBeta,
  applyBeta,
  curveToPoints
} from "../server-utils/calibration/methods.js";
import {
  evaluateCalibrationMethods,
  selectBestCalibration
} from "../server-utils/calibration/CalibrationSelector.js";
import {
  extractStackerFeatures,
  applyStacker,
  softmax3,
  trainSoftmax,
  computeStackerMetrics
} from "../server-utils/mlStacker.js";
import { evaluateStackerWalkForward } from "../server-utils/validation/StackerWalkForward.js";
import { timeOrderedExpandingFolds } from "../server-utils/validation/WalkForward.js";
import { eloExpectedHomeScore, updateEloPair, eloProbabilities, eloKFactor } from "../server-utils/teamElo.js";
import { buildPredictionContributions } from "../server-utils/importance/PredictionContributions.js";
import { runModelLab, reconstructSources, blendModel, getModelById, MODEL_REGISTRY } from "../server-utils/modelLab/ModelLab.js";
import { runAutoSelection } from "../server-utils/modelLab/BlendRecipeSelection.js";
import { estimateMatchXg, computeRollingXg, deriveXgLambdas, rollingXgRates } from "../server-utils/xg/RollingXgModel.js";
import {
  calculateExpectedValue,
  calculateKellyPct,
  evaluateValue,
  selectBestValue,
  buildValueEngine,
  buildProfessionalValueEngine,
  classifyMarketFamily
} from "../server-utils/value/ValueEngine.js";
import {
  buildBacktestReport,
  buildDashboardBundle,
  computeBacktestMetrics,
  computeQuantMetrics,
  extractBetEvent,
  filterBetEvents,
  parseFilters,
  seasonStartIso
} from "../server-utils/backtest/BacktestAnalytics.js";
import { buildCacheKey } from "../server-utils/fetcher.js";
import { buildPredictionLaboratory } from "../server-utils/predictionLaboratory/PredictionLaboratory.js";
import {
  computeExactMatchDistribution,
  computeExactMarketProbabilities
} from "../server-utils/monteCarlo/MonteCarloEngine.js";
import { blendLambdasWithXg, buildXgSourceProbs } from "../server-utils/pipeline/xgLambdaBlend.js";
import {
  PIPELINE_TRACE_VERSION,
  LAMBDA_TRACE_STAGE_IDS,
  buildPipelineTrace
} from "../server-utils/pipeline/pipelineTrace.js";
import { getPredictionWeights } from "../server-utils/PredictionEngine/weights.js";
import { buildMatchScorePmf } from "../server-utils/math.js";
import {
  extractSamplesFromHistory,
  computeReliabilityBuckets,
  computeEce,
  computeBrier1x2,
  fitFeatureWeightDeltas,
  applyWeightDeltas,
  mergeWithAutoOverlay,
  fitAutoCalibrationOverlays,
  buildCalibrationReport,
  runAutoCalibration
} from "../server-utils/calibration/AutoCalibrationEngine.js";
import { extractRawTriple } from "../server-utils/ml/extractRawTriple.js";
import { setRuntimeOverlays, clearRuntimeOverlays } from "../server-utils/calibration/overlayRuntime.js";
import { getConfidenceWeights } from "../server-utils/confidence/confidenceWeights.js";

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
  assert.ok(epl.goalFrequency > 2 && epl.bttsRate > 0 && epl.overFrequency > 0);
  assert.ok(epl.corners > 0 && epl.cards > 0);
  assert.equal(epl.profileKey, "premier_league");
  const bundes = getLeagueParams(78);
  assert.ok(bundes.goalFrequency > epl.goalFrequency, "Bundesliga should score more than EPL profile");
  const unknown = getLeagueParams(99999);
  assert.ok(unknown.leagueAvg > 0);
  assert.ok(unknown.blendWeight >= 0.35 && unknown.blendWeight <= 0.9);
  assert.equal(unknown.profileKey, "default");
});

test("getModelMarketBlendWeight respects method heuristic", () => {
  const baseEpl = getLeagueParams(39).blendWeight;
  assert.ok(getModelMarketBlendWeight("strength-ratings", 39) >= baseEpl);
  assert.ok(getModelMarketBlendWeight("standings", 39) <= baseEpl);
});

test("TOP_LEAGUE_IDS conţine ligile din League Profiles (inclusiv UEFA + MLS)", () => {
  assert.ok(TOP_LEAGUE_IDS.length >= 11);
  const expected = [39, 140, 135, 78, 61, 2, 3, 848, 88, 283, 253];
  for (const id of expected) {
    assert.ok(TOP_LEAGUE_IDS.includes(id), `Lipseşte liga ${id}`);
  }
  assert.ok(TOP_LEAGUE_IDS.includes(2), "UCL lipseşte");
  assert.ok(TOP_LEAGUE_IDS.includes(3), "UEL lipseşte");
  assert.ok(TOP_LEAGUE_IDS.includes(848), "UECL lipseşte");
  assert.ok(TOP_LEAGUE_IDS.includes(253), "MLS lipseşte");
});

// =============================================================================
// Prima repriză (first-half predictions)
// =============================================================================

test("computeMatchProbs exposes pO05 (at least one goal total)", () => {
  const r = computeMatchProbs(1.5, 0.9, 0, {});
  assert.ok(r.probs.pO05 > 0 && r.probs.pO05 <= 100);
  // pO05 trebuie să fie > pO15 (peste 0.5 ⊇ peste 1.5)
  assert.ok(r.probs.pO05 > r.probs.pO15, `pO05=${r.probs.pO05} trebuie > pO15=${r.probs.pO15}`);
  // pO05 > pGG (pentru 0 < λ mic, ambele marchează e eveniment mai rar)
  assert.ok(r.probs.pO05 >= r.probs.pGG);
});

test("extractFirstHalfFractions extracts ~0.5 ratio from balanced minute buckets", () => {
  const payload = {
    response: {
      goals: {
        for: {
          minute: {
            "0-15": { total: 2 },
            "16-30": { total: 3 },
            "31-45": { total: 3 },
            "46-60": { total: 3 },
            "61-75": { total: 3 },
            "76-90": { total: 2 }
          }
        },
        against: {
          minute: {
            "0-15": { total: 1 },
            "16-30": { total: 2 },
            "31-45": { total: 2 },
            "46-60": { total: 2 },
            "61-75": { total: 3 },
            "76-90": { total: 2 }
          }
        }
      }
    }
  };
  const result = extractFirstHalfFractions(payload);
  assert.ok(result, "ar trebui să producă fracţii");
  // for: 8/16 = 0.5
  assert.ok(Math.abs(result.fhFractionFor - 0.5) < 1e-9, `fhFractionFor=${result.fhFractionFor}`);
  // against: 5/12 ≈ 0.4167
  assert.ok(Math.abs(result.fhFractionAgainst - 5 / 12) < 1e-9, `fhFractionAgainst=${result.fhFractionAgainst}`);
});

test("extractFirstHalfFractions returns null when minute buckets missing", () => {
  assert.equal(extractFirstHalfFractions({ response: { goals: { for: {}, against: {} } } }), null);
  assert.equal(extractFirstHalfFractions(null), null);
  assert.equal(extractFirstHalfFractions({}), null);
});

test("extractFirstHalfFractions handles extra-time buckets without crashing", () => {
  const payload = {
    response: {
      goals: {
        for: {
          minute: {
            "0-15": { total: 3 },
            "46-60": { total: 2 },
            "91-105": { total: 1 },
            "106-120": { total: 0 }
          }
        }
      }
    }
  };
  const r = extractFirstHalfFractions(payload);
  assert.ok(r);
  // FH=3, SH=2+1+0=3 → fraction = 3/6 = 0.5
  assert.ok(Math.abs(r.fhFractionFor - 0.5) < 1e-9);
});

test("deriveFirstHalfLambdas scales lambdas below full-match values", () => {
  const fhFractionsHome = { fhFractionFor: 0.5, fhFractionAgainst: 0.42 };
  const fhFractionsAway = { fhFractionFor: 0.45, fhFractionAgainst: 0.48 };
  const result = deriveFirstHalfLambdas({
    lambdaHomeFull: 1.8,
    lambdaAwayFull: 1.2,
    fhFractionsHome,
    fhFractionsAway
  });
  assert.ok(result.lambdaHomeFH > 0 && result.lambdaHomeFH < 1.8, `λ_H_FH=${result.lambdaHomeFH}`);
  assert.ok(result.lambdaAwayFH > 0 && result.lambdaAwayFH < 1.2, `λ_A_FH=${result.lambdaAwayFH}`);
  // scale_home = (0.5 + 0.48) / 2 = 0.49 → 1.8 * 0.49 = 0.882
  assert.ok(Math.abs(result.lambdaHomeFH - 1.8 * 0.49) < 1e-9);
});

test("deriveFirstHalfLambdas falls back to baseline when fractions are null", () => {
  const result = deriveFirstHalfLambdas({
    lambdaHomeFull: 2.0,
    lambdaAwayFull: 1.0,
    fhFractionsHome: null,
    fhFractionsAway: null
  });
  assert.ok(Math.abs(result.lambdaHomeFH - 2.0 * FIRST_HALF_GOALS_BASELINE) < 1e-9);
  assert.ok(Math.abs(result.lambdaAwayFH - 1.0 * FIRST_HALF_GOALS_BASELINE) < 1e-9);
  assert.equal(result.meta.baselineUsed, true);
});

test("FH probs: pO05 FH < pO05 full match pentru acelaşi meci", () => {
  const full = computeMatchProbs(1.5, 1.2, 0, {});
  const fhLam = deriveFirstHalfLambdas({
    lambdaHomeFull: 1.5,
    lambdaAwayFull: 1.2,
    fhFractionsHome: { fhFractionFor: 0.46, fhFractionAgainst: 0.46 },
    fhFractionsAway: { fhFractionFor: 0.46, fhFractionAgainst: 0.46 }
  });
  const fh = computeMatchProbs(fhLam.lambdaHomeFH, fhLam.lambdaAwayFH, 0, {});
  // FH are λ mai mici → probabilitate mai mică pentru cel puţin un gol
  assert.ok(fh.probs.pO05 < full.probs.pO05, `FH pO05=${fh.probs.pO05} vs full pO05=${full.probs.pO05}`);
  // pX la pauză > pX la final (egalurile low-score sunt mai frecvente în FH)
  assert.ok(fh.probs.pX > full.probs.pX, `FH pX=${fh.probs.pX} vs full pX=${full.probs.pX}`);
});

// =============================================================================
// Poisson CDF + Over/Under lines (cornere / şuturi)
// =============================================================================

test("poissonCDF sums Poisson probabilities monotone non-decreasing", () => {
  const lam = 3.5;
  let prev = -1;
  for (let n = 0; n <= 10; n++) {
    const c = poissonCDF(n, lam);
    assert.ok(c >= prev, `CDF nu e monoton la n=${n}`);
    assert.ok(c <= 1 + 1e-9);
    prev = c;
  }
  // P(X ≤ ∞) trebuie să se apropie de 1
  assert.ok(poissonCDF(40, lam) > 0.999);
});

test("poissonOverLine aproape Over 9.5 cornere pentru λ=10 e ~50%", () => {
  // Pentru λ=10, Poisson e ~simetric ≈ median 10, Over 9.5 ≈ P(X ≥ 10) ≈ 0.54
  const p = poissonOverLine(9.5, 10);
  assert.ok(p > 0.50 && p < 0.60, `poissonOverLine(9.5, 10) = ${p}`);
  // Over 15.5 pentru λ=10 trebuie să fie rar (< 5%)
  assert.ok(poissonOverLine(15.5, 10) < 0.06);
  // Over 5.5 pentru λ=10 trebuie să fie foarte probabil (> 90%)
  assert.ok(poissonOverLine(5.5, 10) > 0.90);
});

test("poissonOverLine cu λ=0 întoarce 0", () => {
  assert.equal(poissonOverLine(0.5, 0), 0);
});

// =============================================================================
// teamMarketRolling — extract + aggregate + derive λ
// =============================================================================

test("extractFixtureMarketStats citeşte corner + SoT + shots din payload /fixtures/statistics", () => {
  const payload = {
    response: [
      {
        team: { id: 42 },
        statistics: [
          { type: "Shots on Goal", value: 5 },
          { type: "Total Shots", value: 14 },
          { type: "Corner Kicks", value: 6 }
        ]
      },
      {
        team: { id: 99 },
        statistics: [
          { type: "Shots on Goal", value: 3 },
          { type: "Total Shots", value: 10 },
          { type: "Corner Kicks", value: 4 }
        ]
      }
    ]
  };
  const out = extractFixtureMarketStats(payload);
  assert.equal(out.length, 2);
  // Core market fields (extra xG signal fields default to null when absent).
  assert.equal(out[0].teamId, 42);
  assert.equal(out[0].corners, 6);
  assert.equal(out[0].sot, 5);
  assert.equal(out[0].shotsTotal, 14);
  assert.equal(out[1].teamId, 99);
  assert.equal(out[1].corners, 4);
  assert.equal(out[1].sot, 3);
  assert.equal(out[1].shotsTotal, 10);
  // New signal keys exist on the shape.
  assert.ok("shotsInsideBox" in out[0] && "possession" in out[0] && "xg" in out[0]);
});

test("extractFixtureMarketStats citeşte Yellow Cards + Red Cards din payload /fixtures/statistics", () => {
  const payload = {
    response: [
      {
        team: { id: 42 },
        statistics: [
          { type: "Yellow Cards", value: 3 },
          { type: "Red Cards", value: 1 }
        ]
      },
      {
        team: { id: 99 },
        statistics: [
          { type: "Yellow Cards", value: 2 },
          { type: "Red Cards", value: 0 }
        ]
      }
    ]
  };
  const out = extractFixtureMarketStats(payload);
  assert.equal(out[0].yellowCards, 3);
  assert.equal(out[0].redCards, 1);
  assert.equal(out[1].yellowCards, 2);
  assert.equal(out[1].redCards, 0);
});

test("extractFixtureMarketStats întoarce array gol pentru payload invalid", () => {
  assert.deepEqual(extractFixtureMarketStats(null), []);
  assert.deepEqual(extractFixtureMarketStats({}), []);
  assert.deepEqual(extractFixtureMarketStats({ response: [] }), []);
});

test("extractFixtureMarketStats parsează value string cu procent", () => {
  const payload = {
    response: [
      {
        team: { id: 1 },
        statistics: [
          { type: "Ball Possession", value: "45%" },
          { type: "Corner Kicks", value: 7 }
        ]
      }
    ]
  };
  const out = extractFixtureMarketStats(payload);
  assert.equal(out[0].corners, 7);
});

test("aggregateRollingForTeam produce medii corecte pe cornere şi SoT", () => {
  const matches = [
    { fixtureId: 1, date: "2024-01-01T15:00:00Z", isHome: true,
      teamStats: { corners: 6, sot: 5, shotsTotal: 14 },
      opponentStats: { corners: 4, sot: 3, shotsTotal: 10 } },
    { fixtureId: 2, date: "2024-01-08T15:00:00Z", isHome: false,
      teamStats: { corners: 4, sot: 3, shotsTotal: 11 },
      opponentStats: { corners: 7, sot: 4, shotsTotal: 13 } },
    { fixtureId: 3, date: "2024-01-15T15:00:00Z", isHome: true,
      teamStats: { corners: 8, sot: 4, shotsTotal: 17 },
      opponentStats: { corners: 3, sot: 2, shotsTotal: 8 } }
  ];
  const agg = aggregateRollingForTeam(matches);
  assert.equal(agg.matches_sampled, 3);
  // agregările sunt rotunjite la 3 zecimale → tolerance 0.005
  const approxEq = (a, b) => Math.abs(a - b) < 0.005;
  assert.ok(approxEq(agg.corners_for_avg, (6 + 4 + 8) / 3), `for=${agg.corners_for_avg}`);
  assert.ok(approxEq(agg.corners_against_avg, (4 + 7 + 3) / 3), `against=${agg.corners_against_avg}`);
  assert.ok(approxEq(agg.corners_for_home_avg, (6 + 8) / 2), `home=${agg.corners_for_home_avg}`);
  assert.ok(approxEq(agg.corners_for_away_avg, 4), `away=${agg.corners_for_away_avg}`);
  assert.ok(approxEq(agg.sot_for_avg, (5 + 3 + 4) / 3), `sot=${agg.sot_for_avg}`);
  assert.equal(agg.last_fixture_id, 3);
});

test("aggregateRollingForTeam separă cartonaşe brute (cards_*) de puncte ponderate (cards_points_*)", () => {
  // Acelaşi set de date, ambele unităţi. cards_*_avg este numărul BRUT de cartonaşe
  // (cardsTotal), cards_points_*_avg păstrează convenţia ponderată roşu×2 + galben —
  // aserţiunile pe puncte de mai jos sunt exact cele dinaintea separării unităţilor.
  const matches = [
    // team: 2 galbene + 1 roşu = 3 cartonaşe / 4 puncte. opponent: 1 galben = 1 / 1.
    { fixtureId: 1, date: "2024-01-01T15:00:00Z", isHome: true,
      teamStats: { yellowCards: 2, redCards: 1 },
      opponentStats: { yellowCards: 1, redCards: 0 } },
    // team: 3 galbene = 3 cartonaşe / 3 puncte. opponent: 2 galbene + 1 roşu = 3 / 4.
    { fixtureId: 2, date: "2024-01-08T15:00:00Z", isHome: false,
      teamStats: { yellowCards: 3, redCards: 0 },
      opponentStats: { yellowCards: 2, redCards: 1 } }
  ];
  const agg = aggregateRollingForTeam(matches);
  const approxEq = (a, b) => Math.abs(a - b) < 0.005;

  // Cartonaşe brute — unitatea rolling-ului Cards.
  assert.ok(approxEq(agg.cards_for_avg, (3 + 3) / 2), `for=${agg.cards_for_avg}`);
  assert.ok(approxEq(agg.cards_against_avg, (1 + 3) / 2), `against=${agg.cards_against_avg}`);
  assert.ok(approxEq(agg.cards_for_home_avg, 3), `home=${agg.cards_for_home_avg}`);
  assert.ok(approxEq(agg.cards_for_away_avg, 3), `away=${agg.cards_for_away_avg}`);

  // Puncte ponderate — pistă separată, roşul valorează dublu.
  assert.ok(approxEq(agg.cards_points_for_avg, (4 + 3) / 2), `pFor=${agg.cards_points_for_avg}`);
  assert.ok(approxEq(agg.cards_points_against_avg, (1 + 4) / 2), `pAgainst=${agg.cards_points_against_avg}`);
  assert.ok(approxEq(agg.cards_points_for_home_avg, 4), `pHome=${agg.cards_points_for_home_avg}`);
  assert.ok(approxEq(agg.cards_points_for_away_avg, 3), `pAway=${agg.cards_points_for_away_avg}`);
});

test("aggregateRollingForTeam tratează lista goală", () => {
  const r = aggregateRollingForTeam([]);
  assert.equal(r.matches_sampled, 0);
  assert.equal(r.corners_for_avg, null);
  assert.equal(r.cards_for_avg, null);
});

test("deriveMarketLambdas: echipa cu atac superior produce λ home mai mare", () => {
  const rollingHome = { corners_for_avg: 7, corners_against_avg: 4, matches_sampled: 15 };
  const rollingAway = { corners_for_avg: 3, corners_against_avg: 6, matches_sampled: 15 };
  const r = deriveMarketLambdas({
    rollingHome,
    rollingAway,
    baseAvgTotal: 10,
    marketKey: "corners",
    homeAdv: 1.05,
    awayAdv: 0.97
  });
  assert.ok(r.lambdaHome > r.lambdaAway, `λH=${r.lambdaHome}, λA=${r.lambdaAway}`);
  assert.ok(r.lambdaHome + r.lambdaAway > 0);
  assert.equal(r.usedFallback, false);
});

test("deriveMarketLambdas fallback când lipseşte rolling", () => {
  const r = deriveMarketLambdas({
    rollingHome: null,
    rollingAway: null,
    baseAvgTotal: 10,
    marketKey: "corners"
  });
  // fallback → ambele λ ≈ baseSide (5), cu mici ajustări home/away
  assert.ok(r.lambdaHome > 4 && r.lambdaHome < 6);
  assert.ok(r.lambdaAway > 4 && r.lambdaAway < 6);
  assert.equal(r.usedFallback, true);
});

test("deriveMarketLambdas respectă marketKey (sot vs corners folosesc câmpuri diferite)", () => {
  const rolling = {
    corners_for_avg: 8,
    corners_against_avg: 3,
    sot_for_avg: 5,
    sot_against_avg: 2,
    matches_sampled: 10
  };
  const cornersR = deriveMarketLambdas({
    rollingHome: rolling,
    rollingAway: rolling,
    baseAvgTotal: 10,
    marketKey: "corners"
  });
  const sotR = deriveMarketLambdas({
    rollingHome: rolling,
    rollingAway: rolling,
    baseAvgTotal: 8,
    marketKey: "sot"
  });
  // Valorile sunt diferite pentru că citesc din câmpuri diferite
  assert.ok(cornersR.lambdaHome !== sotR.lambdaHome);
});

test("deriveMarketLambdas: marketKey cards citeşte cards_for_avg/cards_against_avg", () => {
  // The cards counter is explicit because cards no longer borrow `matches_sampled`: that
  // field is the maximum across market families, so it cannot say how many matches carried
  // discipline data. This test is about WHICH FIELDS the cards key reads, which is
  // unchanged — the fixture just has to state its cards evidence now instead of implying it.
  const rollingHome = {
    cards_for_avg: 6,
    cards_against_avg: 3,
    matches_sampled: 12,
    samples_by_market: { cards: 12 }
  };
  const rollingAway = {
    cards_for_avg: 3,
    cards_against_avg: 5,
    matches_sampled: 12,
    samples_by_market: { cards: 12 }
  };
  const r = deriveMarketLambdas({
    rollingHome,
    rollingAway,
    baseAvgTotal: 8,
    marketKey: "cards",
    homeAdv: 1.05,
    awayAdv: 0.97
  });
  assert.ok(r.lambdaHome > r.lambdaAway, `λH=${r.lambdaHome}, λA=${r.lambdaAway}`);
  assert.equal(r.usedFallback, false);
  // Fără rolling data ("cards" nou, echipă niciodată observată) → fallback la media ligii,
  // exact acelaşi comportament ca la corners/sot.
  const fallback = deriveMarketLambdas({
    rollingHome: null,
    rollingAway: null,
    baseAvgTotal: 8,
    marketKey: "cards"
  });
  assert.equal(fallback.usedFallback, true);
});

// ===== INCREMENT C — regression: missing-stats poisoning (λ degenerat) =====

test("readStat via extractFixtureMarketStats: null/undefined/'' → null; 0 şi '0' → zero real", () => {
  const payload = {
    response: [
      {
        team: { id: 1 },
        statistics: [
          { type: "Corner Kicks", value: null },
          { type: "Shots on Goal" },
          { type: "Total Shots", value: "" },
          { type: "Yellow Cards", value: 0 },
          { type: "Red Cards", value: "0" },
          { type: "Ball Possession", value: "45%" }
        ]
      }
    ]
  };
  const out = extractFixtureMarketStats(payload);
  assert.equal(out[0].corners, null);
  assert.equal(out[0].sot, null);
  assert.equal(out[0].shotsTotal, null);
  assert.equal(out[0].yellowCards, 0);
  assert.equal(out[0].redCards, 0);
  assert.equal(out[0].possession, 45);
});

test("aggregateRollingForTeam: meci cu statistici integral null nu contează ca sample real", () => {
  const realMatch = {
    fixtureId: 1, date: "2026-08-06T18:00:00Z", isHome: true,
    teamStats: { corners: 6, sot: 4, shotsTotal: 12 },
    opponentStats: { corners: 3, sot: 2, shotsTotal: 9 }
  };
  const nullMatch = {
    fixtureId: 2, date: "2026-07-23T18:00:00Z", isHome: false,
    teamStats: { corners: null, sot: null, shotsTotal: null },
    opponentStats: { corners: null, sot: null, shotsTotal: null }
  };
  const agg = aggregateRollingForTeam([realMatch, nullMatch]);
  assert.equal(agg.matches_sampled, 1);
  assert.equal(agg.samples_by_market.corners, 1);
  assert.equal(agg.samples_by_market.sot, 1);
  // media NU mai e trasă în jos de null→0 (înainte de fix ar fi fost (6+0)/2=3)
  assert.equal(agg.corners_for_avg, 6);
});

// -------------------- Cards rolling (Increment B) --------------------
// Unitatea rolling-ului Cards este cardsTotal (număr brut yellow + red). Convenţia
// ponderată (red*2 + yellow) trăieşte separat în cards_points_*_avg şi nu trebuie să se
// amestece niciodată cu prima.

/** Un meci în forma consumată de aggregateRollingForTeam. */
function cardsMatch({ id, isHome, teamY, teamR, oppY, oppR, date }) {
  return {
    fixtureId: id,
    date: date || `2026-08-${String(id).padStart(2, "0")}T18:00:00Z`,
    isHome,
    teamStats: { corners: 5, sot: 3, shotsTotal: 10, yellowCards: teamY, redCards: teamR },
    opponentStats: { corners: 4, sot: 2, shotsTotal: 9, yellowCards: oppY, redCards: oppR }
  };
}

test("cards rolling [A]: cardsTotal = yellow + red, nu puncte ponderate", () => {
  // 3 galbene + 1 roşu = 4 cartonaşe brute, dar 5 puncte ponderate.
  const matches = [1, 2].map((i) =>
    cardsMatch({ id: i, isHome: i === 1, teamY: 3, teamR: 1, oppY: 2, oppR: 0 })
  );
  const agg = aggregateRollingForTeam(matches);
  assert.equal(agg.cards_for_avg, 4, "media rolling trebuie să fie în cartonaşe brute");
  assert.equal(agg.cards_against_avg, 2);
});

test("cards rolling [I]: cardsTotal şi cardsPoints sunt piste separate, niciodată amestecate", () => {
  const matches = [1, 2].map((i) =>
    cardsMatch({ id: i, isHome: i === 1, teamY: 3, teamR: 1, oppY: 1, oppR: 1 })
  );
  const agg = aggregateRollingForTeam(matches);
  // for: 4 cartonaşe / 5 puncte · against: 2 cartonaşe / 3 puncte
  assert.equal(agg.cards_for_avg, 4);
  assert.equal(agg.cards_points_for_avg, 5);
  assert.equal(agg.cards_against_avg, 2);
  assert.equal(agg.cards_points_against_avg, 3);
  // Dacă unităţile s-ar confunda, aceste două ar fi egale.
  assert.notEqual(agg.cards_for_avg, agg.cards_points_for_avg);
});

test("cards rolling [C]: 0 cartonaşe dintr-un bloc real este observaţie validă", () => {
  const matches = [1, 2, 3].map((i) =>
    cardsMatch({ id: i, isHome: i % 2 === 1, teamY: 0, teamR: null, oppY: 2, oppR: null })
  );
  const agg = aggregateRollingForTeam(matches);
  assert.equal(agg.samples_by_market.cards, 3, "un 0 real NU trebuie exclus din sample");
  assert.equal(agg.cards_for_avg, 0);
  assert.equal(agg.cards_points_for_avg, 0);
});

test("cards rolling [H]: dataset mixt [4,5,null,3,null,6] → sample 4, media pe cele 4 valide", () => {
  const values = [4, 5, null, 3, null, 6];
  const matches = values.map((v, i) =>
    cardsMatch({ id: i + 1, isHome: true, teamY: v, teamR: v == null ? null : 0, oppY: 1, oppR: 0 })
  );
  const agg = aggregateRollingForTeam(matches);
  assert.equal(agg.samples_by_market.cards, 4, "doar observaţiile valide intră în sample");
  // (4+5+3+6)/4 = 4.5 — NU (4+5+0+3+0+6)/6 = 3, care ar fi rezultatul dacă null→0.
  assert.equal(agg.cards_for_avg, 4.5);
  assert.notEqual(agg.cards_for_avg, 3);
});

test("cards rolling [E]: home şi away sunt calculate şi eşantionate separat", () => {
  const matches = [
    cardsMatch({ id: 1, isHome: true, teamY: 6, teamR: 0, oppY: 1, oppR: 0 }),
    cardsMatch({ id: 2, isHome: true, teamY: 4, teamR: 0, oppY: 3, oppR: 0 }),
    cardsMatch({ id: 3, isHome: false, teamY: 2, teamR: 0, oppY: 5, oppR: 0 })
  ];
  const agg = aggregateRollingForTeam(matches);
  assert.equal(agg.cards_for_home_avg, 5, "(6+4)/2");
  assert.equal(agg.cards_for_away_avg, 2);
  assert.equal(agg.samples_by_market.cards_home, 2);
  assert.equal(agg.samples_by_market.cards_away, 1);
  // Pooled rămâne media tuturor celor trei, nu media mediilor.
  assert.equal(agg.cards_for_avg, 4);
});

test("cards rolling [F]: latura 'against' urmăreşte adversarul, pe aceleaşi observaţii", () => {
  // Infrastructura pentru adversar este perechea for/against, exact ca la cornere —
  // nu se adaugă o a doua metodologie.
  const matches = [
    cardsMatch({ id: 1, isHome: true, teamY: 2, teamR: 0, oppY: 5, oppR: 1 }),
    cardsMatch({ id: 2, isHome: false, teamY: 2, teamR: 0, oppY: 3, oppR: 1 })
  ];
  const agg = aggregateRollingForTeam(matches);
  assert.equal(agg.cards_for_avg, 2);
  assert.equal(agg.cards_against_avg, 5, "(6+4)/2 cartonaşe primite");
  assert.equal(agg.cards_against_home_avg, 6);
  assert.equal(agg.cards_against_away_avg, 4);
});

test("cards rolling [G]: un adversar UNKNOWN scoate meciul din sample-ul perechii", () => {
  const matches = [
    cardsMatch({ id: 1, isHome: true, teamY: 3, teamR: 0, oppY: 2, oppR: 0 }),
    // Latura echipei e observată, a adversarului nu — perechea for/against e incompletă.
    cardsMatch({ id: 2, isHome: true, teamY: 5, teamR: 0, oppY: null, oppR: null })
  ];
  const agg = aggregateRollingForTeam(matches);
  assert.equal(agg.samples_by_market.cards, 1, "sample = min(for, against)");
  assert.equal(agg.cards_against_avg, 2, "media 'against' NU include un 0 fantomă");
});

test("cards rolling [B/D]: null explicit rămâne UNKNOWN şi în pista de puncte", () => {
  // Aceeaşi regresie Number(null)→0, verificată pe ambele unităţi deodată.
  const matches = [
    cardsMatch({ id: 1, isHome: true, teamY: 4, teamR: 0, oppY: 2, oppR: 0 }),
    cardsMatch({ id: 2, isHome: true, teamY: null, teamR: null, oppY: null, oppR: null })
  ];
  const agg = aggregateRollingForTeam(matches);
  assert.equal(agg.samples_by_market.cards, 1);
  assert.equal(agg.cards_for_avg, 4);
  assert.equal(agg.cards_points_for_avg, 4);
});

test("cards rolling: câmpurile in-memory nu se scurg în setul de coloane persistate", () => {
  // Coloanele reale din team_market_rolling (migrările 015 + 038). Un câmp nou lăsat în
  // afara listei de stripping ar face upsert-ul să eşueze pe "coloană necunoscută" abia
  // la rulare — acest test prinde asta la build.
  const DB_COLUMNS = new Set([
    "matches_sampled",
    "corners_for_avg", "corners_against_avg",
    "corners_for_home_avg", "corners_against_home_avg",
    "corners_for_away_avg", "corners_against_away_avg",
    "sot_for_avg", "sot_against_avg",
    "shots_total_for_avg", "shots_total_against_avg",
    "cards_for_avg", "cards_against_avg",
    "cards_for_home_avg", "cards_against_home_avg",
    "cards_for_away_avg", "cards_against_away_avg",
    "last_fixture_id", "last_fixture_date"
  ]);
  const IN_MEMORY_ONLY = new Set([
    "samples_by_market",
    "cards_points_for_avg", "cards_points_against_avg",
    "cards_points_for_home_avg", "cards_points_against_home_avg",
    "cards_points_for_away_avg", "cards_points_against_away_avg"
  ]);

  const agg = aggregateRollingForTeam([
    cardsMatch({ id: 1, isHome: true, teamY: 2, teamR: 0, oppY: 1, oppR: 0 })
  ]);
  const leaked = Object.keys(agg).filter((k) => !DB_COLUMNS.has(k) && !IN_MEMORY_ONLY.has(k));
  assert.deepEqual(leaked, [], `câmpuri fără coloană şi fără stripping: ${leaked.join(", ")}`);

  // Şi invers: forma goală trebuie să expună exact aceleaşi chei ca forma populată.
  assert.deepEqual(Object.keys(aggregateRollingForTeam([])).sort(), Object.keys(agg).sort());
});

test("cards rolling: lista goală întoarce null pe ambele unităţi, nu 0", () => {
  const agg = aggregateRollingForTeam([]);
  assert.equal(agg.cards_for_avg, null);
  assert.equal(agg.cards_points_for_avg, null);
  assert.equal(agg.samples_by_market.cards_home, 0);
  assert.equal(agg.samples_by_market.cards_away, 0);
});

test("aggregateRollingForTeam: cartonaşe null NU intră ca 0 în medie (regresie null→0)", () => {
  // Regresia exactă: garda citea `Number(stats.yellowCards)` ÎNAINTE de a verifica null,
  // iar `Number(null) === 0` este finit — deci un bloc de statistici integral null trecea
  // ca meci-fantomă cu 0 cartonaşe şi trăgea media în jos. Testul vecin foloseşte câmpuri
  // ABSENTE (undefined → NaN), care erau respinse corect; doar `null` explicit declanşa
  // bug-ul, aşa că valorile de aici sunt null intenţionat.
  const realMatch = {
    fixtureId: 1, date: "2026-08-06T18:00:00Z", isHome: true,
    teamStats: { corners: 6, sot: 4, shotsTotal: 12, yellowCards: 4, redCards: 0 },
    opponentStats: { corners: 3, sot: 2, shotsTotal: 9, yellowCards: 2, redCards: 0 }
  };
  const nullMatch = {
    fixtureId: 2, date: "2026-07-23T18:00:00Z", isHome: false,
    teamStats: { corners: null, sot: null, shotsTotal: null, yellowCards: null, redCards: null },
    opponentStats: { corners: null, sot: null, shotsTotal: null, yellowCards: null, redCards: null }
  };
  const agg = aggregateRollingForTeam([realMatch, nullMatch]);
  // Înainte de fix: samples 2, cards_for_avg = (4+0)/2 = 2.
  assert.equal(agg.samples_by_market.cards, 1);
  assert.equal(agg.cards_for_avg, 4);
  assert.equal(agg.cards_against_avg, 2);
});

test("aggregateRollingForTeam: red null lângă yellow cunoscut este zero real", () => {
  // Forma reală a payload-ului: un meci cu galbene şi fără eliminări raportează
  // Yellow Cards = 2 şi Red Cards = null. Acesta NU trebuie exclus.
  const matches = [1, 2, 3, 4].map((i) => ({
    fixtureId: i, date: `2026-08-0${i}T18:00:00Z`, isHome: i % 2 === 0,
    teamStats: { corners: 5, sot: 3, shotsTotal: 10, yellowCards: 3, redCards: null },
    opponentStats: { corners: 4, sot: 2, shotsTotal: 9, yellowCards: 1, redCards: null }
  }));
  const agg = aggregateRollingForTeam(matches);
  assert.equal(agg.samples_by_market.cards, 4);
  assert.equal(agg.cards_for_avg, 3);
  assert.equal(agg.cards_against_avg, 1);
});

test("aggregateRollingForTeam: 0 galbene explicit rămâne producţie reală", () => {
  const matches = [1, 2, 3, 4].map((i) => ({
    fixtureId: i, date: `2026-08-0${i}T18:00:00Z`, isHome: i % 2 === 0,
    teamStats: { corners: 5, sot: 3, shotsTotal: 10, yellowCards: 0, redCards: 0 },
    opponentStats: { corners: 4, sot: 2, shotsTotal: 9, yellowCards: 2, redCards: 0 }
  }));
  const agg = aggregateRollingForTeam(matches);
  assert.equal(agg.samples_by_market.cards, 4);
  assert.equal(agg.cards_for_avg, 0);
});

test("aggregateRollingForTeam: 0 explicit de la provider este producţie reală, nu missing", () => {
  const matches = [1, 2, 3, 4].map((i) => ({
    fixtureId: i, date: `2026-08-0${i}T18:00:00Z`, isHome: i % 2 === 0,
    teamStats: { corners: 0, sot: 2, shotsTotal: 8 },
    opponentStats: { corners: 5, sot: 3, shotsTotal: 10 }
  }));
  const agg = aggregateRollingForTeam(matches);
  assert.equal(agg.samples_by_market.corners, 4);
  assert.equal(agg.corners_for_avg, 0);
});

test("deriveMarketLambdas: 3 meciuri reale (+2 null excluse) → sample insuficient → fallback", () => {
  const rolling = {
    corners_for_avg: 4,
    corners_against_avg: 5,
    matches_sampled: 3,
    samples_by_market: { corners: 3, cards: 0, sot: 3, shots_total: 3 }
  };
  const r = deriveMarketLambdas({
    rollingHome: rolling, rollingAway: rolling,
    baseAvgTotal: 10, marketKey: "corners", homeAdv: 1.05, awayAdv: 0.97
  });
  assert.equal(r.usedFallback, true);
  assert.equal(r.fallbackReason, "insufficient_data");
  assert.ok(r.lambdaHome > 4 && r.lambdaHome < 6, `λH=${r.lambdaHome}`);
  assert.ok(r.lambdaAway > 4 && r.lambdaAway < 6, `λA=${r.lambdaAway}`);
  assert.equal(r.sampleHome, 3);
});

test("deriveMarketLambdas: 4+ meciuri reale → rolling folosit, fără fallback", () => {
  const rolling = {
    corners_for_avg: 5.5,
    corners_against_avg: 4.5,
    matches_sampled: 4,
    samples_by_market: { corners: 4, cards: 4, sot: 4, shots_total: 4 }
  };
  const r = deriveMarketLambdas({
    rollingHome: rolling, rollingAway: rolling,
    baseAvgTotal: 10, marketKey: "corners", homeAdv: 1.05, awayAdv: 0.97
  });
  assert.equal(r.usedFallback, false);
  assert.equal(r.fallbackReason, null);
  assert.ok(r.lambdaHome > 4 && r.lambdaHome < 6, `λH=${r.lambdaHome}`);
});

test("deriveMarketLambdas: sample separat pe familie — corners reale, SOT lipsă", () => {
  const rolling = {
    corners_for_avg: 5,
    corners_against_avg: 5,
    sot_for_avg: null,
    sot_against_avg: null,
    matches_sampled: 5,
    samples_by_market: { corners: 5, cards: 0, sot: 0, shots_total: 0 }
  };
  const corners = deriveMarketLambdas({
    rollingHome: rolling, rollingAway: rolling, baseAvgTotal: 10, marketKey: "corners"
  });
  const sot = deriveMarketLambdas({
    rollingHome: rolling, rollingAway: rolling, baseAvgTotal: 8, marketKey: "sot"
  });
  assert.equal(corners.usedFallback, false);
  assert.equal(sot.usedFallback, true);
  assert.equal(sot.fallbackReason, "insufficient_data");
});

test("deriveMarketLambdas: sanity gate — rând persistat otrăvit (medii minuscule, sample mare) → fallback", () => {
  // Rând team_market_rolling persistat ÎNAINTE de fix: matches_sampled a numărat şi
  // meciurile null→0, deci mediile sunt artificial mici dar sample-ul pare suficient.
  // Reproduce cazul real 1607568 (CSKA Sofia vs Maccabi TA): λTotal era 0.2.
  const poisonedHome = { corners_for_avg: 0.4, corners_against_avg: 0.6, matches_sampled: 8 };
  const poisonedAway = { corners_for_avg: 1.0, corners_against_avg: 0.667, matches_sampled: 8 };
  const r = deriveMarketLambdas({
    rollingHome: poisonedHome, rollingAway: poisonedAway,
    baseAvgTotal: 10.5, marketKey: "corners", homeAdv: 1.05, awayAdv: 0.97
  });
  assert.equal(r.usedFallback, true);
  assert.equal(r.fallbackReason, "sanity_gate");
  assert.ok(r.lambdaHome + r.lambdaAway > 9, `λTotal=${r.lambdaHome + r.lambdaAway}`);
});

test("deriveMarketLambdas: λ legitim mic (peste baseline/2) NU este respins de sanity gate", () => {
  // Două echipe defensive reale: λTotal ≈ 6.4 la baseline 10 — sub medie, dar legitim.
  const home = { corners_for_avg: 4, corners_against_avg: 4, matches_sampled: 8 };
  const away = { corners_for_avg: 4, corners_against_avg: 4, matches_sampled: 8 };
  const r = deriveMarketLambdas({
    rollingHome: home, rollingAway: away,
    baseAvgTotal: 10, marketKey: "corners", homeAdv: 1.05, awayAdv: 0.97
  });
  assert.equal(r.usedFallback, false);
  assert.equal(r.fallbackReason, null);
  const total = r.lambdaHome + r.lambdaAway;
  assert.ok(total > 5 && total < 8, `total=${total}`);
});

test("estimateMatchXg: statistici integral null → null, nu floor artificial 0.05", () => {
  const allNull = {
    corners: null, sot: null, shotsTotal: null,
    shotsInsideBox: null, shotsOutsideBox: null,
    possession: null, xg: null, yellowCards: 6, redCards: 0
  };
  assert.equal(estimateMatchXg(allNull), null);
  // Zero real (meci fără şuturi înregistrat explicit) rămâne estimare validă, nu missing.
  const realZero = estimateMatchXg({ sot: 0, shotsTotal: 0 });
  assert.ok(realZero != null && realZero > 0);
});

test("computeRollingXg: meciurile fără date de şuturi nu produc sample-uri xG", () => {
  const nullStats = { sot: null, shotsTotal: null, shotsInsideBox: null, shotsOutsideBox: null, possession: null, xg: null };
  const matches = [
    { date: "2026-08-06", isHome: true, teamStats: { sot: 5, shotsTotal: 14 }, opponentStats: { sot: 3, shotsTotal: 9 } },
    { date: "2026-07-30", isHome: false, teamStats: nullStats, opponentStats: nullStats },
    { date: "2026-07-23", isHome: true, teamStats: nullStats, opponentStats: nullStats }
  ];
  const xg = computeRollingXg(matches);
  assert.equal(xg.xg_samples, 1);
});

test("dataQualityScore: fallback sau sample subţire reduce scorul; rolling plin nu-l schimbă", async () => {
  const { dataQualityScore } = await import("../server-utils/pipeline/predictHelpers.js");
  const base = { method: "modular-engine", hasOdds: true, hasLuckStats: true, hasTeamIds: true };
  const none = dataQualityScore(base);
  const full = dataQualityScore({ ...base, marketRolling: { sampleHome: 8, sampleAway: 8, usedFallback: false } });
  const thin = dataQualityScore({ ...base, marketRolling: { sampleHome: 3, sampleAway: 3, usedFallback: false } });
  const fb = dataQualityScore({ ...base, marketRolling: { sampleHome: 8, sampleAway: 8, usedFallback: true } });
  assert.equal(full, none);
  assert.ok(thin < full, `thin=${thin} full=${full}`);
  assert.ok(fb < full, `fb=${fb} full=${full}`);
});

test("getLeagueConfidenceMultiplier şi getLeagueStakeCap întorc valori plauzibile", () => {
  // EPL trebuie să aibă cel mai înalt multiplier (1.00) şi cel mai mare stake cap
  assert.equal(getLeagueConfidenceMultiplier(39), 1.0);
  assert.equal(getLeagueStakeCap(39), 3.0);

  // UCL are multiplier mai scăzut (sample mic)
  assert.ok(getLeagueConfidenceMultiplier(2) < 1.0);
  assert.ok(getLeagueStakeCap(2) <= getLeagueStakeCap(39));

  // Liga necunoscută → default fallback (0.88, 1.9)
  assert.equal(getLeagueConfidenceMultiplier(99999), 0.88);
  assert.equal(getLeagueStakeCap(99999), 1.9);
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

test("pickCalibrationMapForLeague falls back to global league_id=-1", () => {
  const maps = {
    "39": { "1": { xPoints: [0, 1], yPoints: [0, 1] } },
    "-1": { "1": { xPoints: [0, 1], yPoints: [0, 0.5] } }
  };
  assert.equal(pickCalibrationMapForLeague(maps, 39)["1"].yPoints[1], 1);
  assert.equal(pickCalibrationMapForLeague(maps, 140)["1"].yPoints[1], 0.5);
});

// =============================================================================
// Multi-method calibration (Platt / Temperature / Beta / selector)
// =============================================================================

function synthMiscalibrated(n, kind, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const trueP = 0.15 + 0.7 * rnd();
    let raw = trueP;
    if (kind === "over") raw = Math.min(0.99, Math.max(0.01, 0.5 + (trueP - 0.5) * 1.8));
    if (kind === "under") raw = Math.min(0.99, Math.max(0.01, 0.5 + (trueP - 0.5) * 0.45));
    out.push({ x: raw, y: rnd() < trueP ? 1 : 0 });
  }
  return out;
}

test("fitPlatt / fitTemperature / fitBeta produce finite params and monotone curves", () => {
  const samples = synthMiscalibrated(200, "over");
  const platt = fitPlatt(samples);
  const temp = fitTemperature(samples);
  const beta = fitBeta(samples);
  assert.ok(Number.isFinite(platt.a) && Number.isFinite(platt.b));
  assert.ok(temp.t > 0);
  assert.ok(beta.a >= 0 && beta.b >= 0);

  for (const [applyFn, params] of [
    [applyPlatt, platt],
    [applyTemperature, temp],
    [applyBeta, beta]
  ]) {
    const curve = curveToPoints(applyFn, params, 20);
    assert.equal(curve.xPoints.length, 21);
    for (let i = 1; i < curve.yPoints.length; i++) {
      assert.ok(curve.yPoints[i] + 1e-9 >= curve.yPoints[i - 1]);
    }
  }
});

test("evaluateCalibrationMethods ranks all four methods and beats overconfident baseline", () => {
  const samples = synthMiscalibrated(400, "over", 11);
  const { ranking, best, baseline } = evaluateCalibrationMethods(samples, { folds: 4 });
  assert.equal(ranking.length, 4);
  assert.ok(["isotonic", "platt", "temperature", "beta"].includes(best));
  const winner = ranking[0];
  assert.ok(winner.logLoss < baseline.logLoss, `winner ${winner.method} LL ${winner.logLoss} vs baseline ${baseline.logLoss}`);
});

test("selectBestCalibration prefers parametric methods on underconfident data", () => {
  const samples = synthMiscalibrated(400, "under", 22);
  const sel = selectBestCalibration(samples, { minSamples: 40, folds: 4 });
  assert.ok(["platt", "temperature", "beta"].includes(sel.method), `got ${sel.method}`);
  assert.ok(sel.xPoints.length >= 2);
  assert.ok(sel.baseline);
});

test("selectBestCalibration returns none when data is already well calibrated", () => {
  let s = 4;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const samples = [];
  for (let i = 0; i < 400; i++) {
    const p = 0.1 + 0.8 * rnd();
    samples.push({ x: p, y: rnd() < p ? 1 : 0 });
  }
  const sel = selectBestCalibration(samples, { minSamples: 40, folds: 4 });
  // Identity guard: no fitted method may beat the uncalibrated baseline.
  assert.equal(sel.method, "none");
  assert.equal(sel.reason, "no_method_beats_baseline");
  assert.ok(sel.ranking.every((r) => r.logLoss > sel.baseline.logLoss));
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

/** Synthetic, linearly-separable stacker samples with chronological kickoffs. */
function makeStackerSamples(n, { seedOffset = 0 } = {}) {
  const samples = [];
  const baseMs = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i++) {
    const homeStronger = (i + seedOffset) % 3 !== 0;
    const poissonProbs = homeStronger ? { p1: 0.55, pX: 0.25, p2: 0.2 } : { p1: 0.25, pX: 0.25, p2: 0.5 };
    const feat = extractStackerFeatures({ poissonProbs, marketProbs: poissonProbs });
    const actual = homeStronger ? "1" : "2";
    samples.push({
      x: feat.values,
      y: actual === "1" ? [1, 0, 0] : actual === "X" ? [0, 1, 0] : [0, 0, 1],
      actual,
      poissonProbs,
      kickoffAt: baseMs + i * 86400000
    });
  }
  return samples;
}

test("trainSoftmax improves in-sample fit over untrained (zero) weights", () => {
  const samples = makeStackerSamples(200);
  const nFeatures = samples[0].x.length;
  const zeroWeights = { intercept: [0, 0, 0], coef: Array.from({ length: nFeatures }, () => [0, 0, 0]) };
  const before = computeStackerMetrics(samples, zeroWeights);

  const trained = trainSoftmax(
    samples.map((s) => ({ ...s })),
    nFeatures,
    { epochs: 40 }
  );
  const after = computeStackerMetrics(samples, trained);

  assert.ok(after.logLossStk < before.logLossStk, "trained log-loss should beat untrained (uniform) weights");
  assert.ok(after.accuracyStk > 50, "trained accuracy should clearly beat chance on separable data");
});

test("evaluateStackerWalkForward reports insufficient_samples when there's too little data for any fold", () => {
  const samples = makeStackerSamples(8);
  const nFeatures = samples[0].x.length;
  const out = evaluateStackerWalkForward(samples, nFeatures, { folds: 3 });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "insufficient_samples");
});

test("evaluateStackerWalkForward reports no_valid_folds when folds exist but are too small to trust", () => {
  const samples = makeStackerSamples(20);
  const nFeatures = samples[0].x.length;
  const out = evaluateStackerWalkForward(samples, nFeatures, { folds: 3 });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "no_valid_folds");
});

test("evaluateStackerWalkForward runs genuine out-of-sample folds on a larger dataset", () => {
  const samples = makeStackerSamples(500);
  const nFeatures = samples[0].x.length;
  const out = evaluateStackerWalkForward(samples, nFeatures, { folds: 3, epochs: 40 });
  assert.equal(out.ok, true);
  assert.ok(out.foldsRun >= 1);
  assert.ok(out.accuracy.mean > 0.5, "out-of-sample accuracy should beat chance on separable data");
  assert.ok(out.logLoss.mean != null && out.logLoss.mean >= 0);
});

test("evaluateStackerWalkForward never scores a fold on data that trained it (chronology holds)", () => {
  const samples = makeStackerSamples(500);
  // Reuse the same chronological-fold primitive CalibrationSelector relies on —
  // this asserts evaluateStackerWalkForward is actually built on it, not a
  // reimplementation that could silently leak future data into training.
  const windows = timeOrderedExpandingFolds(samples, 3);
  assert.ok(windows.length >= 1);
  for (const w of windows) {
    const trainLast = w.train[w.train.length - 1]?.kickoffAt;
    const testFirst = w.test[0]?.kickoffAt;
    assert.ok(trainLast < testFirst, "train must end strictly before test begins");
  }
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

test("ValueEngine EV / Kelly / Value Score for positive edge", () => {
  // p=0.55, odds=2.10 → EV = (0.55*2.10 - 1)*100 = 15.5%
  const ev = calculateExpectedValue(0.55, 2.1);
  assert.equal(ev, 15.5);
  const kelly = calculateKellyPct(0.55, 2.1, { confidencePct: 70 });
  assert.ok(kelly > 0 && kelly <= 3);
  const v = evaluateValue(0.55, 2.1, { type: "1", confidencePct: 70 });
  assert.equal(v.positiveEV, true);
  assert.equal(v.negativeEV, false);
  assert.equal(v.signal, "positive");
  assert.equal(v.recommendable, true);
  assert.ok(v.valueScore >= 50);
  assert.equal(v.expectedValue, 15.5);
});

test("ValueEngine never recommends negative EV", () => {
  // p=0.40, odds=2.00 → EV = (0.8 - 1)*100 = -20%
  const v = evaluateValue(0.4, 2.0, { type: "X", confidencePct: 80 });
  assert.equal(v.negativeEV, true);
  assert.equal(v.positiveEV, false);
  assert.equal(v.signal, "negative");
  assert.equal(v.recommendable, false);
  assert.ok(v.expectedValue < 0);

  const selected = selectBestValue([
    { probability: 0.4, odds: 2.0, type: "X", confidencePct: 80 },
    { probability: 0.3, odds: 2.5, type: "2", confidencePct: 50 }
  ]);
  assert.equal(selected.best, null);
  assert.ok(selected.rejectedNegative.length >= 1);

  const engine = buildValueEngine([
    { probability: 0.4, odds: 2.0, type: "X", confidencePct: 80 }
  ]);
  assert.equal(engine.detected, false);
  assert.equal(engine.recommendable, false);
  assert.equal(engine.rule, "never_recommend_negative_ev");
});

test("ValueEngine accepts 0-100 probability and picks best positive EV", () => {
  const v = evaluateValue(55, 2.1, { type: "1", confidencePct: 70 });
  assert.ok(Math.abs(v.probability - 0.55) < 1e-9);
  assert.equal(v.recommendable, true);

  const { best } = selectBestValue([
    { probability: 0.4, odds: 2.0, type: "bad", confidencePct: 60 },
    { probability: 0.55, odds: 2.1, type: "good", confidencePct: 70 },
    { probability: 0.48, odds: 2.05, type: "meh", confidencePct: 55 }
  ]);
  assert.ok(best);
  assert.equal(best.type, "good");
  assert.equal(best.recommendable, true);
  assert.ok(best.expectedValue > 0);
});

test("Professional Value Engine covers families and highlights best market", () => {
  assert.equal(classifyMarketFamily("1X"), "Double Chance");
  assert.equal(classifyMarketFamily("GG"), "BTTS");
  assert.equal(classifyMarketFamily("Peste 2.5"), "Over/Under");
  assert.equal(classifyMarketFamily("Cards Over 3.5"), "Cards");

  const engine = buildProfessionalValueEngine({
    probs: {
      p1: 48,
      pX: 26,
      p2: 26,
      pDC1X: 74,
      pDC12: 74,
      pDCX2: 52,
      pGG: 55,
      pNGG: 45,
      pO25: 58,
      pU25: 42,
      pO15: 78,
      pU15: 22,
      pU35: 70
    },
    matchWinnerOdds: { home: 2.2, draw: 3.4, away: 3.3 },
    doubleChanceOdds: { homeDraw: 1.35, homeAway: 1.4, drawAway: 1.7 },
    bttsOdds: { yes: 1.85, no: 1.95 },
    goals25Odds: { over: 1.9, under: 1.95 },
    goals15Odds: { over: 1.25, under: 3.8 },
    // Corners and Cards now arrive already priced at the bookmaker's own line
    // (repriceCandidateLine), so probability and odd can never describe different lines.
    cornersSelections: [
      {
        side: "over",
        requestedLine: 9.5,
        bookLine: 9.5,
        lineExact: true,
        probabilityLine: 9.5,
        probabilityPct: 56,
        odd: 1.95,
        bookmakersUsed: 4,
        tradable: true,
        repriced: false,
        betType: "total",
        period: "full_match",
        scope: "match"
      }
    ],
    cardsSelections: [
      {
        side: "over",
        requestedLine: 3.5,
        bookLine: 3.5,
        lineExact: true,
        probabilityLine: 3.5,
        probabilityPct: 54,
        odd: 1.9,
        bookmakersUsed: 4,
        tradable: true,
        repriced: false,
        betType: "total",
        period: "full_match",
        scope: "match"
      },
      {
        side: "under",
        requestedLine: 3.5,
        bookLine: 3.5,
        lineExact: true,
        probabilityLine: 3.5,
        probabilityPct: 46,
        odd: 1.9,
        bookmakersUsed: 4,
        tradable: true,
        repriced: false,
        betType: "total",
        period: "full_match",
        scope: "match"
      }
    ]
  });

  assert.ok(engine.markets.length >= 8);
  const families = new Set(engine.markets.map((m) => m.family));
  for (const f of ["1X2", "Double Chance", "BTTS", "Over/Under", "Corners", "Cards"]) {
    assert.ok(families.has(f), `missing family ${f}`);
  }
  assert.ok(Array.isArray(engine.positiveMarkets));
  assert.ok(Array.isArray(engine.negativeMarkets));
  if (engine.detected) {
    assert.ok(engine.bestMarket);
    assert.equal(engine.bestMarket.negativeEV, false);
    assert.ok(engine.bestMarket.expectedValue > 0);
    assert.equal(engine.recommendable, true);
    assert.ok(engine.markets.some((m) => m.bestMarket));
  }
  // Negative EV markets must never be recommendable
  for (const m of engine.markets) {
    if (m.negativeEV || m.expectedValue <= 0) {
      assert.equal(m.recommendable, false);
    }
  }
  assert.equal(engine.rule, "never_recommend_negative_ev");
});

test("BacktestAnalytics computes ROI Yield Profit Loss streaks and drawdown", () => {
  const rows = [
    {
      fixture_id: 1,
      kickoff_at: "2026-01-01T12:00:00Z",
      league_id: 39,
      league_name: "Premier League",
      home_team: "A",
      away_team: "B",
      validation: "win",
      odds_home: 2.0,
      odds_draw: 3.2,
      odds_away: 3.5,
      recommended_confidence: 62,
      raw_payload: { valueBet: { type: "1", kelly: 2, ev: 8 } }
    },
    {
      fixture_id: 2,
      kickoff_at: "2026-01-02T12:00:00Z",
      league_id: 39,
      league_name: "Premier League",
      home_team: "C",
      away_team: "D",
      validation: "loss",
      odds_home: 1.8,
      odds_draw: 3.4,
      odds_away: 4.2,
      recommended_confidence: 55,
      raw_payload: { valueBet: { type: "1", kelly: 1, ev: 3 } }
    },
    {
      fixture_id: 3,
      kickoff_at: "2026-01-03T12:00:00Z",
      league_id: 140,
      league_name: "La Liga",
      home_team: "E",
      away_team: "F",
      validation: "win",
      odds_home: 2.5,
      odds_draw: 3.1,
      odds_away: 2.8,
      recommended_confidence: 70,
      raw_payload: { valueBet: { type: "2", kelly: 1.5, ev: 12 } }
    }
  ];

  const report = buildBacktestReport(rows, { period: "30d" });
  const m = report.metrics;
  assert.equal(m.settled, 3);
  assert.equal(m.wins, 2);
  assert.equal(m.losses, 1);
  assert.ok(m.hitRate > 60);
  assert.equal(m.roi, m.yield);
  assert.ok(m.profit > 0);
  assert.ok(m.loss > 0);
  assert.ok(m.averageOdds > 1);
  assert.ok(m.averageConfidence > 0);
  assert.ok(m.expectedValue > 0);
  assert.ok(m.maxDrawdown >= 0);
  assert.ok(m.winningStreak >= 1);
  assert.ok(m.losingStreak >= 1);
  assert.ok(m.equityCurve.length === 3);

  const homeOnly = filterBetEvents(
    rows.map(extractBetEvent).filter(Boolean),
    parseFilters({ side: "home" })
  );
  assert.equal(homeOnly.length, 2);

  const liga = buildBacktestReport(rows, { competition: "La Liga" });
  assert.equal(liga.metrics.settled, 1);
  assert.ok(seasonStartIso().startsWith("20"));

  const metrics = computeBacktestMetrics([]);
  assert.equal(metrics.settled, 0);
  assert.equal(metrics.roi, 0);

  const dash = report.dashboard;
  assert.ok(dash);
  assert.equal(typeof dash.predictionAccuracy, "number");
  assert.equal(dash.hitRate, dash.predictionAccuracy);
  assert.ok(typeof dash.averageOdds === "number");
  assert.ok(typeof dash.expectedValue === "number");
  assert.ok(Array.isArray(dash.radar));
  assert.ok(dash.radar.length >= 4);
  assert.ok(dash.heatmap.markets.includes("1"));
  assert.ok(Array.isArray(dash.confidenceDistribution));
  assert.ok(Array.isArray(dash.predictionDistribution));
  assert.ok(Array.isArray(dash.bestLeagues));
  assert.ok(Array.isArray(dash.worstLeagues));
  assert.ok(Array.isArray(dash.bestMarkets));
  assert.ok(Array.isArray(dash.worstMarkets));
  const emptyDash = buildDashboardBundle(metrics, []);
  assert.equal(emptyDash.dailyProfit, 0);
  assert.equal(emptyDash.hitRate, 0);

  // Multi-market value bet: odds from valueEngine, settle from score (not 1X2 columns).
  const ggRow = {
    fixture_id: 99,
    kickoff_at: "2026-01-04T12:00:00Z",
    league_id: 39,
    league_name: "Premier League",
    validation: "pending",
    value_bet_validation: null,
    score_home: 2,
    score_away: 1,
    odds_home: 2.1,
    odds_draw: 3.3,
    odds_away: 3.4,
    recommended_pick: "1",
    raw_payload: {
      valueBet: { detected: true, type: "GG", kelly: 1.2, ev: 6 },
      valueEngine: { bestMarket: { type: "GG", odds: 1.85, kellyPct: 1.2 } },
      score: { home: 2, away: 1 }
    }
  };
  const ggEvent = extractBetEvent(ggRow);
  assert.ok(ggEvent);
  assert.equal(ggEvent.won, true);
  assert.equal(ggEvent.odd, 1.85);
  assert.ok(ggEvent.stake > 0);
});

test("Auto Calibration compares predicted vs actual and respects manual locks", async () => {
  clearRuntimeOverlays();
  const historyRows = [];
  for (let i = 0; i < 120; i++) {
    const homeWin = i % 3 !== 0;
    historyRows.push({
      league_id: 39,
      score_home: homeWin ? 2 : 0,
      score_away: homeWin ? 0 : 1,
      validation: homeWin ? "win" : "loss",
      recommended_pick: "1",
      recommended_confidence: 70,
      raw_payload: {
        evaluation: {
          rawPoissonProbs1x2Pct: { p1: 65, pX: 20, p2: 15 }
        },
        featureImportance: {
          contributions: {
            attack: 0.3,
            defense: 0.2,
            form: 0.15,
            odds: 0.2,
            standings: 0.15
          }
        }
      }
    });
  }

  const samples = extractSamplesFromHistory(historyRows);
  assert.equal(samples.length, 120);
  const buckets = computeReliabilityBuckets(samples);
  assert.ok(buckets.some((b) => b.n > 0));
  const ece = computeEce(buckets);
  assert.ok(ece == null || ece >= 0);
  assert.ok(computeBrier1x2(samples) > 0);

  const fi = fitFeatureWeightDeltas(samples, ["attack", "defense", "odds"], {
    lockedKeys: ["odds"],
    maxDelta: 0.15
  });
  assert.equal(fi.deltas.odds, 0, "locked key must stay at zero delta");

  const merged = applyWeightDeltas({ attack: 0.2, odds: 0.1 }, { attack: 0.1, odds: -0.2 }, ["odds"]);
  assert.equal(merged.odds, 0.1);
  assert.ok(merged.attack > 0.2);

  const prevAttack = process.env.CONFIDENCE_WEIGHT_ATTACK;
  process.env.CONFIDENCE_WEIGHT_ATTACK = "0.22";
  try {
    setRuntimeOverlays({
      confidence: { deltas: { attack: -0.5, form: 0.1 }, lockedKeys: ["attack"] }
    });
    const w = getConfidenceWeights();
    assert.equal(w.attack, 0.22, "manual env weight must not be overwritten");
  } finally {
    if (prevAttack === undefined) delete process.env.CONFIDENCE_WEIGHT_ATTACK;
    else process.env.CONFIDENCE_WEIGHT_ATTACK = prevAttack;
    clearRuntimeOverlays();
  }

  const fitted = fitAutoCalibrationOverlays(samples, { maxDelta: 0.12, learningRate: 0.4 });
  assert.ok(fitted.confidence && fitted.feature_importance && fitted.prediction);
  const report = buildCalibrationReport({
    samples,
    buckets,
    ece,
    brier: computeBrier1x2(samples),
    overlays: fitted,
    modelVersion: "test",
    windowDays: 90,
    config: {}
  });
  assert.equal(report.rule, "never_overwrite_manual_weights");
  assert.ok(report.predictedVsActual);

  const run = await runAutoCalibration({
    rows: historyRows,
    modelVersion: "test-auto-calib",
    minSamples: 50,
    persist: true,
    mode: "test"
  });
  assert.equal(run.ok, true);
  assert.ok(run.report.nRows >= 50);
  assert.ok(run.summary.ece != null || run.summary.brier1x2 != null);

  // Overlay merge helper skips when no deltas
  const base = { a: 1 };
  assert.deepEqual(mergeWithAutoOverlay(base, null), { a: 1 });
});

test("runAutoCalibration resolves maxDelta/learningRate to their real defaults when unset", async () => {
  // Regression: `Number(options.maxDelta) ?? DEFAULT` never falls through, because
  // Number(undefined) is NaN, not null/undefined -- `??` only triggers on nullish,
  // so the outer clamp() silently returned its lower bound (0.02 / 0.05) instead
  // of the intended default (0.15 / 0.35) on every call that didn't pass these
  // options explicitly, which is how production actually calls it (daily-ml.js
  // passes no maxDelta/learningRate at all).
  const run = await runAutoCalibration({ rows: [], persist: false, mode: "test" });
  assert.equal(run.config.maxDelta, 0.15);
  assert.equal(run.config.learningRate, 0.35);
});

test("computeExactMatchDistribution matches computeMatchProbs exactly (no sampling noise)", () => {
  const pmf = buildMatchScorePmf(1.6, 1.1, { correlation: 0.12, rho: -0.11 });
  assert.ok(pmf.cells.length > 10);
  assert.ok(Math.abs(pmf.cells.reduce((s, c) => s + c.prob, 0) - 1) < 1e-6);

  const round2 = (n) => Math.round(Number(n) * 100) / 100;
  const dist = computeExactMatchDistribution(1.6, 1.1, { correlation: 0.12, rho: -0.11 });
  const closedForm = computeMatchProbs(1.6, 1.1, 0, { correlation: 0.12, rho: -0.11 });

  // Same underlying PMF, same market math -- must agree exactly, not "close within noise".
  assert.equal(dist.probabilityDistribution.p1, round2(closedForm.probs.p1));
  assert.equal(dist.probabilityDistribution.pX, round2(closedForm.probs.pX));
  assert.equal(dist.probabilityDistribution.p2, round2(closedForm.probs.p2));
  assert.equal(dist.probabilityDistribution.pGG, round2(closedForm.probs.pGG));
  assert.equal(dist.probabilityDistribution.pO25, round2(closedForm.probs.pO25));

  const sum1x2 =
    dist.probabilityDistribution.p1 + dist.probabilityDistribution.pX + dist.probabilityDistribution.p2;
  assert.ok(Math.abs(sum1x2 - 100) < 0.01, "1X2 must sum to ~100%, not approximately within sampling error");

  assert.ok(dist.expectedGoalsDistribution.home.mean > 0);
  assert.ok(dist.expectedGoalsDistribution.away.mean > 0);
  assert.ok(dist.expectedGoalsDistribution.total.histogram.length >= 1);
  assert.ok(dist.mostLikelyScores.length >= 5);
  assert.ok(dist.goalDistribution.length >= 1);
  assert.ok(dist.range.totalGoals.high >= dist.range.totalGoals.low);
  assert.equal(dist.range.level, 0.95);
  assert.ok(dist.histogram.scores.length >= 5);
  assert.ok(dist.summary.mostLikelyScore);

  // Top score must be the actual max-probability cell in the PMF, not a sampling estimate of it.
  const topCell = [...pmf.cells].sort((a, b) => b.prob - a.prob)[0];
  assert.equal(dist.summary.mostLikelyScore, `${topCell.home}-${topCell.away}`);

  // No RNG left at all -- identical inputs must produce bit-identical output.
  const dist2 = computeExactMatchDistribution(1.6, 1.1, { correlation: 0.12, rho: -0.11 });
  assert.deepEqual(dist, dist2);
});

test("computeExactMarketProbabilities sums 1X2 to 100 and matches per-market PMF mass", () => {
  const pmf = buildMatchScorePmf(0.9, 2.4, { correlation: 0.12, rho: -0.11 });
  const markets = computeExactMarketProbabilities(pmf);
  assert.ok(Math.abs(markets.p1 + markets.pX + markets.p2 - 100) < 0.01);
  assert.ok(Math.abs(markets.pO25 + markets.pU25 - 100) < 0.01);
  assert.ok(Math.abs(markets.pGG + markets.pNGG - 100) < 0.01);
  // Big away favorite: away win should clearly beat home win.
  assert.ok(markets.p2 > markets.p1);
});

test("λ pipeline trace contract and xG λ blend", () => {
  assert.ok(PIPELINE_TRACE_VERSION.startsWith("predictor-v2"));
  assert.ok(LAMBDA_TRACE_STAGE_IDS.includes("fetch"));
  assert.ok(LAMBDA_TRACE_STAGE_IDS.includes("predictionEngine"));
  assert.ok(LAMBDA_TRACE_STAGE_IDS.includes("xg"));
  assert.ok(LAMBDA_TRACE_STAGE_IDS.includes("calibration"));
  assert.ok(LAMBDA_TRACE_STAGE_IDS.includes("featureImportance"));
  assert.equal(LAMBDA_TRACE_STAGE_IDS[LAMBDA_TRACE_STAGE_IDS.length - 1], "prediction");

  const blended = blendLambdasWithXg(1.5, 1.2, 2.0, 0.8, 0.5);
  assert.equal(blended.applied, true);
  assert.ok(Math.abs(blended.lambdaHome - 1.75) < 1e-9);
  assert.ok(Math.abs(blended.lambdaAway - 1.0) < 1e-9);

  const off = blendLambdasWithXg(1.5, 1.2, 2.0, 0.8, 0);
  assert.equal(off.applied, false);

  const xgProbs = buildXgSourceProbs(2.1, 0.9, { correlation: 0.12, rho: -0.11 });
  assert.ok(xgProbs);
  assert.ok(xgProbs.p1 > xgProbs.p2);

  const weights = getPredictionWeights();
  assert.ok(weights.modularBlend > 0);
  assert.ok(weights.expectedGoals > 0);

  const trace = buildPipelineTrace({
    fetch: { ok: true },
    xg: { ok: true, detail: "blended" },
    prediction: { ok: true }
  });
  assert.equal(trace.version, PIPELINE_TRACE_VERSION);
  assert.equal(trace.stages.xg.status, "ok");
  assert.ok(trace.summary.includes("xg:ok"));
});

test("Prediction Laboratory builds radar, comparison, and evolution", () => {
  const lab = buildPredictionLaboratory({
    id: 101,
    teams: { home: "Arsenal", away: "Chelsea" },
    lambdas: { home: 1.55, away: 1.1 },
    luckStats: { hG: 1.4, hXG: 1.5, aG: 1.0, aXG: 1.05 },
    probs: { p1: 48, pX: 26, p2: 26, pGG: 54, pO25: 52 },
    odds: { home: 2.1, draw: 3.4, away: 3.5, bookmakersUsed: 8 },
    recommended: { pick: "1", confidence: 62, odd: 2.1 },
    valueEngine: { expectedValue: 8.5, edge: 6.2 },
    confidenceEngine: {
      overall: 64,
      scores: { attack: 70, defense: 58, standings: 66, oddsConsensus: 72 }
    },
    teamContext: {
      home: { rank: 2, points: 40, played: 18 },
      away: { rank: 8, points: 28, played: 18 }
    },
    modelMeta: {
      massCaptured: 0.92,
      strengthMeta: { atkH: 1.6, defH: 1.1, atkA: 1.2, defA: 1.3 },
      leagueParams: { leagueAvg: 1.4 }
    },
    evaluation: {
      rawPoissonProbs1x2Pct: { p1: 46, pX: 27, p2: 27 },
      calibratedProbs1x2Pct: { p1: 47, pX: 26.5, p2: 26.5 },
      modelProbs1x2Pct: { p1: 48, pX: 26, p2: 26 }
    }
  });

  assert.equal(lab.available, true);
  assert.equal(lab.radar.length, 10);
  assert.ok(lab.scores.poisson > 0);
  assert.ok(lab.scores.expectedGoals > 0);
  assert.ok(lab.scores.attack > 0);
  assert.ok(lab.scores.defense > 0);
  assert.ok(lab.scores.standings > 0);
  assert.ok(lab.scores.odds > 0);
  assert.ok(lab.scores.confidence > 0);
  assert.ok(lab.scores.expectedValue > 0);
  assert.ok(lab.scores.bookmakerDifference > 0);
  assert.ok(lab.scores.predictionEvolution > 0);
  assert.ok(lab.comparison.rows.length >= 5);
  assert.ok(lab.evolution.length >= 2);
  assert.ok(lab.bookmaker.differencePp != null);
  assert.equal(buildPredictionLaboratory({ insufficientData: true }).available, false);
});

test("fetcher buildCacheKey is provider-agnostic and param-order stable", () => {
  const a = buildCacheKey("/odds", { page: 1, date: "2026-07-18" });
  const b = buildCacheKey("/odds", { date: "2026-07-18", page: 1 });
  assert.equal(a, b);
  assert.ok(a.startsWith("req:v2:/odds?"));
  assert.ok(a.includes("date=2026-07-18"));
  assert.ok(!a.includes("api-sports"));
});

test("PredictionContributions attributes signed per-module impact toward the pick", () => {
  const ctx = {
    pick: "1",
    confidence: 63,
    overallConfidence: 85,
    weights: {
      attack: 1,
      defense: 1,
      form: 1,
      homeAdvantage: 1,
      odds: 0.15,
      injuries: 0.1,
      weather: 0.05,
      referee: 0.05,
      modularBlend: 1
    },
    strengthMeta: {
      leagueAvg: 1.35,
      atkH: 1.8,
      atkA: 1.1,
      defH: 1.0,
      defA: 1.4,
      homeAdv: 1.08,
      awayAdv: 0.95
    },
    modularScores: {
      form: { details: { home: 1.05, away: 0.97, available: true } },
      odds: { details: { home: 1.06, away: 0.94, available: true } },
      injuries: { details: { home: 1.0, away: 0.96, available: true } },
      weather: { details: { home: 0.98, away: 0.98, available: true } }
    },
    eloInfo: { eloSpread: 80 },
    probsRaw: { p1: 58, pX: 25, p2: 17 },
    probsFinal: { p1: 62, pX: 24, p2: 14 }
  };
  const fi = buildPredictionContributions(ctx);
  assert.equal(fi.outcome, "1");
  assert.equal(fi.confidence, 85);
  const keys = fi.items.map((i) => i.key);
  for (const k of ["poisson", "elo", "form", "homeAdvantage", "odds", "injuries", "calibration"]) {
    assert.ok(keys.includes(k), `missing ${k}`);
  }
  // Home is the stronger side → Poisson should push positively toward pick "1".
  assert.ok(fi.contributions.poisson > 0);
  // Calibration raised P(home) from 58 → 62 → +4pp.
  assert.equal(fi.contributions.calibration, 4);
  // Every item carries a signed contribution and a normalized share.
  for (const it of fi.items) {
    assert.equal(typeof it.contribution, "number");
    assert.ok(it.share >= 0);
    assert.ok(["positive", "negative", "neutral"].includes(it.direction));
  }
  // Away-oriented pick flips Poisson sign.
  const away = buildPredictionContributions({ ...ctx, pick: "2", probsFinal: { p1: 62, pX: 24, p2: 14 } });
  assert.ok(away.contributions.poisson < 0);
});

test("Closing odds blob + selectionClosingOdd resolve 1X2 and GG", async () => {
  const { buildClosingOddsBlob } = await import("../server-utils/closingOddsCapture.js");
  const { selectionClosingOdd } = await import("../server-utils/backtest/BacktestAnalytics.js");

  const oddsApi = {
    response: [
      {
        bookmakers: [
          {
            name: "A",
            bets: [
              {
                name: "Match Winner",
                values: [
                  { value: "Home", odd: "2.10" },
                  { value: "Draw", odd: "3.40" },
                  { value: "Away", odd: "3.50" }
                ]
              },
              {
                name: "Both Teams Score",
                values: [
                  { value: "Yes", odd: "1.80" },
                  { value: "No", odd: "2.00" }
                ]
              },
              {
                name: "Goals Over/Under",
                values: [
                  { value: "Over 2.5", odd: "1.95" },
                  { value: "Under 2.5", odd: "1.90" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const blob = buildClosingOddsBlob(oddsApi, "2026-07-18T12:00:00.000Z");
  assert.ok(blob);
  assert.equal(blob.home, 2.1);
  assert.equal(blob.gg, 1.8);
  assert.equal(blob.over25, 1.95);

  const payload = { closingOdds: blob };
  assert.equal(selectionClosingOdd(payload, {}, "1"), 2.1);
  assert.equal(selectionClosingOdd(payload, {}, "GG"), 1.8);
  assert.equal(selectionClosingOdd(payload, {}, "Peste 2.5"), 1.95);
  assert.equal(selectionClosingOdd(payload, { closing_odds_away: 3.6 }, "2"), 3.5);
});

test("Quant backtest metrics: LogLoss, Brier, Kelly growth, Sharpe, CLV, drawdown", () => {
  const events = [
    { kickoffAt: "2026-01-01T12:00:00Z", stake: 0.02, odd: 2.2, prob: 0.5, clvPct: 3, won: true, pnl: 0.02 * 1.2 },
    { kickoffAt: "2026-01-05T12:00:00Z", stake: 0.02, odd: 1.9, prob: 0.55, clvPct: -1, won: false, pnl: -0.02 },
    { kickoffAt: "2026-01-10T12:00:00Z", stake: 0.02, odd: 3.1, prob: 0.38, clvPct: 5, won: true, pnl: 0.02 * 2.1 },
    { kickoffAt: "2026-01-20T12:00:00Z", stake: 0.02, odd: 2.0, prob: 0.52, clvPct: null, won: false, pnl: -0.02 }
  ];
  const q = computeQuantMetrics(events);
  assert.ok(q.logLoss > 0);
  assert.ok(q.brier >= 0 && q.brier <= 2);
  assert.equal(typeof q.kellyGrowthPct, "number");
  assert.equal(q.kellyCurve.length, 4);
  assert.ok(q.kellyMaxDrawdownPct >= 0);
  assert.equal(typeof q.sharpe, "number");
  assert.equal(typeof q.sharpeAnnualized, "number");
  // CLV present on 3 of 4 rows → available with mean of 3,-1,5.
  assert.equal(q.clvAvailable, true);
  assert.equal(q.clvCount, 3);
  assert.ok(Math.abs(q.clv - (3 - 1 + 5) / 3) < 0.01);
  assert.ok(Array.isArray(q.returnsHistogram) && q.returnsHistogram.length > 0);

  // computeBacktestMetrics surfaces the quant fields.
  const m = computeBacktestMetrics(events);
  for (const key of ["logLoss", "brier", "kellyGrowthPct", "sharpe", "sharpeAnnualized", "clv", "kellyCurve", "returnsHistogram"]) {
    assert.ok(key in m, `metrics missing ${key}`);
  }
});

test("Model Lab evaluates each model independently with all six metrics", () => {
  const mkRow = (fixtureId, sh, sa, poisson, elo, xgH, xgA) => ({
    fixture_id: fixtureId,
    score_home: sh,
    score_away: sa,
    odds_home: 2.0,
    odds_draw: 3.4,
    odds_away: 3.8,
    luck_hxg: xgH,
    luck_axg: xgA,
    raw_payload: {
      evaluation: {
        rawPoissonProbs1x2Pct: poisson,
        modelProbs1x2Pct: poisson
      },
      modelMeta: {
        elo: { home: elo.home, away: elo.away },
        leagueParams: { homeAdv: 1.08, rho: -0.11 },
        modularScores: { injuries: { detail: { home: 0.98, away: 1.0, available: true } } }
      }
    }
  });

  const rows = [
    mkRow(1, 2, 0, { p1: 55, pX: 25, p2: 20 }, { home: 1550, away: 1450 }, 1.8, 1.0),
    mkRow(2, 0, 1, { p1: 40, pX: 28, p2: 32 }, { home: 1400, away: 1500 }, 1.0, 1.4),
    mkRow(3, 1, 1, { p1: 33, pX: 34, p2: 33 }, { home: 1480, away: 1480 }, 1.2, 1.2),
    mkRow(4, 3, 1, { p1: 60, pX: 22, p2: 18 }, { home: 1600, away: 1400 }, 2.1, 0.9)
  ];

  // Every registered model reconstructs from a row.
  const src = reconstructSources(rows[0]);
  assert.ok(src.sources.poisson && src.sources.elo && src.sources.xg && src.sources.everything);

  const lab = runModelLab(rows);
  assert.equal(lab.totalSettled, 4);
  assert.equal(lab.models.length, MODEL_REGISTRY.length);
  for (const m of lab.models) {
    assert.ok(m.samples > 0, `${m.id} has samples`);
    for (const key of ["accuracy", "roi", "yield", "logLoss", "brier", "expectedValue"]) {
      assert.ok(m[key] !== undefined && m[key] !== null, `${m.id} missing ${key}`);
    }
    assert.equal(m.yield, m.roi); // flat stake
    assert.ok(m.brier >= 0 && m.brier <= 2);
    assert.ok(m.logLoss >= 0);
  }
  assert.ok(lab.best && typeof lab.best.roi === "number");
});

test("Rolling xG model: shot-based estimate, recency rolling, and DC lambdas", () => {
  // Location-aware estimate: more inside-box shots → higher xG.
  const highQ = estimateMatchXg({ shotsInsideBox: 12, shotsOutsideBox: 4, sot: 7, possession: 60 });
  const lowQ = estimateMatchXg({ shotsInsideBox: 3, shotsOutsideBox: 8, sot: 2, possession: 40 });
  assert.ok(highQ > lowQ);
  assert.ok(highQ > 0 && highQ <= 6);

  // Provider xG (recent xG) is blended in when present.
  const withProvider = estimateMatchXg({ xg: 2.4, sot: 5, shotsTotal: 12 });
  const withoutProvider = estimateMatchXg({ sot: 5, shotsTotal: 12 });
  assert.ok(withProvider > withoutProvider);

  // Reduced model works from SoT + total shots only (persisted rolling fallback).
  const reduced = estimateMatchXg({ sot: 4.5, shotsTotal: 13 });
  assert.ok(reduced > 0.8 && reduced < 2.5);

  // Recency-weighted rolling: recent high-xG match dominates.
  const matches = [
    { date: "2026-01-20", isHome: true, teamStats: { sot: 8, shotsTotal: 18, shotsInsideBox: 12 }, opponentStats: { sot: 2, shotsTotal: 7 } },
    { date: "2026-01-10", isHome: false, teamStats: { sot: 3, shotsTotal: 9 }, opponentStats: { sot: 5, shotsTotal: 12 } }
  ];
  const rolling = computeRollingXg(matches);
  assert.equal(rolling.xg_samples, 2);
  assert.ok(rolling.xg_for_avg > rolling.xg_against_avg);

  // rollingXgRates falls back to SoT/shots when no xg fields present.
  const rates = rollingXgRates({ sot_for_avg: 5, shots_total_for_avg: 13, sot_against_avg: 3, shots_total_against_avg: 9 });
  assert.equal(rates.source, "sot_shots_derived");
  assert.ok(rates.forRate > rates.againstRate);

  // DC lambdas from rolling xG.
  const lambdas = deriveXgLambdas({
    rollingHome: { xg_for_avg: 1.8, xg_against_avg: 1.0, xg_samples: 6, xg_source: "shot_rolling_model" },
    rollingAway: { xg_for_avg: 1.1, xg_against_avg: 1.5, xg_samples: 6, xg_source: "shot_rolling_model" },
    leagueBaseXg: 1.35,
    homeAdv: 1.08,
    awayAdv: 0.95
  });
  assert.ok(lambdas && lambdas.xgHome > lambdas.xgAway);
  assert.equal(lambdas.usedFallback, false);
});

test("blendModel produces a normalized triple and injuries modifier tilts it", () => {
  const sources = {
    poisson: { p1: 0.5, pX: 0.25, p2: 0.25 },
    elo: { p1: 0.6, pX: 0.2, p2: 0.2 },
    xg: { p1: 0.55, pX: 0.25, p2: 0.2 },
    market: { p1: 0.52, pX: 0.26, p2: 0.22 },
    everything: { p1: 0.58, pX: 0.22, p2: 0.2 }
  };
  const a = blendModel(getModelById("A"), sources, null);
  assert.ok(Math.abs(a.p1 + a.pX + a.p2 - 1) < 1e-6);
  assert.ok(Math.abs(a.p1 - 0.5) < 1e-9);
  const d = blendModel(getModelById("D"), sources, { home: 0.95, away: 1.0 });
  assert.ok(Math.abs(d.p1 + d.pX + d.p2 - 1) < 1e-6);
  // Injured home side → its win prob is tilted down vs the no-injury blend.
  const dNoInj = blendModel(getModelById("D"), sources, null);
  assert.ok(d.p1 < dNoInj.p1);
});

test("Auto Model Selection competes over windows and picks a winner (default safe)", () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const rows = [];
  for (let i = 0; i < 60; i++) {
    const homeWin = i % 2 === 0;
    rows.push({
      fixture_id: i + 1,
      kickoff_at: new Date(now - (i * 5 * day)).toISOString(),
      score_home: homeWin ? 2 : 0,
      score_away: homeWin ? 0 : 1,
      odds_home: 2.0,
      odds_draw: 3.4,
      odds_away: 3.8,
      luck_hxg: homeWin ? 1.8 : 1.0,
      luck_axg: homeWin ? 0.9 : 1.4,
      raw_payload: {
        evaluation: {
          rawPoissonProbs1x2Pct: homeWin ? { p1: 55, pX: 25, p2: 20 } : { p1: 35, pX: 30, p2: 35 },
          modelProbs1x2Pct: homeWin ? { p1: 58, pX: 24, p2: 18 } : { p1: 33, pX: 30, p2: 37 }
        },
        modelMeta: { elo: { home: 1500, away: 1450 }, leagueParams: { homeAdv: 1.08, rho: -0.11 } }
      }
    });
  }
  const sel = runAutoSelection(rows);
  assert.ok(sel.windows.length === 3);
  assert.ok(["A", "B", "C", "D", "E"].includes(sel.selected.id));
  assert.ok(Array.isArray(sel.ranking));
  // Each window reports its own settled count.
  for (const w of sel.windows) assert.ok(typeof w.totalSettled === "number");
});

test("extractRawTriple prefers rawPoisson over final modelProbs (train/serve align)", () => {
  const payload = {
    evaluation: {
      rawPoissonProbs1x2Pct: { p1: 50, pX: 30, p2: 20 },
      modelProbs1x2Pct: { p1: 70, pX: 20, p2: 10 }
    },
    probs: { p1: 60, pX: 25, p2: 15 }
  };
  const t = extractRawTriple(payload);
  assert.ok(t);
  assert.ok(Math.abs(t.p1 - 0.5) < 1e-9);
  assert.ok(Math.abs(t.pX - 0.3) < 1e-9);
  assert.ok(Math.abs(t.p2 - 0.2) < 1e-9);

  const prev = process.env.PREDICT_TRAIN_USE_FINAL_PROBS;
  process.env.PREDICT_TRAIN_USE_FINAL_PROBS = "1";
  const legacy = extractRawTriple(payload);
  process.env.PREDICT_TRAIN_USE_FINAL_PROBS = prev;
  assert.ok(legacy);
  assert.ok(Math.abs(legacy.p1 - 0.7) < 1e-9);
});

test("consensusOverUnderOddsAtLine matches fuzzy shot markets and nearest line", async () => {
  const { consensusOverUnderOddsAtLine } = await import("../server-utils/marketOdds.js");
  const payload = {
    response: [
      {
        bookmakers: [
          {
            name: "BetA",
            bets: [
              {
                name: "Total Shots on Target Over/Under",
                values: [
                  { value: "Over 7.5", odd: "1.90" },
                  { value: "Under 7.5", odd: "1.85" },
                  { value: "Over 8.5", odd: "2.10" },
                  { value: "Under 8.5", odd: "1.70" }
                ]
              },
              {
                name: "Player Shots on Target",
                values: [
                  { value: "Over 2.5", odd: "1.50" },
                  { value: "Under 2.5", odd: "2.40" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const exact = consensusOverUnderOddsAtLine(
    payload,
    ["Shots On Target - Over/Under"],
    8.5,
    { maxLineDelta: 1.5, kind: "shots_on_target" }
  );
  assert.ok(exact);
  assert.equal(exact.line, 8.5);
  assert.equal(exact.lineExact, true);
  assert.ok(exact.over > 1);

  const nearest = consensusOverUnderOddsAtLine(
    payload,
    ["Shots On Target"],
    9.5,
    { maxLineDelta: 1.5, kind: "shots_on_target" }
  );
  assert.ok(nearest);
  assert.equal(nearest.line, 8.5);
  assert.equal(nearest.lineExact, false);
  assert.ok(nearest.over > 1);

  const noPlayer = consensusOverUnderOddsAtLine(
    payload,
    ["Shots On Target"],
    2.5,
    { maxLineDelta: 0, kind: "shots_on_target" }
  );
  assert.equal(noPlayer, null);

  const { resolveShotsOnTargetMarketQuote, FIRST_HALF_GOALS_MARKET_NAMES } = await import(
    "../server-utils/marketOdds.js"
  );

  const totalOnlyPayload = {
    response: [
      {
        bookmakers: [
          {
            name: "Bet365",
            bets: [
              {
                name: "Total Shots Over/Under",
                values: [
                  { value: "Over 8.5", odd: "1.95" },
                  { value: "Under 8.5", odd: "1.80" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
  const viaTotal = resolveShotsOnTargetMarketQuote(totalOnlyPayload, { matchLine: 8.5 });
  assert.ok(viaTotal);
  assert.equal(viaTotal.sourceKind, "shots_total");
  assert.ok(viaTotal.over > 1);

  const teamPayload = {
    response: [
      {
        bookmakers: [
          {
            name: "Unibet",
            bets: [
              {
                name: "Home Team Total Shots On Target",
                values: [
                  { value: "Over 3.5", odd: "1.88" },
                  { value: "Under 3.5", odd: "1.92" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
  const viaHome = resolveShotsOnTargetMarketQuote(teamPayload, {
    matchLine: 9.5,
    homeLine: 3.5
  });
  assert.ok(viaHome);
  assert.equal(viaHome.sourceKind, "team_home");

  // API-Football v3 names: bet 87 "Total ShotOnGoal", bet 211 "Total Shots"
  const apiFootballPayload = {
    response: [
      {
        bookmakers: [
          {
            name: "Betano",
            bets: [
              {
                name: "Total ShotOnGoal",
                values: [
                  { value: "Over 8.5", odd: "1.95" },
                  { value: "Under 8.5", odd: "1.80" },
                  { value: "Over 7.5", odd: "1.55" },
                  { value: "Under 7.5", odd: "2.35" }
                ]
              },
              {
                name: "Total Shots",
                values: [
                  { value: "Over 23.5", odd: "1.83" },
                  { value: "Under 23.5", odd: "1.91" }
                ]
              },
              {
                name: "Home Player Shots",
                values: [
                  { value: "Over 2.5", odd: "1.40" },
                  { value: "Under 2.5", odd: "2.80" }
                ]
              }
            ]
          },
          {
            name: "1xBet",
            bets: [
              {
                name: "Total ShotOnGoal",
                values: [
                  { value: "Over 8.5", odd: "2.07" },
                  { value: "Under 8.5", odd: "1.67" }
                ]
              },
              {
                name: "Total Shots",
                values: [
                  { value: "Over 23.5", odd: "1.80" },
                  { value: "Under 23.5", odd: "1.91" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  const {
    SHOTS_SOT_MARKET_NAMES: sotNames,
    SHOTS_TOTAL_MARKET_NAMES: totalNames
  } = await import("../server-utils/marketOdds.js");

  const apiSot = consensusOverUnderOddsAtLine(apiFootballPayload, sotNames, 8.5, {
    maxLineDelta: 1.5,
    kind: "shots_on_target"
  });
  assert.ok(apiSot, "Total ShotOnGoal must resolve as match SOT market");
  assert.equal(apiSot.line, 8.5);
  assert.ok(apiSot.over > 1);
  assert.ok(apiSot.under > 1);
  assert.ok(apiSot.bookmakersUsed >= 2);

  const apiTotal = consensusOverUnderOddsAtLine(apiFootballPayload, totalNames, 23.5, {
    maxLineDelta: 2,
    kind: "shots_total"
  });
  assert.ok(apiTotal, "Total Shots must resolve as match total-shots market");
  assert.equal(apiTotal.line, 23.5);
  assert.ok(apiTotal.over > 1);

  const viaApiSot = resolveShotsOnTargetMarketQuote(apiFootballPayload, { matchLine: 8.5 });
  assert.ok(viaApiSot);
  assert.equal(viaApiSot.sourceKind, "sot");

  const htPayload = {
    response: [
      {
        bookmakers: [
          {
            name: "Bet365",
            bets: [
              {
                name: "Total Goals - First Half",
                values: [
                  { value: "Over 1.5", odd: "2.20" },
                  { value: "Under 1.5", odd: "1.65" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
  const ht = consensusOverUnderOddsAtLine(htPayload, FIRST_HALF_GOALS_MARKET_NAMES, 1.5, {
    maxLineDelta: 0.5,
    kind: "first_half_goals"
  });
  assert.ok(ht);
  assert.equal(ht.line, 1.5);
  assert.ok(ht.over > 1);
});

// =============================================================================
// Correct Score — odds parsing + value candidates
// =============================================================================

function correctScoreOddsPayload(rows) {
  return {
    response: [
      {
        bookmakers: [
          {
            name: "BetA",
            bets: [{ name: "Correct Score", values: rows.map(([value, odd]) => ({ value, odd })) }]
          }
        ]
      }
    ]
  };
}

test("consensusCorrectScoreOdds parsează cotele per scor exact (home-away)", async () => {
  const { consensusCorrectScoreOdds } = await import("../server-utils/marketOdds.js");
  const payload = correctScoreOddsPayload([
    ["1-0", "7.00"],
    ["2-1", "8.50"],
    ["0-0", "9.00"]
  ]);
  const out = consensusCorrectScoreOdds(payload);
  assert.ok(out);
  assert.equal(out.scores["1-0"], 7.0);
  assert.equal(out.scores["2-1"], 8.5);
  assert.equal(out.scores["0-0"], 9.0);
  assert.equal(out.bookmakersUsed, 1);
});

test("consensusCorrectScoreOdds ignoră valori non-numerice (ex. \"Other\") fără să eşueze", async () => {
  const { consensusCorrectScoreOdds } = await import("../server-utils/marketOdds.js");
  const payload = correctScoreOddsPayload([
    ["1-0", "7.00"],
    ["Other", "15.00"],
    ["4+", "20.00"]
  ]);
  const out = consensusCorrectScoreOdds(payload);
  assert.ok(out);
  assert.equal(Object.keys(out.scores).length, 1);
  assert.equal(out.scores["1-0"], 7.0);
});

test("consensusCorrectScoreOdds face median pe mai mulţi bookmakeri pentru acelaşi scor", async () => {
  const { consensusCorrectScoreOdds } = await import("../server-utils/marketOdds.js");
  const payload = {
    response: [
      {
        bookmakers: [
          { name: "BetA", bets: [{ name: "Correct Score", values: [{ value: "1-0", odd: "7.00" }] }] },
          { name: "BetB", bets: [{ name: "Correct Score", values: [{ value: "1-0", odd: "9.00" }] }] }
        ]
      }
    ]
  };
  const out = consensusCorrectScoreOdds(payload);
  assert.equal(out.scores["1-0"], 8.0);
  assert.equal(out.bookmakersUsed, 2);
});

test("consensusCorrectScoreOdds: null (nu eroare) când piaţa lipseşte sau nu există bookmakeri", async () => {
  const { consensusCorrectScoreOdds } = await import("../server-utils/marketOdds.js");
  assert.equal(consensusCorrectScoreOdds(null), null);
  assert.equal(consensusCorrectScoreOdds({}), null);
  assert.equal(consensusCorrectScoreOdds({ response: [{ bookmakers: [] }] }), null);
  assert.equal(
    consensusCorrectScoreOdds({
      response: [{ bookmakers: [{ name: "BetA", bets: [{ name: "Match Winner", values: [] }] }] }]
    }),
    null
  );
});

test("consensusCorrectScoreOdds recunoaşte piaţa numită \"Correct Score\" (neschimbat)", async () => {
  const { consensusCorrectScoreOdds } = await import("../server-utils/marketOdds.js");
  const payload = {
    response: [
      {
        bookmakers: [
          { name: "BetA", bets: [{ name: "Correct Score", values: [{ value: "1-0", odd: "7.00" }] }] }
        ]
      }
    ]
  };
  const out = consensusCorrectScoreOdds(payload);
  assert.ok(out);
  assert.equal(out.scores["1-0"], 7.0);
  assert.equal(out.bookmakersUsed, 1);
});

test("consensusCorrectScoreOdds recunoaşte piaţa numită \"Exact Score\" (Sprint 6 fix)", async () => {
  const { consensusCorrectScoreOdds } = await import("../server-utils/marketOdds.js");
  const payload = {
    response: [
      {
        bookmakers: [
          { name: "BetB", bets: [{ name: "Exact Score", values: [{ value: "2-1", odd: "8.50" }] }] }
        ]
      }
    ]
  };
  const out = consensusCorrectScoreOdds(payload);
  assert.ok(out);
  assert.equal(out.scores["2-1"], 8.5);
  assert.equal(out.bookmakersUsed, 1);
});

test("consensusCorrectScoreOdds combină \"Correct Score\" şi \"Exact Score\" de la bookmakeri diferiţi în acelaşi consens (median)", async () => {
  const { consensusCorrectScoreOdds } = await import("../server-utils/marketOdds.js");
  const payload = {
    response: [
      {
        bookmakers: [
          { name: "BetA", bets: [{ name: "Correct Score", values: [{ value: "1-0", odd: "7.00" }] }] },
          { name: "BetB", bets: [{ name: "Exact Score", values: [{ value: "1-0", odd: "9.00" }] }] }
        ]
      }
    ]
  };
  const out = consensusCorrectScoreOdds(payload);
  assert.equal(out.scores["1-0"], 8.0);
  assert.equal(out.bookmakersUsed, 2);
});

test("consensusCorrectScoreOdds ignoră \"Correct Score - First Half\" / \"Correct Score - Second Half\" (pieţe diferite, pe repriză)", async () => {
  const { consensusCorrectScoreOdds } = await import("../server-utils/marketOdds.js");
  const payload = {
    response: [
      {
        bookmakers: [
          {
            name: "BetA",
            bets: [
              { name: "Correct Score - First Half", values: [{ value: "1-0", odd: "3.00" }] },
              { name: "Correct Score - Second Half", values: [{ value: "0-0", odd: "2.50" }] }
            ]
          }
        ]
      }
    ]
  };
  // Neither half-time variant is the full-time market -> no candidates at all.
  assert.equal(consensusCorrectScoreOdds(payload), null);
});

test("consensusCorrectScoreOdds parsează scoreline-uri \"Exact Score\" cu \":\" (ex. \"1:0\") şi le normalizează la cheia \"1-0\"", async () => {
  const { consensusCorrectScoreOdds } = await import("../server-utils/marketOdds.js");
  const payload = {
    response: [
      {
        bookmakers: [
          {
            name: "10Bet",
            bets: [
              {
                name: "Exact Score",
                values: [
                  { value: "1:0", odd: "6.25" },
                  { value: "2:1", odd: "7.00" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
  const out = consensusCorrectScoreOdds(payload);
  assert.ok(out);
  assert.equal(out.scores["1-0"], 6.25);
  assert.equal(out.scores["2-1"], 7.0);
  assert.equal(out.bookmakersUsed, 1);
});

test("consensusCorrectScoreOdds face median pe acelaşi scor între bookmakeri cu format \"-\" şi \":\" diferit", async () => {
  const { consensusCorrectScoreOdds } = await import("../server-utils/marketOdds.js");
  const payload = {
    response: [
      {
        bookmakers: [
          { name: "BetA", bets: [{ name: "Correct Score", values: [{ value: "1-0", odd: "7.00" }] }] },
          { name: "10Bet", bets: [{ name: "Exact Score", values: [{ value: "1:0", odd: "9.00" }] }] }
        ]
      }
    ]
  };
  const out = consensusCorrectScoreOdds(payload);
  assert.equal(out.scores["1-0"], 8.0);
  assert.equal(out.bookmakersUsed, 2);
});

test("consensusCorrectScoreOdds ignoră \"Other\"/\"4+\" şi când markete-ul e \"Exact Score\" cu \":\" (filtrare neschimbată)", async () => {
  const { consensusCorrectScoreOdds } = await import("../server-utils/marketOdds.js");
  const payload = {
    response: [
      {
        bookmakers: [
          {
            name: "10Bet",
            bets: [
              {
                name: "Exact Score",
                values: [
                  { value: "1:0", odd: "6.25" },
                  { value: "Other", odd: "15.00" },
                  { value: "4+", odd: "20.00" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
  const out = consensusCorrectScoreOdds(payload);
  assert.ok(out);
  assert.equal(Object.keys(out.scores).length, 1);
  assert.equal(out.scores["1-0"], 6.25);
});

test("buildValueCandidates: generează exact un candidat Correct Score per scor cu odds + probabilitate", async () => {
  const { buildValueCandidates } = await import("../server-utils/value/valueMarkets.js");
  const list = buildValueCandidates({
    probs: {},
    correctScoreOdds: { "1-0": 7.0, "2-1": 8.5, "0-0": 9.0 },
    correctScoreProbsPct: { "1-0": 12.0, "2-1": 8.0 } // "0-0" lipseşte intenţionat — fără probabilitate, fără candidat
  });
  const csCandidates = list.filter((c) => c.family === "Correct Score");
  assert.equal(csCandidates.length, 2, "doar scorurile cu AMBELE odds şi probabilitate devin candidaţi");
  const types = csCandidates.map((c) => c.type).sort();
  assert.deepEqual(types, ["Correct Score 1-0", "Correct Score 2-1"]);
  // Fără duplicate — un singur candidat per scor.
  const uniqueTypes = new Set(csCandidates.map((c) => c.type));
  assert.equal(uniqueTypes.size, csCandidates.length);
  const c10 = csCandidates.find((c) => c.type === "Correct Score 1-0");
  assert.equal(c10.odds, 7.0);
  assert.ok(Math.abs(c10.probability - 0.12) < 1e-9);
  assert.equal(c10.confidencePct, 12.0);
});

test("buildValueCandidates: Sprint 9 — probabilitate mică (0.4421, adică 0.4421%) devine fracţia corectă 0.004421, nu 44.21% (regresie Sprint 8.1)", async () => {
  const { buildValueCandidates } = await import("../server-utils/value/valueMarkets.js");
  const list = buildValueCandidates({
    probs: {},
    correctScoreOdds: { "6-0": 201 },
    correctScoreProbsPct: { "6-0": 0.4421175488481423 } // cell.prob(0.004421...) * 100, exact ca în Stage08Decision.js
  });
  const c = list.find((x) => x.type === "Correct Score 6-0");
  assert.ok(c);
  assert.ok(Math.abs(c.probability - 0.004421175488481423) < 1e-9, `probability ar trebui să fie ~0.004421, nu ${c.probability}`);
  // confidencePct rămâne pe scara 0-100 (neschimbat de acest fix — era deja corect).
  assert.ok(Math.abs(c.confidencePct - 0.4421175488481423) < 1e-9);
});

test("buildValueCandidates: Sprint 9 — 2-1 la 9.26% rămâne 0.0926 ca fracţie (piaţă peste pragul de 1.5, se comporta deja corect)", async () => {
  const { buildValueCandidates } = await import("../server-utils/value/valueMarkets.js");
  const list = buildValueCandidates({
    probs: {},
    correctScoreOdds: { "2-1": 8.3 },
    correctScoreProbsPct: { "2-1": 9.261686700539384 }
  });
  const c = list.find((x) => x.type === "Correct Score 2-1");
  assert.ok(c);
  assert.ok(Math.abs(c.probability - 0.09261686700539384) < 1e-9);
});

test("buildValueCandidates + buildProfessionalValueEngine: Sprint 9 — EV-ul unui scor rar cu cotă mare rămâne rezonabil, nu explodează la mii de procente", async () => {
  const { buildProfessionalValueEngine } = await import("../server-utils/value/ValueEngine.js");
  const engine = buildProfessionalValueEngine({
    probs: { p1: 40, pX: 30, p2: 30 },
    matchWinnerOdds: { home: 2.5, draw: 3.2, away: 2.9 },
    correctScoreOdds: { "6-0": 201 },
    correctScoreProbsPct: { "6-0": 0.4421175488481423 }
  });
  const cs = engine.markets.find((m) => m.type === "Correct Score 6-0");
  assert.ok(cs);
  // EV corect: (0.004421 * 201 - 1) * 100 ≈ -11.13%. Înainte de fix, cu 0.4421
  // interpretat ca fracţie (44.21%), EV ar fi fost ~+8785% — absurd.
  assert.ok(cs.expectedValue < 0, `EV ar trebui să fie negativ/rezonabil pentru un outsider la cotă 201, nu ${cs.expectedValue}`);
  assert.ok(Math.abs(cs.expectedValue) < 100, `EV nu ar trebui să fie de ordinul miilor de procente, a ieşit ${cs.expectedValue}`);
});

test("buildValueCandidates: fără cote Correct Score → niciun candidat, fără eroare (skip elegant)", async () => {
  const { buildValueCandidates } = await import("../server-utils/value/valueMarkets.js");
  const list = buildValueCandidates({
    probs: { p1: 40, pX: 30, p2: 30 },
    matchWinnerOdds: { home: 2.1, draw: 3.2, away: 3.5 },
    correctScoreOdds: null,
    correctScoreProbsPct: { "1-0": 12.0 }
  });
  assert.equal(list.filter((c) => c.family === "Correct Score").length, 0);
  // Restul familiilor rămân complet neafectate.
  assert.equal(list.filter((c) => c.family === "1X2").length, 3);
});

test("buildValueCandidates: Sprint 9 — 1X2/Double Chance/BTTS/Over-Under/Corners/Cards rămân byte-identice cu Correct Score prezent", async () => {
  const { buildValueCandidates } = await import("../server-utils/value/valueMarkets.js");
  const input = {
    probs: { p1: 40, pX: 30, p2: 30, pGG: 55, pO25: 60 },
    matchWinnerOdds: { home: 2.1, draw: 3.2, away: 3.5 },
    doubleChanceOdds: { homeDraw: 1.3, homeAway: 1.25, drawAway: 1.6 },
    bttsOdds: { yes: 1.8, no: 2.0 },
    goals25Odds: { over: 1.9, under: 1.95 },
    cornersQuote: { pick: "Peste 9.5", line: 9.5, odd: 1.9 },
    cornersProbPct: 58,
    cardsOdds: { over: 1.85, under: 1.95, line: 3.5 },
    cardsOverProbPct: 52,
    cardsUnderProbPct: 48
  };
  const without = buildValueCandidates(input);
  const withCs = buildValueCandidates({
    ...input,
    correctScoreOdds: { "6-0": 201, "2-1": 8.3 },
    correctScoreProbsPct: { "6-0": 0.4421175488481423, "2-1": 9.261686700539384 }
  });
  const strip = (list) => list.filter((c) => c.family !== "Correct Score");
  assert.deepEqual(strip(withCs), strip(without));
  assert.equal(withCs.length, without.length + 2);
  // Confirmă explicit fiecare familie neatinsă e prezentă şi identică.
  for (const fam of ["1X2", "Double Chance", "BTTS", "Over/Under", "Corners", "Cards"]) {
    assert.deepEqual(
      withCs.filter((c) => c.family === fam),
      without.filter((c) => c.family === fam),
      `familia ${fam} ar trebui să rămână byte-identică`
    );
  }
});

test("buildValueCandidates: pieţele existente rămân neschimbate cu Correct Score prezent (regresie)", async () => {
  const { buildValueCandidates } = await import("../server-utils/value/valueMarkets.js");
  const input = {
    probs: { p1: 40, pX: 30, p2: 30, pGG: 55, pO25: 60 },
    matchWinnerOdds: { home: 2.1, draw: 3.2, away: 3.5 },
    bttsOdds: { yes: 1.8, no: 2.0 },
    goals25Odds: { over: 1.9, under: 1.95 }
  };
  const without = buildValueCandidates(input);
  const withCs = buildValueCandidates({
    ...input,
    correctScoreOdds: { "1-0": 7.0 },
    correctScoreProbsPct: { "1-0": 12.0 }
  });
  const strip = (list) => list.filter((c) => c.family !== "Correct Score");
  assert.deepEqual(strip(withCs), strip(without));
  assert.equal(withCs.length, without.length + 1);
});

test("UEFA stats fallback helpers pick domestic league and build averages from FT fixtures", async () => {
  const {
    pickDomesticLeagueId,
    buildStatsFromFinishedFixtures,
    isUefaClubCompetition,
    leaguePriorLambdas
  } = await import("../server-utils/pipeline/predictHelpers.js");

  assert.equal(isUefaClubCompetition(2), true);
  assert.equal(isUefaClubCompetition(3), true);
  assert.equal(isUefaClubCompetition(848), true);
  assert.equal(isUefaClubCompetition(39), false);

  const prior = leaguePriorLambdas({ leagueAvg: 1.4, leagueAvgHome: 1.5, leagueAvgAway: 1.2, homeAdv: 1.08, awayAdv: 0.95 });
  assert.ok(prior.lambdaHome > 0.2);
  assert.ok(prior.lambdaAway > 0.2);
  assert.ok(prior.lambdaHome > prior.lambdaAway);
  // Venue-side averages must not be multiplied by homeAdv again.
  assert.ok(Math.abs(prior.lambdaHome - 1.5) < 0.01);
  assert.ok(Math.abs(prior.lambdaAway - 1.2) < 0.01);

  const priorFlat = leaguePriorLambdas({ leagueAvg: 1.4, homeAdv: 1.08, awayAdv: 0.95 });
  assert.ok(Math.abs(priorFlat.lambdaHome - 1.4 * 1.08) < 0.01);
  assert.ok(Math.abs(priorFlat.lambdaAway - 1.4 * 0.95) < 0.01);

  const domestic = pickDomesticLeagueId(
    {
      response: [
        { league: { id: 2, type: "Cup", name: "Champions League" }, country: { name: "World" } },
        {
          league: { id: 39, type: "League", name: "Premier League" },
          country: { name: "England" },
          seasons: [{ year: 2025, coverage: { fixtures: { statistics_fixtures: true }, standings: true } }]
        },
        { league: { id: 45, type: "Cup", name: "FA Cup" }, country: { name: "England" } }
      ]
    },
    { preferNotLeagueId: 2, seasonNum: 2025 }
  );
  assert.equal(domestic, 39);

  const built = buildStatsFromFinishedFixtures(
    [
      {
        fixture: { status: { short: "FT" } },
        teams: { home: { id: 33 }, away: { id: 34 } },
        goals: { home: 2, away: 1 }
      },
      {
        fixture: { status: { short: "FT" } },
        teams: { home: { id: 40 }, away: { id: 33 } },
        goals: { home: 0, away: 1 }
      },
      {
        fixture: { status: { short: "AET" } },
        teams: { home: { id: 33 }, away: { id: 50 } },
        goals: { home: 1, away: 1 }
      },
      {
        fixture: { status: { short: "NS" } },
        teams: { home: { id: 33 }, away: { id: 42 } },
        goals: { home: null, away: null }
      }
    ],
    33
  );
  assert.ok(built);
  assert.equal(built.stats.played, 3);
  assert.equal(built.stats.playedHome, 2);
  assert.equal(built.stats.playedAway, 1);
  assert.ok(built.stats.gfHome > 0);
  assert.equal(built.norm.response.form, "WWD");

  const twoOnly = buildStatsFromFinishedFixtures(
    [
      {
        fixture: { status: { short: "FT" } },
        teams: { home: { id: 33 }, away: { id: 34 } },
        goals: { home: 2, away: 0 }
      },
      {
        fixture: { status: { short: "FT" } },
        teams: { home: { id: 40 }, away: { id: 33 } },
        goals: { home: 1, away: 1 }
      }
    ],
    33,
    { minPlayed: 2 }
  );
  assert.ok(twoOnly);
  assert.equal(twoOnly.stats.played, 2);
  assert.equal(buildStatsFromFinishedFixtures(twoOnly ? [
    {
      fixture: { status: { short: "FT" } },
      teams: { home: { id: 33 }, away: { id: 34 } },
      goals: { home: 2, away: 0 }
    },
    {
      fixture: { status: { short: "FT" } },
      teams: { home: { id: 40 }, away: { id: 33 } },
      goals: { home: 1, away: 1 }
    }
  ] : [], 33, { minPlayed: 3 }), null);
});

test("reweightPmfTo1x2 matches target 1X2 margins and keeps O/U mass coherent", async () => {
  const { buildMatchScorePmf, reweightPmfTo1x2, computeMatchProbs } = await import("../server-utils/math.js");
  const pmf = buildMatchScorePmf(1.7, 1.2, { correlation: 0, rho: -0.11 });
  const target = { p1: 0.55, pX: 0.25, p2: 0.2 };
  const rw = reweightPmfTo1x2(pmf, target);
  const calc = computeMatchProbs(1.7, 1.2, 0, { pmf: rw });
  assert.ok(Math.abs(calc.probs.p1 - 55) < 1.5, `p1=${calc.probs.p1}`);
  assert.ok(Math.abs(calc.probs.pX - 25) < 1.5, `pX=${calc.probs.pX}`);
  assert.ok(Math.abs(calc.probs.p2 - 20) < 1.5, `p2=${calc.probs.p2}`);
  assert.ok(Number.isFinite(calc.probs.pO25) && calc.probs.pO25 > 0);
  assert.ok(Number.isFinite(calc.probs.pGG) && calc.probs.pGG > 0);
  assert.equal(rw.reweightedTo1x2, true);
});

test("poissonOverLineCorrelated differs from independent sum when corr > 0", async () => {
  const { poissonOverLine, poissonOverLineCorrelated } = await import("../server-utils/math.js");
  const indep = poissonOverLine(9.5, 5.2 + 4.8);
  const corr = poissonOverLineCorrelated(9.5, 5.2, 4.8, 0.12);
  assert.ok(Number.isFinite(corr) && corr > 0 && corr < 1);
  assert.ok(Math.abs(corr - indep) > 1e-4, "correlated total should shift vs independent");
});

test("DC-only default (correlation 0) still produces valid 1X2 + draws via rho", () => {
  const r = computeMatchProbs(1.5, 1.2, 0, { correlation: 0, rho: -0.11 });
  assert.equal(r.modelMeta.method, "poisson-dc-analytic");
  assert.equal(r.modelMeta.correlation, 0);
  const sum = r.probs.p1 + r.probs.pX + r.probs.p2;
  assert.ok(Math.abs(sum - 100) < 0.2);
});

test("deriveCardsLambda blends league + referee + corners aggression", async () => {
  const { deriveCardsLambda } = await import("../server-utils/pipeline/predictHelpers.js");
  const base = deriveCardsLambda({ leagueParams: { cardsAvgTotal: 4.2 } });
  assert.ok(Math.abs(base - 4.2) < 0.05);
  const withRef = deriveCardsLambda({
    leagueParams: { cardsAvgTotal: 4.2 },
    modularScores: { referee: { detail: { avgCards: 5.0, cardsBoost: 5.0 / 4.2 } } }
  });
  assert.ok(withRef > base);
  const withCorners = deriveCardsLambda({
    leagueParams: { cardsAvgTotal: 4.2, cornersAvgTotal: 10 },
    cornersBlock: { expectedTotal: 13 }
  });
  assert.ok(withCorners > base);
});

test("MotivationEngine is directional on large rank gaps", async () => {
  const { MotivationEngine } = await import("../server-utils/PredictionEngine/MotivationEngine.js");
  const out = MotivationEngine.calculate({
    homeStandingsRow: { rank: 18 },
    awayStandingsRow: { rank: 2 }
  });
  assert.ok(out.details.home > out.details.away, "home underdog should get higher factor");
});

test("MotivationEngine: rank-gap behaviour unchanged when no description is present (regression)", async () => {
  const { MotivationEngine } = await import("../server-utils/PredictionEngine/MotivationEngine.js");
  const out = MotivationEngine.calculate({
    homeStandingsRow: { rank: 18 },
    awayStandingsRow: { rank: 2 }
  });
  // Same fixture as the pre-existing test above — exact original values, no drift from the new code.
  assert.equal(out.details.home, 1.025);
  assert.equal(out.details.away, 0.985);
});

test("MotivationEngine: description mentioning promotion nudges motivation up", async () => {
  const { MotivationEngine } = await import("../server-utils/PredictionEngine/MotivationEngine.js");
  const withPromotion = MotivationEngine.calculate({
    homeStandingsRow: { rank: 5, description: "Promotion - Championship", all: { played: 20 } },
    awayStandingsRow: { rank: 6, all: { played: 20 } }
  });
  const withoutDescription = MotivationEngine.calculate({
    homeStandingsRow: { rank: 5, all: { played: 20 } },
    awayStandingsRow: { rank: 6, all: { played: 20 } }
  });
  assert.ok(
    withPromotion.details.home > withoutDescription.details.home,
    `promotion should raise home factor: ${withPromotion.details.home} vs ${withoutDescription.details.home}`
  );
});

test("MotivationEngine: description mentioning relegation nudges motivation up", async () => {
  const { MotivationEngine } = await import("../server-utils/PredictionEngine/MotivationEngine.js");
  const withRelegation = MotivationEngine.calculate({
    homeStandingsRow: { rank: 5, all: { played: 20 } },
    awayStandingsRow: { rank: 6, description: "Relegation - Championship", all: { played: 20 } }
  });
  const withoutDescription = MotivationEngine.calculate({
    homeStandingsRow: { rank: 5, all: { played: 20 } },
    awayStandingsRow: { rank: 6, all: { played: 20 } }
  });
  assert.ok(
    withRelegation.details.away > withoutDescription.details.away,
    `relegation should raise away factor: ${withRelegation.details.away} vs ${withoutDescription.details.away}`
  );
});

test("MotivationEngine: neutral description (mid-table, no stake) applies no competition bonus", async () => {
  const { MotivationEngine } = await import("../server-utils/PredictionEngine/MotivationEngine.js");
  const withNeutralDesc = MotivationEngine.calculate({
    homeStandingsRow: { rank: 10, description: "Mid-table", all: { played: 20 } },
    awayStandingsRow: { rank: 11, all: { played: 20 } }
  });
  const withoutDescription = MotivationEngine.calculate({
    homeStandingsRow: { rank: 10, all: { played: 20 } },
    awayStandingsRow: { rank: 11, all: { played: 20 } }
  });
  assert.equal(withNeutralDesc.details.home, withoutDescription.details.home);
});

test("MotivationEngine: missing description (undefined/null) does not throw and applies no bonus", async () => {
  const { MotivationEngine } = await import("../server-utils/PredictionEngine/MotivationEngine.js");
  const undefinedDesc = MotivationEngine.calculate({
    homeStandingsRow: { rank: 10 },
    awayStandingsRow: { rank: 11 }
  });
  const nullDesc = MotivationEngine.calculate({
    homeStandingsRow: { rank: 10, description: null },
    awayStandingsRow: { rank: 11, description: null }
  });
  assert.equal(undefinedDesc.details.home, nullDesc.details.home);
  assert.ok(Number.isFinite(undefinedDesc.details.home));
});

test("MotivationEngine: season progress scales the competition bonus (late season amplifies, early dampens)", async () => {
  const { MotivationEngine } = await import("../server-utils/PredictionEngine/MotivationEngine.js");
  const early = MotivationEngine.calculate({
    homeStandingsRow: { rank: 5, description: "Champions League", all: { played: 3 } },
    awayStandingsRow: { rank: 6, all: { played: 3 } }
  });
  const late = MotivationEngine.calculate({
    homeStandingsRow: { rank: 5, description: "Champions League", all: { played: 30 } },
    awayStandingsRow: { rank: 6, all: { played: 30 } }
  });
  assert.ok(
    late.details.home > early.details.home,
    `late-season bonus should exceed early-season bonus: ${late.details.home} vs ${early.details.home}`
  );
});

test("MotivationEngine: explicit homeMotivation/awayMotivation path also gets the competition bonus", async () => {
  const { MotivationEngine } = await import("../server-utils/PredictionEngine/MotivationEngine.js");
  const withDesc = MotivationEngine.calculate({
    homeMotivation: 0.5,
    awayMotivation: 0.5,
    homeStandingsRow: { description: "Relegation", all: { played: 30 } },
    awayStandingsRow: { all: { played: 30 } }
  });
  const withoutDesc = MotivationEngine.calculate({
    homeMotivation: 0.5,
    awayMotivation: 0.5
  });
  assert.equal(withDesc.details.source, "explicit");
  assert.ok(withDesc.details.home > withoutDesc.details.home);
});

test("InjuriesEngine weights suspended players more than doubtful", async () => {
  const { InjuriesEngine } = await import("../server-utils/PredictionEngine/InjuriesEngine.js");
  const mild = InjuriesEngine.calculate({
    homeTeamId: "1",
    awayTeamId: "2",
    injuries: [{ teamId: "1", type: "Doubtful" }]
  });
  const harsh = InjuriesEngine.calculate({
    homeTeamId: "1",
    awayTeamId: "2",
    injuries: [{ teamId: "1", type: "Suspended" }]
  });
  assert.ok(harsh.details.home < mild.details.home);
});

test("extractStackerModelTriple prefers calibrated probs over raw", async () => {
  const { extractStackerModelTriple, extractRawTriple } = await import(
    "../server-utils/ml/extractRawTriple.js"
  );
  const payload = {
    evaluation: {
      rawPoissonProbs1x2Pct: { p1: 40, pX: 30, p2: 30 },
      calibratedProbs1x2Pct: { p1: 55, pX: 25, p2: 20 }
    }
  };
  const raw = extractRawTriple(payload);
  const stacked = extractStackerModelTriple(payload);
  assert.ok(Math.abs(raw.p1 - 0.4) < 0.01);
  assert.ok(Math.abs(stacked.p1 - 0.55) < 0.01);
});

test("extractStackerModelTriple replays maps when calibrated missing", async () => {
  const { extractStackerModelTriple } = await import("../server-utils/ml/extractRawTriple.js");
  const maps = {
    "39": {
      "1": { xPoints: [0.2, 0.8], yPoints: [0.3, 0.9] },
      X: { xPoints: [0.2, 0.8], yPoints: [0.2, 0.5] },
      "2": { xPoints: [0.2, 0.8], yPoints: [0.2, 0.6] }
    }
  };
  const payload = {
    evaluation: { rawPoissonProbs1x2Pct: { p1: 50, pX: 30, p2: 20 } }
  };
  const t = extractStackerModelTriple(payload, maps, 39);
  assert.ok(t && t.p1 > 0.5, "calibrated home win should rise on overconfident map");
});

test("applySideMarketCalibration moves O25/GG and preserves 1X2", async () => {
  const { applySideMarketCalibration } = await import("../server-utils/isotonicCalibration.js");
  const maps = {
    O25: { xPoints: [0.4, 0.7], yPoints: [0.35, 0.55] },
    GG: { xPoints: [0.4, 0.7], yPoints: [0.45, 0.65] }
  };
  const out = applySideMarketCalibration(
    { p1: 45, pX: 28, p2: 27, pO25: 60, pGG: 55, pO15: 80, pU35: 70 },
    maps
  );
  assert.equal(out.p1, 45);
  assert.ok(out.sideCalibrationAny);
  assert.ok(out.pO25 < 60);
  assert.ok(Number.isFinite(out.pU25));
  assert.ok(Math.abs(out.pO25 + out.pU25 - 100) < 0.2);
});

test("resolvePublishedTip scores tip from pOut and closing", async () => {
  const { resolvePublishedTip } = await import("../server-utils/backtest/TipEvent.js");
  const tip = resolvePublishedTip({
    recommended_pick: "Peste 2.5",
    recommended_confidence: 62,
    validation: "win",
    score_home: 2,
    score_away: 1,
    closing_odds_home: null,
    raw_payload: {
      recommended: { pick: "Peste 2.5", odd: 1.85, confidence: 62 },
      probs: { pO25: 62, p1: 40, pX: 30, p2: 30 },
      closingOdds: { over25: 1.75, "o2.5": 1.75 }
    }
  });
  assert.equal(tip.pick, "Peste 2.5");
  assert.equal(tip.won, true);
  assert.ok(tip.prob > 0.5);
  assert.ok(tip.odd > 1);
  assert.ok(tip.clvPct != null && tip.clvPct > 0);
});

test("evaluateTipClvReport aggregates tip ROI and CLV", async () => {
  const { evaluateTipClvReport } = await import("../server-utils/validation/TipClvReport.js");
  const rows = [];
  for (let i = 0; i < 80; i++) {
    const won = i % 3 !== 0;
    rows.push({
      kickoff_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      recommended_pick: "1",
      validation: won ? "win" : "loss",
      score_home: won ? 2 : 0,
      score_away: won ? 0 : 1,
      closing_odds_home: 1.9,
      raw_payload: {
        recommended: { pick: "1", odd: 2.05, confidence: 55 },
        probs: { p1: 55, pX: 25, p2: 20 }
      }
    });
  }
  const out = evaluateTipClvReport(rows, { minTrain: 30, testSize: 10, step: 10 });
  assert.ok(out.tips >= 70);
  assert.ok(out.overall.accuracy != null);
  assert.ok(out.walkForward.windows >= 1);
  assert.ok(out.walkForward.clv.mean != null || out.overall.clv != null);
});

test("extractBetEvent track=tip scores published recommendation", async () => {
  const { extractBetEvent } = await import("../server-utils/backtest/BacktestAnalytics.js");
  const row = {
    recommended_pick: "GG",
    validation: "win",
    score_home: 2,
    score_away: 1,
    league_id: 39,
    league_name: "EPL",
    kickoff_at: "2026-07-01T12:00:00Z",
    raw_payload: {
      recommended: { pick: "GG", odd: 1.9, confidence: 58 },
      probs: { pGG: 58, p1: 40, pX: 30, p2: 30 },
      closingOdds: { gg: 1.8 }
    }
  };
  const tip = extractBetEvent(row, { track: "tip" });
  assert.ok(tip);
  assert.equal(tip.track, "tip");
  assert.equal(tip.market, "GG");
  assert.equal(tip.won, true);
  assert.ok(tip.clvPct > 0);

  const value = extractBetEvent(row, { track: "value" });
  assert.equal(value, null, "no valueBet → value track skips");
});

test("extractStackerVector uses calibrated triple when present", async () => {
  const { extractStackerVector } = await import("../server-utils/ml/features/FeatureExtractor.js");
  const { extractStackerFeatures } = await import("../server-utils/mlStacker.js");
  const { shinImpliedProbs } = await import("../server-utils/advancedMath.js");
  const odds = { home: 1.8, draw: 3.5, away: 4.5 };
  const shin = shinImpliedProbs(odds.home, odds.draw, odds.away);
  const row = {
    league_id: 39,
    raw_payload: {
      evaluation: {
        rawPoissonProbs1x2Pct: { p1: 40, pX: 30, p2: 30 },
        calibratedProbs1x2Pct: { p1: 60, pX: 20, p2: 20 }
      },
      odds,
      modelMeta: { dataQuality: 0.7, eloSpread: 40, leagueParams: { homeAdv: 1.06, rho: -0.1 } }
    }
  };
  const vec = extractStackerVector(row);
  const expected = extractStackerFeatures({
    poissonProbs: { p1: 0.6, pX: 0.2, p2: 0.2 },
    marketProbs: shin,
    eloSpread: 40,
    dataQuality: 0.7,
    homeAdv: 1.06,
    rho: -0.1
  });
  // First feature is poisson_log_ratio_1X — must match calibrated, not raw 40/30.
  assert.ok(Math.abs(vec.values[0] - expected.values[0]) < 1e-9);
});

// =============================================================================
// Clean Sheet / Failed To Score — extraction + empirical BTTS blend
// =============================================================================

function teamStatsPayload({ cleanSheet, failedToScore, playedHome = 10, playedAway = 10 } = {}) {
  return {
    response: {
      goals: {
        for: { average: { home: "1.80", away: "1.20", total: "1.50" } },
        against: { average: { home: "0.90", away: "1.10", total: "1.00" } }
      },
      fixtures: { played: { total: playedHome + playedAway, home: playedHome, away: playedAway } },
      ...(cleanSheet ? { clean_sheet: cleanSheet } : {}),
      ...(failedToScore ? { failed_to_score: failedToScore } : {})
    }
  };
}

test("extractAdvancedGoalsAverages extrage clean_sheet ca rate (count / meciuri jucate)", () => {
  const out = extractAdvancedGoalsAverages(
    teamStatsPayload({ cleanSheet: { home: 6, away: 3, total: 9 }, playedHome: 10, playedAway: 10 })
  );
  assert.ok(out, "should not be null");
  assert.equal(out.cleanSheetRateHome, 0.6);
  assert.equal(out.cleanSheetRateAway, 0.3);
  // Câmpurile existente rămân neschimbate.
  assert.equal(out.gfHome, 1.8);
  assert.equal(out.gaAway, 1.1);
  assert.equal(out.played, 20);
});

test("extractAdvancedGoalsAverages extrage failed_to_score ca rate", () => {
  const out = extractAdvancedGoalsAverages(
    teamStatsPayload({ failedToScore: { home: 1, away: 4, total: 5 }, playedHome: 10, playedAway: 10 })
  );
  assert.equal(out.failedToScoreRateHome, 0.1);
  assert.equal(out.failedToScoreRateAway, 0.4);
});

test("extractAdvancedGoalsAverages: fallback null când clean_sheet/failed_to_score lipsesc din payload", () => {
  const out = extractAdvancedGoalsAverages(teamStatsPayload({}));
  assert.equal(out.cleanSheetRateHome, null);
  assert.equal(out.cleanSheetRateAway, null);
  assert.equal(out.failedToScoreRateHome, null);
  assert.equal(out.failedToScoreRateAway, null);
  // Restul câmpurilor tot funcţionează normal.
  assert.equal(out.gfHome, 1.8);
});

test("computeEmpiricalBttsRate: combină rate-uri proprii + adversar, conservator (mediere, nu amplificare)", () => {
  const rate = computeEmpiricalBttsRate({
    cleanSheetRateHome: 0.2,
    cleanSheetRateAway: 0.3,
    failedToScoreRateHome: 0.1,
    failedToScoreRateAway: 0.2
  });
  // pHomeFailsToScore = avg(0.1, 0.3) = 0.2 → home scores 0.8
  // pAwayFailsToScore = avg(0.2, 0.2) = 0.2 → away scores 0.8
  // BTTS = 0.8 * 0.8 = 0.64
  assert.ok(Math.abs(rate - 0.64) < 1e-9, `rate=${rate}`);
});

test("computeEmpiricalBttsRate: null când orice rată lipseşte sau e invalidă", () => {
  assert.equal(computeEmpiricalBttsRate({ cleanSheetRateHome: 0.2, cleanSheetRateAway: 0.3, failedToScoreRateHome: 0.1 }), null);
  assert.equal(computeEmpiricalBttsRate({}), null);
  assert.equal(
    computeEmpiricalBttsRate({
      cleanSheetRateHome: 0.2,
      cleanSheetRateAway: 0.3,
      failedToScoreRateHome: 0.1,
      failedToScoreRateAway: 1.5 // în afara [0,1]
    }),
    null
  );
});

test("blendBttsWithEmpirical: 85% Poisson / 15% empiric, hardcodat", () => {
  const rates = {
    cleanSheetRateHome: 0.2,
    cleanSheetRateAway: 0.3,
    failedToScoreRateHome: 0.1,
    failedToScoreRateAway: 0.2
  };
  // empiric = 0.64 → 64%. Poisson = 50%. blend = 50*0.85 + 64*0.15 = 42.5 + 9.6 = 52.1
  const out = blendBttsWithEmpirical(50, rates);
  assert.ok(Math.abs(out - 52.1) < 1e-9, `out=${out}`);
});

test("blendBttsWithEmpirical: clampează la [0,100]", () => {
  const rates = {
    cleanSheetRateHome: 1,
    cleanSheetRateAway: 1,
    failedToScoreRateHome: 0,
    failedToScoreRateAway: 0
  };
  const out = blendBttsWithEmpirical(100, rates);
  assert.ok(out >= 0 && out <= 100);
});

test("blendBttsWithEmpirical: fără date empirice → întoarce valoarea Poisson neschimbată (comportament identic azi)", () => {
  assert.equal(blendBttsWithEmpirical(47.3, {}), 47.3);
  assert.equal(blendBttsWithEmpirical(47.3, undefined), 47.3);
  assert.equal(
    blendBttsWithEmpirical(47.3, { cleanSheetRateHome: 0.2, cleanSheetRateAway: 0.3, failedToScoreRateHome: 0.1 }),
    47.3
  );
});
