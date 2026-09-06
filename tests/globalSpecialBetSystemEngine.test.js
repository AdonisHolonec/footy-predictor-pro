import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  LEAGUE_SPREAD_MAX_PP,
  PROB_FLOOR,
  SYSTEM_K_VALUES,
  SYSTEM_SELECTION_COUNT,
  buildGlobalSpecialBets,
  buildGlobalSystemBets,
  collectGlobalCandidates,
  rankGlobalCandidates,
  rankSystemCandidates,
  selectionExpectedValue,
  systemTicketProbability
} from "../server-utils/globalSpecialBetEngine.js";

/**
 * GSB System engine — EV-first ranking over the unchanged GSB candidate pool.
 *
 * The product claim this suite has to hold up: System is the SAME GSB — same
 * pool, same twelve gates, same fixture and league rules — consumed in a
 * different order. So most tests here are comparisons against the combo path
 * rather than assertions in isolation: if System ever stopped sharing the pool,
 * or Combo ever started following EV, these fail.
 */

const NOW = Date.parse("2026-08-09T10:00:00.000Z");
const KICKOFF = "2026-08-09T18:00:00.000Z";

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

/** A market that passes every safety gate, so a test only varies what it means to. */
function goodMarket(overrides = {}) {
  return {
    type: "Over 2.5",
    family: "Goals",
    line: 2.5,
    odds: 1.5,
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

/** n fixtures, spread over three leagues, identical odds so EV order follows probability. */
const evenPool = (count) =>
  Array.from({ length: count }, (_, i) =>
    fixture(i + 1, 39 + (i % 3), [goodMarket({ probability: 0.9 - i * 0.01, odds: 1.5 })])
  );

const ids = (list) => list.map((c) => c.fixtureId);
const collect = (rows, leagueIds = [39, 40, 41]) =>
  collectGlobalCandidates({ rows, leagueIds, now: NOW }).candidates;

// ── 1–3. The EV formula ────────────────────────────────────────────────────

test("[1] EV is probability × odds − 1: 0.60 at 2.00 is 0.20", () => {
  assert.equal(selectionExpectedValue({ probability: 0.6, odds: 2.0 }).toFixed(10), (0.2).toFixed(10));
});

test("[2] a price below fair value gives a negative EV", () => {
  // 0.60 at 1.50 returns 0.90 of the stake: a ten percent expected loss.
  assert.equal(selectionExpectedValue({ probability: 0.6, odds: 1.5 }).toFixed(10), (-0.1).toFixed(10));
});

test("[3] a fairly priced selection gives exactly zero", () => {
  assert.equal(selectionExpectedValue({ probability: 0.8, odds: 1.25 }), 0);
});

test("[3b] an unusable input is absent, never a fake break-even", () => {
  assert.equal(selectionExpectedValue({ probability: null, odds: 2 }), null);
  assert.equal(selectionExpectedValue({ probability: 0.7, odds: undefined }), null);
  assert.equal(selectionExpectedValue(undefined), null);
});

// ── 4–7. Ranking and its tie-breaks ────────────────────────────────────────

test("[4] System ranks by EV, descending", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0.9, odds: 1.3 })]), // ev 0.170
    fixture(2, 40, [goodMarket({ probability: 0.62, odds: 3.2 })]), // ev 0.984
    fixture(3, 41, [goodMarket({ probability: 0.7, odds: 2.0 })]) // ev 0.400
  ];
  assert.deepEqual(ids(rankSystemCandidates(collect(rows))), [2, 3, 1]);
});

test("[5] equal EV breaks on probability, descending", () => {
  // Both ev = 0.20 exactly; the likelier leg wins.
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0.6, odds: 2.0 })]),
    fixture(2, 40, [goodMarket({ probability: 0.8, odds: 1.5 })])
  ];
  assert.deepEqual(ids(rankSystemCandidates(collect(rows))), [2, 1]);
});

test("[6] equal EV and probability break on confidence, descending", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0.7, odds: 1.6 })], {
      recommended: { pick: "Over 2.5", family: "Goals", confidence: 70 }
    }),
    fixture(2, 40, [goodMarket({ probability: 0.7, odds: 1.6 })], {
      recommended: { pick: "Over 2.5", family: "Goals", confidence: 92 }
    })
  ];
  assert.deepEqual(ids(rankSystemCandidates(collect(rows))), [2, 1]);
});

test("[6b] then dataQuality, descending", () => {
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0.7, odds: 1.6 })], { modelMeta: { dataQuality: 0.55 } }),
    fixture(2, 40, [goodMarket({ probability: 0.7, odds: 1.6 })], { modelMeta: { dataQuality: 0.95 } })
  ];
  assert.deepEqual(ids(rankSystemCandidates(collect(rows))), [2, 1]);
});

test("[7] identical candidates order by fixtureId, and input order cannot change the result", () => {
  const rows = [7, 3, 11, 5].map((id) => fixture(id, 39, [goodMarket()]));
  const forward = collect(rows);
  const reversed = [...forward].reverse();

  assert.deepEqual(ids(rankSystemCandidates(forward)), [3, 5, 7, 11]);
  assert.deepEqual(
    ids(rankSystemCandidates(reversed)),
    ids(rankSystemCandidates(forward)),
    "the ranking must not depend on the order rows arrived in"
  );
});

// ── 8, 21, 24. Combo is untouched ──────────────────────────────────────────

/** A pool where value and chance genuinely disagree — the whole point of #69. */
const disagreeingPool = () => [
  fixture(1, 39, [goodMarket({ probability: 0.62, odds: 3.2 })]), // ev 0.984, p 0.62
  fixture(2, 40, [goodMarket({ probability: 0.9, odds: 1.3 })]), // ev 0.170, p 0.90
  fixture(3, 41, [goodMarket({ probability: 0.75, odds: 2.0 })]) // ev 0.500, p 0.75
];

test("[8] Combo stays probability-first while System is EV-first", () => {
  const candidates = collect(disagreeingPool());

  assert.deepEqual(ids(rankGlobalCandidates(candidates)), [2, 3, 1], "combo: chance first");
  assert.deepEqual(ids(rankSystemCandidates(candidates)), [1, 3, 2], "system: value first");
  assert.notDeepEqual(
    ids(rankGlobalCandidates(candidates)),
    ids(rankSystemCandidates(candidates)),
    "if these ever agree on this pool, one of the two rankings has been lost"
  );
});

test("[8b] ranking does not mutate the array it was given", () => {
  const candidates = collect(disagreeingPool());
  const before = ids(candidates);
  rankSystemCandidates(candidates);
  rankGlobalCandidates(candidates);
  assert.deepEqual(ids(candidates), before);
});

test("[21] Combo 3/5/8 still slice one probability-first pool", () => {
  const options = { rows: evenPool(8), leagueIds: [39, 40, 41], now: NOW };
  const built = buildGlobalSpecialBets(options);

  assert.equal(built.bets[3].selections.length, 3);
  assert.equal(built.bets[5].selections.length, 5);
  assert.equal(built.bets[8].selections.length, 8);
  assert.deepEqual(
    ids(built.bets[3].selections),
    ids(built.bets[8].selections).slice(0, 3),
    "3 is still the prefix of 8"
  );
  // The combo shape is unchanged: it still carries the two fields a system
  // deliberately does not.
  assert.ok(Number.isFinite(built.bets[3].totalOdds));
  assert.ok(Number.isFinite(built.bets[3].estimatedTicketProbability));
});

test("[24] a huge valueScore does not buy a place — EV alone ranks", () => {
  const rows = [
    // The pre-#69 ranking would have put this first: valueScore 99 × dataQuality.
    fixture(1, 39, [goodMarket({ probability: 0.9, odds: 1.3, valueScore: 99 })]), // ev 0.170
    fixture(2, 40, [goodMarket({ probability: 0.62, odds: 3.2, valueScore: 1 })]) // ev 0.984
  ];
  assert.deepEqual(ids(rankSystemCandidates(collect(rows))), [2, 1]);
});

// ── 9, 10, 22, 23. The pool and its gates are shared, unchanged ────────────

test("[9] System reads the same candidate pool as Combo", () => {
  const options = { rows: evenPool(6), leagueIds: [39, 40, 41], now: NOW };
  const direct = collectGlobalCandidates(options);
  const system = buildGlobalSystemBets({ ...options, systemK: 3 });
  const combo = buildGlobalSpecialBets(options);

  assert.deepEqual(system.candidates, direct.candidates);
  assert.deepEqual(system.candidates, combo.candidates, "one collector, two orderings");
  assert.equal(system.examined, direct.examined);
  assert.deepEqual(system.rejected, direct.rejected);
});

test("[10] all twelve gate counters survive into the System result", () => {
  const system = buildGlobalSystemBets({ rows: evenPool(6), leagueIds: [39, 40, 41], now: NOW, systemK: 3 });
  assert.deepEqual(Object.keys(system.rejected).sort(), [
    "alreadyStarted",
    "identityUnknown",
    "insufficientData",
    "leagueNotSelected",
    "marketNotSettleable",
    "missingData",
    "modelMarketDivergence",
    "notRecommendable",
    "notTradable",
    "oddBelowMinimum",
    "probabilityBelowFloor",
    "quarterLineUnsupported"
  ]);
  assert.equal(Object.keys(system.rejected).length, 12);
});

test("[22] the best EV in the pool is discarded when it sits below the probability floor", () => {
  // p 0.55 at 3.00: ev 0.65, the highest here — and p < PROB_FLOOR, so it never
  // reaches the ranking at all.
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0.55, odds: 3.0 })]),
    fixture(2, 40, [goodMarket({ probability: 0.7, odds: 1.6 })])
  ];
  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39, 40], now: NOW });

  assert.ok(0.55 < PROB_FLOOR);
  assert.equal(rejected.probabilityBelowFloor, 1);
  assert.deepEqual(ids(rankSystemCandidates(candidates)), [2], "the high-EV leg is gone before ranking");
});

test("[23] a leg breaching the edge ceiling is gone before ranking", () => {
  // p 0.70 at 3.00: p × o = 2.10 > MAX_MODEL_EDGE. ev would be 1.10, the best here.
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0.7, odds: 3.0 })]),
    fixture(2, 40, [goodMarket({ probability: 0.7, odds: 1.6 })])
  ];
  const { candidates, rejected } = collectGlobalCandidates({ rows, leagueIds: [39, 40], now: NOW });

  assert.equal(rejected.modelMarketDivergence, 1);
  assert.deepEqual(ids(rankSystemCandidates(candidates)), [2]);
});

// ── 11–13. Five, or nothing ────────────────────────────────────────────────

test("[11] five safe candidates are enough", () => {
  const built = buildGlobalSystemBets({ rows: evenPool(5), leagueIds: [39, 40, 41], now: NOW, systemK: 3 });
  assert.deepEqual(built.unavailable, []);
  assert.equal(built.selections.length, SYSTEM_SELECTION_COUNT);
});

test("[12] four safe candidates build nothing, and say why", () => {
  const built = buildGlobalSystemBets({ rows: evenPool(4), leagueIds: [39, 40, 41], now: NOW, systemK: 3 });

  // Was `built.bets` deepEqual {} — one invocation now yields one ticket or none.
  assert.equal(built.bet, null, "no ticket is built from a thin pool");
  assert.deepEqual(built.selections, []);
  assert.equal(built.unavailable.length, 1);
  assert.equal(built.unavailable[0].reason, "insufficient_system_candidates");
  assert.equal(built.unavailable[0].available, 4);
  assert.equal(built.unavailable[0].required, SYSTEM_SELECTION_COUNT);
});

test("[12b] a thin pool is never padded with a leg that failed a gate", () => {
  // Four safe candidates plus one below the floor: still unavailable, not five.
  const rows = [...evenPool(4), fixture(99, 39, [goodMarket({ probability: 0.5, odds: 1.9 })])];
  const built = buildGlobalSystemBets({ rows, leagueIds: [39, 40, 41], now: NOW, systemK: 3 });

  assert.equal(built.rejected.probabilityBelowFloor, 1);
  assert.equal(built.unavailable[0].reason, "insufficient_system_candidates");
  assert.equal(built.unavailable[0].available, 4);
});

test("[13] a built System carries exactly five selections", () => {
  for (const k of SYSTEM_K_VALUES) {
    const built = buildGlobalSystemBets({ rows: evenPool(9), leagueIds: [39, 40, 41], now: NOW, systemK: k });
    assert.equal(built.bet.selections.length, SYSTEM_SELECTION_COUNT, `system ${k}/5`);
  }
});

// ── 14–15. Fixture uniqueness and league spread survive the new order ──────

test("[14] two markets on one fixture cannot both enter the ticket", () => {
  const rows = [
    fixture(1, 39, [
      goodMarket({ probability: 0.62, odds: 3.2 }), // ev 0.984 — the best in the pool
      goodMarket({ type: "Under 3.5", line: 3.5, probability: 0.7, odds: 2.0 }) // ev 0.400
    ]),
    ...evenPool(5).map((row) => ({ ...row, id: row.id + 10 }))
  ];
  const built = buildGlobalSystemBets({ rows, leagueIds: [39, 40, 41], now: NOW, systemK: 3 });

  const fixtures = ids(built.selections);
  assert.equal(new Set(fixtures).size, fixtures.length, "one selection per fixture");
  assert.equal(fixtures.filter((id) => id === 1).length, 1);
  assert.equal(built.selections[0].fixtureId, 1, "and it is the higher-EV of the two");
});

test("[15] the league band still applies, measured in probability points", () => {
  // Equal odds, so EV order follows probability order and the test isolates the
  // band. League 40 sits 1pp below the best — inside LEAGUE_SPREAD_MAX_PP — so
  // it is taken second even though league 39 holds the next best legs.
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0.8, odds: 1.5 })]),
    fixture(2, 39, [goodMarket({ probability: 0.79, odds: 1.5 })]),
    fixture(3, 39, [goodMarket({ probability: 0.78, odds: 1.5 })]),
    fixture(4, 40, [goodMarket({ probability: 0.79, odds: 1.5 })])
  ];
  const pool = buildGlobalSystemBets({ rows, leagueIds: [39, 40], now: NOW, systemK: 3 }).pool;

  assert.ok(LEAGUE_SPREAD_MAX_PP >= 1);
  assert.equal(pool[0].fixtureId, 1);
  assert.equal(pool[1].leagueId, 40, "a fresh league within the band is preferred");
});

test("[15b] the band cannot drag a materially weaker leg into the ticket", () => {
  // League 40 is 20pp below the best: far outside the band, so it waits.
  const rows = [
    fixture(1, 39, [goodMarket({ probability: 0.85, odds: 1.5 })]),
    fixture(2, 39, [goodMarket({ probability: 0.84, odds: 1.5 })]),
    fixture(3, 40, [goodMarket({ probability: 0.65, odds: 1.5 })])
  ];
  const pool = buildGlobalSystemBets({ rows, leagueIds: [39, 40], now: NOW, systemK: 3 }).pool;
  assert.deepEqual(ids(pool), [1, 2, 3]);
});

// ── 16–19. The three products ──────────────────────────────────────────────

test("[16] 3/5, 4/5 and 5/5 are the same five selections", () => {
  // Three DELIBERATE builds. One build no longer produces three tickets, so the
  // shared pool is demonstrated by asking three times and comparing the answers.
  const of = (k) => buildGlobalSystemBets({ rows: evenPool(9), leagueIds: [39, 40, 41], now: NOW, systemK: k });
  const three = of(3);
  const four = of(4);
  const five = of(5);

  assert.deepEqual(three.bet.selections, four.bet.selections);
  assert.deepEqual(four.bet.selections, five.bet.selections);
  assert.deepEqual(three.bet.selections, three.selections);
  assert.notEqual(
    three.bet.selections,
    four.bet.selections,
    "same content, separate arrays — one ticket cannot mutate another"
  );
});

test("[17][18][19] a ticket is variant 5, kind system, at the k that was asked for", () => {
  for (const k of SYSTEM_K_VALUES) {
    const built = buildGlobalSystemBets({ rows: evenPool(9), leagueIds: [39, 40, 41], now: NOW, systemK: k });
    const bet = built.bet;
    assert.equal(bet.variant, 5, "variant keeps meaning the number of selections");
    assert.equal(bet.betKind, "system");
    assert.equal(bet.systemK, k, "the k built is the k requested");
    assert.equal(built.systemK, k);
  }
});

test("[19b] the combination count is C(5,k) — 10, 5 and 1", () => {
  const of = (k) => buildGlobalSystemBets({ rows: evenPool(9), leagueIds: [39, 40, 41], now: NOW, systemK: k });
  assert.equal(of(3).bet.combinationCount, 10);
  assert.equal(of(4).bet.combinationCount, 5);
  assert.equal(of(5).bet.combinationCount, 1);
});

test("[19c] a System ticket carries no combo payout field", () => {
  // Π odds is the payout of ONE combination, so it is not published under the
  // combo's field name. See the comment on toSystemBet.
  const built = buildGlobalSystemBets({ rows: evenPool(9), leagueIds: [39, 40, 41], now: NOW, systemK: 3 });
  const bet = built.bet;

  assert.equal(bet.totalOdds, undefined, "a 3/5 does not pay Π odds");
  assert.ok(Number.isFinite(bet.productOdds), "the product is kept, under a name that says what it is");
});

test("[19d] the ticket probability is P(X >= k), not the product", () => {
  const of = (k) => buildGlobalSystemBets({ rows: evenPool(9), leagueIds: [39, 40, 41], now: NOW, systemK: k });
  const byK = Object.fromEntries(SYSTEM_K_VALUES.map((k) => [k, of(k)]));
  const probabilities = byK[3].selections.map((s) => s.probability);
  const product = probabilities.reduce((acc, p) => acc * p, 1);

  for (const k of SYSTEM_K_VALUES) {
    const expected = systemTicketProbability(probabilities, k);
    assert.equal(byK[k].bet.estimatedTicketProbability, Number(expected.toFixed(4)), `k=${k}`);
  }
  // 5/5 IS the product; 3/5 and 4/5 are strictly likelier, which is the whole
  // reason a system exists.
  assert.equal(byK[5].bet.estimatedTicketProbability, Number(product.toFixed(4)));
  assert.ok(byK[3].bet.estimatedTicketProbability > byK[4].bet.estimatedTicketProbability);
  assert.ok(byK[4].bet.estimatedTicketProbability > byK[5].bet.estimatedTicketProbability);
});

// ── 20. System cannot reach production ─────────────────────────────────────

test("[20] the server builds and validates a System, and the k never comes from the request", () => {
  // The database now accepts one (migration 053 lifted the gate; S16 in
  // tests/integration/gsbSystemFoundation.db.test.js proves the creation). This
  // is the other half: the server never even asks. A unit test on the engine
  // alone would pass while an unwired capability quietly became reachable.
  //
  // Narrowed in the settlement-integration increment: the persistence layer now
  // READS bet_kind and system_k, because it has to know which grader answers for
  // a ticket that already exists. What it still must not do is build one or send
  // one to the RPC — which is the invariant that actually keeps System off the
  // product.
  const persistence = fs.readFileSync("server-utils/globalSpecialBets.js", "utf8");
  const api = fs.readFileSync("server-utils/globalSpecialBetsApi.js", "utf8");

  // What is left is the invariant that actually keeps System off the product,
  // and it deliberately lives in SQL rather than JavaScript: the RPC returns
  // system_not_enabled. A check in application code could be sidestepped by any
  // other caller; a check inside the function cannot. Whoever ships System must
  // lift it there, on purpose.
  // Whichever migration last reissues the function, not a named one: a guard
  // that points at 053 keeps passing after 054 supersedes it while describing a
  // function the database no longer has.
  const active = fs
    .readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) =>
      fs.readFileSync(`supabase/migrations/${f}`, "utf8").includes("create function public.create_global_special_bet")
    );
  const enable = fs.readFileSync(`supabase/migrations/${active}`, "utf8");
  assert.ok(!/error', 'system_not_enabled/.test(enable), "the active function has no gate");
  assert.ok(persistence.includes("createGlobalSystemBets"), "the server can create a System");
  assert.ok(persistence.includes("validateSystemShape"), "creation validates the shape before the RPC");
  assert.ok(persistence.includes("p_system_k"), "creation sends the k through 052's own parameter");

  // NARROWED, not dropped. This used to assert the HTTP layer knew nothing of
  // System — true until the public product shipped, and the whole point of this
  // increment is that it now does. What replaces it is the invariant that
  // actually protects the product: the route may CREATE a System, but the k is
  // never taken from the request. A source guard rather than a behavioural one
  // for the same reason as above — a body-read reintroduced here would pass
  // every unit test while quietly handing the product back to the client.
  assert.ok(api.includes("createGlobalSystemBets"), "the public route can create a System");
  assert.ok(api.includes("SYSTEM_PRODUCT_K = 3"), "the k is a server-side constant");
  assert.ok(
    !/body\.system_k|body\.systemK|\bsystemK\s*=\s*(?!SYSTEM_PRODUCT_K)/.test(api),
    "the k is never read from the request body"
  );
});

// ── System cross-ticket diversification ────────────────────────────────────

/*
  A System ticket now consumes the SAME exclusion set the combo path uses, so a
  fixture the user's earlier tickets already took is not taken again while
  equally qualified fresh ones remain.

  These assert the ENGINE rule. That the USER service actually reaches it with
  the right scope — and that combos and systems exclude each other — is proved
  in tests/userTicketDiversification.test.js, which drives the real service
  against a table-aware double.
*/

const buildSystem = (rows, excludeFixtureIds, leagueIds = [39, 40, 41]) =>
  buildGlobalSystemBets({ rows, leagueIds, now: NOW, systemK: 3, excludeFixtureIds });

const legIds = (built) => built.selections.map((s) => s.fixtureId).sort((a, b) => a - b);

test("[S1] a second System takes five DIFFERENT fixtures when the pool allows", () => {
  const rows = evenPool(20);

  const first = buildSystem(rows, new Set());
  const second = buildSystem(rows, new Set(legIds(first)));

  assert.equal(first.selections.length, SYSTEM_SELECTION_COUNT);
  assert.equal(second.selections.length, SYSTEM_SELECTION_COUNT);
  assert.deepEqual(
    legIds(first).filter((id) => legIds(second).includes(id)),
    [],
    "the second System must not repeat the first's matches"
  );
  assert.deepEqual(second.reusedFixtureIds, [], "nothing was reused: the pool was wide enough");
});

test("[S2] three sequential Systems consume fifteen distinct fixtures", () => {
  const rows = evenPool(20);
  const used = new Set();
  const all = [];

  for (let i = 0; i < 3; i += 1) {
    const built = buildSystem(rows, new Set(used));
    assert.equal(built.selections.length, SYSTEM_SELECTION_COUNT, `ticket ${i + 1} is five legs`);
    assert.deepEqual(built.reusedFixtureIds, [], `ticket ${i + 1} needed no reuse`);
    for (const id of legIds(built)) {
      used.add(id);
      all.push(id);
    }
  }

  assert.equal(all.length, 15);
  assert.equal(new Set(all).size, 15, "three tickets' worth of legs, fifteen distinct matches");
});

test("[S3] FALLBACK: with too few fresh, exactly 5 - fresh.length are reused", () => {
  // Seven qualified fixtures; the first System takes five, leaving two fresh.
  const rows = evenPool(7);

  const first = buildSystem(rows, new Set());
  const firstIds = legIds(first);
  assert.equal(firstIds.length, 5);

  const second = buildSystem(rows, new Set(firstIds));
  const secondIds = legIds(second);

  assert.equal(secondIds.length, SYSTEM_SELECTION_COUNT, "still a five-leg ticket");
  assert.equal(new Set(secondIds).size, 5, "and still five DISTINCT fixtures");

  const fresh = secondIds.filter((id) => !firstIds.includes(id));
  assert.equal(fresh.length, 2, "both remaining fresh fixtures are taken first");
  assert.equal(second.reusedFixtureIds.length, 3, "5 - 2 = 3 reused, the fewest that make a ticket");
  // The reuse is reported, not silent: a caller can say how novel the ticket is.
  assert.equal(
    second.reusedFixtureIds.every((id) => firstIds.includes(id)),
    true,
    "every reused leg comes from the excluded set"
  );
});

test("[S4] a pool below five still refuses, with the existing reason", () => {
  const built = buildSystem(evenPool(4), new Set([1, 2]));

  assert.equal(built.bet, null);
  assert.deepEqual(built.selections, []);
  assert.equal(built.unavailable[0].reason, "insufficient_system_candidates");
  assert.equal(built.unavailable[0].required, SYSTEM_SELECTION_COUNT);
  assert.equal(built.unavailable[0].available, 4);
  // The exclusion never converts a thin pool into a different answer.
  assert.deepEqual(built.reusedFixtureIds, []);
});

test("[S5] QUALITY IS NOT TRADED FOR VARIETY: a sub-floor fresh leg is not promoted", () => {
  /*
    Five qualified fixtures (1–5), all already used, plus three FRESH ones whose
    probability sits under PROB_FLOOR. The novel legs are the unqualified ones,
    so a rule that chased variety would take them.
  */
  const qualified = Array.from({ length: 5 }, (_, i) =>
    fixture(i + 1, 39 + (i % 3), [goodMarket({ probability: 0.9 - i * 0.01, odds: 1.5 })])
  );
  const freshButUnqualified = [6, 7, 8].map((id) =>
    fixture(id, 39 + (id % 3), [goodMarket({ probability: PROB_FLOOR - 0.05, odds: 1.5 })])
  );

  const built = buildSystem([...qualified, ...freshButUnqualified], new Set([1, 2, 3, 4, 5]));

  assert.equal(built.selections.length, SYSTEM_SELECTION_COUNT);
  assert.deepEqual(legIds(built), [1, 2, 3, 4, 5], "the ticket is the five QUALIFIED legs, all reused");
  assert.equal(built.reusedFixtureIds.length, 5, "every leg is a reuse, and that is the correct answer");
  assert.equal(built.rejected.probabilityBelowFloor, 3, "the fresh three never entered the pool at all");
});

test("[S6] every System ticket carries five DISTINCT fixture ids", () => {
  for (const exclusion of [new Set(), new Set([1]), new Set([1, 2, 3]), new Set([1, 2, 3, 4, 5, 6])]) {
    const built = buildSystem(evenPool(9), exclusion);
    const list = built.selections.map((s) => s.fixtureId);
    assert.equal(list.length, SYSTEM_SELECTION_COUNT);
    assert.equal(new Set(list).size, SYSTEM_SELECTION_COUNT, `distinct under exclusion ${[...exclusion]}`);
  }
});

test("[S7] two markets on one fixture stay ONE fixture under exclusion", () => {
  // Fixture 1 offers two qualifying markets; it must still occupy one slot.
  const rows = [
    fixture(1, 39, [
      goodMarket({ probability: 0.9, odds: 1.5 }),
      goodMarket({ type: "Under 3.5", line: 3.5, probability: 0.88, odds: 1.5 })
    ]),
    ...Array.from({ length: 6 }, (_, i) =>
      fixture(i + 2, 39 + (i % 3), [goodMarket({ probability: 0.85 - i * 0.01, odds: 1.5 })])
    )
  ];

  const built = buildSystem(rows, new Set());
  const list = built.selections.map((s) => s.fixtureId);
  assert.equal(new Set(list).size, SYSTEM_SELECTION_COUNT);
  assert.equal(list.filter((id) => id === 1).length <= 1, true, "fixture 1 cannot occupy two slots");
});

test("[S8] the same pool and the same exclusion give the same ticket every time", () => {
  const rows = evenPool(12);
  const exclusion = [3, 7];

  const runs = Array.from({ length: 3 }, () => legIds(buildSystem(rows, new Set(exclusion))));
  assert.deepEqual(runs[1], runs[0]);
  assert.deepEqual(runs[2], runs[0]);
  // A plain array is accepted exactly like a Set — the primitive normalises it.
  assert.deepEqual(legIds(buildSystem(rows, exclusion)), runs[0]);
});

test("[S9] EV ordering stays PRIMARY: the ticket is the EV-best legs still available", () => {
  const rows = evenPool(12);
  const exclusion = new Set([1, 2]);

  // What the ranking says, computed independently of the builder.
  const ranked = rankSystemCandidates(collect(rows));
  const expected = [];
  const seen = new Set();
  for (const candidate of ranked) {
    if (seen.has(candidate.fixtureId) || exclusion.has(candidate.fixtureId)) continue;
    seen.add(candidate.fixtureId);
    expected.push(candidate.fixtureId);
    if (expected.length === SYSTEM_SELECTION_COUNT) break;
  }

  const built = buildSystem(rows, exclusion);
  assert.deepEqual(
    built.selections.map((s) => s.fixtureId).sort((a, b) => a - b),
    expected.sort((a, b) => a - b),
    "diversity removes candidates from consideration; it never reorders the survivors"
  );
});

test("[S10] k, n and variant are untouched by diversification", () => {
  const built = buildSystem(evenPool(12), new Set([1, 2, 3]));

  assert.equal(built.systemK, 3);
  assert.equal(built.bet.systemK, 3);
  assert.equal(built.bet.variant, SYSTEM_SELECTION_COUNT);
  assert.equal(SYSTEM_SELECTION_COUNT, 5);
  assert.equal(built.bet.betKind, "system");
  assert.equal(built.bet.selections.length, 5);
  assert.deepEqual(SYSTEM_K_VALUES, [3, 4, 5], "the supported shapes are unchanged");
});

test("[S11] probability and odds are computed from the SELECTED five, whatever was excluded", () => {
  const built = buildSystem(evenPool(12), new Set([1, 2, 3]));
  const chosen = built.selections;

  // P(X >= 3) over exactly the five legs the ticket holds — not the pool, not
  // the excluded ones.
  const expectedP = systemTicketProbability(
    chosen.map((s) => s.probability),
    3
  );
  assert.equal(built.bet.estimatedTicketProbability, Number(expectedP.toFixed(4)));

  // total_odds stays the PRODUCT of the five selected odds.
  const expectedOdds = chosen.reduce((acc, s) => acc * s.odds, 1);
  assert.equal(built.bet.productOdds, Number(expectedOdds.toFixed(3)));
  assert.equal(built.bet.combinationCount, 10, "C(5,3) is unchanged");
});

test("[S12] the twelve gates produce the same populations with and without exclusion", () => {
  const rows = evenPool(12);

  const plain = buildGlobalSystemBets({ rows, leagueIds: [39, 40, 41], now: NOW, systemK: 3 });
  const excluded = buildSystem(rows, new Set([1, 2, 3]));

  // Gating happens BEFORE selection, so the accepted and rejected populations
  // cannot move — only which of the accepted end up in the ticket.
  assert.deepEqual(excluded.rejected, plain.rejected);
  assert.equal(excluded.examined, plain.examined);
  assert.deepEqual(
    excluded.pool.map((c) => c.fixtureId),
    plain.pool.map((c) => c.fixtureId),
    "the same pool, in the same order"
  );
  assert.notDeepEqual(
    excluded.selections.map((c) => c.fixtureId),
    plain.selections.map((c) => c.fixtureId),
    "only the chosen legs differ"
  );
});

test("[S13] an absent exclusion behaves exactly as before this change", () => {
  const rows = evenPool(9);
  const before = buildGlobalSystemBets({ rows, leagueIds: [39, 40, 41], now: NOW, systemK: 3 });

  // The pre-change behaviour was the pool's first five, in rank order.
  assert.deepEqual(
    before.selections.map((c) => c.fixtureId),
    before.pool.slice(0, SYSTEM_SELECTION_COUNT).map((c) => c.fixtureId)
  );
  assert.deepEqual(before.reusedFixtureIds, []);
});
