/**
 * Cards C1 — production λ port + rolling sample persistence.
 *
 * Every test here pins a behaviour the C1 PR claims: the production λ IS the validated
 * candidate (not a second model), cardsTotal is the unit, the referee has no effect,
 * sample counters survive persistence, fallbacks stay explicit, bounds reject rather than
 * clamp, and the decision layer keeps Cards OFF.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { deriveCardsLambda, buildCardsPricingBlock } from "../server-utils/pipeline/predictHelpers.js";
import {
  deriveCardsLambdaCandidate,
  CARDS_LAMBDA_MIN,
  CARDS_LAMBDA_MAX
} from "../server-utils/analysis/deriveCardsLambdaCandidate.js";
import {
  aggregateRollingForTeam,
  deriveMarketLambdas,
  buildRollingPersistPayload,
  normalizeSamplesByMarket,
  isMissingSamplesColumnError,
  SAMPLES_BY_MARKET_KEYS,
  MIN_MARKET_SAMPLES
} from "../server-utils/teamMarketRolling.js";
import { SETTLEABLE_VALUE_FAMILIES } from "../server-utils/value/valueMarkets.js";
import { SETTLEABLE_MARKET_FAMILIES } from "../server-utils/globalSpecialBetEngine.js";
import { cardsFromCounts } from "../server-utils/fixtureCardTotals.js";

/** A persisted-looking rolling row in cardsTotal units, with a real cards counter. */
const rolling = (forAvg, againstAvg, n = 10, extra = {}) => ({
  cards_for_avg: forAvg,
  cards_against_avg: againstAvg,
  matches_sampled: n,
  samples_by_market: { corners: n, cards: n, cards_home: Math.ceil(n / 2), cards_away: Math.floor(n / 2), sot: n, shots_total: n },
  ...extra
});

/** A league map with enough observed matches for the empirical baseline gate (≥ 40). */
function leagueMap(teamAvg, teams = 20, perTeam = 10) {
  const m = new Map();
  for (let i = 0; i < teams; i += 1) {
    m.set(100 + i, {
      team_id: 100 + i,
      league_id: 135,
      season: 2025,
      ...rolling(teamAvg, teamAvg, perTeam)
    });
  }
  return m;
}

const leagueParams = { cardsAvgTotal: 4.8, cards: 4.8, homeAdv: 1.06, awayAdv: 0.96 };

// ---------------------------------------------------------------- 1. port == candidate

test("1. production deriveCardsLambda equals the validated candidate on the same inputs", () => {
  const home = rolling(2.6, 2.2);
  const away = rolling(1.9, 2.4);
  const map = leagueMap(2.0);
  const prod = deriveCardsLambda({ leagueParams, rollingHome: home, rollingAway: away, marketRollingMap: map, leagueId: 135, season: 2025 });
  // Same baseline the production path resolves: empirical current season, 2 × team mean.
  const cand = deriveCardsLambdaCandidate({
    baseline: { mean: 4.0, sampleSize: 100, sufficient: true },
    rollingHome: home,
    rollingAway: away,
    homeAdv: 1.06,
    awayAdv: 0.96
  });
  assert.equal(prod.baseline.source, "empirical_current_season");
  assert.equal(prod.baseline.mean, 4.0);
  assert.equal(prod.lambda, cand.lambda);
  assert.equal(prod.lambdaHome, cand.components.lambdaHome);
  assert.equal(prod.lambdaAway, cand.components.lambdaAway);
  assert.equal(prod.confidence, cand.confidence);
  assert.equal(prod.source, "candidate_v1");
  assert.ok(Math.abs(prod.lambdaHome + prod.lambdaAway - prod.lambda) < 0.002, "two-sided: home + away = total");
});

test("1b. empirical baseline beats the static league constant when the league is observed", () => {
  // Serie A case from the audit: configured 4.8, observed ≈ 4.0.
  const prod = deriveCardsLambda({ leagueParams, marketRollingMap: leagueMap(2.0), leagueId: 135, season: 2025 });
  assert.equal(prod.baseline.mean, 4.0);
  assert.notEqual(prod.baseline.mean, 4.8);
  assert.ok(Math.abs(prod.lambda - 4.0) < 0.05);
});

// ---------------------------------------------------------------- 2–3. unit

test("2. cardsTotal is the canonical unit, stated on the output", () => {
  const out = deriveCardsLambda({ leagueParams });
  assert.equal(out.unit, "cardsTotal");
  const total = cardsFromCounts(3, 1);
  assert.equal(total.count, 4, "yellow + red");
  assert.equal(total.points, 5, "points is a different number and lives elsewhere");
});

test("3. cardsPoints is never substituted: points-only rows do not move λ", () => {
  const base = deriveCardsLambda({ leagueParams });
  const pointsOnly = {
    cards_points_for_avg: 9,
    cards_points_against_avg: 9,
    matches_sampled: 10,
    samples_by_market: { cards: 10 }
  };
  const out = deriveCardsLambda({ leagueParams, rollingHome: pointsOnly, rollingAway: pointsOnly });
  assert.equal(out.lambda, base.lambda);
  assert.equal(out.usedFallback, true);
  // And a row carrying BOTH units uses the count, not the points.
  const both = rolling(2.0, 2.0, 10, { cards_points_for_avg: 9, cards_points_against_avg: 9 });
  const fromCount = deriveCardsLambda({ leagueParams, rollingHome: both, rollingAway: both });
  const onlyCount = deriveCardsLambda({ leagueParams, rollingHome: rolling(2.0, 2.0), rollingAway: rolling(2.0, 2.0) });
  assert.equal(fromCount.lambda, onlyCount.lambda);
});

// ---------------------------------------------------------------- 4. referee

test("4. referee average / boost / stats have no effect on Cards λ", () => {
  const home = rolling(2.6, 2.2);
  const away = rolling(1.9, 2.4);
  const base = deriveCardsLambda({ leagueParams, rollingHome: home, rollingAway: away });
  const variants = [
    { modularScores: { referee: { detail: { avgCards: 7.5, cardsBoost: 1.12, home: 1.08 } } } },
    { modularScores: { referee: { details: { avgCards: 1.0, cardsBoost: 0.88 } } } },
    { refereeStats: { avgCards: 7.5, avgGoals: 3.2, cards: { avgCards: 7.5, sufficient: true } } },
    { cornersBlock: { expectedTotal: 14, lambdaTotal: 14 } }
  ];
  for (const v of variants) {
    const out = deriveCardsLambda({ leagueParams, rollingHome: home, rollingAway: away, ...v });
    assert.deepEqual(out, base, `variant ${Object.keys(v)[0]} must be inert`);
  }
});

// ---------------------------------------------------------------- 5–6. persistence

test("5. rolling Cards sample counts survive the persist payload (before N == after N)", () => {
  const matches = Array.from({ length: 7 }, (_, i) => ({
    fixtureId: i + 1,
    date: `2025-08-${String(i + 1).padStart(2, "0")}T15:00:00Z`,
    isHome: i % 2 === 0,
    teamStats: { corners: 5, sot: 4, shotsTotal: 10, yellowCards: 2, redCards: 0 },
    opponentStats: { corners: 4, sot: 3, shotsTotal: 9, yellowCards: 1, redCards: 1 }
  }));
  const agg = aggregateRollingForTeam(matches);
  assert.equal(agg.samples_by_market.cards, 7, "before upsert");
  const [row] = buildRollingPersistPayload([{ team_id: 1, league_id: 39, season: 2025, ...agg }], "2025-08-23T00:00:00.000Z");
  assert.equal(row.samples_by_market.cards, 7, "after upsert");
  assert.equal(row.samples_by_market.corners, 7, "other families preserved");
  assert.equal(row.samples_by_market.sot, 7);
  assert.equal(row.samples_by_market.shots_total, 7);
  assert.equal(row.matches_sampled, 7, "existing field untouched");
  assert.equal(row.cards_for_avg, 2, "cards_for_avg stays cardsTotal (2 yellow + 0 red)");
  assert.equal(row.cards_against_avg, 2, "1 yellow + 1 red = 2 cards, not 3 points");
  for (const k of Object.keys(row)) assert.ok(!k.startsWith("cards_points_"), `${k} has no column and must be stripped`);
  assert.equal(row.updated_at, "2025-08-23T00:00:00.000Z");
});

test("6. marketSampleCount reads the persisted Cards counter, and fails closed without it", () => {
  const withCounter = rolling(2.5, 2.5, 6);
  const live = deriveMarketLambdas({ rollingHome: withCounter, rollingAway: withCounter, baseAvgTotal: 4.2, marketKey: "cards" });
  assert.equal(live.sampleHome, 6);
  assert.equal(live.usedFallback, false);

  const pre058 = { cards_for_avg: 2.5, cards_against_avg: 2.5, matches_sampled: 6, samples_by_market: null };
  const legacy = deriveMarketLambdas({ rollingHome: pre058, rollingAway: pre058, baseAvgTotal: 4.2, marketKey: "cards" });
  assert.equal(legacy.sampleHome, 0, "no counter → unknown → 0, never borrowed from matches_sampled");
  assert.equal(legacy.usedFallback, true);
  assert.equal(legacy.fallbackReason, "insufficient_data");

  // Corners keep borrowing matches_sampled — their semantics are unchanged.
  const corners = deriveMarketLambdas({ rollingHome: { ...pre058, corners_for_avg: 5, corners_against_avg: 5 }, rollingAway: { ...pre058, corners_for_avg: 5, corners_against_avg: 5 }, baseAvgTotal: 10, marketKey: "corners" });
  assert.equal(corners.sampleHome, 6);
});

test("6b. normalizeSamplesByMarket writes integers or null — never zero for missing", () => {
  assert.equal(normalizeSamplesByMarket(null), null);
  assert.equal(normalizeSamplesByMarket("x"), null);
  const out = normalizeSamplesByMarket({ cards: "7", corners: 3.9, sot: undefined, junk: 5 });
  assert.deepEqual(Object.keys(out), [...SAMPLES_BY_MARKET_KEYS]);
  assert.equal(out.cards, 7);
  assert.equal(out.corners, 3);
  assert.equal(out.sot, null);
  assert.equal(out.cards_home, null);
  assert.equal("junk" in out, false);
});

test("6c. the deploy-before-migrate error is recognised, unrelated errors are not", () => {
  assert.equal(isMissingSamplesColumnError({ message: "Could not find the 'samples_by_market' column of 'team_market_rolling' in the schema cache" }), true);
  assert.equal(isMissingSamplesColumnError({ message: 'column "samples_by_market" does not exist' }), true);
  assert.equal(isMissingSamplesColumnError({ message: 'column "cards_for_avg" does not exist' }), false);
  assert.equal(isMissingSamplesColumnError({ message: "duplicate key value violates unique constraint" }), false);
  assert.equal(isMissingSamplesColumnError(null), false);
});

// ---------------------------------------------------------------- 7–8. fallbacks

test("7. insufficient-data path stays explicit: baseline split, usedFallback + reason", () => {
  const thin = rolling(9, 9, MIN_MARKET_SAMPLES - 1);
  const out = deriveCardsLambda({ leagueParams, rollingHome: thin, rollingAway: thin });
  assert.equal(out.usedFallback, true);
  assert.equal(out.fallbackReason, "insufficient_data");
  assert.equal(out.baseline.source, "static_config");
  assert.ok(Math.abs(out.lambda - 4.8) < 0.05, "league prior, not the 9-card thin average");
  assert.equal(out.confidence, 0.35);
});

test("8. fallback hierarchy: empirical current season → static prior → null (no manufactured λ)", () => {
  const thinLeague = leagueMap(2.0, 4, 3); // 4 teams × 3 = 12 team-obs = 6 matches < 40
  const a = deriveCardsLambda({ leagueParams, marketRollingMap: thinLeague, leagueId: 135, season: 2025 });
  assert.equal(a.baseline.source, "static_config", "under-sampled empirical falls through to the prior");
  assert.equal(a.baseline.mean, 4.8);

  const b = deriveCardsLambda({ leagueParams, marketRollingMap: leagueMap(2.0), leagueId: 135, season: 2025 });
  assert.equal(b.baseline.source, "empirical_current_season");

  const c = deriveCardsLambda({ leagueParams: {}, marketRollingMap: thinLeague, leagueId: 135, season: 2025 });
  assert.equal(c.lambda, null, "no baseline at all → no λ");
  assert.equal(c.lambdaHome, null);
  assert.equal(c.reason, "no_baseline");
  assert.equal(c.baseline.source, "unavailable");

  // Season isolation: rows from another season never feed this season's baseline.
  const otherSeason = new Map([...leagueMap(2.0).entries()].map(([k, v]) => [k, { ...v, season: 2024 }]));
  const d = deriveCardsLambda({ leagueParams, marketRollingMap: otherSeason, leagueId: 135, season: 2025 });
  assert.equal(d.baseline.source, "static_config");
});

// ---------------------------------------------------------------- 9. bounds

test("9. λ outside [CARDS_LAMBDA_MIN, CARDS_LAMBDA_MAX] is rejected, not clamped", () => {
  assert.equal(CARDS_LAMBDA_MIN, 1.0);
  assert.equal(CARDS_LAMBDA_MAX, 12.0);
  const wild = rolling(30, 30, 10);
  const out = deriveCardsLambda({ leagueParams, rollingHome: wild, rollingAway: wild });
  assert.equal(out.lambda, null);
  assert.equal(out.lambdaHome, null);
  assert.equal(out.reason, "lambda_out_of_plausible_range");
  assert.equal(out.confidence, 0);
  const sane = deriveCardsLambda({ leagueParams, rollingHome: rolling(2.4, 2.2), rollingAway: rolling(2.1, 2.5) });
  assert.ok(sane.lambda >= CARDS_LAMBDA_MIN && sane.lambda <= CARDS_LAMBDA_MAX);
});

// ---------------------------------------------------------------- 10. determinism

test("10. identical inputs give identical output; map order does not matter", () => {
  const home = rolling(2.6, 2.2);
  const away = rolling(1.9, 2.4);
  const map = leagueMap(2.1);
  const a = deriveCardsLambda({ leagueParams, rollingHome: home, rollingAway: away, marketRollingMap: map, leagueId: 135, season: 2025 });
  const b = deriveCardsLambda({ leagueParams, rollingHome: home, rollingAway: away, marketRollingMap: map, leagueId: 135, season: 2025 });
  const reversed = new Map([...map.entries()].reverse());
  const c = deriveCardsLambda({ leagueParams, rollingHome: home, rollingAway: away, marketRollingMap: reversed, leagueId: 135, season: 2025 });
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

// ---------------------------------------------------------------- 11. flag OFF

test("11. Cards remains OFF in the decision layer and refused by Global Special Bets", () => {
  assert.equal(SETTLEABLE_VALUE_FAMILIES.Cards, false);
  assert.equal(SETTLEABLE_MARKET_FAMILIES.has("cards"), false);
  assert.equal(SETTLEABLE_MARKET_FAMILIES.has("Cards"), false);
  assert.equal(String(process.env.PREDICT_ENABLE_CARDS || "").trim() === "1", false, "test env must not enable the probs.cards block");
});

// ---------------------------------------------------------------- 12. other markets

test("12. non-Cards market λ derivation is untouched by the Cards inputs", () => {
  const row = {
    corners_for_avg: 5.5, corners_against_avg: 4.5,
    sot_for_avg: 5, sot_against_avg: 4,
    shots_total_for_avg: 13, shots_total_against_avg: 11,
    matches_sampled: 8,
    samples_by_market: { corners: 8, cards: 0, cards_home: 0, cards_away: 0, sot: 8, shots_total: 8 }
  };
  const corners = deriveMarketLambdas({ rollingHome: row, rollingAway: row, baseAvgTotal: 10, marketKey: "corners" });
  const sot = deriveMarketLambdas({ rollingHome: row, rollingAway: row, baseAvgTotal: 9, marketKey: "sot" });
  const shots = deriveMarketLambdas({ rollingHome: row, rollingAway: row, baseAvgTotal: 24, marketKey: "shots_total" });
  for (const r of [corners, sot, shots]) {
    assert.equal(r.usedFallback, false);
    assert.equal(r.sampleHome, 8);
  }
  // Cards on the same row: counter is 0 → explicit fallback, and it does not touch corners.
  const cards = deriveMarketLambdas({ rollingHome: row, rollingAway: row, baseAvgTotal: 4.2, marketKey: "cards" });
  assert.equal(cards.fallbackReason, "insufficient_data");
  const expectedCorners = 5 * (5.5 / 5) * (4.5 / 5) * Math.sqrt(1.06) + 5 * (5.5 / 5) * (4.5 / 5) * Math.sqrt(0.96);
  assert.ok(Math.abs(corners.lambdaHome + corners.lambdaAway - expectedCorners) < 0.01);
});

// ---------------------------------------------------------------- 1c. Stage08 pricing block

test("1c. Stage08 prices from a two-sided block; a rejected λ yields no block", () => {
  const ok = deriveCardsLambda({ leagueParams, rollingHome: rolling(2.6, 2.2), rollingAway: rolling(1.9, 2.4) });
  const block = buildCardsPricingBlock(ok);
  assert.equal(block.lambdaHome, ok.lambdaHome);
  assert.equal(block.lambdaAway, ok.lambdaAway);
  assert.ok(block.lambdaAway > 0, "two-sided: the away λ is carried, not zeroed");
  assert.ok(Math.abs(block.lambdaHome + block.lambdaAway - ok.lambda) < 0.002);
  assert.equal(block.correlation, 0);
  assert.equal(block.unit, "cardsTotal");
  const rejected = deriveCardsLambda({ leagueParams, rollingHome: rolling(30, 30), rollingAway: rolling(30, 30) });
  assert.equal(buildCardsPricingBlock(rejected), null);
  assert.equal(buildCardsPricingBlock(null), null);
});
