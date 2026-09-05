import assert from "node:assert/strict";
import { test } from "node:test";
import {
  betDateScanWindow,
  createGlobalSpecialBet,
  loadBetDateFixtures,
  summarizeLeagueCoverage
} from "../server-utils/globalSpecialBets.js";

/**
 * Generation feedback: which selected leagues fed the pool, and for the ones
 * that did not, whether the bet_date calendar day had simply run out.
 *
 * Production case (2026-08-22, user added Serie A at 20:34 UTC): every Serie A
 * fixture of the day had kicked off, the league contributed zero candidates,
 * and the engine legitimately produced the same ticket as two hours earlier.
 * The pool query never sees started fixtures, so the ONLY safe evidence for
 * "all of today's matches have started" is the day scan: ≥1 kick-off <= now
 * AND zero kick-offs > now on that Europe/Bucharest day.
 */

const BET_DATE = "2026-08-22";
// 20:34:44Z on the 22nd = 23:34 Bucharest: still the bet_date day.
const NOW = Date.parse("2026-08-22T20:34:44.000Z");

const cand = (leagueId, leagueName, fixtureId = leagueId * 100) => ({ fixtureId, leagueId, leagueName, market: "corners", selection: "Over 7.5" });
let seq = 0;
const fx = (league_id, kickoff_at, league_name = null, fixture_id = ++seq) => ({ fixture_id, league_id, league_name, kickoff_at });
const ids = (s) => s.noEligibleBecauseAlreadyStartedLeagueIds;

test("1. selected + eligible candidates → not affected (and named from the pool)", () => {
  const s = summarizeLeagueCoverage({ selectedLeagueIds: [39], pool: [cand(39, "Premier League")], dayFixtures: [fx(39, "2026-08-22T14:00:00Z")], now: NOW });
  assert.deepEqual(s.eligibleLeagueIds, [39]);
  assert.deepEqual(s.noEligibleLeagueIds, []);
  assert.deepEqual(ids(s), []);
  assert.deepEqual(s.names, { 39: "Premier League" });
});

test("2. selected + every fixture of the day started + no future fixture + zero candidates → affected", () => {
  const s = summarizeLeagueCoverage({
    selectedLeagueIds: [135],
    pool: [],
    dayFixtures: [fx(135, "2026-08-22T16:30:00Z", "Serie A"), fx(135, "2026-08-22T18:45:00Z", "Serie A")],
    now: NOW
  });
  assert.deepEqual(s.noEligibleLeagueIds, [135]);
  assert.deepEqual(ids(s), [135]);
  assert.equal(s.names[135], "Serie A");
});

test("3. selected + started fixtures + a later kick-off today → NOT affected (the day is not over)", () => {
  const s = summarizeLeagueCoverage({
    selectedLeagueIds: [135],
    pool: [],
    dayFixtures: [fx(135, "2026-08-22T16:30:00Z"), fx(135, "2026-08-22T20:45:00Z")],
    now: NOW
  });
  assert.deepEqual(s.noEligibleLeagueIds, [135]);
  assert.deepEqual(ids(s), []);
});

test("4. selected + no fixture on the day at all → NOT affected (nothing proves 'already started')", () => {
  const s = summarizeLeagueCoverage({ selectedLeagueIds: [135], pool: [], dayFixtures: [], now: NOW });
  assert.deepEqual(s.noEligibleLeagueIds, [135]);
  assert.deepEqual(ids(s), []);
});

test("5. selected + upcoming fixture rejected by another gate → NOT affected", () => {
  // The fixture is still to come; it simply produced no safe candidate.
  const s = summarizeLeagueCoverage({ selectedLeagueIds: [135], pool: [], dayFixtures: [fx(135, "2026-08-22T20:45:00Z")], now: NOW });
  assert.deepEqual(ids(s), []);
});

test("6. mixed: A eligible, B day finished, C no fixtures, D started+later → only B", () => {
  const s = summarizeLeagueCoverage({
    selectedLeagueIds: [39, 135, 94, 61],
    pool: [cand(39, "Premier League")],
    dayFixtures: [fx(135, "2026-08-22T16:30:00Z", "Serie A"), fx(61, "2026-08-22T15:00:00Z", "Ligue 1"), fx(61, "2026-08-22T20:45:00Z", "Ligue 1")],
    now: NOW
  });
  assert.deepEqual(s.selectedLeagueIds, [39, 61, 94, 135]);
  assert.deepEqual(s.eligibleLeagueIds, [39]);
  assert.deepEqual(s.noEligibleLeagueIds, [61, 94, 135]);
  assert.deepEqual(ids(s), [135]);
  assert.deepEqual(s.names, { 39: "Premier League", 61: "Ligue 1", 135: "Serie A" });
});

test("7. kick-off exactly at `now` counts as started; one millisecond later is upcoming", () => {
  const at = new Date(NOW).toISOString();
  const after = new Date(NOW + 1).toISOString();
  assert.deepEqual(ids(summarizeLeagueCoverage({ selectedLeagueIds: [1], pool: [], dayFixtures: [fx(1, at)], now: NOW })), [1]);
  assert.deepEqual(ids(summarizeLeagueCoverage({ selectedLeagueIds: [1], pool: [], dayFixtures: [fx(1, after)], now: NOW })), []);
});

test("8. names: pool name wins, day-scan name fills the gap, unnamed leagues are absent", () => {
  const s = summarizeLeagueCoverage({
    selectedLeagueIds: [1, 2, 3],
    pool: [cand(1, "From Pool")],
    dayFixtures: [fx(1, "2026-08-22T10:00:00Z", "From Day"), fx(2, "2026-08-22T10:00:00Z", "Day Only"), fx(3, "2026-08-22T10:00:00Z", null)],
    now: NOW
  });
  assert.deepEqual(s.names, { 1: "From Pool", 2: "Day Only" });
});

test("9. a league outside the selection never appears, and duplicate / non-numeric ids are dropped", () => {
  const s = summarizeLeagueCoverage({ selectedLeagueIds: [39, 39, "x"], pool: [cand(135, "Serie A")], dayFixtures: [fx(135, "2026-08-22T10:00:00Z")], now: NOW });
  assert.deepEqual(s.selectedLeagueIds, [39]);
  assert.deepEqual(s.eligibleLeagueIds, []);
  assert.deepEqual(s.names, {});
});

test("10. the day scan brackets the Europe/Bucharest day with a UTC superset and filters by the app's own date key", async () => {
  const w = betDateScanWindow(BET_DATE);
  assert.equal(w.from, "2026-08-21T00:00:00.000Z");
  assert.equal(w.to, "2026-08-23T00:00:00.000Z");
  assert.equal(betDateScanWindow("nope"), null);

  const filters = [];
  const chain = {
    select: () => chain,
    in: (c, v) => (filters.push(["in", c, v]), chain),
    gte: (c, v) => (filters.push(["gte", c, v]), chain),
    lte: (c, v) => (filters.push(["lte", c, v]), chain),
    then: (resolve) =>
      resolve({
        data: [
          fx(135, "2026-08-21T21:30:00Z", "Serie A", 1), // 00:30 Bucharest on the 22nd → in
          fx(135, "2026-08-22T20:59:00Z", "Serie A", 2), // 23:59 Bucharest on the 22nd → in
          fx(135, "2026-08-22T21:00:00Z", "Serie A", 3), // 00:00 Bucharest on the 23rd → out
          fx(135, "2026-08-21T20:59:00Z", "Serie A", 4) // 23:59 Bucharest on the 21st → out
        ],
        error: null
      })
  };
  const rows = await loadBetDateFixtures({ from: () => chain }, [135], BET_DATE);
  assert.deepEqual(rows.map((r) => r.fixture_id), [1, 2]);
  assert.deepEqual(filters, [["in", "league_id", [135]], ["gte", "kickoff_at", w.from], ["lte", "kickoff_at", w.to]]);
  assert.deepEqual(await loadBetDateFixtures({ from: () => chain }, [], BET_DATE), [], "no leagues → no query");
});

test("11. createGlobalSpecialBet: the response is additive — created ticket untouched, leagueSummary alongside examined/rejected", async () => {
  // The engine's own happy-path payload shape (mirrors tests/globalSpecialBets.test.js).
  const payload = (id) => ({
    id,
    leagueId: 39,
    kickoff: "2026-08-23T18:00:00.000Z",
    modelVersion: "predictor-v3.1-test",
    teams: { home: `H${id}`, away: `A${id}` },
    recommended: { pick: "Over 2.5", family: "Goals", confidence: 80 },
    modelMeta: { dataQuality: 0.8 },
    valueEngine: {
      markets: [{ type: "Over 2.5", family: "Goals", line: 2.5, odds: 1.8, probability: 0.7, valueScore: 70 - id, recommendable: true, tradable: true, betType: "over_under", period: "full_match", scope: "match" }]
    }
  });
  const historyRows = [1, 2, 3].map((id) => ({ fixture_id: id, league_id: 39, league_name: "Premier League", kickoff_at: "2026-08-23T18:00:00.000Z", raw_payload: payload(id) }));
  const dayRows = [fx(135, "2026-08-22T16:30:00Z", "Serie A", 9)];
  let phase = "pool";
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    not: () => chain,
    in: () => chain,
    gt: () => chain,
    order: () => chain,
    limit: () => chain,
    gte: () => ((phase = "day"), chain),
    lte: () => chain,
    then: (resolve) => resolve({ data: phase === "day" ? dayRows : historyRows, error: null })
  };
  const rpc = [];
  /*
    TABLE-AWARE. Creation now also reads special_bets / special_bet_selections
    for the fixtures this user's other tickets of the day already used
    (cross-ticket diversification). This case stores no tickets, so those tables
    answer empty and the exclusion set is empty — which is why the assertions
    below are unchanged. A table-blind stub would return the history rows for
    those queries too, and every fixture would look already-used.
  */
  const empty = {
    select: () => empty,
    eq: () => empty,
    is: () => empty,
    not: () => empty,
    in: () => empty,
    order: () => empty,
    limit: () => empty,
    then: (resolve) => resolve({ data: [], error: null })
  };
  const supabase = {
    from: (table) => (table === "special_bets" || table === "special_bet_selections" ? empty : chain),
    rpc: async (name, params) => (rpc.push({ name, params }), { data: { ok: true, created: true, bet: { id: "b1", total_odds: 4.1 }, selections: [] }, error: null })
  };
  const result = await createGlobalSpecialBet({ userId: "u", betDate: BET_DATE, variant: 3, leagueIds: [135, 39], now: NOW, supabase });
  assert.equal(result.created, true);
  assert.equal(rpc.length, 1, "exactly one write — identical or not, a generation is persisted");
  assert.deepEqual(rpc[0].params.p_league_ids, [39, 135], "league scope stored unchanged");
  assert.equal(typeof result.examined, "number");
  assert.equal(typeof result.rejected, "object");
  assert.deepEqual(result.leagueSummary, {
    selectedLeagueIds: [39, 135],
    eligibleLeagueIds: [39],
    noEligibleLeagueIds: [135],
    noEligibleBecauseAlreadyStartedLeagueIds: [135],
    names: { 39: "Premier League", 135: "Serie A" }
  });
});
