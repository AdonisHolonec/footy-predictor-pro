import assert from "node:assert/strict";
import { test } from "node:test";

import { createGlobalSpecialBet, createGlobalSystemBets } from "../server-utils/globalSpecialBets.js";
import { loadUsedFixtureIds } from "../server-utils/ticketFixtureUsage.js";

/**
 * USER tickets ("My Bets") — the diversification rule, proved through the
 * SERVICE rather than through the engine.
 *
 * The engine-level rule is covered by tests/ticketFixtureDiversification.test.js.
 * What that suite cannot show is that the USER path actually reaches it with the
 * right scope, so this one drives `createGlobalSpecialBet` end to end against a
 * recording double and asserts three things the engine tests cannot:
 *
 *   1. The USER candidate universe is still the user's OWN leagues. The GLOBAL
 *      path is admin-wide by construction; USER must NOT become admin-wide as a
 *      side effect of sharing the selection primitive.
 *
 *   2. The exclusion is scoped to `{betDate, userId}`. A second user's tickets,
 *      a GLOBAL ticket and another date must all be invisible to it — asserted
 *      on the FILTERS the query carries, not merely on today's output.
 *
 *   3. The variants really are disjoint when the pool allows, asserted by
 *      fixture id on the rows the RPC was asked to persist.
 */

const NOW = Date.parse("2026-09-05T10:00:00.000Z");
const KICKOFF = "2026-09-05T18:00:00.000Z";
const BET_DATE = "2026-09-05";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

const payload = (id, leagueId, markets) => ({
  id,
  leagueId,
  kickoff: KICKOFF,
  teams: { home: `Home ${id}`, away: `Away ${id}` },
  recommended: { confidence: 80 },
  modelMeta: { dataQuality: 0.8 },
  insufficientData: false,
  valueEngine: { markets }
});

/** `n` history rows in the user's leagues, ranked by descending probability. */
const historyRows = (n, leagueId = 39) =>
  Array.from({ length: n }, (_, i) => ({
    fixture_id: i + 1,
    league_id: leagueId,
    league_name: "Premier League",
    kickoff_at: KICKOFF,
    raw_payload: payload(i + 1, leagueId, [goodMarket({ probability: 0.95 - i * 0.01 })])
  }));

/**
 * Table-aware double. `special_bets` / `special_bet_selections` answer the
 * stored tickets so the exclusion set is real; `predictions_history` answers the
 * candidate pool. Every filter is recorded so scope can be asserted.
 */
function fakeSupabase({ rows = [], storedBets = [], storedSelections = [], rpcResult } = {}) {
  const log = { rpc: [], queries: [] };

  return {
    log,
    from(table) {
      const ctx = { table, eqs: {}, ins: {}, phase: "pool" };
      log.queries.push(ctx);
      const b = {
        select: (cols) => ((ctx.select = cols), b),
        eq: (col, val) => ((ctx.eqs[col] = val), b),
        is: (col, val) => ((ctx.eqs[`is:${col}`] = val), b),
        not: () => b,
        in: (col, vals) => ((ctx.ins[col] = vals), b),
        gt: () => b,
        gte: () => ((ctx.phase = "day"), b),
        lte: () => b,
        order: () => b,
        limit: () => b,
        then(resolve) {
          if (table === "special_bets") {
            return resolve({
              data: storedBets.filter((x) => Object.entries(ctx.eqs).every(([k, v]) => x[k] === v)),
              error: null
            });
          }
          if (table === "special_bet_selections") {
            return resolve({
              data: storedSelections.filter((s) => (ctx.ins.special_bet_id || []).includes(s.special_bet_id)),
              error: null
            });
          }
          // predictions_history: the day-window scan returns nothing, so the
          // league summary stays empty and does not disturb these assertions.
          return resolve({ data: ctx.phase === "day" ? [] : rows, error: null });
        }
      };
      return b;
    },
    async rpc(name, params) {
      log.rpc.push({ name, params });
      return {
        data: rpcResult
          ? rpcResult(params)
          : { ok: true, created: true, bet: { id: `bet-${log.rpc.length}`, total_odds: 1 }, selections: [] },
        error: null
      };
    }
  };
}

const create = (supabase, variant, userId = USER_A, leagueIds = [39]) =>
  createGlobalSpecialBet({ userId, betDate: BET_DATE, variant, leagueIds, now: NOW, supabase });

/** The fixture ids the RPC was asked to persist. */
const persisted = (supabase, index = 0) =>
  supabase.log.rpc[index].params.p_selections.map((s) => s.fixture_id).sort((a, b) => a - b);

const intersect = (a, b) => a.filter((x) => b.includes(x));

/** A stored ticket plus its legs, as the exclusion reader will see them. */
function storedTicket(id, userId, fixtureIds, betDate = BET_DATE) {
  return {
    bet: { id, bet_date: betDate, bet_type: userId ? "USER" : "GLOBAL", user_id: userId },
    selections: fixtureIds.map((fixture_id) => ({ special_bet_id: id, fixture_id }))
  };
}

// ── the USER regression ────────────────────────────────────────────────────

test("REGRESSION: a user's 3 / 5 / 8 are pairwise disjoint when the pool allows", async () => {
  const rows = historyRows(20);

  const s3 = fakeSupabase({ rows });
  await create(s3, 3);
  const three = persisted(s3);

  const t3 = storedTicket("u3", USER_A, three);
  const s5 = fakeSupabase({ rows, storedBets: [t3.bet], storedSelections: t3.selections });
  await create(s5, 5);
  const five = persisted(s5);

  const t5 = storedTicket("u5", USER_A, five);
  const s8 = fakeSupabase({
    rows,
    storedBets: [t3.bet, t5.bet],
    storedSelections: [...t3.selections, ...t5.selections]
  });
  await create(s8, 8);
  const eight = persisted(s8);

  assert.equal(three.length, 3);
  assert.equal(five.length, 5);
  assert.equal(eight.length, 8);

  assert.deepEqual(intersect(three, five), [], "the 5 must not reuse the 3's matches");
  assert.deepEqual(intersect(three, eight), [], "the 8 must not reuse the 3's matches");
  assert.deepEqual(intersect(five, eight), [], "the 8 must not reuse the 5's matches");
  assert.equal(new Set([...three, ...five, ...eight]).size, 16);
});

test("FALLBACK: a constrained user pool reuses only the shortfall", async () => {
  // Six qualified fixtures; a 3 is already stored, so a 5 has three left.
  const rows = historyRows(6);
  const stored = storedTicket("u3", USER_A, [1, 2, 3]);
  const supabase = fakeSupabase({ rows, storedBets: [stored.bet], storedSelections: stored.selections });

  await create(supabase, 5);
  const ids = persisted(supabase);

  const fresh = ids.filter((id) => ![1, 2, 3].includes(id));
  const reused = ids.filter((id) => [1, 2, 3].includes(id));
  assert.equal(fresh.length, 3, "every unused fixture is taken first");
  assert.equal(reused.length, 2, "exactly the shortfall is reused");
  assert.notDeepEqual(ids, [1, 2, 3, 4, 5], "never the naive ranked prefix");
});

test("a user with no prior ticket is unaffected — the rule only subtracts", async () => {
  const supabase = fakeSupabase({ rows: historyRows(10) });
  await create(supabase, 3);
  assert.deepEqual(persisted(supabase), [1, 2, 3], "the top of the ranked pool, exactly as before");
});

// ── the USER candidate universe stays the user's own ───────────────────────

test("the USER pool is still league-scoped — it did not become admin-wide", async () => {
  const supabase = fakeSupabase({ rows: historyRows(10) });
  await create(supabase, 3, USER_A, [39, 140]);

  const poolQuery = supabase.log.queries.find((q) => q.table === "predictions_history" && q.ins.league_id);
  assert.ok(poolQuery, "the candidate read must still carry a league predicate");
  assert.deepEqual(poolQuery.ins.league_id, [39, 140], "the user's own leagues, canonicalised");
});

test("the league scope the user asked for is still what is persisted", async () => {
  const supabase = fakeSupabase({ rows: historyRows(10) });
  await create(supabase, 3, USER_A, [140, 39, 39]);

  // Deduped and sorted by the existing canonicalisation — unchanged behaviour.
  assert.deepEqual(supabase.log.rpc[0].params.p_league_ids, [39, 140]);
  assert.equal(supabase.log.rpc[0].params.p_user_id, USER_A, "ownership is unchanged");
  assert.equal(supabase.log.rpc[0].name, "create_global_special_bet", "the USER RPC, never the GLOBAL one");
});

// ── isolation ──────────────────────────────────────────────────────────────

test("the exclusion query is scoped to this user and this date", async () => {
  const supabase = fakeSupabase({ rows: historyRows(10) });
  await create(supabase, 3, USER_A);

  const usage = supabase.log.queries.find((q) => q.table === "special_bets");
  assert.ok(usage, "a usage read must happen");
  assert.equal(usage.eqs.user_id, USER_A);
  assert.equal(usage.eqs.bet_type, "USER");
  assert.equal(usage.eqs.bet_date, BET_DATE);
});

test("user B's tickets cannot narrow user A's pool", async () => {
  const rows = historyRows(10);
  const b = storedTicket("ub", USER_B, [1, 2, 3]);
  const supabase = fakeSupabase({ rows, storedBets: [b.bet], storedSelections: b.selections });

  await create(supabase, 3, USER_A);
  // A's ticket is the untouched top of the pool: B's usage was never seen.
  assert.deepEqual(persisted(supabase), [1, 2, 3]);
});

test("a GLOBAL ticket cannot narrow a user's pool", async () => {
  const rows = historyRows(10);
  const g = storedTicket("g1", null, [1, 2, 3]);
  const supabase = fakeSupabase({ rows, storedBets: [g.bet], storedSelections: g.selections });

  await create(supabase, 3, USER_A);
  assert.deepEqual(persisted(supabase), [1, 2, 3], "the product's ticket is not the user's history");
});

test("a user's ticket on another date does not narrow today", async () => {
  const rows = historyRows(10);
  const yesterday = storedTicket("uy", USER_A, [1, 2, 3], "2026-09-04");
  const supabase = fakeSupabase({ rows, storedBets: [yesterday.bet], storedSelections: yesterday.selections });

  await create(supabase, 3, USER_A);
  assert.deepEqual(persisted(supabase), [1, 2, 3]);
});

test("the reader itself refuses to cross a user boundary", async () => {
  const a = storedTicket("ua", USER_A, [11]);
  const b = storedTicket("ub", USER_B, [22]);
  const g = storedTicket("g1", null, [33]);
  const all = {
    storedBets: [a.bet, b.bet, g.bet],
    storedSelections: [...a.selections, ...b.selections, ...g.selections]
  };

  const forA = await loadUsedFixtureIds(fakeSupabase(all), { betDate: BET_DATE, userId: USER_A });
  const forB = await loadUsedFixtureIds(fakeSupabase(all), { betDate: BET_DATE, userId: USER_B });
  const forGlobal = await loadUsedFixtureIds(fakeSupabase(all), { betDate: BET_DATE });

  assert.deepEqual([...forA], [11]);
  assert.deepEqual([...forB], [22]);
  assert.deepEqual([...forGlobal], [33]);
});

// ── quality is never traded for variety, on the USER path too ──────────────

test("an unqualified fixture is not promoted to spare the user a duplicate", async () => {
  // Three qualified fixtures, all already used, plus one that fails a gate.
  const rows = [
    ...historyRows(3),
    {
      fixture_id: 90,
      league_id: 39,
      league_name: "Premier League",
      kickoff_at: KICKOFF,
      raw_payload: payload(90, 39, [goodMarket({ recommendable: false, probability: 0.99 })])
    }
  ];
  const stored = storedTicket("u3", USER_A, [1, 2, 3]);
  const supabase = fakeSupabase({ rows, storedBets: [stored.bet], storedSelections: stored.selections });

  await create(supabase, 3, USER_A);
  const ids = persisted(supabase);

  assert.equal(ids.includes(90), false, "a rejected candidate stays rejected");
  assert.deepEqual(ids, [1, 2, 3], "reuse beats admitting an unqualified fixture");
});

test("a pool too thin to build writes nothing and says so", async () => {
  const supabase = fakeSupabase({ rows: historyRows(2) });
  const result = await create(supabase, 3, USER_A);

  assert.equal(result.available, false);
  assert.equal(result.created, false);
  assert.deepEqual(supabase.log.rpc, [], "nothing may be persisted when nothing can be built");
});

// ── existing semantics survive ─────────────────────────────────────────────

test("idempotency is untouched: an existing ticket is surfaced, not duplicated", async () => {
  const supabase = fakeSupabase({
    rows: historyRows(10),
    rpcResult: () => ({ ok: true, created: false, bet: { id: "existing", ticket_probability: "0.5" }, selections: [] })
  });
  const result = await create(supabase, 3, USER_A);

  assert.equal(result.created, false);
  assert.equal(result.available, true);
  assert.equal(result.bet.id, "existing");
});

test("ticket math still derives from the legs that were chosen", async () => {
  const supabase = fakeSupabase({ rows: historyRows(10) });
  await create(supabase, 3, USER_A);
  const p = supabase.log.rpc[0].params;

  assert.equal(p.p_selections.length, 3);
  assert.equal(new Set(p.p_selections.map((s) => s.fixture_id)).size, 3, "within-ticket dedup holds");
  assert.ok(p.p_total_odds > 1);
  assert.ok(p.p_ticket_probability > 0 && p.p_ticket_probability <= 1);
  assert.equal(p.p_bet_kind, undefined, "the Combo payload shape is unchanged");
});

// ── Combo and System share one budget of fixtures ──────────────────────────

/*
  THE MUTUAL RULE. A user's day is one pool of matches, so both products draw
  from it and both subtract from it:

      USER Combo  excludes the user's System fixtures
      USER System excludes the user's Combo fixtures

  Whichever the punter builds first no longer owns the pool. This is why
  `loadUsedFixtureIds` carries NO `bet_kind` filter — the absence is the
  feature, and these tests are what stops someone "tidying" one in.

  The engine-level rule is proved in globalSpecialBetSystemEngine.test.js;
  what only the service can show is that the System path reaches it with the
  right scope, which is what everything below drives.
*/

const createSystem = (supabase, userId = USER_A, leagueIds = [39]) =>
  createGlobalSystemBets({ userId, betDate: BET_DATE, leagueIds, systemK: 3, now: NOW, supabase });

test("REGRESSION: Combo and System alternate and never collide", async () => {
  /*
    The production-shaped sequence: System, Combo, System, Combo, from one pool
    of twenty. Each ticket is generated by its own call against the tickets the
    previous ones persisted — separate HTTP requests, exactly as the product
    issues them.
  */
  const rows = historyRows(20);
  const storedBets = [];
  const storedSelections = [];
  const tickets = [];

  const record = (id, fixtureIds) => {
    const t = storedTicket(id, USER_A, fixtureIds);
    storedBets.push(t.bet);
    storedSelections.push(...t.selections);
    tickets.push({ id, fixtureIds });
  };

  const sys1 = fakeSupabase({ rows, storedBets: [...storedBets], storedSelections: [...storedSelections] });
  await createSystem(sys1);
  record("s1", persisted(sys1));

  const combo1 = fakeSupabase({ rows, storedBets: [...storedBets], storedSelections: [...storedSelections] });
  await create(combo1, 3);
  record("c1", persisted(combo1));

  const sys2 = fakeSupabase({ rows, storedBets: [...storedBets], storedSelections: [...storedSelections] });
  await createSystem(sys2);
  record("s2", persisted(sys2));

  const combo2 = fakeSupabase({ rows, storedBets: [...storedBets], storedSelections: [...storedSelections] });
  await create(combo2, 5);
  record("c2", persisted(combo2));

  assert.deepEqual(
    tickets.map((t) => t.fixtureIds.length),
    [5, 3, 5, 5],
    "System 5, Combo 3, System 5, Combo 5"
  );

  // Every pair disjoint — regardless of which KIND came before which.
  for (let i = 0; i < tickets.length; i += 1) {
    for (let j = i + 1; j < tickets.length; j += 1) {
      assert.deepEqual(
        intersect(tickets[i].fixtureIds, tickets[j].fixtureIds),
        [],
        `${tickets[i].id} and ${tickets[j].id} must not share a match`
      );
    }
  }
  assert.equal(
    new Set(tickets.flatMap((t) => t.fixtureIds)).size,
    18,
    "eighteen distinct matches across four tickets"
  );
});

test("SECOND REGRESSION: seven fixtures, two Systems, minimum reuse", async () => {
  const rows = historyRows(7);

  const first = fakeSupabase({ rows });
  await createSystem(first);
  const firstIds = persisted(first);
  assert.equal(firstIds.length, 5);

  const stored = storedTicket("s1", USER_A, firstIds);
  const second = fakeSupabase({ rows, storedBets: [stored.bet], storedSelections: stored.selections });
  await createSystem(second);
  const secondIds = persisted(second);

  assert.equal(secondIds.length, 5, "still a five-leg System");
  assert.equal(new Set(secondIds).size, 5, "five DISTINCT fixtures");

  const fresh = secondIds.filter((id) => !firstIds.includes(id));
  const reused = secondIds.filter((id) => firstIds.includes(id));
  assert.equal(fresh.length, 2, "both remaining fresh fixtures are taken");
  assert.equal(reused.length, 3, "exactly the shortfall, 5 - 2");
  // Nothing outside the qualified seven was invented to avoid the reuse.
  assert.equal(
    secondIds.every((id) => id >= 1 && id <= 7),
    true,
    "no unqualified fixture was introduced"
  );
});

test("a System excludes the user's COMBO fixtures", async () => {
  const rows = historyRows(20);
  const combo = storedTicket("c1", USER_A, [1, 2, 3]);
  const supabase = fakeSupabase({ rows, storedBets: [combo.bet], storedSelections: combo.selections });

  await createSystem(supabase);
  const ids = persisted(supabase);

  assert.deepEqual(intersect(ids, [1, 2, 3]), [], "the combo's matches are not reused");
  assert.equal(ids.length, 5);
});

test("a COMBO excludes the user's SYSTEM fixtures — the other direction", async () => {
  const rows = historyRows(20);
  const system = storedTicket("s1", USER_A, [1, 2, 3, 4, 5]);
  const supabase = fakeSupabase({ rows, storedBets: [system.bet], storedSelections: system.selections });

  await create(supabase, 3);
  const ids = persisted(supabase);

  assert.deepEqual(intersect(ids, [1, 2, 3, 4, 5]), [], "the system's matches are not reused");
  assert.equal(ids.length, 3);
});

test("the System exclusion query carries the same scope the Combo one does", async () => {
  const supabase = fakeSupabase({ rows: historyRows(20) });
  await createSystem(supabase);

  const usage = supabase.log.queries.find((q) => q.table === "special_bets");
  assert.ok(usage, "the System path must read stored usage");
  assert.equal(usage.eqs.user_id, USER_A);
  assert.equal(usage.eqs.bet_type, "USER");
  assert.equal(usage.eqs.bet_date, BET_DATE);
  // The absence that makes the rule mutual: filtering by kind would split the
  // budget in two and let each product quietly reuse the other's matches.
  assert.equal("bet_kind" in usage.eqs, false, "the usage read must NOT filter by bet_kind");
  assert.equal("league_scope" in usage.eqs, false, "nor by league scope");
});

test("a System under a DIFFERENT league scope still excludes the earlier one", async () => {
  /*
    `league_scope` is part of the ticket's uniqueness key, so these are two rows
    — and they must still see each other. The exclusion scope is deliberately
    NOT the uniqueness key.
  */
  const rows = historyRows(20);
  const first = storedTicket("s1", USER_A, [1, 2, 3, 4, 5]);
  const supabase = fakeSupabase({ rows, storedBets: [first.bet], storedSelections: first.selections });

  await createSystem(supabase, USER_A, [39, 140]);
  const ids = persisted(supabase);

  assert.deepEqual(intersect(ids, [1, 2, 3, 4, 5]), [], "a new league selection is not a fresh budget");
});

test("another user's System cannot narrow this user's System", async () => {
  const rows = historyRows(20);
  const b = storedTicket("sb", USER_B, [1, 2, 3, 4, 5]);
  const supabase = fakeSupabase({ rows, storedBets: [b.bet], storedSelections: b.selections });

  await createSystem(supabase, USER_A);
  assert.deepEqual(persisted(supabase), [1, 2, 3, 4, 5], "user B's usage was never seen");
});

test("a GLOBAL ticket cannot narrow a user's System", async () => {
  const rows = historyRows(20);
  const g = storedTicket("g1", null, [1, 2, 3, 4, 5]);
  const supabase = fakeSupabase({ rows, storedBets: [g.bet], storedSelections: g.selections });

  await createSystem(supabase, USER_A);
  assert.deepEqual(persisted(supabase), [1, 2, 3, 4, 5], "the product's ticket is not the user's history");
});

test("yesterday's System does not narrow today's", async () => {
  const rows = historyRows(20);
  const yesterday = storedTicket("sy", USER_A, [1, 2, 3, 4, 5], "2026-09-04");
  const supabase = fakeSupabase({ rows, storedBets: [yesterday.bet], storedSelections: yesterday.selections });

  await createSystem(supabase, USER_A);
  assert.deepEqual(persisted(supabase), [1, 2, 3, 4, 5]);
});

test("the System payload still says system, k=3, five legs", async () => {
  const rows = historyRows(20);
  const combo = storedTicket("c1", USER_A, [1, 2]);
  const supabase = fakeSupabase({ rows, storedBets: [combo.bet], storedSelections: combo.selections });

  await createSystem(supabase);
  const p = supabase.log.rpc[0].params;

  assert.equal(p.p_bet_kind, "system");
  assert.equal(p.p_system_k, 3);
  assert.equal(p.p_variant, 5);
  assert.equal(p.p_selections.length, 5);
  assert.equal(new Set(p.p_selections.map((s) => s.fixture_id)).size, 5, "within-ticket dedup holds");
  assert.ok(p.p_total_odds > 1, "still the product of the five odds");
  assert.ok(p.p_ticket_probability > 0 && p.p_ticket_probability <= 1, "still P(X >= k)");
  assert.equal(p.p_user_id, USER_A, "ownership is unchanged");
});

test("a System pool too thin to build writes nothing, exclusion or not", async () => {
  const rows = historyRows(6);
  const combo = storedTicket("c1", USER_A, [1, 2, 3]);
  const supabase = fakeSupabase({ rows, storedBets: [combo.bet], storedSelections: combo.selections });

  // Three fresh remain, so the ticket is built with two reused — not refused.
  const built = await createSystem(supabase);
  assert.equal(built.available, true);
  assert.equal(persisted(supabase).length, 5);

  // But a genuinely thin pool still refuses, and still writes nothing.
  const thin = fakeSupabase({ rows: historyRows(4) });
  const result = await createSystem(thin);
  assert.equal(result.available, false);
  assert.equal(result.created, false);
  assert.equal(result.unavailable[0].reason, "insufficient_system_candidates");
  assert.deepEqual(thin.log.rpc, [], "nothing may be persisted when nothing can be built");
});
