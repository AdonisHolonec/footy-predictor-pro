import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createGlobalSpecialBet,
  createGlobalSystemBets,
  loadCandidatePayloads,
  loadUserCandidatePayloads,
  restoreProjectionCounters
} from "../server-utils/globalSpecialBets.js";
import { collectGlobalCandidates } from "../server-utils/globalSpecialBetEngine.js";
import { buildTicketCandidates } from "../server-utils/ticketCandidateColumn.js";

/**
 * USER candidate source: raw_payload -> ticket_candidates.
 *
 * The switch is only safe if the two sources are INDISTINGUISHABLE to the
 * engine, so these drive BOTH loaders over the SAME rows and compare what comes
 * out — candidates, ranking, and the legs each product finally takes.
 *
 * The projection deliberately stores only `recommendable === true` markets, so
 * a collector reading it cannot see the discarded ones and cannot count them.
 * That is why `examined` and `notRecommendable` are stored per row, and why the
 * loader hands them back for restoreProjectionCounters to fold in: the
 * unavailable-variant reason has to keep meaning what it meant.
 */

const NOW = Date.parse("2026-09-07T10:00:00.000Z");
const KICKOFF = "2026-09-07T18:00:00.000Z";
const BET_DATE = "2026-09-07";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const goodMarket = (o = {}) => ({
  type: "Over 2.5",
  family: "Goals",
  line: 2.5,
  odds: 1.9,
  probability: 0.7,
  valueScore: 60,
  recommendable: true,
  tradable: true,
  settleable: true,
  betType: "over_under",
  period: "full_match",
  scope: "match",
  ...o
});

/** A payload with the given recommendable markets plus `drop` that are not. */
const payload = (id, leagueId, keep, drop = 0, o = {}) => ({
  id,
  leagueId,
  kickoff: KICKOFF,
  modelVersion: "predictor-v3.1-test",
  teams: { home: `Home ${id}`, away: `Away ${id}` },
  recommended: { confidence: 80 },
  modelMeta: { dataQuality: 0.8 },
  insufficientData: false,
  valueEngine: {
    markets: [
      ...keep,
      ...Array.from({ length: drop }, (_, i) => goodMarket({ recommendable: false, type: `Junk ${i}` }))
    ]
  },
  ...o
});

/** One history row carrying BOTH columns, exactly as the live writer produces. */
const row = (id, leagueId, keep, drop = 0, extra = {}) => {
  const p = payload(id, leagueId, keep, drop, extra);
  return {
    fixture_id: id,
    league_id: leagueId,
    league_name: "Premier League",
    kickoff_at: KICKOFF,
    model_version: p.modelVersion,
    raw_payload: p,
    ticket_candidates: buildTicketCandidates(p)
  };
};

/** `n` fixtures with descending probability, each hiding three junk markets. */
const pool = (n = 10, leagueId = 39) =>
  Array.from({ length: n }, (_, i) => row(i + 1, leagueId, [goodMarket({ probability: 0.92 - i * 0.01 })], 3));

/**
 * Table-aware double. `predictions_history` answers the candidate read; the
 * ticket tables answer the exclusion read. Every filter is recorded so scope is
 * asserted rather than inferred from output.
 */
function fakeSupabase({ rows = [], storedBets = [], storedSelections = [], rpcResult } = {}) {
  const log = { rpc: [], queries: [] };
  return {
    log,
    from(table) {
      const ctx = { table, eqs: {}, ins: {}, nots: [], select: null };
      log.queries.push(ctx);
      const b = {
        select: (cols) => ((ctx.select = cols), b),
        eq: (c, v) => ((ctx.eqs[c] = v), b),
        not: (c, op, v) => (ctx.nots.push([c, op, v]), b),
        is: () => b,
        in: (c, v) => ((ctx.ins[c] = v), b),
        gt: () => b,
        gte: () => b,
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
          // predictions_history. Only the candidate read carries the projection
          // filter, which is what distinguishes it from the day scan.
          const isCandidateRead = ctx.nots.some(([c]) => c === "ticket_candidates");
          const scoped = ctx.ins.league_id ? rows.filter((r) => ctx.ins.league_id.includes(r.league_id)) : rows;
          return resolve({
            data: isCandidateRead ? scoped.filter((r) => r.ticket_candidates != null) : scoped,
            error: null
          });
        }
      };
      return b;
    },
    async rpc(name, params) {
      log.rpc.push({ name, params });
      return {
        data: rpcResult ? rpcResult(params) : { ok: true, created: true, bet: { id: "bet-1" }, selections: [] },
        error: null
      };
    }
  };
}

const both = (rows, leagueIds = [39]) =>
  Promise.all([
    loadCandidatePayloads(fakeSupabase({ rows }), leagueIds, NOW),
    loadUserCandidatePayloads(fakeSupabase({ rows }), leagueIds, NOW)
  ]);

const CAND_FIELDS = [
  "fixtureId",
  "leagueId",
  "kickoff",
  "fixtureLabel",
  "leagueName",
  "market",
  "selection",
  "side",
  "line",
  "probability",
  "odds",
  "confidence",
  "valueScore",
  "dataQuality"
];

const legsOf = (supabase) => supabase.log.rpc[0].params.p_selections.map((s) => s.fixture_id).sort((a, b) => a - b);

// ── A, E, F. identical candidate sets, field for field ─────────────────────

test("[A][E][F] both sources yield identical candidates, field for field", async () => {
  const rows = pool(10);
  const [oldLoad, newLoad] = await both(rows);

  const o = collectGlobalCandidates({ rows: oldLoad.rows, leagueIds: [39], now: NOW });
  const n = collectGlobalCandidates({ rows: newLoad.rows, leagueIds: [39], now: NOW });

  assert.equal(o.candidates.length, 10);
  assert.equal(n.candidates.length, o.candidates.length, "same candidate count");

  for (let i = 0; i < o.candidates.length; i += 1) {
    for (const f of CAND_FIELDS) {
      assert.deepEqual(n.candidates[i][f], o.candidates[i][f], `candidate ${i} field ${f}`);
    }
  }
  // Fixture, league, team label and kickoff all survive the projection.
  assert.equal(n.candidates[0].fixtureLabel, "Home 1 – Away 1");
  assert.equal(n.candidates[0].leagueName, "Premier League");
  assert.equal(n.candidates[0].kickoff, KICKOFF);
});

// ── B. identical ranking ───────────────────────────────────────────────────

test("[B] ranking order is identical", async () => {
  const rows = pool(10);
  const [oldLoad, newLoad] = await both(rows);
  const o = collectGlobalCandidates({ rows: oldLoad.rows, leagueIds: [39], now: NOW });
  const n = collectGlobalCandidates({ rows: newLoad.rows, leagueIds: [39], now: NOW });

  assert.deepEqual(
    n.candidates.map((c) => c.fixtureId),
    o.candidates.map((c) => c.fixtureId)
  );
});

// ── C, D. the legs each product finally takes ──────────────────────────────

test("[C] Combo 3, 5 and 8 take legs the raw_payload pool also offered", async () => {
  for (const variant of [3, 5, 8]) {
    const rows = pool(10);
    const legacy = fakeSupabase({ rows });
    const projected = fakeSupabase({ rows });

    // The service now reads the projection, so the legacy side is exercised
    // through the engine directly: this proves the SOURCES agree, not the wiring.
    const oldLoad = await loadCandidatePayloads(legacy, [39], NOW);
    const oldBuilt = collectGlobalCandidates({ rows: oldLoad.rows, leagueIds: [39], now: NOW });

    await createGlobalSpecialBet({
      userId: USER_A,
      betDate: BET_DATE,
      variant,
      leagueIds: [39],
      now: NOW,
      supabase: projected
    });

    const chosen = legsOf(projected);
    assert.equal(chosen.length, variant, `variant ${variant} leg count`);
    for (const id of chosen) {
      assert.ok(
        oldBuilt.candidates.some((c) => c.fixtureId === id),
        `variant ${variant}: leg ${id} exists in the raw_payload pool`
      );
    }
  }
});

test("[D] System 5 (k=3) keeps its shape and its legs", async () => {
  const rows = pool(10);
  const supabase = fakeSupabase({ rows });
  await createGlobalSystemBets({ userId: USER_A, betDate: BET_DATE, leagueIds: [39], systemK: 3, now: NOW, supabase });

  const p = supabase.log.rpc[0].params;
  assert.equal(p.p_bet_kind, "system");
  assert.equal(p.p_system_k, 3);
  assert.equal(p.p_variant, 5);
  assert.equal(p.p_selections.length, 5);
  assert.equal(new Set(p.p_selections.map((s) => s.fixture_id)).size, 5, "five distinct fixtures");
});

// ── G, H. the stored counters are folded back ──────────────────────────────

test("[G][H] examined and notRecommendable survive the projection", async () => {
  // 10 fixtures x (1 recommendable + 3 junk) = 40 examined, 30 discarded.
  const rows = pool(10);
  const [oldLoad, newLoad] = await both(rows);

  const o = collectGlobalCandidates({ rows: oldLoad.rows, leagueIds: [39], now: NOW });
  const rawN = collectGlobalCandidates({ rows: newLoad.rows, leagueIds: [39], now: NOW });

  // Unrestored, the projection under-reports — this is the defect being fixed.
  assert.equal(o.examined, 40);
  assert.equal(o.rejected.notRecommendable, 30);
  assert.equal(rawN.examined, 10, "the collector can only count what it was given");
  assert.equal(rawN.rejected.notRecommendable, 0);

  const restored = restoreProjectionCounters(rawN, newLoad.counters);
  assert.equal(restored.examined, o.examined, "examined is preserved");
  assert.equal(restored.rejected.notRecommendable, o.rejected.notRecommendable, "notRecommendable is preserved");
  // Every other counter was already identical and must stay untouched.
  for (const k of Object.keys(o.rejected)) {
    if (k === "notRecommendable") continue;
    assert.equal(restored.rejected[k], o.rejected[k], `counter ${k}`);
  }
});

test("[G][H] the unavailable-variant response carries the restored counters", async () => {
  // Two fixtures only: an 8-fold cannot be built, so the reason is returned.
  const supabase = fakeSupabase({ rows: pool(2) });
  const res = await createGlobalSpecialBet({
    userId: USER_A,
    betDate: BET_DATE,
    variant: 8,
    leagueIds: [39],
    now: NOW,
    supabase
  });

  assert.equal(res.available, false);
  assert.equal(res.examined, 8, "2 fixtures x 4 markets — not the 2 the projection kept");
  assert.equal(res.rejected.notRecommendable, 6, "the discarded markets are still reported");
  assert.deepEqual(supabase.log.rpc, [], "nothing is written when nothing can be built");
});

test("[G][H] a wholesale-rejected row attributes its hidden markets to its own gate", async () => {
  /*
    insufficientData is the ONLY row-level gate reachable here: the query has
    already filtered the league and the kickoff window, so leagueNotSelected and
    alreadyStarted cannot fire. That is what makes the attribution exact.
  */
  const rows = [
    row(1, 39, [goodMarket({ probability: 0.9 })], 3, { insufficientData: true }),
    row(10, 39, [goodMarket({ probability: 0.89 })], 3),
    row(11, 39, [goodMarket({ probability: 0.88 })], 3),
    row(12, 39, [goodMarket({ probability: 0.87 })], 3)
  ];
  const [, newLoad] = await both(rows);

  assert.equal(newLoad.counters.insufficientData, 3, "hidden markets follow the row's own gate");
  assert.equal(newLoad.counters.notRecommendable, 9, "the other three rows' hidden markets");
});

// ── I. missing projection: skipped, never reconstructed ────────────────────

test("[I] a row without ticket_candidates is skipped, with no raw_payload fallback", async () => {
  const rows = pool(4);
  // A fifth row with a payload but no projection — the pre-backfill shape.
  const orphan = row(99, 39, [goodMarket({ probability: 0.99 })], 2);
  orphan.ticket_candidates = null;
  rows.push(orphan);

  const supabase = fakeSupabase({ rows });
  const load = await loadUserCandidatePayloads(supabase, [39], NOW);

  assert.equal(load.rows.length, 4, "the orphan is not in the pool");
  assert.equal(
    load.rows.some((r) => r.id === 99),
    false,
    "and it was NOT reconstructed from raw_payload"
  );

  const read = supabase.log.queries.find((q) => q.table === "predictions_history");
  assert.deepEqual(
    read.nots.find(([c]) => c === "ticket_candidates"),
    ["ticket_candidates", "is", null],
    "the database is asked to exclude it, so it never reaches the wire"
  );
  assert.equal(/raw_payload/.test(read.select || ""), false, "raw_payload must not be transported at all");
});

// ── J, K. security is unchanged ────────────────────────────────────────────

test("[J] the persisted owner is the server-derived userId", async () => {
  const supabase = fakeSupabase({ rows: pool(5) });
  await createGlobalSpecialBet({ userId: USER_A, betDate: BET_DATE, variant: 3, leagueIds: [39], now: NOW, supabase });
  assert.equal(supabase.log.rpc[0].params.p_user_id, USER_A);
});

test("[K] the candidate read is still scoped to the requested leagues", async () => {
  const rows = [...pool(4, 39), ...pool(4, 140).map((r) => ({ ...r, fixture_id: r.fixture_id + 100 }))];
  const supabase = fakeSupabase({ rows });
  await createGlobalSpecialBet({ userId: USER_A, betDate: BET_DATE, variant: 3, leagueIds: [39], now: NOW, supabase });

  const read = supabase.log.queries.find((q) => q.table === "predictions_history" && q.ins.league_id);
  assert.deepEqual(read.ins.league_id, [39], "the league predicate still reaches the query");
  assert.equal(
    legsOf(supabase).every((id) => id <= 100),
    true,
    "nothing from league 140 could be chosen"
  );
});

test("[K] the exclusion read is still scoped to this user and this date", async () => {
  const supabase = fakeSupabase({ rows: pool(5) });
  await createGlobalSpecialBet({ userId: USER_A, betDate: BET_DATE, variant: 3, leagueIds: [39], now: NOW, supabase });

  const usage = supabase.log.queries.find((q) => q.table === "special_bets");
  assert.equal(usage.eqs.user_id, USER_A);
  assert.equal(usage.eqs.bet_type, "USER");
  assert.equal(usage.eqs.bet_date, BET_DATE);
});
