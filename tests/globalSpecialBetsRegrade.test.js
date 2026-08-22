import assert from "node:assert/strict";
import { test } from "node:test";
import { regradeLegsOnSettledBets, settlePendingGlobalSpecialBets } from "../server-utils/globalSpecialBets.js";
import { MISSING_STATS_VOID_AFTER_MS } from "../server-utils/globalSpecialBetSettlement.js";
import { fakeSettlementClient } from "./globalSpecialBetsFixtureState.test.js";

/**
 * Legs left pending on a ticket that already has its verdict.
 *
 * A combo is LOST the moment one leg loses; its other legs may still be NS.
 * Settlement scans PENDING tickets, so those legs never got graded — after the
 * 2026-08-22 cron, six such legs sat on FT fixtures with every number present
 * (3 dc, 2 corners, 1 ou), all on LOST tickets. This pass grades them from the
 * same fixture state with the same grader, and never touches the ticket row.
 */

const KICKOFF = "2026-08-20T16:00:00.000Z";
const KICKOFF_MS = Date.parse(KICKOFF);
const AFTER = KICKOFF_MS + 3 * 60 * 60 * 1000;
const AT_48H = KICKOFF_MS + MISSING_STATS_VOID_AFTER_MS;

const FT_ROW = (fixture_id, home, away, corners) => ({
  fixture_id,
  match_status: "FT",
  score_home: home,
  score_away: away,
  corners_total: corners,
  shots_total: null,
  shots_on_target_total: null,
  legacy_market_results: null
});

const leg = (id, bet, overrides = {}) => ({
  id,
  special_bet_id: bet,
  fixture_id: 1,
  market: "dc",
  selection: "X2",
  side: null,
  line: null,
  odds: 1.5,
  status: "pending",
  kickoff_at: KICKOFF,
  ...overrides
});

/** Production shape: a LOST combo whose later legs were still NS when the first one lost. */
function lostTicketWithLeftoverLegs() {
  const bet = { id: "bet-lost", status: "lost", settled_total_odds: null, settled_at: "2026-08-19T17:51:16Z", bet_kind: "combo", system_k: null };
  const selections = [
    leg("l-lost", bet.id, { fixture_id: 1, status: "lost" }),
    leg("l-won", bet.id, { fixture_id: 2, status: "won" }),
    leg("l-dc", bet.id, { fixture_id: 3, market: "dc", selection: "X2" }), // pending on FT 3-0 → lost
    leg("l-corners", bet.id, { fixture_id: 4, market: "corners", selection: "Over 8.5", side: "over", line: 8.5 }), // corners 10 → won
    leg("l-ou", bet.id, { fixture_id: 5, market: "ou", selection: "Under 2.5", side: "under", line: 2.5 }) // 0-5 → lost
  ];
  const fixtureRows = [FT_ROW(1, 1, 0, 8), FT_ROW(2, 2, 1, 9), FT_ROW(3, 3, 0, 7), FT_ROW(4, 1, 1, 10), FT_ROW(5, 0, 5, 4)];
  return { bet, selections, fixtureRows };
}

test("grades the pending legs of a LOST ticket from the fixture state; the ticket row is untouched", async () => {
  const { bet, selections, fixtureRows } = lostTicketWithLeftoverLegs();
  const sb = fakeSettlementClient({ bets: [bet], selections, fixtureRows });

  const result = await regradeLegsOnSettledBets({ now: AFTER, supabase: sb });

  assert.deepEqual(result, { scanned: 3, regraded: 3, failures: [] });
  assert.deepEqual(
    sb.selectionsTable.map((s) => [s.id, s.status]),
    [
      ["l-lost", "lost"],
      ["l-won", "won"],
      ["l-dc", "lost"],
      ["l-corners", "won"],
      ["l-ou", "lost"]
    ]
  );
  for (const id of ["l-dc", "l-corners", "l-ou"]) assert.ok(sb.selectionsTable.find((s) => s.id === id).settled_at);
  assert.deepEqual(sb.betsTable[0], bet);
  assert.equal(sb.writes.some((w) => w.table === "special_bets"), false, "no ticket write");
});

test("legs on a PENDING ticket are not this pass's business (the normal settlement owns them)", async () => {
  const bet = { id: "bet-open", status: "pending", settled_total_odds: null, bet_kind: "combo", system_k: null };
  const sb = fakeSettlementClient({ bets: [bet], selections: [leg("l1", bet.id, { fixture_id: 3 })], fixtureRows: [FT_ROW(3, 3, 0, 7)] });
  const result = await regradeLegsOnSettledBets({ now: AFTER, supabase: sb });
  assert.deepEqual(result, { scanned: 0, regraded: 0, failures: [] });
  assert.equal(sb.selectionsTable[0].status, "pending");
});

test("a leftover leg whose fixture has no usable result stays pending, then voids at 48h — same rule as live tickets", async () => {
  const bet = { id: "bet-lost", status: "lost", settled_total_odds: null, bet_kind: "combo", system_k: null };
  const selections = [leg("l-lost", bet.id, { fixture_id: 1, status: "lost" }), leg("l-c", bet.id, { fixture_id: 9, market: "corners", selection: "Over 8.5", side: "over", line: 8.5 })];
  const sb = fakeSettlementClient({ bets: [bet], selections, fixtureRows: [FT_ROW(1, 1, 0, 8), FT_ROW(9, 1, 1, null)] });

  const early = await regradeLegsOnSettledBets({ now: AFTER, supabase: sb });
  assert.deepEqual(early, { scanned: 1, regraded: 0, failures: [] });
  assert.equal(sb.selectionsTable[1].status, "pending");

  const late = await regradeLegsOnSettledBets({ now: AT_48H, supabase: sb });
  assert.deepEqual(late, { scanned: 1, regraded: 1, failures: [] });
  assert.equal(sb.selectionsTable[1].status, "void");
});

test("idempotent: a second run scans nothing and writes nothing", async () => {
  const { bet, selections, fixtureRows } = lostTicketWithLeftoverLegs();
  const sb = fakeSettlementClient({ bets: [bet], selections, fixtureRows });
  await regradeLegsOnSettledBets({ now: AFTER, supabase: sb });
  const before = sb.writes.length;
  const again = await regradeLegsOnSettledBets({ now: AFTER, supabase: sb });
  assert.deepEqual(again, { scanned: 0, regraded: 0, failures: [] });
  assert.equal(sb.writes.length, before);
});

test("a missing fixture row leaves the leg pending (no guess), voiding only at 48h", async () => {
  const bet = { id: "bet-lost", status: "lost", settled_total_odds: null, bet_kind: "combo", system_k: null };
  const sb = fakeSettlementClient({ bets: [bet], selections: [leg("l-x", bet.id, { fixture_id: 404 })], fixtureRows: [] });
  assert.equal((await regradeLegsOnSettledBets({ now: AFTER, supabase: sb })).regraded, 0);
  assert.equal(sb.selectionsTable[0].status, "pending");
  assert.equal((await regradeLegsOnSettledBets({ now: AT_48H, supabase: sb })).regraded, 1);
  assert.equal(sb.selectionsTable[0].status, "void");
});

test("the cron entry point runs the regrade after settling pending tickets — and when there is nothing pending", async () => {
  const { bet, selections, fixtureRows } = lostTicketWithLeftoverLegs();
  const sb = fakeSettlementClient({ bets: [bet], selections, fixtureRows });
  const summary = await settlePendingGlobalSpecialBets({ now: AFTER, supabase: sb });
  assert.equal(summary.scanned, 0, "no pending ticket");
  assert.equal(summary.legsRegradeScanned, 3);
  assert.equal(summary.legsRegraded, 3);
  assert.deepEqual(summary.failures, []);

  const open = { id: "bet-open", status: "pending", settled_total_odds: null, bet_kind: "combo", system_k: null };
  const sb2 = fakeSettlementClient({
    bets: [bet, open],
    selections: [...selections, leg("o-1", open.id, { fixture_id: 3 })],
    fixtureRows
  });
  const s2 = await settlePendingGlobalSpecialBets({ now: AFTER, supabase: sb2 });
  assert.equal(s2.scanned, 1);
  assert.equal(s2.settled, 1);
  assert.equal(sb2.betsTable.find((b) => b.id === open.id).status, "lost");
  assert.equal(s2.legsRegraded, 3);
});

test("a write that touches the wrong number of rows is reported as a failure, not success", async () => {
  const { bet, selections, fixtureRows } = lostTicketWithLeftoverLegs();
  const sb = fakeSettlementClient({ bets: [bet], selections, fixtureRows });
  const realFrom = sb.from;
  sb.from = (name) => {
    const t = realFrom(name);
    if (name !== "special_bet_selections") return t;
    return { ...t, update: () => ({ in: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }) };
  };
  const result = await regradeLegsOnSettledBets({ now: AFTER, supabase: sb });
  assert.equal(result.regraded, 0);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error, /touched 0 of/);
});
