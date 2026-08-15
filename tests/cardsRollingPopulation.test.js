import test from "node:test";
import assert from "node:assert/strict";

import { aggregateRollingForTeam, MIN_MARKET_SAMPLES } from "../server-utils/teamMarketRolling.js";
import { priorMatchesForTeam } from "../server-utils/analysis/cardsBaselineAnalysis.js";
import { parseSideCards, cardsFromCounts } from "../server-utils/fixtureCardTotals.js";
import { deriveCardsBaselineFromRolling } from "../server-utils/analysis/empiricalCardsBaseline.js";

/** Fixture with explicit per-side yellow/red, as the provider reports them. */
const fx = (fixtureId, date, homeTeamId, awayTeamId, hy, hr, ay, ar) => ({
  fixtureId,
  date,
  leagueId: 39,
  season: 2025,
  homeTeamId,
  awayTeamId,
  homeSide: hy == null ? null : cardsFromCounts(hy, hr),
  awaySide: ay == null ? null : cardsFromCounts(ay, ar),
  cardsTotal:
    hy == null || ay == null ? null : cardsFromCounts(hy, hr).count + cardsFromCounts(ay, ar).count
});

const day = (n) => `2025-08-${String(n).padStart(2, "0")}T15:00:00Z`;

// -------------------- 2. LEAKAGE PROTECTION --------------------

test("[leakage] un outlier extrem NU intra in propriul rolling", () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => fx(i + 1, day(i + 1), 100, 200 + i, 2, 0, 2, 0)),
    fx(99, day(20), 100, 300, 40, 0, 2, 0)
  ];
  const priorToOutlier = aggregateRollingForTeam(priorMatchesForTeam(rows, 100, { before: day(20) }));
  assert.equal(priorToOutlier.samples_by_market.cards, 5, "doar cele 5 meciuri anterioare");
  assert.equal(priorToOutlier.cards_for_avg, 2, "outlier-ul de 40 nu contribuie");
  assert.notEqual(priorToOutlier.cards_for_avg, 8.333, "media daca s-ar include (2*5+40)/6");

  const after = aggregateRollingForTeam(priorMatchesForTeam(rows, 100, { before: null }));
  assert.equal(after.samples_by_market.cards, 6);
  assert.equal(after.cards_for_avg, 8.333);
});

test("[leakage] un meci exact la ora cutoff este EXCLUS (comparatie stricta)", () => {
  const rows = [fx(1, day(1), 100, 200, 2, 0, 2, 0), fx(2, day(2), 100, 300, 9, 0, 9, 0)];
  const prior = priorMatchesForTeam(rows, 100, { before: day(2) });
  assert.equal(prior.length, 1);
  assert.equal(prior[0].fixtureId, 1);
});

test("[leakage] rolling-ul creste monoton pe masura ce meciurile se termina", () => {
  const rows = Array.from({ length: 6 }, (_, i) => fx(i + 1, day(i + 1), 100, 200 + i, 3, 0, 1, 0));
  const sizes = [1, 2, 3, 4, 5, 6].map((d) => priorMatchesForTeam(rows, 100, { before: day(d) }).length);
  assert.deepEqual(sizes, [0, 1, 2, 3, 4, 5], "fiecare predictie vede doar trecutul");
});

// -------------------- 3. UNKNOWN vs ZERO --------------------

test("[unknown] yellow null → meciul NU intra in rolling", () => {
  const rows = [
    fx(1, day(1), 100, 200, 3, 0, 1, 0),
    fx(2, day(2), 100, 300, null, null, null, null),
    fx(3, day(3), 100, 400, 5, 0, 1, 0)
  ];
  const agg = aggregateRollingForTeam(priorMatchesForTeam(rows, 100, { before: null }));
  assert.equal(agg.samples_by_market.cards, 2, "meciul UNKNOWN este exclus");
  assert.equal(agg.cards_for_avg, 4, "(3+5)/2");
  assert.notEqual(agg.cards_for_avg, 2.667, "media daca null ar deveni 0");
});

test("[unknown] yellow prezent + red null → red = 0 real, meciul intra", () => {
  const rows = [fx(1, day(1), 100, 200, 2, null, 3, null), fx(2, day(2), 100, 300, 4, null, 1, null)];
  const agg = aggregateRollingForTeam(priorMatchesForTeam(rows, 100, { before: null }));
  assert.equal(agg.samples_by_market.cards, 2);
  assert.equal(agg.cards_for_avg, 3, "(2+4)/2");
});

test("[unknown] 0 galbene explicit este observatie valida, nu absenta", () => {
  const rows = [fx(1, day(1), 100, 200, 0, 0, 2, 0), fx(2, day(2), 100, 300, 4, 0, 2, 0)];
  const agg = aggregateRollingForTeam(priorMatchesForTeam(rows, 100, { before: null }));
  assert.equal(agg.samples_by_market.cards, 2);
  assert.equal(agg.cards_for_avg, 2, "(0+4)/2");
});

test("[unknown] parserul folosit este fixtureCardTotals — o singura sursa de adevar", () => {
  const emptyBlock = [
    { type: "Corner Kicks", value: null },
    { type: "Yellow Cards", value: null },
    { type: "Red Cards", value: null }
  ];
  assert.equal(parseSideCards(emptyBlock), null);
  assert.equal(cardsFromCounts(null, null), null);
  assert.deepEqual(cardsFromCounts(2, null), { yellow: 2, red: 0, count: 2, points: 2 });
});

// -------------------- 4. UNIT: cardsTotal, not cardsPoints --------------------

test("[unitate] rolling-ul Cards foloseste cardsTotal, nu cardsPoints", () => {
  // 3 galbene + 1 rosu = 4 cartonase brute / 5 puncte ponderate.
  const rows = [fx(1, day(1), 100, 200, 3, 1, 1, 0), fx(2, day(2), 100, 300, 3, 1, 1, 0)];
  const agg = aggregateRollingForTeam(priorMatchesForTeam(rows, 100, { before: null }));
  assert.equal(agg.cards_for_avg, 4, "cardsTotal");
  assert.equal(agg.cards_points_for_avg, 5, "cardsPoints, pista separata");
  assert.notEqual(agg.cards_for_avg, agg.cards_points_for_avg);
});

test("[unitate] baseline-ul empiric consuma cards_for_avg (cardsTotal), nu punctele", () => {
  const rolling = [1, 2].map((id) => ({
    team_id: id,
    league_id: 39,
    season: 2025,
    cards_for_avg: 2.0,
    cards_points_for_avg: 9.9,
    samples_by_market: { cards: 40 }
  }));
  const b = deriveCardsBaselineFromRolling(rolling, { leagueId: 39, season: 2025 });
  assert.equal(b.cards_total_mean, 4, "2 x 2.0 — punctele de 9.9 nu au efect");
  assert.equal(b.unit, "cardsTotal");
});

// -------------------- 5. HOME / AWAY --------------------

test("[home/away] mediile si sample-urile raman separate", () => {
  const rows = [
    fx(1, day(1), 100, 200, 1, 0, 5, 0),
    fx(2, day(2), 100, 201, 3, 0, 5, 0),
    fx(3, day(3), 300, 100, 5, 0, 6, 0),
    fx(4, day(4), 301, 100, 5, 0, 4, 0)
  ];
  const agg = aggregateRollingForTeam(priorMatchesForTeam(rows, 100, { before: null }));
  assert.equal(agg.cards_for_home_avg, 2, "(1+3)/2");
  assert.equal(agg.cards_for_away_avg, 5, "(6+4)/2");
  assert.equal(agg.samples_by_market.cards_home, 2);
  assert.equal(agg.samples_by_market.cards_away, 2);
  assert.equal(agg.cards_for_avg, 3.5, "pooled = media tuturor celor 4, nu media mediilor");
});

test("[home/away] media home nu este presupusa egala cu away", () => {
  const rows = [fx(1, day(1), 100, 200, 1, 0, 1, 0), fx(2, day(2), 300, 100, 1, 0, 9, 0)];
  const agg = aggregateRollingForTeam(priorMatchesForTeam(rows, 100, { before: null }));
  assert.notEqual(agg.cards_for_home_avg, agg.cards_for_away_avg);
  assert.equal(agg.cards_for_home_avg, 1);
  assert.equal(agg.cards_for_away_avg, 9);
});

test("[home/away] latura 'against' pastreaza si ea separarea", () => {
  const rows = [fx(1, day(1), 100, 200, 2, 0, 7, 0), fx(2, day(2), 300, 100, 3, 0, 2, 0)];
  const agg = aggregateRollingForTeam(priorMatchesForTeam(rows, 100, { before: null }));
  assert.equal(agg.cards_against_home_avg, 7);
  assert.equal(agg.cards_against_away_avg, 3);
});

// -------------------- 7. SAMPLE GATE --------------------

test("[sample gate] pragul de rolling folosit de deriveMarketLambdas este MIN_MARKET_SAMPLES", () => {
  // Conventia REALA a team_market_rolling. Nu exista un prag de 30 pentru rolling —
  // MIN_SAMPLE=30 din Sprint1FeatureReport este pragul de RAPORTARE al backtestului.
  assert.equal(MIN_MARKET_SAMPLES, 4);
});

test("[sample gate] sample sub / la / peste prag este numarat corect", () => {
  const build = (n) =>
    aggregateRollingForTeam(
      priorMatchesForTeam(
        Array.from({ length: n }, (_, i) => fx(i + 1, day(i + 1), 100, 200 + i, 2, 0, 2, 0)),
        100,
        { before: null }
      )
    );
  assert.equal(build(3).samples_by_market.cards, 3);
  assert.equal(build(4).samples_by_market.cards, 4);
  assert.equal(build(5).samples_by_market.cards, 5);
  assert.ok(build(3).samples_by_market.cards < MIN_MARKET_SAMPLES);
  assert.ok(build(4).samples_by_market.cards >= MIN_MARKET_SAMPLES);
});

test("[sample gate] sample-ul perechii este min(for, against)", () => {
  const rows = [fx(1, day(1), 100, 200, 2, 0, 2, 0), fx(2, day(2), 100, 300, 2, 0, null, null)];
  const agg = aggregateRollingForTeam(priorMatchesForTeam(rows, 100, { before: null }));
  assert.equal(agg.samples_by_market.cards, 1);
});

// -------------------- coloane produse --------------------

test("[coloane] rolling-ul produce toate campurile Cards asteptate", () => {
  const rows = Array.from({ length: 6 }, (_, i) =>
    fx(i + 1, day(i + 1), i % 2 === 0 ? 100 : 200 + i, i % 2 === 0 ? 200 + i : 100, 2, 0, 3, 0)
  );
  const agg = aggregateRollingForTeam(priorMatchesForTeam(rows, 100, { before: null }));
  for (const k of [
    "cards_for_avg",
    "cards_against_avg",
    "cards_for_home_avg",
    "cards_against_home_avg",
    "cards_for_away_avg",
    "cards_against_away_avg"
  ]) {
    assert.ok(agg[k] != null, `${k} nu a fost populat`);
  }
  for (const k of ["cards", "cards_home", "cards_away"]) {
    assert.ok(agg.samples_by_market[k] > 0, `samples_by_market.${k} este 0`);
  }
});
