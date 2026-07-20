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
  poissonOverLine
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
import { extractStackerFeatures, applyStacker, softmax3 } from "../server-utils/mlStacker.js";
import { eloExpectedHomeScore, updateEloPair, eloProbabilities, eloKFactor } from "../server-utils/teamElo.js";
import { buildPredictionContributions } from "../server-utils/importance/PredictionContributions.js";
import { runModelLab, reconstructSources, blendModel, getModelById, MODEL_REGISTRY } from "../server-utils/modelLab/ModelLab.js";
import { runAutoSelection } from "../server-utils/modelLab/AutoModelSelection.js";
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
  runMonteCarloSimulation,
  DEFAULT_MONTE_CARLO_SIMS,
  ADAPTIVE_SIM_TIERS,
  estimateMonteCarloUncertainty,
  selectAdaptiveSimulations,
  resolveMonteCarloSimulations
} from "../server-utils/monteCarlo/MonteCarloEngine.js";
import {
  PREDICTOR_V2_VERSION,
  PIPELINE_STAGES,
  blendLambdasWithXg,
  buildXgSourceProbs,
  buildPipelineTrace
} from "../server-utils/pipeline/PredictorV2.js";
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

test("aggregateRollingForTeam tratează lista goală", () => {
  const r = aggregateRollingForTeam([]);
  assert.equal(r.matches_sampled, 0);
  assert.equal(r.corners_for_avg, null);
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
    cornersQuote: { pick: "Over 9.5 Corners", line: 9.5, odd: 1.95 },
    cornersProbPct: 56,
    cardsOdds: { over: 1.9, under: 1.9, line: 3.5 },
    cardsOverProbPct: 54,
    cardsUnderProbPct: 46
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

test("Monte Carlo runs 10000 sims and returns distributions + CI", () => {
  const pmf = buildMatchScorePmf(1.6, 1.1, { correlation: 0.12, rho: -0.11 });
  assert.ok(pmf.cells.length > 10);
  assert.ok(Math.abs(pmf.cells.reduce((s, c) => s + c.prob, 0) - 1) < 1e-6);

  const mc = runMonteCarloSimulation(1.6, 1.1, {
    simulations: DEFAULT_MONTE_CARLO_SIMS,
    fixtureId: 4242,
    correlation: 0.12,
    rho: -0.11
  });
  assert.equal(mc.simulations, 10_000);
  assert.equal(mc.adaptive?.enabled, false);
  assert.ok(mc.probabilityDistribution.p1 > 0);
  assert.ok(mc.probabilityDistribution.pX > 0);
  assert.ok(mc.probabilityDistribution.p2 > 0);
  const sum1x2 =
    mc.probabilityDistribution.p1 + mc.probabilityDistribution.pX + mc.probabilityDistribution.p2;
  assert.ok(Math.abs(sum1x2 - 100) < 0.5);
  assert.ok(mc.expectedGoalsDistribution.home.mean > 0);
  assert.ok(mc.expectedGoalsDistribution.away.mean > 0);
  assert.ok(mc.expectedGoalsDistribution.total.histogram.length >= 1);
  assert.ok(mc.mostLikelyScores.length >= 5);
  assert.ok(mc.goalDistribution.length >= 1);
  assert.ok(mc.confidenceInterval.totalGoals.high >= mc.confidenceInterval.totalGoals.low);
  assert.equal(mc.confidenceInterval.level, 0.95);
  assert.ok(mc.histogram.scores.length >= 5);
  assert.ok(mc.summary.mostLikelyScore);

  const mc2 = runMonteCarloSimulation(1.6, 1.1, {
    simulations: 10_000,
    fixtureId: 4242,
    correlation: 0.12,
    rho: -0.11
  });
  assert.equal(mc.summary.mostLikelyScore, mc2.summary.mostLikelyScore);
  assert.equal(mc.probabilityDistribution.p1, mc2.probabilityDistribution.p1);
});

test("Predictor V2 pipeline contract and xG λ blend", () => {
  assert.ok(PREDICTOR_V2_VERSION.startsWith("predictor-v2"));
  assert.ok(PIPELINE_STAGES.includes("fetch"));
  assert.ok(PIPELINE_STAGES.includes("predictionEngine"));
  assert.ok(PIPELINE_STAGES.includes("xg"));
  assert.ok(PIPELINE_STAGES.includes("calibration"));
  assert.ok(PIPELINE_STAGES.includes("featureImportance"));
  assert.equal(PIPELINE_STAGES[PIPELINE_STAGES.length - 1], "prediction");

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
  assert.equal(trace.version, PREDICTOR_V2_VERSION);
  assert.equal(trace.stages.xg.status, "ok");
  assert.ok(trace.summary.includes("xg:ok"));
});

test("Adaptive Monte Carlo maps uncertainty into 1k/3k/5k/10k/25k tiers", () => {
  assert.deepEqual([...ADAPTIVE_SIM_TIERS], [1000, 3000, 5000, 10000, 25000]);
  assert.equal(selectAdaptiveSimulations(0.1), 1000);
  assert.equal(selectAdaptiveSimulations(0.3), 3000);
  assert.equal(selectAdaptiveSimulations(0.5), 5000);
  assert.equal(selectAdaptiveSimulations(0.7), 10000);
  assert.equal(selectAdaptiveSimulations(0.9), 25000);

  // Blowout / low entropy → fewer sims
  const blowout = estimateMonteCarloUncertainty(3.2, 0.4, { correlation: 0.12, rho: -0.11 });
  const tight = estimateMonteCarloUncertainty(1.35, 1.3, { correlation: 0.12, rho: -0.11 });
  assert.ok(blowout.score < tight.score, `blowout ${blowout.score} should be < tight ${tight.score}`);

  const blowoutSims = resolveMonteCarloSimulations(3.2, 0.4, { correlation: 0.12, rho: -0.11 });
  const tightSims = resolveMonteCarloSimulations(1.35, 1.3, { correlation: 0.12, rho: -0.11 });
  assert.ok(blowoutSims.adaptive.enabled);
  assert.ok(tightSims.adaptive.enabled);
  assert.ok(blowoutSims.simulations <= tightSims.simulations);
  assert.ok(ADAPTIVE_SIM_TIERS.includes(blowoutSims.simulations));
  assert.ok(ADAPTIVE_SIM_TIERS.includes(tightSims.simulations));

  const adaptiveRun = runMonteCarloSimulation(1.35, 1.3, {
    fixtureId: 99,
    correlation: 0.12,
    rho: -0.11
  });
  assert.ok(adaptiveRun.adaptive?.enabled);
  assert.equal(adaptiveRun.simulations, adaptiveRun.adaptive.tier);
  assert.ok(ADAPTIVE_SIM_TIERS.includes(adaptiveRun.simulations));
  assert.equal(adaptiveRun.version, "mc-v2-adaptive");
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

test("UEFA stats fallback helpers pick domestic league and build averages from FT fixtures", async () => {
  const {
    pickDomesticLeagueId,
    buildStatsFromFinishedFixtures
  } = await import("../server-utils/pipeline/predictHelpers.js");

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
});
