import { describe, expect, test } from "vitest";
import type { PredictionRow } from "../types";
import {
  LEAGUE_SPREAD_TOLERANCE,
  MIN_SELECTION_ODD,
  buildGlobalSpecialBets,
  collectGlobalCandidates,
  diversifyGlobalCandidates,
  rankGlobalCandidates
} from "./globalSpecialBet";

const NOW = Date.parse("2026-08-09T10:00:00.000Z");
const KICKOFF = "2026-08-09T18:00:00.000Z";
const PAST = "2026-08-09T08:00:00.000Z";

type MarketSpec = {
  type?: string;
  family?: string;
  line?: number | null;
  odds?: number | null;
  valueScore?: number | null;
  recommendable?: boolean;
};

function fixture(
  id: number,
  leagueId: number,
  markets: MarketSpec[],
  overrides: Record<string, unknown> = {}
): PredictionRow {
  return {
    id,
    leagueId,
    kickoff: KICKOFF,
    teams: { home: `Home ${id}`, away: `Away ${id}` },
    recommended: { pick: "Over 2.5", family: "Goals", confidence: 80 },
    modelMeta: { dataQuality: 0.8 },
    valueEngine: { markets },
    ...overrides
  } as unknown as PredictionRow;
}

/** A market that passes every hard filter, so tests only vary what they mean to. */
function goodMarket(overrides: MarketSpec = {}): MarketSpec {
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

describe("hard filters reject rather than default", () => {
  test("an odd below the floor is rejected even at high confidence", () => {
    const rows = [
      fixture(1, 39, [goodMarket({ odds: 1.24, valueScore: 99 })], {
        recommended: { pick: "1", family: "1X2", confidence: 95 }
      })
    ];

    const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

    expect(candidates).toHaveLength(0);
    expect(rejected.oddBelowMinimum).toBe(1);
  });

  test("the floor is inclusive", () => {
    const rows = [fixture(1, 39, [goodMarket({ odds: MIN_SELECTION_ODD })])];
    expect(collectGlobalCandidates({ rows, leagueIds: [39], now: NOW }).candidates).toHaveLength(1);
  });

  test("a market the engine does not recommend is rejected", () => {
    const rows = [fixture(1, 39, [goodMarket({ recommendable: false })])];
    const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

    expect(candidates).toHaveLength(0);
    expect(rejected.notRecommendable).toBe(1);
  });

  test("missing odds, value score, confidence or data quality are all disqualifying", () => {
    const rows = [
      fixture(1, 39, [goodMarket({ odds: null })]),
      fixture(2, 39, [goodMarket({ valueScore: null })]),
      fixture(3, 39, [goodMarket()], { recommended: { pick: "x", confidence: null } }),
      fixture(4, 39, [goodMarket()], { modelMeta: {} })
    ];

    const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

    expect(candidates).toHaveLength(0);
    expect(rejected.missingData).toBe(4);
  });

  test("fixtures outside the user's leagues never enter the pool", () => {
    const rows = [fixture(1, 39, [goodMarket()]), fixture(2, 140, [goodMarket()])];
    const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

    expect(candidates.map((c) => c.leagueId)).toEqual([39]);
    expect(rejected.leagueNotSelected).toBe(1);
  });

  test("an empty league list yields an empty pool, never everything", () => {
    const rows = [fixture(1, 39, [goodMarket()])];
    expect(collectGlobalCandidates({ rows, leagueIds: [], now: NOW }).candidates).toHaveLength(0);
  });

  test("a fixture that already kicked off is not bettable", () => {
    const rows = [fixture(1, 39, [goodMarket()], { kickoff: PAST })];
    const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

    expect(candidates).toHaveLength(0);
    expect(rejected.alreadyStarted).toBe(1);
  });

  test("a row flagged insufficientData contributes nothing", () => {
    const rows = [fixture(1, 39, [goodMarket(), goodMarket()], { insufficientData: true })];
    const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39], now: NOW });

    expect(candidates).toHaveLength(0);
    expect(rejected.insufficientData).toBe(2);
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
    expect(candidates.length + totalRejected).toBe(examined);
    expect(examined).toBe(5);
  });
});

describe("ranking is valueScore × dataQuality", () => {
  test("data quality can outrank a higher raw value score", () => {
    const rows = [
      fixture(1, 39, [goodMarket({ valueScore: 70 })], { modelMeta: { dataQuality: 0.5 } }), // 35
      fixture(2, 140, [goodMarket({ valueScore: 50 })], { modelMeta: { dataQuality: 0.9 } }) // 45
    ];

    const ranked = rankGlobalCandidates(
      collectGlobalCandidates({ rows, leagueIds: [39, 140], now: NOW }).candidates
    );

    expect(ranked.map((c) => c.fixtureId)).toEqual([2, 1]);
    expect(ranked[0].score).toBeCloseTo(45);
  });

  test("ordering is total and independent of input order", () => {
    const specs: Array<[number, number, number]> = [
      [1, 39, 60],
      [2, 140, 55],
      [3, 135, 70]
    ];
    const build = (order: typeof specs) =>
      rankGlobalCandidates(
        collectGlobalCandidates({
          rows: order.map(([id, league, vs]) => fixture(id, league, [goodMarket({ valueScore: vs })])),
          leagueIds: [39, 140, 135],
          now: NOW
        }).candidates
      ).map((c) => c.fixtureId);

    expect(build(specs)).toEqual(build([...specs].reverse()));
  });
});

describe("diversification", () => {
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

    expect(pool).toHaveLength(1);
    expect(pool[0].selection).toBe("Under 3.5");
  });

  test("a comparable candidate from a fresh league is preferred", () => {
    // 60 and 55 sit within the tolerance, so spread decides between them.
    const rows = [
      fixture(1, 39, [goodMarket({ valueScore: 60 })]),
      fixture(2, 39, [goodMarket({ valueScore: 58 })]),
      fixture(3, 140, [goodMarket({ valueScore: 55 })])
    ];

    const pool = diversifyGlobalCandidates(
      rankGlobalCandidates(collectGlobalCandidates({ rows, leagueIds: [39, 140], now: NOW }).candidates)
    );

    expect(pool.map((c) => c.leagueId)).toEqual([39, 140, 39]);
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
      rankGlobalCandidates(collectGlobalCandidates({ rows, leagueIds: [39, 140], now: NOW }).candidates)
    );

    expect(pool.map((c) => c.fixtureId)).toEqual([1, 2, 3]);
    expect(LEAGUE_SPREAD_TOLERANCE).toBe(0.85);
  });

  test("a single league still produces a full bet", () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      fixture(i + 1, 39, [goodMarket({ valueScore: 70 - i })])
    );

    const pool = diversifyGlobalCandidates(
      rankGlobalCandidates(collectGlobalCandidates({ rows, leagueIds: [39], now: NOW }).candidates)
    );

    expect(pool).toHaveLength(4);
  });
});

describe("variants come from one pool", () => {
  function poolOf(count: number) {
    return Array.from({ length: count }, (_, i) =>
      fixture(i + 1, 39 + (i % 3), [goodMarket({ valueScore: 80 - i, odds: 1.5 })])
    );
  }

  test("3 / 5 / 8 are prefixes of the same ordering", () => {
    const built = buildGlobalSpecialBets({ rows: poolOf(10), leagueIds: [39, 40, 41], now: NOW });

    expect(built.unavailable).toEqual([]);
    expect(built.bets[3]!.selections).toEqual(built.pool.slice(0, 3));
    expect(built.bets[5]!.selections.slice(0, 3)).toEqual(built.bets[3]!.selections);
    expect(built.bets[8]!.selections.slice(0, 5)).toEqual(built.bets[5]!.selections);
  });

  test("totals are the product of the odds and the mean confidence", () => {
    const built = buildGlobalSpecialBets({ rows: poolOf(3), leagueIds: [39, 40, 41], now: NOW });

    expect(built.bets[3]!.totalOdds).toBeCloseTo(1.5 ** 3, 3);
    expect(built.bets[3]!.averageConfidence).toBe(80);
  });

  test("a variant with too few selections is absent, not padded", () => {
    const built = buildGlobalSpecialBets({ rows: poolOf(6), leagueIds: [39, 40, 41], now: NOW });

    expect(built.bets[3]).toBeDefined();
    expect(built.bets[5]).toBeDefined();
    expect(built.bets[8]).toBeUndefined();
    expect(built.unavailable).toEqual([{ variant: 8, available: 6, required: 8 }]);
  });

  test("too thin a pool leaves every variant unbuilt", () => {
    const built = buildGlobalSpecialBets({ rows: poolOf(2), leagueIds: [39, 40, 41], now: NOW });

    expect(built.bets).toEqual({});
    expect(built.unavailable.map((u) => u.variant)).toEqual([3, 5, 8]);
  });

  test("the same inputs always produce the same bet", () => {
    const options = { rows: poolOf(9), leagueIds: [39, 40, 41], now: NOW };
    expect(buildGlobalSpecialBets(options)).toEqual(buildGlobalSpecialBets(options));
  });
});
