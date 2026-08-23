import test from "node:test";
import assert from "node:assert/strict";

import {
  getCardsLeagueBaseline,
  selectBaselineFixtures,
  priorMatchesForTeam,
  sidesForTeam,
  MIN_CARDS_BASELINE_SAMPLE
} from "../server-utils/analysis/cardsBaselineAnalysis.js";
import {
  deriveCardsLambdaCandidate,
  CARDS_LAMBDA_MIN,
  CARDS_LAMBDA_MAX
} from "../server-utils/analysis/deriveCardsLambdaCandidate.js";
import { aggregateRollingForTeam } from "../server-utils/teamMarketRolling.js";

/** A finished fixture with per-side card counts. */
const fx = (fixtureId, date, leagueId, season, homeTeamId, awayTeamId, hy, ay) => ({
  fixtureId,
  date,
  leagueId,
  season,
  homeTeamId,
  awayTeamId,
  homeSide: hy == null ? null : { yellow: hy, red: 0, count: hy, points: hy },
  awaySide: ay == null ? null : { yellow: ay, red: 0, count: ay, points: ay },
  cardsTotal: hy == null || ay == null ? null : hy + ay
});

/** N fixtures in one league/season, each with `total` cards, dated sequentially. */
function season(leagueId, seasonYear, count, total, startDay = 1) {
  return Array.from({ length: count }, (_, i) =>
    fx(
      i + 1 + leagueId * 1000,
      `2025-${String(Math.floor((startDay + i) / 28) + 1).padStart(2, "0")}-${String(((startDay + i) % 28) + 1).padStart(2, "0")}T15:00:00Z`,
      leagueId,
      seasonYear,
      100 + (i % 4),
      200 + (i % 4),
      total / 2,
      total / 2
    )
  );
}

/** A rolling row shaped like team_market_rolling, with enough samples to pass the gate. */
const rolling = (forAvg, againstAvg, n = 10) => ({
  cards_for_avg: forAvg,
  cards_against_avg: againstAvg,
  matches_sampled: n,
  samples_by_market: { cards: n, cards_home: Math.ceil(n / 2), cards_away: Math.floor(n / 2) }
});

// -------------------- baseline league/season --------------------

test("baseline: mean/median/sd/min/max si unitatea explicita", () => {
  const rows = [
    fx(1, "2025-08-01T15:00:00Z", 39, 2025, 1, 2, 1, 1),
    fx(2, "2025-08-02T15:00:00Z", 39, 2025, 3, 4, 2, 2),
    fx(3, "2025-08-03T15:00:00Z", 39, 2025, 5, 6, 3, 3)
  ];
  const b = getCardsLeagueBaseline(rows, { leagueId: 39, season: 2025, minSample: 1 });
  assert.equal(b.mean, 4);
  assert.equal(b.median, 4);
  assert.equal(b.min, 2);
  assert.equal(b.max, 6);
  assert.equal(b.sampleSize, 3);
  assert.equal(b.unit, "cardsTotal");
  assert.equal(b.source, "observed_fixtures");
});

test("baseline: set gol → null peste tot, nu 0", () => {
  const b = getCardsLeagueBaseline([], { leagueId: 39, season: 2025 });
  assert.equal(b.sampleSize, 0);
  assert.equal(b.mean, null);
  assert.equal(b.median, null);
  assert.equal(b.stdDev, null);
  assert.equal(b.sufficient, false);
});

// -------------------- season isolation --------------------

test("season isolation: sezoanele NU se amesteca", () => {
  const rows = [...season(39, 2025, 4, 4), ...season(39, 2024, 4, 10, 5)];
  const b25 = getCardsLeagueBaseline(rows, { leagueId: 39, season: 2025, minSample: 1 });
  const b24 = getCardsLeagueBaseline(rows, { leagueId: 39, season: 2024, minSample: 1 });
  assert.equal(b25.mean, 4);
  assert.equal(b24.mean, 10);
  assert.equal(b25.sampleSize, 4, "sezonul 2024 nu contribuie");
});

test("season isolation: ligile NU se amesteca", () => {
  const rows = [...season(39, 2025, 4, 4), ...season(140, 2025, 4, 8)];
  assert.equal(getCardsLeagueBaseline(rows, { leagueId: 39, season: 2025, minSample: 1 }).mean, 4);
  assert.equal(getCardsLeagueBaseline(rows, { leagueId: 140, season: 2025, minSample: 1 }).mean, 8);
});

// -------------------- no temporal leakage --------------------

test("no leakage: `before` este EXCLUSIV — fixture-ul prezis nu intra in propriul baseline", () => {
  const rows = [
    fx(1, "2025-08-01T15:00:00Z", 39, 2025, 1, 2, 1, 1),
    fx(2, "2025-08-02T15:00:00Z", 39, 2025, 3, 4, 1, 1),
    fx(3, "2025-08-03T15:00:00Z", 39, 2025, 5, 6, 50, 50)
  ];
  const b = getCardsLeagueBaseline(rows, {
    leagueId: 39,
    season: 2025,
    before: "2025-08-03T15:00:00Z",
    minSample: 1
  });
  assert.equal(b.sampleSize, 2, "outlier-ul propriu este exclus");
  assert.equal(b.mean, 2, "daca ar fi inclus, media ar fi 34.667");
});

test("no leakage: priorMatchesForTeam intoarce doar meciuri anterioare", () => {
  const rows = [
    fx(1, "2025-08-01T15:00:00Z", 39, 2025, 100, 200, 1, 3),
    fx(2, "2025-08-08T15:00:00Z", 39, 2025, 200, 100, 2, 4),
    fx(3, "2025-08-15T15:00:00Z", 39, 2025, 100, 300, 9, 9)
  ];
  const prior = priorMatchesForTeam(rows, 100, { before: "2025-08-15T15:00:00Z" });
  assert.equal(prior.length, 2);
  assert.deepEqual(prior.map((m) => m.fixtureId), [1, 2]);
});

test("no leakage: fereastra pastreaza cele mai RECENTE meciuri anterioare", () => {
  const rows = Array.from({ length: 8 }, (_, i) =>
    fx(i + 1, `2025-08-0${i + 1}T15:00:00Z`, 39, 2025, 100, 200 + i, i + 1, 1)
  );
  const prior = priorMatchesForTeam(rows, 100, { before: null, window: 3 });
  assert.deepEqual(prior.map((m) => m.fixtureId), [6, 7, 8]);
});

// -------------------- UNKNOWN / zero --------------------

test("UNKNOWN: un fixture fara cardsTotal nu intra in baseline", () => {
  const rows = [
    fx(1, "2025-08-01T15:00:00Z", 39, 2025, 1, 2, 2, 2),
    fx(2, "2025-08-02T15:00:00Z", 39, 2025, 3, 4, null, null),
    fx(3, "2025-08-03T15:00:00Z", 39, 2025, 5, 6, 3, 3)
  ];
  const b = getCardsLeagueBaseline(rows, { leagueId: 39, season: 2025, minSample: 1 });
  assert.equal(b.sampleSize, 2);
  assert.equal(b.mean, 5, "(4+6)/2");
  assert.notEqual(b.mean, 3.333, "daca UNKNOWN ar deveni 0");
});

test("zero real: un meci fara cartonase este observatie valida", () => {
  const rows = [
    fx(1, "2025-08-01T15:00:00Z", 39, 2025, 1, 2, 0, 0),
    fx(2, "2025-08-02T15:00:00Z", 39, 2025, 3, 4, 3, 3)
  ];
  const b = getCardsLeagueBaseline(rows, { leagueId: 39, season: 2025, minSample: 1 });
  assert.equal(b.sampleSize, 2);
  assert.equal(b.min, 0);
  assert.equal(b.mean, 3);
});

// -------------------- sample quality --------------------

test("sample quality: `sufficient` respecta pragul si il raporteaza", () => {
  const few = getCardsLeagueBaseline(season(39, 2025, 5, 4), { leagueId: 39, season: 2025 });
  assert.equal(few.sufficient, false);
  assert.equal(few.minSampleRequired, MIN_CARDS_BASELINE_SAMPLE);
  assert.equal(few.sampleSize, 5, "sample-ul ramane vizibil chiar si sub prag");

  const many = getCardsLeagueBaseline(season(39, 2025, MIN_CARDS_BASELINE_SAMPLE, 4), {
    leagueId: 39,
    season: 2025
  });
  assert.equal(many.sufficient, true);
});

// -------------------- team rolling reuse / home-away --------------------

test("team rolling: sidesForTeam produce forma pe care aggregateRollingForTeam o consuma", () => {
  const f = fx(1, "2025-08-01T15:00:00Z", 39, 2025, 100, 200, 2, 5);
  const asHome = sidesForTeam(f, 100);
  assert.equal(asHome.isHome, true);
  assert.equal(asHome.teamStats.yellowCards, 2);
  assert.equal(asHome.opponentStats.yellowCards, 5);
  const asAway = sidesForTeam(f, 200);
  assert.equal(asAway.isHome, false);
  assert.equal(asAway.teamStats.yellowCards, 5);
  assert.equal(sidesForTeam(f, 999), null, "o echipa care nu joaca acest meci");
});

test("team rolling: home si away raman separate prin agregarea existenta", () => {
  const rows = [
    fx(1, "2025-08-01T15:00:00Z", 39, 2025, 100, 200, 1, 4),
    fx(2, "2025-08-08T15:00:00Z", 39, 2025, 300, 100, 4, 5),
    fx(3, "2025-08-15T15:00:00Z", 39, 2025, 100, 400, 3, 2)
  ];
  const agg = aggregateRollingForTeam(priorMatchesForTeam(rows, 100, { before: null }));
  assert.equal(agg.cards_for_home_avg, 2, "(1+3)/2 acasa");
  assert.equal(agg.cards_for_away_avg, 5, "un meci in deplasare");
  assert.equal(agg.samples_by_market.cards_home, 2);
  assert.equal(agg.samples_by_market.cards_away, 1);
});

// -------------------- lambda candidate --------------------

const okBaseline = { mean: 4.3, sampleSize: 200, sufficient: true };

test("lambda candidat: echipe neutre → lambda in jurul baseline-ului", () => {
  const r = deriveCardsLambdaCandidate({
    baseline: okBaseline,
    rollingHome: rolling(2.15, 2.15),
    rollingAway: rolling(2.15, 2.15),
    teamSignalAlpha: 1
  });
  assert.ok(Math.abs(r.lambda - 4.3) < 0.15, `lambda=${r.lambda}`);
  assert.equal(r.outOfBounds, false);
  assert.equal(r.source, "candidate_v1");
  assert.equal(r.confidence, 0.8);
});

test("lambda candidat: opponent adjustment misca lambda in directia corecta", () => {
  const calm = deriveCardsLambdaCandidate({
    baseline: okBaseline,
    rollingHome: rolling(1.8, 1.8),
    rollingAway: rolling(1.8, 1.8),
    teamSignalAlpha: 1
  });
  const rough = deriveCardsLambdaCandidate({
    baseline: okBaseline,
    rollingHome: rolling(2.6, 2.6),
    rollingAway: rolling(2.6, 2.6),
    teamSignalAlpha: 1
  });
  assert.ok(calm.lambda < 4.3, `calm=${calm.lambda}`);
  assert.ok(rough.lambda > 4.3, `rough=${rough.lambda}`);
  assert.ok(rough.lambda > calm.lambda);
});

test("CONSTATARE: sanity gate-ul mostenit respinge meciuri legitim linistite", () => {
  // Gate-ul din #65 respinge orice λ_total < baseSide, adica sub JUMATATE din baseline.
  // Pragul a fost calibrat pentru cornere, unde forma multiplicativa nu coboara atat de
  // usor. La cartonase, doua echipe cu 1.4 cartonase/latura fata de un baseSide de 2.15
  // produc λ_total ≈ 1.83 < 2.15 — o valoare perfect plauzibila (3.7 cartonase pe meci
  // devine 1.83), respinsa ca "date otravite" si inlocuita cu baseline-ul.
  //
  // Nu este reparat aici: gate-ul traieste in deriveMarketLambdas, cod de productie
  // folosit de Corners si Shots, in afara scopului acestui increment. Testul exista ca
  // sa fixeze comportamentul observat si sa il aduca in discutia despre Increment F.
  const calm = deriveCardsLambdaCandidate({
    baseline: okBaseline,
    rollingHome: rolling(1.4, 1.4),
    rollingAway: rolling(1.4, 1.4)
  });
  assert.equal(calm.sampleQuality.fallbackReason, "sanity_gate");
  assert.ok(Math.abs(calm.lambda - 4.3) < 0.1, "revine la baseline in loc sa scada");
});

test("lambda candidat: baseline insuficient → refuz, nu ghicire", () => {
  const r = deriveCardsLambdaCandidate({
    baseline: { mean: 4.3, sampleSize: 5, sufficient: false },
    rollingHome: rolling(2, 2),
    rollingAway: rolling(2, 2)
  });
  assert.equal(r.lambda, null);
  assert.equal(r.reason, "baseline_sample_insufficient");
  assert.equal(r.confidence, 0);
});

test("lambda candidat: fara baseline → refuz", () => {
  assert.equal(deriveCardsLambdaCandidate({ baseline: null }).reason, "no_baseline");
  assert.equal(deriveCardsLambdaCandidate({ baseline: { mean: null } }).reason, "no_baseline");
  assert.equal(deriveCardsLambdaCandidate({}).lambda, null);
});

test("lambda candidat: fara rolling → cade pe baseline, cu confidence scazuta", () => {
  const r = deriveCardsLambdaCandidate({ baseline: okBaseline, rollingHome: null, rollingAway: null });
  assert.ok(Math.abs(r.lambda - 4.3) < 0.2, `lambda=${r.lambda}`);
  assert.equal(r.sampleQuality.usedFallback, true);
  assert.equal(r.confidence, 0.35);
});

test("lambda candidat: sample sub prag nu este tratat ca semnal", () => {
  const r = deriveCardsLambdaCandidate({
    baseline: okBaseline,
    rollingHome: rolling(6, 6, 1),
    rollingAway: rolling(6, 6, 1)
  });
  assert.equal(r.sampleQuality.usedFallback, true, "un singur meci nu poate muta lambda");
  assert.ok(Math.abs(r.lambda - 4.3) < 0.2);
});

// -------------------- extreme values / sanity --------------------

test("sanity: lambda este intotdeauna finit si pozitiv pe intrari plauzibile", () => {
  for (const v of [0.5, 1, 2, 4, 6]) {
    const r = deriveCardsLambdaCandidate({
      baseline: okBaseline,
      rollingHome: rolling(v, v),
      rollingAway: rolling(v, v)
    });
    assert.ok(Number.isFinite(r.lambda), `lambda nefinit pentru ${v}`);
    assert.ok(r.lambda > 0, `lambda <= 0 pentru ${v}`);
    assert.ok(!Number.isNaN(r.lambda));
  }
});

test("sanity: valorile extreme sunt RAPORTATE, nu ascunse printr-un clamp", () => {
  const r = deriveCardsLambdaCandidate({
    baseline: okBaseline,
    rollingHome: rolling(13.9, 13.9),
    rollingAway: rolling(13.9, 13.9)
  });
  if (r.outOfBounds) {
    assert.equal(r.confidence, 0, "un lambda implauzibil nu poate avea confidence");
    assert.equal(r.reason, "lambda_out_of_plausible_range");
    assert.ok(r.lambda != null, "valoarea reala este pastrata pentru diagnostic");
  } else {
    assert.ok(r.lambda >= CARDS_LAMBDA_MIN && r.lambda <= CARDS_LAMBDA_MAX);
  }
});

test("sanity: sanity gate-ul mostenit din #65 prinde rolling-ul otravit", () => {
  const r = deriveCardsLambdaCandidate({
    baseline: okBaseline,
    rollingHome: rolling(0.01, 0.01, 20),
    rollingAway: rolling(0.01, 0.01, 20)
  });
  assert.equal(r.sampleQuality.fallbackReason, "sanity_gate");
  assert.ok(Math.abs(r.lambda - 4.3) < 0.2, "cade inapoi pe baseline");
});

// -------------------- deterministic output --------------------

test("determinism: aceleasi intrari → acelasi rezultat", () => {
  const args = {
    baseline: okBaseline,
    rollingHome: rolling(2.4, 1.9),
    rollingAway: rolling(1.8, 2.6)
  };
  assert.deepEqual(deriveCardsLambdaCandidate(args), deriveCardsLambdaCandidate(args));
});

test("determinism: ordinea fixture-urilor nu schimba baseline-ul", () => {
  const rows = season(39, 2025, 12, 4);
  const a = getCardsLeagueBaseline(rows, { leagueId: 39, season: 2025, minSample: 1 });
  const b = getCardsLeagueBaseline([...rows].reverse(), { leagueId: 39, season: 2025, minSample: 1 });
  assert.deepEqual(b, a);
});

// -------------------- referee independence --------------------

test("REFEREE INDEPENDENCE: prezenta sau absenta refereeStats nu schimba lambda", () => {
  const args = {
    baseline: okBaseline,
    rollingHome: rolling(2.4, 1.9),
    rollingAway: rolling(1.8, 2.6)
  };
  const without = deriveCardsLambdaCandidate(args);
  const withCalm = deriveCardsLambdaCandidate({
    ...args,
    refereeStats: { cards: { avgCards: 1.2, sampleSize: 40, sufficient: true } }
  });
  const withStrict = deriveCardsLambdaCandidate({
    ...args,
    refereeStats: { cards: { avgCards: 9.9, sampleSize: 40, sufficient: true } }
  });
  assert.deepEqual(withCalm, without);
  assert.deepEqual(withStrict, without);
  assert.equal(withCalm.lambda, withStrict.lambda, "arbitrul este metadata, nu factor");
});

test("REFEREE INDEPENDENCE: nici forma legacy avgCards/cardsBoost nu are efect", () => {
  const args = { baseline: okBaseline, rollingHome: rolling(2, 2), rollingAway: rolling(2, 2) };
  const legacyShape = deriveCardsLambdaCandidate({
    ...args,
    refereeStats: { avgGoals: 2.7, avgCards: 8.0, cardsBoost: 1.12 }
  });
  assert.deepEqual(legacyShape, deriveCardsLambdaCandidate(args));
});

// -------------------- selectBaselineFixtures --------------------

test("selectBaselineFixtures: filtreaza pe liga, sezon, cutoff si UNKNOWN simultan", () => {
  const rows = [
    fx(1, "2025-08-01T15:00:00Z", 39, 2025, 1, 2, 2, 2),
    fx(2, "2025-08-02T15:00:00Z", 140, 2025, 1, 2, 2, 2),
    fx(3, "2025-08-03T15:00:00Z", 39, 2024, 1, 2, 2, 2),
    fx(4, "2025-08-04T15:00:00Z", 39, 2025, 1, 2, null, null),
    fx(5, "2025-09-01T15:00:00Z", 39, 2025, 1, 2, 2, 2)
  ];
  const kept = selectBaselineFixtures(rows, {
    leagueId: 39,
    season: 2025,
    before: "2025-08-31T00:00:00Z"
  });
  assert.deepEqual(kept.map((f) => f.fixtureId), [1]);
});
