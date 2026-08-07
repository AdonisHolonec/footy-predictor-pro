import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFixtureContext,
  impliedProbs1x2,
  resolveFavouritism,
  resolveMarketMove,
  resolveOddsBand,
  resolveSeasonPhase,
  seasonStartFor
} from "../../server-utils/metaLearning/MetaContextBuilder.js";

function historyRow(overrides = {}) {
  return {
    fixture_id: 1234567,
    league_id: 39,
    league_name: "Premier League",
    kickoff_at: "2026-08-05T18:00:00.000Z",
    recommended_pick: "1",
    recommended_confidence: 63.5,
    odds_home: 1.65,
    odds_draw: 3.9,
    odds_away: 5.2,
    match_status: "FT",
    score_home: 2,
    score_away: 1,
    validation: "win",
    raw_payload: { recommended: { pick: "1", family: "1X2", odd: 1.65, confidence: 63.5 } },
    ...overrides
  };
}

test("odds bands use half-open intervals so a boundary value lands in exactly one bucket", () => {
  assert.equal(resolveOddsBand(1.2), "<1.25");
  assert.equal(resolveOddsBand(1.25), "1.25-1.50");
  assert.equal(resolveOddsBand(1.5), "1.50-1.80");
  assert.equal(resolveOddsBand(1.8), "1.80-2.20");
  assert.equal(resolveOddsBand(2.2), "2.20+");
  assert.equal(resolveOddsBand(9.5), "2.20+");
});

test("odds band rejects non-prices instead of bucketing them", () => {
  assert.equal(resolveOddsBand(null), null);
  assert.equal(resolveOddsBand(0), null);
  assert.equal(resolveOddsBand(1), null);
  assert.equal(resolveOddsBand("not-a-number"), null);
});

test("implied probabilities are de-vigged to sum to 1", () => {
  const probs = impliedProbs1x2(1.65, 3.9, 5.2);
  assert.ok(probs);
  const sum = probs.home + probs.draw + probs.away;
  assert.ok(Math.abs(sum - 1) < 1e-9, `expected 1, got ${sum}`);
  assert.ok(probs.home > probs.draw && probs.draw > probs.away);
});

test("implied probabilities reject an incomplete or invalid odds triple", () => {
  assert.equal(impliedProbs1x2(1.65, 3.9, null), null);
  assert.equal(impliedProbs1x2(1.0, 3.9, 5.2), null);
});

test("favouritism classes span clear, moderate, balanced and outsider-led", () => {
  assert.equal(resolveFavouritism(1.4, 4.5, 7.0).favouritismClass, "clear_favourite");
  assert.equal(resolveFavouritism(1.4, 4.5, 7.0).favouriteSide, "home");

  const moderate = resolveFavouritism(1.95, 3.5, 3.9);
  assert.equal(moderate.favouritismClass, "moderate_favourite");

  const balanced = resolveFavouritism(2.7, 3.2, 2.75);
  assert.equal(balanced.favouritismClass, "balanced");

  // Away side is favourite: the class describes the match shape, the side names which.
  const awayFav = resolveFavouritism(7.0, 4.5, 1.4);
  assert.equal(awayFav.favouriteSide, "away");
  assert.equal(awayFav.favouritismClass, "clear_favourite");
});

test("season start honours the league's own calendar, not a hardcoded August", () => {
  // Premier League (39) starts in August.
  const epl = seasonStartFor("2026-08-05T18:00:00.000Z", 39);
  assert.equal(epl.getUTCMonth(), 7); // 0-based August
  assert.equal(epl.getUTCFullYear(), 2026);

  // MLS (253) is a calendar-year competition starting in February.
  const mls = seasonStartFor("2026-08-05T18:00:00.000Z", 253);
  assert.equal(mls.getUTCMonth(), 1); // February
  assert.equal(mls.getUTCFullYear(), 2026);
});

test("season phase differs between an August league and a calendar-year league on the same date", () => {
  const date = "2026-08-05T18:00:00.000Z";

  const epl = resolveSeasonPhase(date, 39);
  assert.equal(epl.seasonPhase, "early");
  assert.equal(epl.daysSinceSeasonStart, 4);

  // The whole point of per-league season starts: the same fixture date is mid-season for
  // MLS. Under a hardcoded August boundary this would wrongly read as "early".
  const mls = resolveSeasonPhase(date, 253);
  assert.equal(mls.seasonPhase, "mid");
  assert.ok(mls.daysSinceSeasonStart > 150);
});

test("a January fixture in an August-start league belongs to the previous season", () => {
  const { seasonPhase, daysSinceSeasonStart } = resolveSeasonPhase("2027-01-15T15:00:00.000Z", 39);
  assert.equal(seasonPhase, "mid");
  assert.ok(daysSinceSeasonStart > 150 && daysSinceSeasonStart < 210);
});

test("market move classifies a shortening price as moving toward our selection", () => {
  const row = historyRow({ odds_home: 2.0, closing_odds_home: 1.9 });
  const move = resolveMarketMove(row, "home");
  assert.equal(move.marketMoveClass, "toward");
  assert.ok(move.marketMovePct < 0);
});

test("market move classifies a drifting price as moving against us, and small moves as flat", () => {
  assert.equal(resolveMarketMove(historyRow({ odds_home: 2.0, closing_odds_home: 2.2 }), "home").marketMoveClass, "against");
  assert.equal(resolveMarketMove(historyRow({ odds_home: 2.0, closing_odds_home: 2.01 }), "home").marketMoveClass, "flat");
});

test("market move is 'unknown' when no closing price was captured, never 'flat'", () => {
  const row = historyRow({ closing_odds_home: null });
  const move = resolveMarketMove(row, "home");
  assert.equal(move.marketMoveClass, "unknown");
  assert.equal(move.marketMovePct, null);
});

test("buildFixtureContext projects the full context vector", () => {
  const ctx = buildFixtureContext(historyRow(), { modelVersion: "v3-test" });
  assert.ok(ctx);
  assert.equal(ctx.fixture_id, 1234567);
  assert.equal(ctx.model_version, "v3-test");
  assert.equal(ctx.league_tier, 1);
  assert.equal(ctx.league_quality, "Top 5");
  assert.equal(ctx.odds_band, "1.50-1.80");
  assert.equal(ctx.favourite_side, "home");
  assert.equal(ctx.pick_is_favourite, true);
  assert.equal(ctx.season_phase, "early");
  assert.equal(ctx.settled, true);
});

test("pick_is_favourite is null (not false) when our pick is not a 1X2 side", () => {
  const ctx = buildFixtureContext(
    historyRow({ recommended_pick: "GG", raw_payload: { recommended: { pick: "GG", family: "BTTS", odd: 1.8 } } }),
    { modelVersion: "v3-test" }
  );
  assert.equal(ctx.pick_is_favourite, null, "backing BTTS is not the same as backing the outsider");
  assert.equal(ctx.odds_band, "1.80-2.20");
});

test("an unknown league falls back to the default tier rather than throwing", () => {
  const ctx = buildFixtureContext(historyRow({ league_id: 999999, league_name: "Unknown" }), {
    modelVersion: "v3-test"
  });
  assert.equal(ctx.league_tier, 3);
  assert.equal(ctx.league_quality, "Rest");
});

test("buildFixtureContext rejects a row with no usable fixture id", () => {
  assert.equal(buildFixtureContext(null, {}), null);
  assert.equal(buildFixtureContext(historyRow({ fixture_id: 0 }), {}), null);
  assert.equal(buildFixtureContext(historyRow({ fixture_id: null }), {}), null);
});

test("a non-final match is not marked settled", () => {
  const ctx = buildFixtureContext(historyRow({ match_status: "NS", score_home: null, score_away: null }), {
    modelVersion: "v3-test"
  });
  assert.equal(ctx.settled, false);
});
