import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateRollingForTeam,
  deriveMarketLambdas,
  MIN_MARKET_SAMPLES
} from "../server-utils/teamMarketRolling.js";
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

// -------------------- 8. DIMENSIONAL CONTRACT (MUST FIX #1) --------------------
//
// The Cards model is a ratio of a ratio: deriveMarketLambdas computes
//
//     lambda_home = (hAtk x aDef) / baseSide x sqrt(homeAdv),   baseSide = baseAvgTotal / 2
//
// so dimensionally [lambda] = [rolling]^2 / [baseline]. Lambda is only in cards when the
// rolling and the baseline share a unit. That requirement is invisible in the source —
// there is no unit in a variable name — and it is what went unnoticed from migration 038
// until the rolling switched to raw counts. These tests make it executable.

/** Symmetric league: every side of every match takes `y` yellows and `r` reds. */
function symmetricLeague({ matches, y, r }) {
  const rows = Array.from({ length: matches }, (_, i) =>
    fx(i + 1, day(i + 1), 100, 200 + i, y, r, y, r)
  );
  return aggregateRollingForTeam(priorMatchesForTeam(rows, 100, { before: null }));
}

test("[dimensional] rolling raw counts + baseline raw counts reproduce the match mean", () => {
  // 3 yellows + 1 red per side: 4 raw cards, 5 weighted points. Both sides alike, so the
  // observed match total is 8 cards (and would be 10 points).
  const agg = symmetricLeague({ matches: 6, y: 3, r: 1 });
  assert.equal(agg.cards_for_avg, 4, "per-side raw count");
  assert.equal(agg.cards_points_for_avg, 5, "per-side weighted points, separate track");

  const observedMatchTotalCards = 8;

  // With homeAdv = awayAdv = 1 the formula collapses to an identity: in a symmetric league
  // hAtk = aDef = m and baseSide = 2m/2 = m, so lambda_home = m*m/m = m and the total is 2m.
  // The total must therefore come back as the observed match total, in cards.
  const r = deriveMarketLambdas({
    rollingHome: agg,
    rollingAway: agg,
    baseAvgTotal: observedMatchTotalCards,
    marketKey: "cards",
    homeAdv: 1,
    awayAdv: 1
  });
  assert.equal(r.usedFallback, false, "6 card observations clear the gate");
  assert.equal(
    r.lambdaHome + r.lambdaAway,
    observedMatchTotalCards,
    "lambda total equals the observed cards per match"
  );
});

test("[dimensional] feeding weighted points into a raw-count baseline is DETECTABLE", () => {
  // The same matches, but the rolling is taken from the points track while the baseline
  // stays in cards — precisely the pre-#73 pairing. The result is not the cards total, not
  // the points total, but an inflated number with no unit at all: points^2 / cards.
  const agg = symmetricLeague({ matches: 6, y: 3, r: 1 });
  const asPoints = {
    cards_for_avg: agg.cards_points_for_avg,
    cards_against_avg: agg.cards_points_against_avg,
    samples_by_market: agg.samples_by_market
  };

  const wrong = deriveMarketLambdas({
    rollingHome: asPoints,
    rollingAway: asPoints,
    baseAvgTotal: 8,
    marketKey: "cards",
    homeAdv: 1,
    awayAdv: 1
  });
  const wrongTotal = wrong.lambdaHome + wrong.lambdaAway;

  // 5*5/4 per side = 6.25, so 12.5 total: neither 8 cards nor 10 points.
  assert.equal(wrongTotal, 12.5);
  assert.notEqual(wrongTotal, 8, "not the cards total");
  assert.notEqual(wrongTotal, 10, "not the points total either — the mix has no unit");
  // The inflation factor is exactly (points/cards)^2 = (5/4)^2 = 1.5625.
  assert.equal(wrongTotal / 8, (5 / 4) ** 2);
});

test("[dimensional] the baseline derived from the same fixtures is in raw counts", () => {
  // Closes the loop: the baseline the model divides by is produced from cards_for_avg, so
  // it inherits the rolling unit. If the rolling ever returned to points this baseline
  // would silently follow, and the ratio would look self-consistent while being wrong.
  const agg = symmetricLeague({ matches: 6, y: 3, r: 1 });
  const b = deriveCardsBaselineFromRolling(
    [
      { team_id: 1, league_id: 39, season: 2025, ...agg },
      { team_id: 2, league_id: 39, season: 2025, ...agg }
    ],
    { leagueId: 39, season: 2025 }
  );
  assert.equal(b.unit, "cardsTotal");
  assert.equal(b.cards_total_mean, 8, "2 x 4 raw cards per side");
  assert.notEqual(b.cards_total_mean, 10, "not 2 x 5 weighted points");
});

// -------------------- 9. CARDS SAMPLE GATE (MUST FIX #3) --------------------
//
// matches_sampled is the MAXIMUM across market families. Using it as the cards sample count
// lets corners evidence open the cards gate: a team seen ten times for corners and never
// for cards would be treated as having ten card observations. Cards now answer only to
// their own counter, and an absent counter reads as zero rather than as "however many
// matches we happen to have".

/** Persisted row shape: team_market_rolling has no samples_by_market column. */
const persistedRow = (extra = {}) => ({
  cards_for_avg: 2,
  cards_against_avg: 2,
  corners_for_avg: 5,
  corners_against_avg: 5,
  matches_sampled: 10,
  ...extra
});

const cardsLambdaFor = (row) =>
  deriveMarketLambdas({
    rollingHome: row,
    rollingAway: row,
    baseAvgTotal: 4,
    marketKey: "cards",
    homeAdv: 1,
    awayAdv: 1
  });

test("[cards gate] 10 matches, 10 corners, 0 cards leaves the cards sample at 0 and fails", () => {
  const row = persistedRow({ samples_by_market: { corners: 10, cards: 0 } });
  const r = cardsLambdaFor(row);
  assert.equal(r.sampleHome, 0, "corners evidence must not answer for cards");
  assert.equal(r.usedFallback, true);
  assert.equal(r.fallbackReason, "insufficient_data");
});

test("[cards gate] a persisted row with no cards counter fails CLOSED", () => {
  // The row a production read actually returns: matches_sampled and nothing per-family.
  // Unknown is not a satisfied threshold, so the league prior is used instead of a rolling
  // nobody can vouch for.
  const r = cardsLambdaFor(persistedRow());
  assert.equal(r.sampleHome, 0, "unknown cards sample counts as none");
  assert.equal(r.usedFallback, true);
  assert.equal(r.fallbackReason, "insufficient_data");
});

test("[cards gate] 3 cards observations is below MIN_MARKET_SAMPLES and is rejected", () => {
  const r = cardsLambdaFor(persistedRow({ samples_by_market: { cards: 3 } }));
  assert.equal(r.sampleHome, 3, "counted exactly, not raised to matches_sampled");
  assert.ok(3 < MIN_MARKET_SAMPLES);
  assert.equal(r.usedFallback, true);
});

test("[cards gate] 4 cards observations meets MIN_MARKET_SAMPLES and passes", () => {
  const r = cardsLambdaFor(persistedRow({ samples_by_market: { cards: 4 } }));
  assert.equal(r.sampleHome, 4);
  assert.ok(4 >= MIN_MARKET_SAMPLES);
  assert.equal(r.usedFallback, false);
});

test("[cards gate] other markets keep using matches_sampled — corners is untouched", () => {
  // The same row that fails the cards gate passes the corners gate on the same data. That
  // is the whole point: the change is scoped to cards, not a global tightening.
  const row = persistedRow();
  const corners = deriveMarketLambdas({
    rollingHome: row,
    rollingAway: row,
    baseAvgTotal: 10,
    marketKey: "corners",
    homeAdv: 1,
    awayAdv: 1
  });
  assert.equal(corners.sampleHome, 10, "corners still fall back to matches_sampled");
  assert.equal(corners.usedFallback, false);
  assert.equal(cardsLambdaFor(row).usedFallback, true, "cards on the very same row do not");
});

test("[cards gate] MISSING cards do not count, but a real ZERO-card match does", () => {
  // The distinction the whole Cards foundation rests on, asserted at the aggregation level:
  // a provider block with null yellows is an absent observation; a genuine 0/0 match is a
  // present one whose value happens to be zero.
  const match = (yellow, red) => ({
    isHome: true,
    date: day(1),
    fixtureId: 1,
    teamStats: { yellowCards: yellow, redCards: red, corners: 5 },
    opponentStats: { yellowCards: yellow, redCards: red, corners: 5 }
  });

  const missing = aggregateRollingForTeam([match(null, null), match(null, null)]);
  assert.equal(missing.samples_by_market.cards, 0, "null yellows are not observations");
  assert.equal(missing.cards_for_avg, null, "and produce no average at all");

  const realZeros = aggregateRollingForTeam([match(0, 0), match(0, 0)]);
  assert.equal(realZeros.samples_by_market.cards, 2, "zero cards IS an observation");
  assert.equal(realZeros.cards_for_avg, 0, "and its value is a real zero");

  // Corners were present in both cases, which is exactly the trap the gate now avoids.
  assert.equal(missing.samples_by_market.corners, 2);
});
