import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyOuMarketName,
  expectedIdentityForKind,
  identityMatches,
  hasKnownIdentity,
  formatLineLabel
} from "../../../server-utils/marketIdentity.js";
import {
  listOverUnderLinesOffered,
  listOfferedOuMarkets,
  consensusOverUnderOddsAtLine
} from "../../../server-utils/marketOdds.js";
import {
  repriceCandidateLine,
  enumerateLineSelections
} from "../../../server-utils/pipeline/decision/repriceCandidateLine.js";
import { CORNERS_MARKET_NAMES } from "../../../server-utils/pipeline/modelFusion/resolveSideMarketQuotes.js";
import { buildValueCandidates } from "../../../server-utils/value/valueMarkets.js";
import { selectRecommendation } from "../../../server-utils/pipeline/decision/selectRecommendation.js";

/**
 * Market Identity Contract — end-to-end guarantees.
 *
 * The production case this guards (Aug 2026 audit): 1xBet quoted ONLY
 * "Home Corners Over/Under" (Over 3.5 @1.73). Discovery matched it for the
 * full-match corners market because the name contains "corners", and the
 * full-match λ (7.76) priced Over 3.5 at 94.9% — a fictitious edge that became
 * Recommended. Identity (betType/period/scope) now travels from the feed name
 * to the candidate, and a mismatch is a hard rejection, not a nearest fit.
 */

/* ----------------------------------------------------- classification (1-6) */

test("classification: full-match / half / team / non-total corner markets", () => {
  // 1. plain full-match O/U
  assert.deepEqual(classifyOuMarketName("Corners Over/Under"), {
    betType: "total",
    period: "full_match",
    scope: "match"
  });
  assert.deepEqual(classifyOuMarketName("Corners Over Under"), {
    betType: "total",
    period: "full_match",
    scope: "match"
  });
  // 2-3. team scopes
  assert.deepEqual(classifyOuMarketName("Home Corners Over/Under"), {
    betType: "total",
    period: "full_match",
    scope: "home"
  });
  assert.deepEqual(classifyOuMarketName("Away Corners Over/Under"), {
    betType: "total",
    period: "full_match",
    scope: "away"
  });
  // 4-5. halves
  assert.deepEqual(classifyOuMarketName("Total Corners (1st Half)"), {
    betType: "total",
    period: "first_half",
    scope: "match"
  });
  assert.deepEqual(classifyOuMarketName("Total Corners (2nd Half)"), {
    betType: "total",
    period: "second_half",
    scope: "match"
  });
  // 6. non-total structures never classify as "total"
  assert.equal(classifyOuMarketName("Corners 1x2").betType, "1x2");
  assert.equal(classifyOuMarketName("Total Corners (3 way)").betType, "total_3way");
  assert.equal(classifyOuMarketName("Corners Asian Handicap").betType, "handicap");
  assert.equal(classifyOuMarketName("Corners Race To").betType, "race_to");
  assert.equal(classifyOuMarketName("Corners. Odd/Even").betType, "odd_even");
  assert.equal(classifyOuMarketName("Multicorners").betType, "multi");
});

test("classification: undeterminable values stay unknown instead of being invented", () => {
  // Time-interval market: real period, but not one the model understands.
  const interval = classifyOuMarketName("Corners. total between 0 and 10m");
  assert.equal(interval.period, "unknown");
  // "team" without saying which team.
  assert.equal(classifyOuMarketName("Team Corners Over/Under").scope, "unknown");
  assert.deepEqual(classifyOuMarketName(""), {
    betType: "unknown",
    period: "unknown",
    scope: "unknown"
  });
});

test("identityMatches is strict — unknown never matches anything", () => {
  const full = { betType: "total", period: "full_match", scope: "match" };
  assert.equal(identityMatches(full, full), true);
  assert.equal(identityMatches({ ...full, period: "first_half" }, full), false);
  assert.equal(identityMatches({ ...full, scope: "home" }, full), false);
  assert.equal(identityMatches({ ...full, period: "unknown" }, full), false);
  assert.equal(identityMatches(null, full), false);
});

test("expectedIdentityForKind covers team and half kinds", () => {
  assert.equal(expectedIdentityForKind("corners").scope, "match");
  assert.equal(expectedIdentityForKind("shots_on_target_home").scope, "home");
  assert.equal(expectedIdentityForKind("shots_on_target_away").scope, "away");
  assert.equal(expectedIdentityForKind("first_half_goals").period, "first_half");
});

/* ------------------------------------------------ the real production board */

/**
 * Replica of fixture 1607181's corner board (audit case):
 *  - 1xBet has NO full-match corners O/U — only Home/Away Corners + Corners 1x2.
 *  - Superbet has the genuine full-match "Corners Over Under" board.
 */
function auditFeed() {
  return {
    response: [
      {
        bookmakers: [
          {
            name: "1xBet",
            bets: [
              { name: "Corners 1x2", values: [{ value: "Home", odd: "3.20" }] },
              {
                name: "Home Corners Over/Under",
                values: [
                  { value: "Over 3.5", odd: "1.73" },
                  { value: "Under 3.5", odd: "2.00" }
                ]
              },
              {
                name: "Away Corners Over/Under",
                values: [
                  { value: "Over 5.5", odd: "1.73" },
                  { value: "Under 5.5", odd: "2.00" }
                ]
              }
            ]
          },
          {
            name: "Superbet",
            bets: [
              {
                name: "Corners Over Under",
                values: [
                  { value: "Over 8.5", odd: "1.44" },
                  { value: "Under 8.5", odd: "2.65" },
                  { value: "Over 9.5", odd: "1.75" },
                  { value: "Under 9.5", odd: "2.02" },
                  { value: "Over 10.5", odd: "2.25" },
                  { value: "Under 10.5", odd: "1.60" }
                ]
              },
              {
                name: "Total Corners (1st Half)",
                values: [
                  { value: "Over 4.5", odd: "1.82" },
                  { value: "Under 4.5", odd: "1.88" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

/** Full-match corners block from the audit fixture (λ 3.12 + 4.64). */
function auditBlock() {
  return {
    total: { o7_5: 51.2, o8_5: 37.5, o9_5: 25.6, o10_5: 16.3, o11_5: 9.8, o12_5: 5.5 },
    lambdaHome: 3.12,
    lambdaAway: 4.64,
    correlation: 0.08
  };
}

test("AUDIT CASE: Home Corners 3.5 and 1st-half 4.5 never enter full-match discovery", () => {
  const lines = listOverUnderLinesOffered(auditFeed(), CORNERS_MARKET_NAMES, { kind: "corners" });
  assert.deepEqual(lines, [8.5, 9.5, 10.5], "only the genuine full-match board survives");
  assert.ok(!lines.includes(3.5), "1xBet's home-corners 3.5 is rejected");
  assert.ok(!lines.includes(5.5), "1xBet's away-corners 5.5 is rejected");
  assert.ok(!lines.includes(4.5), "Superbet's 1st-half 4.5 is rejected");
});

test("AUDIT CASE: descriptors keep marketName + bookmaker evidence and identity", () => {
  const descriptors = listOfferedOuMarkets(auditFeed(), CORNERS_MARKET_NAMES, { kind: "corners" });
  assert.equal(descriptors.length, 3);
  for (const d of descriptors) {
    assert.equal(d.betType, "total");
    assert.equal(d.period, "full_match");
    assert.equal(d.scope, "match");
    assert.deepEqual(d.marketNames, ["Corners Over Under"]);
    assert.deepEqual(d.bookmakers, ["Superbet"]);
    assert.ok(d.hasOver && d.hasUnder);
  }
});

test("AUDIT CASE: no candidate at 3.5; full-match candidates carry identity end-to-end", () => {
  const selections = enumerateLineSelections({
    oddsData: auditFeed(),
    marketNames: CORNERS_MARKET_NAMES,
    kind: "corners",
    block: auditBlock(),
    preferredLine: 9.5
  });
  assert.ok(selections.length > 0, "genuine full-match lines are still priced");
  assert.ok(
    selections.every((s) => s.bookLine !== 3.5 && s.bookLine !== 4.5 && s.bookLine !== 5.5),
    "no team/half line becomes a selection"
  );
  for (const s of selections) {
    assert.equal(s.period, "full_match");
    assert.equal(s.scope, "match");
    assert.equal(s.betType, "total");
    assert.equal(s.probabilityLine, s.bookLine, "line invariant still holds");
  }

  // ...and through buildValueCandidates into the Recommended pool.
  const candidates = buildValueCandidates({ probs: {}, cornersSelections: selections });
  assert.ok(candidates.length > 0);
  for (const c of candidates) {
    assert.equal(c.family, "Corners");
    assert.equal(c.period, "full_match");
    assert.equal(c.scope, "match");
  }
  assert.ok(
    !candidates.some((c) => c.type.includes("3.5")),
    "the fictitious 94.9% Over 3.5 candidate no longer exists"
  );
});

/* ------------------------------------------------- repricing guard (7-13) */

const FULL_MATCH = { betType: "total", period: "full_match", scope: "match" };
const blockWith = (lines) => ({ total: { ...lines }, lambdaHome: 0, lambdaAway: 0, correlation: 0 });

test("guard: a home-scoped quote can never price a full-match selection (cross_scope_quote)", () => {
  const out = repriceCandidateLine({
    block: blockWith({ o3_5: 94.9 }),
    side: "over",
    requestedLine: 3.5,
    quote: {
      line: 3.5,
      over: 1.73,
      under: 2.0,
      bookmakersUsed: 1,
      market: { betType: "total", period: "full_match", scope: "home" }
    },
    expectedMarket: FULL_MATCH
  });
  assert.equal(out.tradable, false);
  assert.equal(out.reason, "cross_scope_quote");
  assert.equal(out.odd, null, "no odd is carried on a refused quote");
});

test("guard: a first-half quote can never price a full-match selection (cross_period_quote)", () => {
  const out = repriceCandidateLine({
    block: blockWith({ o4_5: 88 }),
    side: "over",
    requestedLine: 4.5,
    quote: {
      line: 4.5,
      over: 1.82,
      under: 1.88,
      bookmakersUsed: 1,
      market: { betType: "total", period: "first_half", scope: "match" }
    },
    expectedMarket: FULL_MATCH
  });
  assert.equal(out.tradable, false);
  assert.equal(out.reason, "cross_period_quote");
});

test("guard: a different bet structure is cross_market_quote", () => {
  const out = repriceCandidateLine({
    block: blockWith({ o8_5: 60 }),
    side: "over",
    requestedLine: 8.5,
    quote: {
      line: 8.5,
      over: 1.4,
      under: 3.0,
      bookmakersUsed: 1,
      market: { betType: "total_3way", period: "full_match", scope: "match" }
    },
    expectedMarket: FULL_MATCH
  });
  assert.equal(out.tradable, false);
  assert.equal(out.reason, "cross_market_quote");
});

test("guard: unknown or missing identity is never tradable (12-13)", () => {
  const unknownPeriod = repriceCandidateLine({
    block: blockWith({ o8_5: 60 }),
    side: "over",
    requestedLine: 8.5,
    quote: {
      line: 8.5,
      over: 1.4,
      bookmakersUsed: 1,
      market: { betType: "total", period: "unknown", scope: "match" }
    },
    expectedMarket: FULL_MATCH
  });
  assert.equal(unknownPeriod.tradable, false);
  assert.equal(unknownPeriod.reason, "unknown_market_identity");

  const unknownScope = repriceCandidateLine({
    block: blockWith({ o8_5: 60 }),
    side: "over",
    requestedLine: 8.5,
    quote: {
      line: 8.5,
      over: 1.4,
      bookmakersUsed: 1,
      market: { betType: "total", period: "full_match", scope: "unknown" }
    },
    expectedMarket: FULL_MATCH
  });
  assert.equal(unknownScope.tradable, false);
  assert.equal(unknownScope.reason, "unknown_market_identity");

  const noIdentity = repriceCandidateLine({
    block: blockWith({ o8_5: 60 }),
    side: "over",
    requestedLine: 8.5,
    quote: { line: 8.5, over: 1.4, bookmakersUsed: 1 },
    expectedMarket: FULL_MATCH
  });
  assert.equal(noIdentity.tradable, false);
  assert.equal(noIdentity.reason, "unknown_market_identity");
});

test("guard: a matching identity remains tradable, with identity on the selection", () => {
  const out = repriceCandidateLine({
    block: blockWith({ o8_5: 60 }),
    side: "over",
    requestedLine: 8.5,
    quote: {
      line: 8.5,
      over: 1.4,
      under: 3.0,
      bookmakersUsed: 3,
      market: { ...FULL_MATCH }
    },
    expectedMarket: FULL_MATCH
  });
  assert.equal(out.tradable, true);
  assert.equal(out.period, "full_match");
  assert.equal(out.scope, "match");
  assert.equal(out.betType, "total");
});

test("SOT and shots-total names classify apart; consensus never crosses them (10-11)", () => {
  const feed = {
    response: [
      {
        bookmakers: [
          {
            name: "bet365",
            bets: [
              {
                name: "Total Shots",
                values: [
                  { value: "Over 22.5", odd: "1.10" },
                  { value: "Under 22.5", odd: "6.50" }
                ]
              },
              {
                name: "Total Shots on Target",
                values: [
                  { value: "Over 8.5", odd: "2.05" },
                  { value: "Under 8.5", odd: "1.78" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
  const shots = consensusOverUnderOddsAtLine(feed, ["Total Shots"], 22.5, { kind: "shots_total" });
  assert.equal(shots.over, 1.1);
  assert.deepEqual(shots.marketNames, ["Total Shots"]);
  const sot = consensusOverUnderOddsAtLine(feed, ["Total Shots on Target"], 8.5, {
    kind: "shots_on_target"
  });
  assert.equal(sot.over, 2.05);
  assert.deepEqual(sot.marketNames, ["Total Shots on Target"]);
  // Cross lookups find nothing rather than borrowing the other market's price:
  // the SOT line (8.5) does not exist on the shots-total board and vice versa,
  // and each kind's identity+name guards keep it on its own market.
  const sotLineOnTotals = consensusOverUnderOddsAtLine(feed, ["Total Shots"], 8.5, {
    kind: "shots_total"
  });
  assert.equal(sotLineOnTotals, null);
  const totalsLineOnSot = consensusOverUnderOddsAtLine(feed, ["Total Shots on Target"], 22.5, {
    kind: "shots_on_target"
  });
  assert.equal(totalsLineOnSot, null);
});

/* --------------------------------------------- quarter lines stay exact (14-15) */

test("10.25 stays 10.25 and 10.75 stays 10.75 — discovery, quote, candidate label", () => {
  assert.equal(formatLineLabel(10), "10");
  assert.equal(formatLineLabel(10.25), "10.25");
  assert.equal(formatLineLabel(10.5), "10.5");
  assert.equal(formatLineLabel(10.75), "10.75");

  const feed = {
    response: [
      {
        bookmakers: [
          {
            name: "1xBet",
            bets: [
              {
                name: "Corners Over Under",
                values: [
                  { value: "Over 10.25", odd: "2.47" },
                  { value: "Under 10.25", odd: "1.44" },
                  { value: "Over 10.75", odd: "2.60" },
                  { value: "Under 10.75", odd: "1.40" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
  const selections = enumerateLineSelections({
    oddsData: feed,
    marketNames: CORNERS_MARKET_NAMES,
    kind: "corners",
    block: { total: {}, lambdaHome: 6.93, lambdaAway: 1.63, correlation: 0.08 },
    preferredLine: null
  });
  const lines = [...new Set(selections.map((s) => s.bookLine))].sort((a, b) => a - b);
  assert.deepEqual(lines, [10.25, 10.75], "quarter lines survive numerically exact");

  const candidates = buildValueCandidates({ probs: {}, cornersSelections: selections });
  assert.ok(
    candidates.some((c) => c.type === "Under 10.25"),
    "label preserves 10.25 (was rendered as the nonexistent 10.3)"
  );
  assert.ok(!candidates.some((c) => /10\.3\b|10\.8\b/.test(c.type)), "no rounded ghost lines");
});

/* ------------------------------------- candidate pool + Recommended (20-22) */

const fullSelection = (over) => ({
  side: "over",
  requestedLine: 8.5,
  bookLine: 8.5,
  lineExact: true,
  probabilityLine: 8.5,
  probabilityPct: over,
  odd: 1.5,
  bookmakersUsed: 3,
  tradable: true,
  repriced: false,
  betType: "total",
  period: "full_match",
  scope: "match"
});

test("a selection without known identity never enters the candidate pool", () => {
  const noIdentity = { ...fullSelection(80) };
  delete noIdentity.period;
  delete noIdentity.scope;
  const unknownIdentity = { ...fullSelection(85), period: "unknown", scope: "unknown" };
  const candidates = buildValueCandidates({
    probs: {},
    cornersSelections: [noIdentity, unknownIdentity, fullSelection(75)]
  });
  assert.equal(candidates.length, 1, "only the identified selection survives");
  assert.equal(candidates[0].period, "full_match");
});

test("hasKnownIdentity mirrors the pool gate", () => {
  assert.equal(hasKnownIdentity(fullSelection(70)), true);
  assert.equal(hasKnownIdentity({ ...fullSelection(70), period: "unknown" }), false);
  assert.equal(hasKnownIdentity({}), false);
});

test("Recommended accepts a valid identified market and refuses an unknown one (20-21)", () => {
  // Valid identified corners selection wins on probability...
  const valid = selectRecommendation({
    p1Adj: 40,
    pXAdj: 30,
    p2Adj: 30,
    leagueMultiplier: 1,
    qualityPenalty: 1,
    cornersSelections: [fullSelection(90)],
    debug: true
  });
  assert.equal(valid.topSelection.family, "Corners");
  assert.equal(valid.recommendedQuote.period, "full_match");
  assert.equal(valid.recommendedQuote.scope, "match");

  // ...an unknown-identity candidate can never be Recommended, whatever its probability.
  // (It is stopped at the pool gate; the explicit selector gate also covers custom pools.)
  const invalid = selectRecommendation({
    p1Adj: 40,
    pXAdj: 30,
    p2Adj: 30,
    leagueMultiplier: 1,
    qualityPenalty: 1,
    cornersSelections: [{ ...fullSelection(99), period: "unknown", scope: "unknown" }],
    debug: true
  });
  assert.notEqual(invalid.topSelection.family, "Corners");
  assert.equal(invalid.diagnostics.gates.requiresKnownMarketIdentity, true);
});
