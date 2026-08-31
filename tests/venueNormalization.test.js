import assert from "node:assert/strict";
import { test } from "node:test";
import { combineLambdas } from "../server-utils/PredictionEngine/combine.js";
import { venueAverages } from "../server-utils/PredictionEngine/helpers.js";
import { calculate as attackCalculate } from "../server-utils/PredictionEngine/AttackStrength.js";
import { calculate as defenseCalculate } from "../server-utils/PredictionEngine/DefenseStrength.js";
import { DEFAULT_PREDICTION_WEIGHTS } from "../server-utils/PredictionEngine/weights.js";
import { computeMatchProbs, strengthRatingsLambdas } from "../server-utils/math.js";
import { syntheticLeagueAvgStats } from "../server-utils/pipeline/predictHelpers.js";

/**
 * Venue normalisation.
 *
 * `LeagueProfile.splitGoalAverages` defines leagueAvg as goalFrequency / 2 — the
 * venue-NEUTRAL per-team mean — while leagueAvgHome / leagueAvgAway are the
 * venue-specific scoring rates. Strength factors are built from venue-specific
 * statistics (gfHome, gaAway), so they must be normalised by the venue average that
 * matches them. Dividing by leagueAvg instead left leagueAvgHome/leagueAvg (~1.12 in
 * production) inside both the attack and the defence ratio, on top of the
 * leagueAvgHome baseline λ already starts from — venue counted three times per side.
 *
 * The contract these tests pin: for a team that is exactly league-average in every
 * respect, λ_home === leagueAvgHome and λ_away === leagueAvgAway, exactly.
 */

/** total goals per match split by homeShare, exactly as splitGoalAverages does. */
function league(total, homeShare) {
  const leagueAvgHome = total * homeShare;
  return { leagueAvg: total / 2, leagueAvgHome, leagueAvgAway: total - leagueAvgHome };
}
const LEAGUE = league(2.87, 0.559); // the production median: leagueAvgHome / leagueAvg ≈ 1.12

const neutral = { details: { home: 1, away: 1 } };
function coreFrom({ atkH, atkA, defH, defA, form = 1, homeAdv = 1.1, awayAdv = 0.92 }) {
  return {
    attack: { details: { atkH, atkA } },
    defense: { details: { defH, defA } },
    form: { details: { home: form, away: form } },
    homeAdvantage: { details: { homeAdv, awayAdv } },
    standings: neutral, h2h: neutral, referee: neutral, restDays: neutral, recentMatches: neutral,
    awayStrength: neutral, injuries: neutral, lineup: neutral, odds: neutral, motivation: neutral, weather: neutral
  };
}
/** A matchup where both sides are exactly league-average for their venue. */
function averageCore(L) {
  // a league-average away side concedes what HOME teams score, and vice versa
  return coreFrom({ atkH: L.leagueAvgHome, defA: L.leagueAvgHome, atkA: L.leagueAvgAway, defH: L.leagueAvgAway });
}
const ctxOf = (L, extra = {}) => ({ leagueParams: { ...L }, hStats: { played: 20 }, aStats: { played: 20 }, ...extra });

/* -- [1][2] attack: an exactly-average side scores factor 1.0 ------------------ */

test("[1] a home team on the exact home prior produces an attack factor of 1.0", () => {
  const ctx = ctxOf(LEAGUE, {
    hStats: { gfHome: LEAGUE.leagueAvgHome, gaHome: LEAGUE.leagueAvgAway, playedHome: 12 },
    aStats: { gfAway: LEAGUE.leagueAvgAway, gaAway: LEAGUE.leagueAvgHome, playedAway: 12 }
  });
  const a = attackCalculate(ctx);
  assert.ok(Math.abs(a.details.home - 1) < 1e-12, `home attack factor ${a.details.home}`);
  assert.ok(Math.abs(a.details.atkH - LEAGUE.leagueAvgHome) < 1e-12, "the shrunk rate is the prior itself");
});

test("[2] an away team on the exact away prior produces an attack factor of 1.0", () => {
  const ctx = ctxOf(LEAGUE, {
    hStats: { gfHome: LEAGUE.leagueAvgHome, gaHome: LEAGUE.leagueAvgAway, playedHome: 12 },
    aStats: { gfAway: LEAGUE.leagueAvgAway, gaAway: LEAGUE.leagueAvgHome, playedAway: 12 }
  });
  const a = attackCalculate(ctx);
  assert.ok(Math.abs(a.details.away - 1) < 1e-12, `away attack factor ${a.details.away}`);
});

/* -- [3] defence: the prior is the OPPOSITE side's scoring rate ---------------- */

test("[3] exactly-average defences produce a factor of 1.0 on both sides", () => {
  const ctx = ctxOf(LEAGUE, {
    // a home side concedes what away teams score; an away side concedes what home teams score
    hStats: { gfHome: LEAGUE.leagueAvgHome, gaHome: LEAGUE.leagueAvgAway, playedHome: 9 },
    aStats: { gfAway: LEAGUE.leagueAvgAway, gaAway: LEAGUE.leagueAvgHome, playedAway: 9 }
  });
  const d = defenseCalculate(ctx);
  assert.ok(Math.abs(d.details.home - 1) < 1e-12, `home defence factor ${d.details.home}`);
  assert.ok(Math.abs(d.details.away - 1) < 1e-12, `away defence factor ${d.details.away}`);
  assert.ok(Math.abs(d.details.defH - LEAGUE.leagueAvgAway) < 1e-12, "defH shrinks toward leagueAvgAway");
  assert.ok(Math.abs(d.details.defA - LEAGUE.leagueAvgHome) < 1e-12, "defA shrinks toward leagueAvgHome");
});

/* -- [4] the defect this fixes -------------------------------------------------- */

test("[4] the previous leagueAvg denominator violated the invariant by ~+25% / -22%", () => {
  const L = LEAGUE;
  const core = averageCore(L);
  const { lambdaHome, lambdaAway } = combineLambdas(ctxOf(L), core, DEFAULT_PREDICTION_WEIGHTS);
  // the OLD expression, recomputed here so the regression is pinned by arithmetic, not by code
  const w = DEFAULT_PREDICTION_WEIGHTS;
  const oldHome = L.leagueAvgHome * Math.pow(L.leagueAvgHome / L.leagueAvg, w.attack) * Math.pow(L.leagueAvgHome / L.leagueAvg, w.defense);
  const oldAway = L.leagueAvgAway * Math.pow(L.leagueAvgAway / L.leagueAvg, w.attack) * Math.pow(L.leagueAvgAway / L.leagueAvg, w.defense);
  assert.ok(oldHome / L.leagueAvgHome > 1.2, `old λ_home was ${(100 * (oldHome / L.leagueAvgHome - 1)).toFixed(1)}% high`);
  assert.ok(oldAway / L.leagueAvgAway < 0.8, `old λ_away was ${(100 * (1 - oldAway / L.leagueAvgAway)).toFixed(1)}% low`);
  assert.ok(Math.abs(lambdaHome - L.leagueAvgHome) < 1e-12, "current λ_home is exact");
  assert.ok(Math.abs(lambdaAway - L.leagueAvgAway) < 1e-12, "current λ_away is exact");
});

/* -- [5][6] one-sided and absent splits ---------------------------------------- */

test("[5] a one-sided split is ignored and behaves exactly like no split", () => {
  const core = coreFrom({ atkH: 1.7, defA: 1.4, atkA: 1.2, defH: 1.3 });
  const oneSided = combineLambdas({ leagueParams: { leagueAvg: 1.4, leagueAvgHome: 1.55 }, hStats: {}, aStats: {} }, core, DEFAULT_PREDICTION_WEIGHTS);
  const flat = combineLambdas({ leagueParams: { leagueAvg: 1.4 }, hStats: {}, aStats: {} }, core, DEFAULT_PREDICTION_WEIGHTS);
  assert.ok(Math.abs(oneSided.lambdaHome - flat.lambdaHome) < 1e-12);
  assert.ok(Math.abs(oneSided.lambdaAway - flat.lambdaAway) < 1e-12);
  assert.equal(venueAverages({ leagueParams: { leagueAvg: 1.4, leagueAvgHome: 1.55 } }).hasVenueSplit, false);
});

test("[6] with no venue split λ is byte-compatible with the previous expression", () => {
  const leagueAvg = 1.4;
  const core = coreFrom({ atkH: 1.7, defA: 1.4, atkA: 1.2, defH: 1.3, homeAdv: 1.15, awayAdv: 0.9 });
  const { lambdaHome, lambdaAway, strengthMeta } = combineLambdas({ leagueParams: { leagueAvg }, hStats: {}, aStats: {} }, core, DEFAULT_PREDICTION_WEIGHTS);
  const w = DEFAULT_PREDICTION_WEIGHTS;
  const expectHome = leagueAvg * Math.pow(1.7 / leagueAvg, w.attack) * Math.pow(1.4 / leagueAvg, w.defense) * Math.pow(1.15, w.homeAdvantage);
  const expectAway = leagueAvg * Math.pow(1.2 / leagueAvg, w.attack) * Math.pow(1.3 / leagueAvg, w.defense) * Math.pow(0.9, w.homeAdvantage);
  assert.ok(Math.abs(lambdaHome - expectHome) < 1e-12, `λ_home ${lambdaHome} vs ${expectHome}`);
  assert.ok(Math.abs(lambdaAway - expectAway) < 1e-12, `λ_away ${lambdaAway} vs ${expectAway}`);
  assert.equal(strengthMeta.homeAdvApplied, true, "the explicit factor still applies exactly once with no split");
});

/* -- [7] symmetry --------------------------------------------------------------- */

test("[7] a league with no venue effect (homeShare 0.5) is perfectly symmetric", () => {
  const L = league(2.8, 0.5);
  const core = averageCore(L);
  const { lambdaHome, lambdaAway } = combineLambdas(ctxOf(L), core, DEFAULT_PREDICTION_WEIGHTS);
  assert.ok(Math.abs(lambdaHome - lambdaAway) < 1e-12, "no venue effect means no venue asymmetry");
  assert.ok(Math.abs(lambdaHome - L.leagueAvg) < 1e-12);
});

/* -- [8][9] monotonicity -------------------------------------------------------- */

test("[8] a stronger home attack raises λ_home and leaves λ_away untouched", () => {
  const L = LEAGUE;
  const base = combineLambdas(ctxOf(L), averageCore(L), DEFAULT_PREDICTION_WEIGHTS);
  const strong = combineLambdas(ctxOf(L), coreFrom({ atkH: L.leagueAvgHome * 1.4, defA: L.leagueAvgHome, atkA: L.leagueAvgAway, defH: L.leagueAvgAway }), DEFAULT_PREDICTION_WEIGHTS);
  const weak = combineLambdas(ctxOf(L), coreFrom({ atkH: L.leagueAvgHome * 0.6, defA: L.leagueAvgHome, atkA: L.leagueAvgAway, defH: L.leagueAvgAway }), DEFAULT_PREDICTION_WEIGHTS);
  assert.ok(strong.lambdaHome > base.lambdaHome && base.lambdaHome > weak.lambdaHome);
  assert.ok(Math.abs(strong.lambdaAway - base.lambdaAway) < 1e-12, "the opponent's λ is unaffected");
});

test("[9] an opponent that concedes more raises λ_home monotonically", () => {
  const L = LEAGUE;
  const base = combineLambdas(ctxOf(L), averageCore(L), DEFAULT_PREDICTION_WEIGHTS);
  const leaky = combineLambdas(ctxOf(L), coreFrom({ atkH: L.leagueAvgHome, defA: L.leagueAvgHome * 1.4, atkA: L.leagueAvgAway, defH: L.leagueAvgAway }), DEFAULT_PREDICTION_WEIGHTS);
  const tight = combineLambdas(ctxOf(L), coreFrom({ atkH: L.leagueAvgHome, defA: L.leagueAvgHome * 0.6, atkA: L.leagueAvgAway, defH: L.leagueAvgAway }), DEFAULT_PREDICTION_WEIGHTS);
  assert.ok(leaky.lambdaHome > base.lambdaHome && base.lambdaHome > tight.lambdaHome);
});

/* -- [10] nothing outside the venue logic moved -------------------------------- */

test("[10] form, the optional block and xG scale λ exactly as before", () => {
  const L = LEAGUE;
  const w = DEFAULT_PREDICTION_WEIGHTS;
  const base = combineLambdas(ctxOf(L), averageCore(L), w);
  const formed = combineLambdas(ctxOf(L), { ...averageCore(L), form: { details: { home: 1.05, away: 1.05 } } }, w);
  assert.ok(Math.abs(formed.lambdaHome / base.lambdaHome - Math.pow(1.05, w.form)) < 1e-12, "form still enters as an exponent");

  const withH2h = combineLambdas(ctxOf(L), { ...averageCore(L), h2h: { details: { home: 1.2, away: 1 } } }, w);
  assert.ok(Math.abs(withH2h.lambdaHome / base.lambdaHome - (1 + w.modularBlend * w.h2h * 0.2)) < 1e-12, "the optional block is still additive × modularBlend");

  const xg = combineLambdas(ctxOf(L, { xgHome: 2.5, xgAway: 0.5 }), averageCore(L), w);
  assert.ok(Math.abs(xg.lambdaHome - (base.lambdaHome * (1 - w.expectedGoals) + 2.5 * w.expectedGoals)) < 1e-12, "the xG blend is still linear");
});

/* -- [11] PR #211 is preserved -------------------------------------------------- */

test("[11] with a venue split the explicit home-advantage factor stays an identity", () => {
  const L = LEAGUE;
  const withAdv = combineLambdas(ctxOf(L), coreFrom({ atkH: L.leagueAvgHome, defA: L.leagueAvgHome, atkA: L.leagueAvgAway, defH: L.leagueAvgAway, homeAdv: 1.2, awayAdv: 0.85 }), DEFAULT_PREDICTION_WEIGHTS);
  const noAdv = combineLambdas(ctxOf(L), coreFrom({ atkH: L.leagueAvgHome, defA: L.leagueAvgHome, atkA: L.leagueAvgAway, defH: L.leagueAvgAway, homeAdv: 1, awayAdv: 1 }), DEFAULT_PREDICTION_WEIGHTS);
  assert.ok(Math.abs(withAdv.lambdaHome - noAdv.lambdaHome) < 1e-12);
  assert.ok(Math.abs(withAdv.lambdaAway - noAdv.lambdaAway) < 1e-12);
  assert.equal(withAdv.strengthMeta.homeAdvApplied, false);
});

/* -- [12][13] the probability surface stays well formed ------------------------- */

test("[12][13] the 1X2 triple normalises and the side markets stay valid percentages", () => {
  for (const [total, share] of [[2.2, 0.48], [2.87, 0.559], [3.4, 0.62]]) {
    const L = league(total, share);
    const { lambdaHome, lambdaAway } = combineLambdas(ctxOf(L), averageCore(L), DEFAULT_PREDICTION_WEIGHTS);
    const p = computeMatchProbs(lambdaHome, lambdaAway, 1, { rho: -0.11 }).probs;
    assert.ok(Math.abs(p.p1 + p.pX + p.p2 - 100) < 1e-6, `1X2 normalises for homeShare ${share}`);
    for (const k of ["pO25", "pO15", "pU35", "pGG"]) {
      assert.ok(p[k] >= 0 && p[k] <= 100, `${k} stays a valid percentage`);
    }
    assert.ok(p.p1 > p.p2 || share <= 0.5, "a home-favoured split still favours the home side");
  }
});

/* -- [14] the invariant across the whole configured range ---------------------- */

test("[14] the average-team invariant holds exactly across the homeShare clamp range", () => {
  for (const share of [0.48, 0.5, 0.52, 0.559, 0.58, 0.62]) {
    for (const total of [1.9, 2.6, 2.87, 3.6]) {
      const L = league(total, share);
      const { lambdaHome, lambdaAway } = combineLambdas(ctxOf(L), averageCore(L), DEFAULT_PREDICTION_WEIGHTS);
      assert.ok(Math.abs(lambdaHome - L.leagueAvgHome) < 1e-12, `λ_home ${lambdaHome} vs ${L.leagueAvgHome} (total ${total}, share ${share})`);
      assert.ok(Math.abs(lambdaAway - L.leagueAvgAway) < 1e-12, `λ_away ${lambdaAway} vs ${L.leagueAvgAway} (total ${total}, share ${share})`);
    }
  }
});

test("venueAverages is the single owner of the split decision", () => {
  const both = venueAverages({ leagueParams: { leagueAvg: 1.4, leagueAvgHome: 1.55, leagueAvgAway: 1.25 } });
  assert.deepEqual(both, { leagueAvg: 1.4, leagueAvgHome: 1.55, leagueAvgAway: 1.25, hasVenueSplit: true });
  for (const params of [{ leagueAvg: 1.4 }, { leagueAvg: 1.4, leagueAvgHome: 1.55 }, { leagueAvg: 1.4, leagueAvgAway: 1.25 }, { leagueAvg: 1.4, leagueAvgHome: 0, leagueAvgAway: 1.25 }]) {
    const v = venueAverages({ leagueParams: params });
    assert.equal(v.hasVenueSplit, false, JSON.stringify(params));
    assert.equal(v.leagueAvgHome, 1.4);
    assert.equal(v.leagueAvgAway, 1.4);
  }
});

/* =============================================================================
 * strengthRatingsLambdas — the Stage03 fallback engine.
 *
 * Stage03 tries PredictionEngine.build first and falls back to
 * strengthRatingsLambdas when it throws or returns a non-finite λ. That fallback
 * carried the identical specification defect this file's [1]-[14] fixed for the
 * modular engine: venue-specific priors normalised by the venue-NEUTRAL leagueAvg,
 * with the two defence priors inverted. The tests below pin the same contract for
 * the fallback, so the two λ paths cannot drift apart again.
 * ========================================================================== */

/** options bag for strengthRatingsLambdas, built from the same league() helper. */
const optsOf = (L, extra = {}) => ({
  leagueAvgGoals: L.leagueAvg,
  leagueAvgHome: L.leagueAvgHome,
  leagueAvgAway: L.leagueAvgAway,
  homeAdv: 1.1,
  awayAdv: 0.92,
  shrinkageK: 6,
  homePlayed: 20,
  awayPlayed: 20,
  ...extra
});
/** Both sides exactly league-average for their venue: a home team scores
 *  leagueAvgHome and concedes leagueAvgAway; an away team is the mirror. */
const averageStats = (L) => ({
  h: { gfHome: L.leagueAvgHome, gaHome: L.leagueAvgAway, gfAway: L.leagueAvgAway, gaAway: L.leagueAvgHome, played: 20 },
  a: { gfHome: L.leagueAvgHome, gaHome: L.leagueAvgAway, gfAway: L.leagueAvgAway, gaAway: L.leagueAvgHome, played: 20 }
});

test("[15] fallback: an exactly average matchup reproduces the venue split exactly", () => {
  const { h, a } = averageStats(LEAGUE);
  const { lambdaHome, lambdaAway } = strengthRatingsLambdas(h, a, 1, 1, optsOf(LEAGUE));
  assert.ok(Math.abs(lambdaHome - LEAGUE.leagueAvgHome) < 1e-12, `λ_home ${lambdaHome} must equal leagueAvgHome ${LEAGUE.leagueAvgHome}`);
  assert.ok(Math.abs(lambdaAway - LEAGUE.leagueAvgAway) < 1e-12, `λ_away ${lambdaAway} must equal leagueAvgAway ${LEAGUE.leagueAvgAway}`);
  assert.ok(lambdaHome > lambdaAway, "home advantage survives exactly once, through the split");
});

test("[16] fallback: exactly-average attacks produce a factor of 1.0 on both sides", () => {
  const { h, a } = averageStats(LEAGUE);
  const { strengthMeta } = strengthRatingsLambdas(h, a, 1, 1, optsOf(LEAGUE));
  assert.ok(Math.abs(strengthMeta.atkH / LEAGUE.leagueAvgHome - 1) < 1e-12, "home attack factor is 1.0 on the exact home prior");
  assert.ok(Math.abs(strengthMeta.atkA / LEAGUE.leagueAvgAway - 1) < 1e-12, "away attack factor is 1.0 on the exact away prior");
});

test("[17] fallback: defence priors are the OPPOSITE venue's scoring rate", () => {
  const { h, a } = averageStats(LEAGUE);
  const { strengthMeta } = strengthRatingsLambdas(h, a, 1, 1, optsOf(LEAGUE));
  // gaHome is conceded by the HOME side, i.e. scored by AWAY teams -> leagueAvgAway.
  assert.ok(Math.abs(strengthMeta.defH / LEAGUE.leagueAvgAway - 1) < 1e-12, "home defence factor is 1.0 against leagueAvgAway");
  assert.ok(Math.abs(strengthMeta.defA / LEAGUE.leagueAvgHome - 1) < 1e-12, "away defence factor is 1.0 against leagueAvgHome");
  // Read the shrinkage prior back directly: with a single observation at the raw
  // floor the shrunk value is (1*eps + k*prior) / (1+k), which names the prior.
  const none = { gfHome: 0, gaHome: 0, gfAway: 0, gaAway: 0, played: 1 };
  const pri = strengthRatingsLambdas(none, none, 1, 1, optsOf(LEAGUE, { homePlayed: 1, awayPlayed: 1 })).strengthMeta;
  const eps = 0.28;
  assert.ok(Math.abs(pri.defH - (eps + 6 * LEAGUE.leagueAvgAway) / 7) < 1e-12, `defH must shrink toward leagueAvgAway, got ${pri.defH}`);
  assert.ok(Math.abs(pri.defA - (eps + 6 * LEAGUE.leagueAvgHome) / 7) < 1e-12, `defA must shrink toward leagueAvgHome, got ${pri.defA}`);
});

test("[18] fallback: the leagueAvg denominator violated the invariant by ~+28% / -25%", () => {
  const L = LEAGUE;
  const { h, a } = averageStats(L);
  const { lambdaHome, lambdaAway, strengthMeta } = strengthRatingsLambdas(h, a, 1, 1, optsOf(L));
  // Reconstruct the OLD expression from the reported factors: a venue-NEUTRAL
  // denominator on top of the venue-specific baseline. Pinned by arithmetic, so it
  // fails if defH/leagueAvgHome or defA/leagueAvgAway is ever reintroduced.
  const oldHome = L.leagueAvgHome * (strengthMeta.atkH / L.leagueAvg) * (strengthMeta.defA / L.leagueAvg);
  const oldAway = L.leagueAvgAway * (strengthMeta.atkA / L.leagueAvg) * (strengthMeta.defH / L.leagueAvg);
  assert.ok(oldHome / L.leagueAvgHome > 1.2, `old λ_home inflated ${((oldHome / L.leagueAvgHome - 1) * 100).toFixed(1)}%`);
  assert.ok(oldAway / L.leagueAvgAway < 0.8, `old λ_away deflated ${((1 - oldAway / L.leagueAvgAway) * 100).toFixed(1)}%`);
  assert.ok(Math.abs(lambdaHome - L.leagueAvgHome) < 1e-12 && Math.abs(lambdaAway - L.leagueAvgAway) < 1e-12,
    "the current expression is unbiased where the old one was not");
});

test("[19] fallback: a one-sided split is ignored and behaves exactly like no split", () => {
  const h = { gfHome: 1.7, gaHome: 1.2, gfAway: 1.3, gaAway: 1.4, played: 20 };
  const a = { gfHome: 1.4, gaHome: 1.3, gfAway: 1.2, gaAway: 1.5, played: 20 };
  const flat = { leagueAvgGoals: 1.4, homeAdv: 1.12, awayAdv: 0.9, shrinkageK: 6, homePlayed: 20, awayPlayed: 20 };
  const base = strengthRatingsLambdas(h, a, 1, 1, flat);
  for (const oneSided of [{ leagueAvgHome: 1.55 }, { leagueAvgAway: 1.25 }, { leagueAvgHome: 0, leagueAvgAway: 1.25 }]) {
    const r = strengthRatingsLambdas(h, a, 1, 1, { ...flat, ...oneSided });
    assert.ok(Math.abs(r.lambdaHome - base.lambdaHome) < 1e-12, `λ_home differs for ${JSON.stringify(oneSided)}`);
    assert.ok(Math.abs(r.lambdaAway - base.lambdaAway) < 1e-12, `λ_away differs for ${JSON.stringify(oneSided)}`);
    assert.equal(r.strengthMeta.homeAdvApplied, true);
    assert.equal(r.strengthMeta.leagueAvgHome, 1.4);
    assert.equal(r.strengthMeta.leagueAvgAway, 1.4);
  }
});

test("[20] fallback: with no venue split λ is byte-compatible with the previous expression", () => {
  const h = { gfHome: 1.7, gaHome: 1.2, gfAway: 1.3, gaAway: 1.4, played: 20 };
  const a = { gfHome: 1.4, gaHome: 1.3, gfAway: 1.2, gaAway: 1.5, played: 20 };
  const opts = { leagueAvgGoals: 1.4, homeAdv: 1.12, awayAdv: 0.9, shrinkageK: 6, homePlayed: 20, awayPlayed: 20 };
  const r = strengthRatingsLambdas(h, a, 1, 1, opts);
  const { atkH, atkA, defH, defA, leagueAvg } = r.strengthMeta;
  // Without a split every baseline collapses to leagueAvg, so the corrected form
  // reduces to the previous one term for term — independent recomputation.
  const prevHome = leagueAvg * (atkH / leagueAvg) * (defA / leagueAvg) * 1.12 * 1;
  const prevAway = leagueAvg * (atkA / leagueAvg) * (defH / leagueAvg) * 0.9 * 1;
  assert.ok(Math.abs(r.lambdaHome - prevHome) < 1e-12, `λ_home ${r.lambdaHome} vs previous ${prevHome}`);
  assert.ok(Math.abs(r.lambdaAway - prevAway) < 1e-12, `λ_away ${r.lambdaAway} vs previous ${prevAway}`);
  assert.equal(leagueAvg, 1.4);
});

test("[21] fallback: home advantage is an identity under a split and applies once without one", () => {
  const { h, a } = averageStats(LEAGUE);
  const withAdv = strengthRatingsLambdas(h, a, 1, 1, optsOf(LEAGUE, { homeAdv: 1.12, awayAdv: 0.9 }));
  const noAdv = strengthRatingsLambdas(h, a, 1, 1, optsOf(LEAGUE, { homeAdv: 1.0, awayAdv: 1.0 }));
  assert.ok(Math.abs(withAdv.lambdaHome - noAdv.lambdaHome) < 1e-12, "split: homeAdv must not scale λ again");
  assert.ok(Math.abs(withAdv.lambdaAway - noAdv.lambdaAway) < 1e-12);
  assert.equal(withAdv.strengthMeta.homeAdvApplied, false);
  const flat = { leagueAvgGoals: 1.4, shrinkageK: 6, homePlayed: 20, awayPlayed: 20 };
  const f1 = strengthRatingsLambdas(h, a, 1, 1, { ...flat, homeAdv: 1.12, awayAdv: 0.9 });
  const f0 = strengthRatingsLambdas(h, a, 1, 1, { ...flat, homeAdv: 1.0, awayAdv: 1.0 });
  assert.ok(Math.abs(f1.lambdaHome / f0.lambdaHome - 1.12) < 1e-9, "no split: the factor still applies exactly once");
  assert.ok(Math.abs(f1.lambdaAway / f0.lambdaAway - 0.9) < 1e-9);
  assert.equal(f1.strengthMeta.homeAdvApplied, true);
});

test("[22] fallback and modular combineLambdas agree on the core strength term", () => {
  // Identical venue data and identical strength factors must produce identical λ.
  // The fallback deliberately has no weight exponents, no optional modules and no
  // xG blend, so parity is asserted on the core term only, at default weights.
  for (const share of [0.5, 0.52, 0.559, 0.62]) {
    const L = league(2.87, share);
    const { h, a } = averageStats(L);
    const sr = strengthRatingsLambdas(h, a, 1, 1, optsOf(L));
    const { atkH, atkA, defH, defA } = sr.strengthMeta;
    const cl = combineLambdas(ctxOf(L), coreFrom({ atkH, atkA, defH, defA }), DEFAULT_PREDICTION_WEIGHTS);
    assert.ok(Math.abs(sr.lambdaHome - cl.lambdaHome) < 1e-12, `λ_home fallback ${sr.lambdaHome} vs modular ${cl.lambdaHome} (share ${share})`);
    assert.ok(Math.abs(sr.lambdaAway - cl.lambdaAway) < 1e-12, `λ_away fallback ${sr.lambdaAway} vs modular ${cl.lambdaAway} (share ${share})`);
    assert.equal(sr.strengthMeta.homeAdvApplied, cl.strengthMeta.homeAdvApplied);
  }
});

test("[23] fallback: the invariant holds exactly across the homeShare clamp range", () => {
  for (const share of [0.48, 0.5, 0.52, 0.559, 0.58, 0.62]) {
    for (const total of [1.9, 2.6, 2.87, 3.6]) {
      const L = league(total, share);
      const { h, a } = averageStats(L);
      for (const played of [6, 20, 1e6]) {
        const { lambdaHome, lambdaAway } = strengthRatingsLambdas(h, a, 1, 1, optsOf(L, { homePlayed: played, awayPlayed: played }));
        assert.ok(Math.abs(lambdaHome - L.leagueAvgHome) < 1e-12, `λ_home ${lambdaHome} vs ${L.leagueAvgHome} (total ${total}, share ${share}, n ${played})`);
        assert.ok(Math.abs(lambdaAway - L.leagueAvgAway) < 1e-12, `λ_away ${lambdaAway} vs ${L.leagueAvgAway} (total ${total}, share ${share}, n ${played})`);
      }
    }
  }
});

test("[24] syntheticLeagueAvgStats concedes at the opposite venue's scoring rate", () => {
  const L = league(2.87, 0.559);
  const s = syntheticLeagueAvgStats({ leagueAvg: L.leagueAvg, leagueAvgHome: L.leagueAvgHome, leagueAvgAway: L.leagueAvgAway });
  assert.ok(Math.abs(s.gfHome - L.leagueAvgHome) < 1e-12, "a home side scores leagueAvgHome");
  assert.ok(Math.abs(s.gaHome - L.leagueAvgAway) < 1e-12, "a home side concedes what AWAY teams score");
  assert.ok(Math.abs(s.gfAway - L.leagueAvgAway) < 1e-12, "an away side scores leagueAvgAway");
  assert.ok(Math.abs(s.gaAway - L.leagueAvgHome) < 1e-12, "an away side concedes what HOME teams score");
  // Fed through the fallback it must be exactly league-average, i.e. reproduce the split.
  const r = strengthRatingsLambdas(s, s, 1, 1, optsOf(L));
  assert.ok(Math.abs(r.lambdaHome - L.leagueAvgHome) < 1e-12, `synthetic λ_home ${r.lambdaHome} vs ${L.leagueAvgHome}`);
  assert.ok(Math.abs(r.lambdaAway - L.leagueAvgAway) < 1e-12, `synthetic λ_away ${r.lambdaAway} vs ${L.leagueAvgAway}`);
  // Unrelated synthetic fields are untouched.
  assert.equal(s.played, 0);
  assert.equal(s.playedHome, 0);
  assert.equal(s.playedAway, 0);
});

test("[25] fallback: 1X2 normalises and the over/under and BTTS markets stay valid", () => {
  for (const share of [0.5, 0.559, 0.62]) {
    const L = league(2.87, share);
    const { h, a } = averageStats(L);
    const { lambdaHome, lambdaAway } = strengthRatingsLambdas(h, a, 1, 1, optsOf(L));
    const p = computeMatchProbs(lambdaHome, lambdaAway, 1, { rho: -0.11 }).probs;
    assert.ok(Math.abs(p.p1 + p.pX + p.p2 - 100) < 1e-6, `1X2 must normalise (share ${share})`);
    for (const k of ["pO05", "pO15", "pO25", "pU35"]) {
      assert.ok(p[k] >= 0 && p[k] <= 100, `over/under ${k} stays a valid percentage`);
    }
    // Over-lines are nested events, so their probabilities must decrease monotonically.
    assert.ok(p.pO05 >= p.pO15 - 1e-9 && p.pO15 >= p.pO25 - 1e-9, `over-lines must be monotone: ${p.pO05} >= ${p.pO15} >= ${p.pO25}`);
    assert.ok(p.pGG >= 0 && p.pGG <= 100, "BTTS stays a valid percentage");
  }
});
