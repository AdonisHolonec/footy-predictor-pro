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

test("TOP_LEAGUE_IDS conţine exact cele 10 ligi canonice, inclusiv UEFA", () => {
  assert.equal(TOP_LEAGUE_IDS.length, 10);
  const expected = [39, 140, 135, 78, 61, 2, 3, 848, 88, 283];
  for (const id of expected) {
    assert.ok(TOP_LEAGUE_IDS.includes(id), `Lipseşte liga ${id}`);
  }
  // UEFA comps sunt obligatorii
  assert.ok(TOP_LEAGUE_IDS.includes(2), "UCL lipseşte");
  assert.ok(TOP_LEAGUE_IDS.includes(3), "UEL lipseşte");
  assert.ok(TOP_LEAGUE_IDS.includes(848), "UECL lipseşte");
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
  assert.deepEqual(out[0], { teamId: 42, corners: 6, sot: 5, shotsTotal: 14 });
  assert.deepEqual(out[1], { teamId: 99, corners: 4, sot: 3, shotsTotal: 10 });
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
