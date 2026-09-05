import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MIN_SELECTION_ODD,
  PROB_FLOOR,
  buildGlobalSpecialBets,
  selectVariantLegs
} from "../server-utils/globalSpecialBetEngine.js";
import { loadUsedFixtureIds } from "../server-utils/ticketFixtureUsage.js";

/**
 * Cross-ticket fixture diversification.
 *
 * The rule: a fixture used by one ticket should not return on the next while
 * other equally qualified fixtures remain. Everything here is asserted by
 * FIXTURE ID rather than by leg count — a ticket of the right length built from
 * all the wrong matches is precisely the bug this exists to prevent.
 *
 * Two properties carry the weight because both fail silently:
 *
 *   1. QUALITY IS NEVER TRADED FOR VARIETY. A candidate that failed a gate
 *      cannot be promoted because it would have been novel. Reusing a qualified
 *      fixture always beats admitting an unqualified one.
 *
 *   2. SCOPES DO NOT LEAK. One user's tickets cannot narrow another's, and no
 *      personal ticket can narrow the product's GLOBAL pool.
 */

const NOW = Date.parse("2026-09-05T10:00:00.000Z");
const KICKOFF = "2026-09-05T18:00:00.000Z";

const goodMarket = (o = {}) => ({
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
  ...o
});

/** A prediction row the engine accepts, with a deterministic descending rank. */
const fixture = (id, markets, o = {}) => ({
  id,
  leagueId: 39 + (id % 4),
  kickoff: KICKOFF,
  teams: { home: `Home ${id}`, away: `Away ${id}` },
  recommended: { confidence: 80 },
  modelMeta: { dataQuality: 0.8 },
  insufficientData: false,
  valueEngine: { markets },
  ...o
});

/** `n` qualified fixtures, ids 1..n, ranked by descending probability. */
const pool = (n) =>
  Array.from({ length: n }, (_, i) => fixture(i + 1, [goodMarket({ probability: 0.95 - i * 0.01 })]));

const leaguesOf = (rows) => [...new Set(rows.map((r) => r.leagueId))];

const build = (rows, variants, excludeFixtureIds) =>
  buildGlobalSpecialBets({ rows, leagueIds: leaguesOf(rows), now: NOW, excludeFixtureIds }, variants);

const idsOf = (bet) => bet.selections.map((s) => s.fixtureId).sort((a, b) => a - b);
const intersect = (a, b) => a.filter((x) => b.includes(x));

// ── the regression scenario ────────────────────────────────────────────────

test("REGRESSION: with 20 trustworthy fixtures, 3 / 5 / 8 are pairwise disjoint", () => {
  const rows = pool(20);

  // Built as three separate operations, each excluding what came before —
  // exactly what the two HTTP callers do across three requests.
  const three = build(rows, [3]).bets[3];
  const used3 = new Set(three.selections.map((s) => s.fixtureId));

  const five = build(rows, [5], used3).bets[5];
  const used35 = new Set([...used3, ...five.selections.map((s) => s.fixtureId)]);

  const eight = build(rows, [8], used35).bets[8];

  const a = idsOf(three);
  const b = idsOf(five);
  const c = idsOf(eight);

  assert.deepEqual(intersect(a, b), [], "5 must not reuse a fixture from 3");
  assert.deepEqual(intersect(a, c), [], "8 must not reuse a fixture from 3");
  assert.deepEqual(intersect(b, c), [], "8 must not reuse a fixture from 5");

  // 16 distinct matches across the three tickets, from a pool of 20.
  assert.equal(new Set([...a, ...b, ...c]).size, 16);
});

test("a single call for [3, 5, 8] diversifies across the variants too", () => {
  // The accumulator inside buildGlobalSpecialBets, so the rule is identical
  // whether the variants arrive together or as separate requests.
  const built = build(pool(20), [3, 5, 8]);
  const a = idsOf(built.bets[3]);
  const b = idsOf(built.bets[5]);
  const c = idsOf(built.bets[8]);

  assert.deepEqual(intersect(a, b), []);
  assert.deepEqual(intersect(a, c), []);
  assert.deepEqual(intersect(b, c), []);
  assert.equal(new Set([...a, ...b, ...c]).size, 16);
});

test("exactly enough unique fixtures still needs no reuse", () => {
  const built = build(pool(16), [3, 5, 8]);

  assert.equal(new Set([...idsOf(built.bets[3]), ...idsOf(built.bets[5]), ...idsOf(built.bets[8])]).size, 16);
  assert.deepEqual(built.reusedByVariant, { 3: [], 5: [], 8: [] });
});

// ── controlled, minimal fallback ───────────────────────────────────────────

test("FALLBACK: reuse is the minimum the ticket requires, and prefers fresh legs", () => {
  // Six qualified fixtures. A 3 takes three; a 5 then has only three left.
  const rows = pool(6);
  const three = build(rows, [3]).bets[3];
  const used = new Set(three.selections.map((s) => s.fixtureId));
  assert.equal(used.size, 3);

  const built = build(rows, [5], used);
  const ids = idsOf(built.bets[5]);

  // Every unused fixture is taken before any reuse happens.
  const fresh = ids.filter((id) => !used.has(id));
  const reused = ids.filter((id) => used.has(id));
  assert.equal(fresh.length, 3, "all three unused fixtures must be used first");
  assert.equal(reused.length, 2, "exactly the shortfall is reused — no more");
  assert.equal(built.reusedByVariant[5].length, 2);

  // NOT the naive "first five of the ranked pool", which would have reused all
  // three of the 3-ticket's fixtures and added only two new ones.
  assert.notDeepEqual(ids, [1, 2, 3, 4, 5]);
});

test("reuse follows the existing rank order, deterministically", () => {
  const rows = pool(6);
  const used = new Set([1, 2, 3]);
  const first = idsOf(build(rows, [5], used).bets[5]);
  const second = idsOf(build(rows, [5], used).bets[5]);

  assert.deepEqual(first, second, "same input must give the same ticket");
  // Fresh 4,5,6 plus the two highest-ranked reused, which are 1 and 2.
  assert.deepEqual(first, [1, 2, 4, 5, 6]);
});

test("total exclusion still builds, reusing only what is needed", () => {
  const built = build(pool(8), [3], new Set([1, 2, 3, 4, 5, 6, 7, 8]));

  assert.equal(built.bets[3].selections.length, 3);
  assert.equal(built.reusedByVariant[3].length, 3, "every leg is a reuse when nothing is fresh");
});

// ── quality is never traded for variety ────────────────────────────────────

test("an unqualified fixture is NOT promoted to avoid duplication", () => {
  // Three qualified fixtures and three that fail existing gates: one below the
  // odds floor, one below the probability floor, one not recommendable.
  const rows = [
    ...pool(3),
    fixture(90, [goodMarket({ odds: MIN_SELECTION_ODD - 0.05, probability: 0.9 })]),
    fixture(91, [goodMarket({ probability: PROB_FLOOR - 0.05 })]),
    fixture(92, [goodMarket({ recommendable: false, probability: 0.9 })])
  ];

  const built = build(rows, [3], new Set([1, 2, 3]));
  const ids = idsOf(built.bets[3]);

  // The three rejects never appear, even though taking them would have avoided
  // every reuse. Reusing a qualified fixture beats admitting an unqualified one.
  for (const rejected of [90, 91, 92]) {
    assert.equal(ids.includes(rejected), false, `fixture ${rejected} failed a gate and must stay out`);
  }
  assert.deepEqual(ids, [1, 2, 3], "only three qualified fixtures exist, so all three are reused");
});

test("exclusion cannot rescue a pool that was never buildable", () => {
  const built = build(pool(2), [3], new Set());
  assert.equal(built.bets[3], undefined);
  assert.deepEqual(built.unavailable, [{ variant: 3, available: 2, required: 3 }]);
});

test("the gates themselves are untouched by exclusion", () => {
  const rows = pool(10);
  const plain = build(rows, [3]);
  const excluded = build(rows, [3], new Set([1, 2]));

  // Same pool, same counters — only WHICH qualified legs were taken differs.
  assert.equal(excluded.pool.length, plain.pool.length);
  assert.deepEqual(excluded.rejected, plain.rejected);
  assert.equal(excluded.examined, plain.examined);
});

// ── fixture identity ───────────────────────────────────────────────────────

test("one fixture is one match, whatever market was taken on it", () => {
  // Fixture 1 offers three qualified markets. It consumes ONE slot, and
  // excluding it removes the whole fixture rather than a single market.
  const rows = [
    fixture(1, [
      goodMarket({ probability: 0.95, type: "Over 1.5", line: 1.5 }),
      goodMarket({ probability: 0.94, type: "Over 2.5", line: 2.5 }),
      goodMarket({ probability: 0.93, type: "Under 4.5", line: 4.5 })
    ]),
    ...pool(4).slice(1)
  ];

  const plain = build(rows, [3]);
  assert.equal(new Set(plain.bets[3].selections.map((s) => s.fixtureId)).size, 3, "within-ticket dedup holds");

  const excluded = build(rows, [3], new Set([1]));
  assert.equal(
    excluded.bets[3].selections.some((s) => s.fixtureId === 1),
    false,
    "excluding a fixture must exclude all of its markets"
  );
});

test("within-ticket dedup survives: no ticket ever repeats a fixture", () => {
  for (const variant of [3, 5, 8]) {
    const built = build(pool(12), [variant], new Set([1, 2]));
    const ids = built.bets[variant].selections.map((s) => s.fixtureId);
    assert.equal(new Set(ids).size, ids.length, `variant ${variant} repeated a fixture`);
  }
});

// ── the primitive in isolation ─────────────────────────────────────────────

test("selectVariantLegs accepts an array or a Set, and never mutates the pool", () => {
  const ranked = build(pool(8), []).pool;
  const before = ranked.map((c) => c.fixtureId);

  const fromSet = selectVariantLegs(ranked, 3, new Set([1, 2]));
  const fromArray = selectVariantLegs(ranked, 3, [1, 2]);

  assert.deepEqual(
    fromSet.selections.map((s) => s.fixtureId),
    fromArray.selections.map((s) => s.fixtureId)
  );
  assert.deepEqual(
    ranked.map((c) => c.fixtureId),
    before,
    "the ranked pool must not be reordered in place"
  );
});

test("selectVariantLegs returns null rather than a short ticket", () => {
  const ranked = build(pool(2), []).pool;
  assert.equal(selectVariantLegs(ranked, 3, new Set()), null);
});

// ── odds and probability semantics are unchanged ───────────────────────────

test("ticket math is unaffected: the stored figures still derive from the legs", () => {
  const built = build(pool(10), [3], new Set([1, 2])).bets[3];
  const legs = built.selections;

  const expectedOdds = Number(legs.reduce((acc, s) => acc * s.odds, 1).toFixed(3));
  const expectedProb = Number(legs.reduce((acc, s) => acc * s.probability, 1).toFixed(4));
  const expectedConf = Number((legs.reduce((acc, s) => acc + s.confidence, 0) / legs.length).toFixed(2));

  assert.equal(built.totalOdds, expectedOdds);
  assert.equal(built.estimatedTicketProbability, expectedProb);
  assert.equal(built.averageConfidence, expectedConf);
  assert.equal(built.variant, 3);
});

// ── the scope reader: isolation ────────────────────────────────────────────

/** Records the filters applied, and answers with the configured rows. */
function fakeSupabase({ bets = [], selections = [] } = {}) {
  const log = { queries: [] };
  return {
    log,
    from(table) {
      const ctx = { table, eqs: {}, ins: {} };
      log.queries.push(ctx);
      const b = {
        select: (cols) => ((ctx.select = cols), b),
        eq: (col, val) => ((ctx.eqs[col] = val), b),
        in: (col, vals) => ((ctx.ins[col] = vals), b),
        then: (res, rej) =>
          Promise.resolve({
            data:
              table === "special_bets"
                ? bets.filter((x) => Object.entries(ctx.eqs).every(([k, v]) => x[k] === v))
                : selections.filter((s) => (ctx.ins.special_bet_id || []).includes(s.special_bet_id)),
            error: null
          }).then(res, rej)
      };
      return b;
    }
  };
}

const BET_DATE = "2026-09-05";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const storedBets = [
  { id: "g1", bet_date: BET_DATE, bet_type: "GLOBAL", user_id: null },
  { id: "a1", bet_date: BET_DATE, bet_type: "USER", user_id: USER_A },
  { id: "b1", bet_date: BET_DATE, bet_type: "USER", user_id: USER_B },
  { id: "old", bet_date: "2026-09-04", bet_type: "GLOBAL", user_id: null }
];
const storedSelections = [
  { special_bet_id: "g1", fixture_id: 11 },
  { special_bet_id: "a1", fixture_id: 22 },
  { special_bet_id: "b1", fixture_id: 33 },
  { special_bet_id: "old", fixture_id: 44 }
];

test("GLOBAL scope sees only GLOBAL tickets of that day", async () => {
  const supabase = fakeSupabase({ bets: storedBets, selections: storedSelections });
  const used = await loadUsedFixtureIds(supabase, { betDate: BET_DATE });

  // Not the users' fixtures (22, 33) and not yesterday's (44).
  assert.deepEqual([...used], [11]);
  const betsQuery = supabase.log.queries[0];
  assert.equal(betsQuery.eqs.bet_type, "GLOBAL");
  assert.equal(betsQuery.eqs.bet_date, BET_DATE);
  assert.equal("user_id" in betsQuery.eqs, false, "GLOBAL scope must not key on a user");
});

test("USER scope sees only that user's tickets — no cross-user leakage", async () => {
  const supabase = fakeSupabase({ bets: storedBets, selections: storedSelections });
  const usedA = await loadUsedFixtureIds(supabase, { betDate: BET_DATE, userId: USER_A });
  assert.deepEqual([...usedA], [22], "user A must not see user B's fixture or the GLOBAL one");

  const other = fakeSupabase({ bets: storedBets, selections: storedSelections });
  const usedB = await loadUsedFixtureIds(other, { betDate: BET_DATE, userId: USER_B });
  assert.deepEqual([...usedB], [33]);

  const q = other.log.queries[0];
  assert.equal(q.eqs.user_id, USER_B);
  assert.equal(q.eqs.bet_type, "USER");
});

test("the reader is two bounded queries, never one per ticket", async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    id: `g${i}`,
    bet_date: BET_DATE,
    bet_type: "GLOBAL",
    user_id: null
  }));
  const supabase = fakeSupabase({
    bets: many,
    selections: many.map((b, i) => ({ special_bet_id: b.id, fixture_id: 100 + i }))
  });

  const used = await loadUsedFixtureIds(supabase, { betDate: BET_DATE });
  assert.equal(used.size, 25);
  assert.equal(supabase.log.queries.length, 2, "25 tickets must still cost exactly two queries");
  assert.equal(supabase.log.queries[1].ins.special_bet_id.length, 25);
});

test("no tickets yet, a missing date or no client all yield an empty set", async () => {
  assert.equal((await loadUsedFixtureIds(fakeSupabase({}), { betDate: BET_DATE })).size, 0);
  assert.equal((await loadUsedFixtureIds(fakeSupabase({ bets: storedBets }), {})).size, 0);
  assert.equal((await loadUsedFixtureIds(null, { betDate: BET_DATE })).size, 0);
});

test("exclusion state is derived per call — nothing accumulates between them", async () => {
  const first = await loadUsedFixtureIds(fakeSupabase({ bets: storedBets, selections: storedSelections }), {
    betDate: BET_DATE
  });
  const second = await loadUsedFixtureIds(fakeSupabase({ bets: storedBets, selections: storedSelections }), {
    betDate: BET_DATE
  });
  assert.deepEqual([...first], [...second]);
});
