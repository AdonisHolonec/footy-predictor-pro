import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEAGUE_SPREAD_MAX_PP,
  MAX_MODEL_EDGE,
  MIN_SELECTION_ODD,
  PROB_FLOOR,
  buildGlobalSpecialBets,
  collectGlobalCandidates,
  diversifyGlobalCandidates,
  rankGlobalCandidates
} from "../server-utils/globalSpecialBetEngine.js";

/**
 * Global Special Bet engine — the behaviours the selection layer guarantees.
 *
 * Rewritten for the probability-first contract (approved Aug 2026): GSB is a
 * best-CHANCE accumulator. The safety-contract scenarios A–N from the approval
 * live here, alongside the hard-filter and snapshot regressions carried over
 * from the valueScore era — those rules did not change, only the ranking did.
 */

const NOW = Date.parse("2026-08-09T10:00:00.000Z");
const KICKOFF = "2026-08-09T18:00:00.000Z";
const PAST = "2026-08-09T08:00:00.000Z";

function fixture(id, leagueId, markets, overrides = {}) {
  return {
    id,
    leagueId,
    kickoff: KICKOFF,
    teams: { home: `Home ${id}`, away: `Away ${id}` },
    recommended: { pick: "Over 2.5", family: "Goals", confidence: 80 },
    modelMeta: { dataQuality: 0.8 },
    valueEngine: { markets },
    ...overrides
  };
}

/** A market that passes every safety gate, so tests only vary what they mean to. */
function goodMarket(overrides = {}) {
  return {
    type: "Over 2.5",
    family: "Goals",
    line: 2.5,
    odds: 1.9,
    probability: 0.7,
    valueScore: 60,
    recommendable: true,
    tradable: true,
    betType: "over_under",
    period: "full_match",
    scope: "match",
    ...overrides
  };
}

const poolOf = (count) =>
  Array.from({ length: count }, (_, i) =>
    fixture(i + 1, 39 + (i % 3), [goodMarket({ probability: 0.9 - i * 0.005, odds: 1.5 })])
  );

// ── hard filters reject rather than default ────────────────────────────────

test("an odd below the floor is rejected even at high probability (scenario B)", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ odds: 1.2, probability: 0.9 })], {
      recommended: { pick: "1", family: "1X2", confidence: 95 }
    })
  ];

  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(candidates.length, 0);
  assert.equal(rejected.oddBelowMinimum, 1);
});

test("the odds floor is inclusive", () => {
  const rows = [fixture(1, 39, [goodMarket({ odds: MIN_SELECTION_ODD })])];
  assert.equal(collectGlobalCandidates({ rows, leagueIds: [39], now: NOW }).candidates.length, 1);
});

test("a market the engine does not recommend is rejected", () => {
  const rows = [fixture(1, 39, [goodMarket({ recommendable: false })])];
  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(candidates.length, 0);
  assert.equal(rejected.notRecommendable, 1);
});

test("missing odds, value score, probability, confidence or data quality all disqualify", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ odds: null })]),
    fixture(2, 39, [goodMarket({ valueScore: null })]),
    fixture(3, 39, [goodMarket({ probability: null })]),
    fixture(4, 39, [goodMarket()], { recommended: { pick: "x", confidence: null } }),
    fixture(5, 39, [goodMarket()], { modelMeta: {} })
  ];

  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(candidates.length, 0);
  assert.equal(rejected.missingData, 5);
});

test("a probability outside (0, 1] is a data defect, not a candidate", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0 })]),
    fixture(2, 39, [goodMarket({ probability: 1.7 })])
  ];

  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(candidates.length, 0);
  assert.equal(rejected.missingData, 2);
});

test("fixtures outside the user's leagues never enter the pool", () => {
  const rows = [fixture(1, 39, [goodMarket()]), fixture(2, 140, [goodMarket()])];
  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.deepEqual(
    candidates.map((c) => c.leagueId),
    [39]
  );
  assert.equal(rejected.leagueNotSelected, 1);
});

test("an empty league list yields an empty pool, never everything", () => {
  const rows = [fixture(1, 39, [goodMarket()])];
  assert.equal(collectGlobalCandidates({ rows, leagueIds: [], now: NOW }).candidates.length, 0);
});

test("a fixture that already kicked off is not bettable", () => {
  const rows = [fixture(1, 39, [goodMarket()], { kickoff: PAST })];
  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(candidates.length, 0);
  assert.equal(rejected.alreadyStarted, 1);
});

test("a row flagged insufficientData contributes nothing", () => {
  const rows = [fixture(1, 39, [goodMarket(), goodMarket()], { insufficientData: true })];
  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(candidates.length, 0);
  assert.equal(rejected.insufficientData, 2);
});

test("every examined market is accounted for exactly once", () => {
  const rows = [
    fixture(1, 39, [
      goodMarket(),
      goodMarket({ odds: 1.1 }),
      goodMarket({ recommendable: false }),
      goodMarket({ probability: 0.5 }),
      goodMarket({ probability: 0.68, odds: 5 })
    ]),
    fixture(2, 140, [goodMarket()]),
    fixture(3, 39, [goodMarket()], { kickoff: PAST })
  ];

  const { candidates, examined, rejected } = collectGlobalCandidates({
    rows,
    leagueIds: [39],
    now: NOW
  });

  const totalRejected = Object.values(rejected).reduce((a, b) => a + b, 0);
  assert.equal(candidates.length + totalRejected, examined);
  assert.equal(examined, 7);
});

// ── safety contract: identity, tradable, floor, divergence ─────────────────

test("unknown or null market identity is rejected (scenario J)", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ period: "unknown" })]),
    fixture(2, 39, [goodMarket({ scope: null })]),
    fixture(3, 39, [goodMarket({ betType: undefined })])
  ];

  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(candidates.length, 0);
  assert.equal(rejected.identityUnknown, 3);
});

test("a non-tradable or unattested-tradable market is rejected (scenario K)", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ tradable: false })]),
    fixture(2, 39, [goodMarket({ tradable: undefined })])
  ];

  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(candidates.length, 0);
  assert.equal(rejected.notTradable, 2);
});

test("a probability below the safety floor is rejected, never used as filler", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ probability: PROB_FLOOR - 0.01 })]),
    fixture(2, 39, [goodMarket({ probability: PROB_FLOOR })])
  ];

  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(candidates.length, 1, "the floor is inclusive");
  assert.equal(candidates[0].fixtureId, 2);
  assert.equal(rejected.probabilityBelowFloor, 1);
});

test("68%@5.00 is rejected by the divergence gate (scenario C)", () => {
  const rows = [
    fixture(1, 39, [
      goodMarket({ type: "1X", family: "Double Chance", line: null, betType: "double_chance", probability: 0.68, odds: 5 })
    ])
  ];

  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(candidates.length, 0);
  assert.equal(rejected.modelMarketDivergence, 1);
});

test("a degenerate 95%@4.69 is rejected by the divergence gate (scenario D)", () => {
  const rows = [
    fixture(1, 39, [
      goodMarket({ type: "Under 6.5", family: "Corners", line: 6.5, betType: "corners", probability: 0.95, odds: 4.69 })
    ])
  ];

  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(candidates.length, 0);
  assert.equal(rejected.modelMarketDivergence, 1);
});

test("the divergence gate is inclusive at exactly MAX_MODEL_EDGE", () => {
  // 0.8 × 2.5 = 2.0 exactly — the model claiming exactly twice the market is
  // the boundary we still accept.
  const rows = [fixture(1, 39, [goodMarket({ probability: 0.8, odds: 2.5 })])];
  const { candidates } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(MAX_MODEL_EDGE, 2.0);
  assert.equal(candidates.length, 1);
});

// ── ranking is probability-first ───────────────────────────────────────────

test("82%@1.40 outranks 68%@2.50 whatever their value scores say (scenario A)", () => {
  // The lower-probability leg gets the maximum value score and the bigger odds;
  // under the old valueScore × dataQuality ranking it would have won. It must
  // not: probability is the only ranking signal.
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0.82, odds: 1.4, valueScore: 10 })]),
    fixture(2, 140, [goodMarket({ probability: 0.68, odds: 2.5, valueScore: 100 })])
  ];

  const ranked = rankGlobalCandidates(
    collectGlobalCandidates({ rows, leagueIds: [39, 140], now: NOW }).candidates
  );

  assert.deepEqual(
    ranked.map((c) => c.fixtureId),
    [1, 2]
  );
});

test("EV, valueScore and dataQuality have zero influence on the order", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0.75, odds: 1.6, valueScore: 1 })], {
      modelMeta: { dataQuality: 0.1 }
    }),
    fixture(2, 140, [goodMarket({ probability: 0.74, odds: 2.6, valueScore: 100 })], {
      modelMeta: { dataQuality: 1 }
    })
  ];

  const ranked = rankGlobalCandidates(
    collectGlobalCandidates({ rows, leagueIds: [39, 140], now: NOW }).candidates
  );

  assert.deepEqual(
    ranked.map((c) => c.fixtureId),
    [1, 2],
    "0.75 beats 0.74 even against maximal commercial metadata"
  );
});

test("equal probability breaks ties deterministically: odds ASC, then fixtureId (scenario E)", () => {
  const rows = [
    fixture(3, 39, [goodMarket({ probability: 0.75, odds: 1.8 })]),
    fixture(1, 140, [goodMarket({ probability: 0.75, odds: 1.6 })]),
    fixture(2, 135, [goodMarket({ probability: 0.75, odds: 1.8 })])
  ];

  const rank = (input) =>
    rankGlobalCandidates(
      collectGlobalCandidates({ rows: input, leagueIds: [39, 140, 135], now: NOW }).candidates
    ).map((c) => c.fixtureId);

  // Lower odds first (the market agrees more), then fixtureId closes the order.
  assert.deepEqual(rank(rows), [1, 2, 3]);
  assert.deepEqual(rank([...rows].reverse()), [1, 2, 3], "independent of input order");
});

test("odds never promote a lower probability over a higher one", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0.76, odds: 2.6 })]),
    fixture(2, 140, [goodMarket({ probability: 0.75, odds: 1.3 })])
  ];

  const ranked = rankGlobalCandidates(
    collectGlobalCandidates({ rows, leagueIds: [39, 140], now: NOW }).candidates
  );

  assert.deepEqual(
    ranked.map((c) => c.fixtureId),
    [1, 2],
    "odds are a tie-break only — 0.76 stays above 0.75 despite the worse price"
  );
});

// ── the readable snapshot a stored bet carries ─────────────────────────────

test("a candidate carries the fixture and league names it was built from", () => {
  const rows = [
    fixture(1, 39, [goodMarket()], { teams: { home: "Arsenal", away: "Chelsea" }, league: "Premier League" })
  ];

  const [candidate] = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW }).candidates;

  // These are persisted (migration 048) so a bet stays readable years later,
  // when the fixture it names is no longer loaded anywhere in the app.
  assert.equal(candidate.fixtureLabel, "Arsenal – Chelsea");
  assert.equal(candidate.leagueName, "Premier League");
});

test("a name the row does not have is null, never a placeholder", () => {
  const rows = [
    fixture(1, 39, [goodMarket()], { teams: { home: "Arsenal" }, league: "  " }),
    fixture(2, 39, [goodMarket()], { teams: undefined, league: undefined })
  ];

  const { candidates } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  // Half a fixture reads like data. Null lets the UI say "Meci #1" honestly.
  assert.equal(candidates[0].fixtureLabel, null);
  assert.equal(candidates[0].leagueName, null, "whitespace is not a league name");
  assert.equal(candidates[1].fixtureLabel, null);
  assert.equal(candidates[1].leagueName, null);
});

test("an unnamed fixture is still a valid candidate", () => {
  const rows = [fixture(1, 39, [goodMarket()], { teams: undefined, league: undefined })];

  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  // A label is presentation. It must never decide whether a bet can be built.
  assert.equal(candidates.length, 1);
  assert.equal(rejected.missingData, 0);
});

test("a candidate keeps probability alongside its audit metadata", () => {
  const [candidate] = collectGlobalCandidates({
    rows: [fixture(1, 39, [goodMarket({ probability: 0.72, valueScore: 55 })])],
    leagueIds: [39],
    now: NOW
  }).candidates;

  assert.equal(candidate.probability, 0.72);
  // Metadata survives for audit/debug; the ranking tests above prove it is inert.
  assert.equal(candidate.valueScore, 55);
  assert.equal(candidate.confidence, 80);
  assert.equal(candidate.dataQuality, 0.8);
});

// ── diversification ────────────────────────────────────────────────────────

test("only the best selection of a fixture survives (scenario F)", () => {
  const rows = [
    fixture(1, 39, [
      goodMarket({ type: "Over 2.5", probability: 0.85 }),
      goodMarket({ type: "Under 3.5", line: 3.5, probability: 0.9 })
    ])
  ];

  const pool = diversifyGlobalCandidates(
    rankGlobalCandidates(collectGlobalCandidates({ rows, leagueIds: [39], now: NOW }).candidates)
  );

  assert.equal(pool.length, 1);
  assert.equal(pool[0].selection, "Under 3.5");
});

test("a fresh league within the probability band is preferred (scenario H, positive)", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0.82 })]),
    fixture(2, 39, [goodMarket({ probability: 0.815 })]),
    fixture(3, 140, [goodMarket({ probability: 0.8 })])
  ];

  const pool = diversifyGlobalCandidates(
    rankGlobalCandidates(
      collectGlobalCandidates({ rows, leagueIds: [39, 140], now: NOW }).candidates
    )
  );

  // 0.815 vs 0.80 is inside the 3pp band, so spread may prefer the new league.
  assert.equal(LEAGUE_SPREAD_MAX_PP, 3);
  assert.deepEqual(
    pool.map((c) => c.fixtureId),
    [1, 3, 2]
  );
});

test("league diversity can never promote a meaningfully lower probability (scenario H)", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0.82 })]),
    fixture(2, 39, [goodMarket({ probability: 0.8 })]),
    fixture(3, 140, [goodMarket({ probability: 0.65 })])
  ];

  const pool = diversifyGlobalCandidates(
    rankGlobalCandidates(
      collectGlobalCandidates({ rows, leagueIds: [39, 140], now: NOW }).candidates
    )
  );

  // 0.65 is 17pp behind — far outside the band. Strict probability order holds.
  assert.deepEqual(
    pool.map((c) => c.fixtureId),
    [1, 2, 3]
  );
});

test("a single league still produces a full bet", () => {
  const rows = Array.from({ length: 4 }, (_, i) =>
    fixture(i + 1, 39, [goodMarket({ probability: 0.9 - i * 0.05 })])
  );

  const pool = diversifyGlobalCandidates(
    rankGlobalCandidates(collectGlobalCandidates({ rows, leagueIds: [39], now: NOW }).candidates)
  );

  assert.equal(pool.length, 4);
});

// ── variants come from one safe pool ───────────────────────────────────────

test("3 / 5 / 8 draw from one pool but no longer repeat its matches (scenario N)", () => {
  /*
    SUPERSEDED RULE. This case used to assert the opposite — that each variant
    was a PREFIX of the same ordering, so the 5 opened with the 3's three legs
    and the 8 opened with the 5's five. That was the duplication the
    cross-ticket diversification change exists to remove; the assertion is
    rewritten here rather than deleted so the change of rule stays on the record.
    The pool, the ranking and every gate are untouched — only WHICH qualified
    legs each variant takes has changed.
  */
  const built = buildGlobalSpecialBets({ rows: poolOf(10), leagueIds: [39, 40, 41], now: NOW });
  assert.deepEqual(built.unavailable, []);

  const ids = (variant) => built.bets[variant].selections.map((s) => s.fixtureId);
  const three = ids(3);
  const five = ids(5);

  // The 3 still takes the top of the ranked pool.
  assert.deepEqual(built.bets[3].selections, built.pool.slice(0, 3));
  // The 5 now shares nothing with it: ten fixtures leave seven unused.
  assert.deepEqual(five.filter((id) => three.includes(id)), []);
  assert.equal(new Set([...three, ...five]).size, 8);

  /*
    The 8 cannot be disjoint — ten fixtures cannot furnish 3 + 5 + 8 distinct
    legs — so it takes the two that remain and reuses the minimum: six. That is
    the controlled fallback, not a regression to prefix behaviour.
  */
  const eight = ids(8);
  assert.equal(eight.length, 8);
  assert.equal(new Set(eight).size, 8, "within-ticket dedup still holds");
  assert.equal(eight.filter((id) => !three.includes(id) && !five.includes(id)).length, 2);
  assert.equal(built.reusedByVariant[8].length, 6);
});

test("totals are the product of odds, the mean confidence, and Π p (scenario M)", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0.9, odds: 1.5 })]),
    fixture(2, 40, [goodMarket({ probability: 0.8, odds: 1.5 })]),
    fixture(3, 41, [goodMarket({ probability: 0.7, odds: 1.5 })])
  ];

  const built = buildGlobalSpecialBets({ rows, leagueIds: [39, 40, 41], now: NOW });

  assert.ok(Math.abs(built.bets[3].totalOdds - 1.5 ** 3) < 1e-3);
  assert.equal(built.bets[3].averageConfidence, 80);
  // Π p_i regardless of the order diversification chose: 0.9 × 0.8 × 0.7.
  assert.equal(built.bets[3].estimatedTicketProbability, 0.504);
});

test("a variant with too few SAFE selections is absent, not padded (scenario G)", () => {
  for (const [safeCount, unavailableVariants] of [
    [2, [3, 5, 8]],
    [4, [5, 8]],
    [7, [8]]
  ]) {
    const built = buildGlobalSpecialBets({ rows: poolOf(safeCount), leagueIds: [39, 40, 41], now: NOW });

    assert.deepEqual(
      built.unavailable.map((u) => u.variant),
      unavailableVariants,
      `${safeCount} safe candidates`
    );
    for (const u of built.unavailable) assert.equal(u.available, safeCount);
  }
});

test("sub-floor legs cannot fill an 8-fold: 7 safe + 3 unsafe stays unavailable", () => {
  const safe = poolOf(7);
  const unsafe = [8, 9, 10].map((id) =>
    fixture(id, 39 + (id % 3), [goodMarket({ probability: 0.45 })])
  );

  const built = buildGlobalSpecialBets({ rows: [...safe, ...unsafe], leagueIds: [39, 40, 41], now: NOW });

  assert.ok(built.bets[5], "the safe pool still builds what it can");
  assert.equal(built.bets[8], undefined);
  assert.deepEqual(built.unavailable, [{ variant: 8, available: 7, required: 8 }]);
  assert.equal(built.rejected.probabilityBelowFloor, 3);
});

test("too thin a pool leaves every variant unbuilt", () => {
  const built = buildGlobalSpecialBets({ rows: poolOf(2), leagueIds: [39, 40, 41], now: NOW });

  assert.deepEqual(built.bets, {});
  assert.deepEqual(
    built.unavailable.map((u) => u.variant),
    [3, 5, 8]
  );
});

test("the same inputs always produce the same bet", () => {
  const options = { rows: poolOf(9), leagueIds: [39, 40, 41], now: NOW };
  assert.deepEqual(buildGlobalSpecialBets(options), buildGlobalSpecialBets(options));
});

// ── settleable market families ────────────────────────────────────────────

test("a market the server cannot settle never enters the pool (scenario L)", () => {
  const unsettleable = [
    { type: "Over 3.5", family: "Cards", line: 3.5 },
    { type: "2-1", family: "Correct Score", line: null },
    { type: "Over 9.5", family: "Goals", line: 9.5 },
    { type: "something", family: "Whatever", line: null }
  ];

  for (const spec of unsettleable) {
    const rows = [fixture(1, 39, [goodMarket(spec)])];
    const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

    assert.equal(candidates.length, 0, `${spec.family} must be rejected`);
    assert.equal(rejected.marketNotSettleable, 1, `${spec.family} must be counted as unsettleable`);
  }
});

test("an explicit settleable=false rejects even a settleable family", () => {
  const rows = [fixture(1, 39, [goodMarket({ settleable: false })])];
  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(candidates.length, 0);
  assert.equal(rejected.marketNotSettleable, 1);
});

test("every settleable family is accepted when the safety contract holds", () => {
  const settleable = [
    { type: "Over 2.5", family: "Goals", line: 2.5, expected: "ou" },
    { type: "Over 9.5", family: "Corners", line: 9.5, expected: "corners" },
    { type: "Under 10.5", family: "Shots On Target", line: 10.5, expected: "shots" },
    { type: "1", family: "1X2", line: null, expected: "1x2" },
    { type: "1X", family: "Double Chance", line: null, expected: "dc" },
    { type: "GG", family: "BTTS", line: null, expected: "btts" }
  ];

  for (const { expected, ...spec } of settleable) {
    const rows = [fixture(1, 39, [goodMarket(spec)])];
    const { candidates } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

    assert.equal(candidates.length, 1, `${expected} must be accepted`);
    assert.equal(candidates[0].market, expected);
  }
});

test("a quarter line is rejected, per Increment B (scenario I)", () => {
  // A quarter GOALS line already dies at the family gate (ou_other). Corners
  // keep their settleable family, so this is the line the quarter gate guards.
  const rows = [
    fixture(1, 39, [goodMarket({ type: "Over 10.25", family: "Corners", line: 10.25, betType: "corners" })])
  ];
  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(candidates.length, 0);
  assert.equal(rejected.quarterLineUnsupported, 1);
});

test("an unsettleable market is filtered before ranking, not after", () => {
  // The cards market carries the highest probability; if the filter ran after
  // ranking it would top the pool. It must not appear at all.
  const rows = [
    fixture(1, 39, [goodMarket({ type: "Over 3.5", family: "Cards", line: 3.5, probability: 0.95, odds: 1.9 })]),
    fixture(2, 140, [goodMarket({ probability: 0.7 })])
  ];

  const built = buildGlobalSpecialBets({ rows, leagueIds: [39, 140], now: NOW }, [3]);

  assert.equal(built.pool.length, 1);
  assert.equal(built.pool[0].fixtureId, 2);
  assert.equal(built.rejected.marketNotSettleable, 1);
});

// ── production regression: the audited Aug 2026 legs ───────────────────────

test("the audited production legs are rejected; only the safe ones remain", () => {
  // Real legs from the read-only audit, reconstructed: two divergence rejects
  // (the DC 1X @5.00 and the degenerate Corners U6.5 @4.69 that lost), two
  // floor rejects (the 44–46% legs that killed the settled 8-fold), and the
  // two safe short-priced legs that the old ranking placed BELOW all of them.
  const rows = [
    fixture(1607622, 39, [
      goodMarket({ type: "1X", family: "Double Chance", line: null, betType: "double_chance", probability: 0.68, odds: 5 })
    ]),
    fixture(1607609, 40, [
      goodMarket({ type: "Under 6.5", family: "Corners", line: 6.5, betType: "corners", probability: 0.99, odds: 4.69 })
    ]),
    fixture(1607169, 41, [
      goodMarket({ type: "X2", family: "Double Chance", line: null, betType: "double_chance", probability: 0.46, odds: 3.45 })
    ]),
    fixture(1607174, 39, [
      goodMarket({ type: "1", family: "1X2", line: null, betType: "match_winner", probability: 0.44, odds: 3.77 })
    ]),
    fixture(1607603, 40, [
      goodMarket({ type: "Over 7.5", family: "Corners", line: 7.5, betType: "corners", probability: 0.83, odds: 1.38 })
    ]),
    fixture(1607566, 41, [
      goodMarket({ type: "Under 27.5", family: "Shots", line: 27.5, betType: "shots", probability: 0.83, odds: 1.87 })
    ])
  ];

  const built = buildGlobalSpecialBets({ rows, leagueIds: [39, 40, 41], now: NOW }, [3]);

  assert.equal(built.rejected.modelMarketDivergence, 2, "DC@5.00 and Corners U6.5@4.69");
  assert.equal(built.rejected.probabilityBelowFloor, 2, "the 44% and 46% legs");
  assert.deepEqual(
    built.pool.map((c) => c.fixtureId).sort((a, b) => a - b),
    [1607566, 1607603],
    "only the two safe legs survive"
  );
  assert.deepEqual(built.unavailable, [{ variant: 3, available: 2, required: 3 }]);
});
