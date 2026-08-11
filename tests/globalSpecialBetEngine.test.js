import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEAGUE_SPREAD_TOLERANCE,
  MIN_SELECTION_ODD,
  buildGlobalSpecialBets,
  collectGlobalCandidates,
  diversifyGlobalCandidates,
  rankGlobalCandidates
} from "../server-utils/globalSpecialBetEngine.js";

/**
 * Global Special Bet engine — the 20 behaviours the selection layer guarantees.
 *
 * Ported verbatim from the TypeScript prototype (src/utils/globalSpecialBet.ts,
 * commit d1fed8bc) when the engine moved server-side, because the server is the
 * only authority on which selections a bet contains. Same cases, same
 * expectations — the port is a change of language and location, not of rules.
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

/** A market that passes every hard filter, so tests only vary what they mean to. */
function goodMarket(overrides = {}) {
  return {
    type: "Over 2.5",
    family: "Goals",
    line: 2.5,
    odds: 1.9,
    valueScore: 60,
    recommendable: true,
    ...overrides
  };
}

const poolOf = (count) =>
  Array.from({ length: count }, (_, i) =>
    fixture(i + 1, 39 + (i % 3), [goodMarket({ valueScore: 80 - i, odds: 1.5 })])
  );

// ── hard filters reject rather than default ────────────────────────────────

test("an odd below the floor is rejected even at high confidence", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ odds: 1.24, valueScore: 99 })], {
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

test("missing odds, value score, confidence or data quality are all disqualifying", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ odds: null })]),
    fixture(2, 39, [goodMarket({ valueScore: null })]),
    fixture(3, 39, [goodMarket()], { recommended: { pick: "x", confidence: null } }),
    fixture(4, 39, [goodMarket()], { modelMeta: {} })
  ];

  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

  assert.equal(candidates.length, 0);
  assert.equal(rejected.missingData, 4);
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
    fixture(1, 39, [goodMarket(), goodMarket({ odds: 1.1 }), goodMarket({ recommendable: false })]),
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
  assert.equal(examined, 5);
});

// ── ranking is valueScore × dataQuality ────────────────────────────────────

test("data quality can outrank a higher raw value score", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ valueScore: 70 })], { modelMeta: { dataQuality: 0.5 } }), // 35
    fixture(2, 140, [goodMarket({ valueScore: 50 })], { modelMeta: { dataQuality: 0.9 } }) // 45
  ];

  const ranked = rankGlobalCandidates(
    collectGlobalCandidates({ rows, leagueIds: [39, 140], now: NOW }).candidates
  );

  assert.deepEqual(
    ranked.map((c) => c.fixtureId),
    [2, 1]
  );
  assert.ok(Math.abs(ranked[0].score - 45) < 1e-9);
});

test("ordering is total and independent of input order", () => {
  const specs = [
    [1, 39, 60],
    [2, 140, 55],
    [3, 135, 70]
  ];
  const build = (order) =>
    rankGlobalCandidates(
      collectGlobalCandidates({
        rows: order.map(([id, league, vs]) => fixture(id, league, [goodMarket({ valueScore: vs })])),
        leagueIds: [39, 140, 135],
        now: NOW
      }).candidates
    ).map((c) => c.fixtureId);

  assert.deepEqual(build(specs), build([...specs].reverse()));
});

// ── diversification ────────────────────────────────────────────────────────

test("only the best selection of a fixture survives", () => {
  const rows = [
    fixture(1, 39, [
      goodMarket({ type: "Over 2.5", valueScore: 40 }),
      goodMarket({ type: "Under 3.5", line: 3.5, valueScore: 80 })
    ])
  ];

  const pool = diversifyGlobalCandidates(
    rankGlobalCandidates(collectGlobalCandidates({ rows, leagueIds: [39], now: NOW }).candidates)
  );

  assert.equal(pool.length, 1);
  assert.equal(pool[0].selection, "Under 3.5");
});

test("a comparable candidate from a fresh league is preferred", () => {
  // 60 and 55 sit within the tolerance, so spread decides between them.
  const rows = [
    fixture(1, 39, [goodMarket({ valueScore: 60 })]),
    fixture(2, 39, [goodMarket({ valueScore: 58 })]),
    fixture(3, 140, [goodMarket({ valueScore: 55 })])
  ];

  const pool = diversifyGlobalCandidates(
    rankGlobalCandidates(
      collectGlobalCandidates({ rows, leagueIds: [39, 140], now: NOW }).candidates
    )
  );

  assert.deepEqual(
    pool.map((c) => c.leagueId),
    [39, 140, 39]
  );
});

test("spread never drags in a clearly weaker selection", () => {
  // 20 × 0.8 = 16 is far below the tolerance of 60 × 0.8 = 48, so the second
  // strong same-league candidate wins the slot instead.
  const rows = [
    fixture(1, 39, [goodMarket({ valueScore: 60 })]),
    fixture(2, 39, [goodMarket({ valueScore: 58 })]),
    fixture(3, 140, [goodMarket({ valueScore: 20 })])
  ];

  const pool = diversifyGlobalCandidates(
    rankGlobalCandidates(
      collectGlobalCandidates({ rows, leagueIds: [39, 140], now: NOW }).candidates
    )
  );

  assert.deepEqual(
    pool.map((c) => c.fixtureId),
    [1, 2, 3]
  );
  assert.equal(LEAGUE_SPREAD_TOLERANCE, 0.85);
});

test("a single league still produces a full bet", () => {
  const rows = Array.from({ length: 4 }, (_, i) =>
    fixture(i + 1, 39, [goodMarket({ valueScore: 70 - i })])
  );

  const pool = diversifyGlobalCandidates(
    rankGlobalCandidates(collectGlobalCandidates({ rows, leagueIds: [39], now: NOW }).candidates)
  );

  assert.equal(pool.length, 4);
});

// ── variants come from one pool ────────────────────────────────────────────

test("3 / 5 / 8 are prefixes of the same ordering", () => {
  const built = buildGlobalSpecialBets({ rows: poolOf(10), leagueIds: [39, 40, 41], now: NOW });

  assert.deepEqual(built.unavailable, []);
  assert.deepEqual(built.bets[3].selections, built.pool.slice(0, 3));
  assert.deepEqual(built.bets[5].selections.slice(0, 3), built.bets[3].selections);
  assert.deepEqual(built.bets[8].selections.slice(0, 5), built.bets[5].selections);
});

test("totals are the product of the odds and the mean confidence", () => {
  const built = buildGlobalSpecialBets({ rows: poolOf(3), leagueIds: [39, 40, 41], now: NOW });

  assert.ok(Math.abs(built.bets[3].totalOdds - 1.5 ** 3) < 1e-3);
  assert.equal(built.bets[3].averageConfidence, 80);
});

test("a variant with too few selections is absent, not padded", () => {
  const built = buildGlobalSpecialBets({ rows: poolOf(6), leagueIds: [39, 40, 41], now: NOW });

  assert.ok(built.bets[3]);
  assert.ok(built.bets[5]);
  assert.equal(built.bets[8], undefined);
  assert.deepEqual(built.unavailable, [{ variant: 8, available: 6, required: 8 }]);
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

test("a market the server cannot settle never enters the pool", () => {
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

test("every settleable family is accepted when the rest of the criteria hold", () => {
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

test("an unsettleable market is filtered before ranking, not after", () => {
  // The cards market outscores everything; if the filter ran after ranking it
  // would top the pool. It must not appear at all.
  const rows = [
    fixture(1, 39, [goodMarket({ type: "Over 3.5", family: "Cards", line: 3.5, valueScore: 99 })]),
    fixture(2, 140, [goodMarket({ valueScore: 40 })])
  ];

  const built = buildGlobalSpecialBets({ rows, leagueIds: [39, 140], now: NOW }, [3]);

  assert.equal(built.pool.length, 1);
  assert.equal(built.pool[0].fixtureId, 2);
  assert.equal(built.rejected.marketNotSettleable, 1);
});
