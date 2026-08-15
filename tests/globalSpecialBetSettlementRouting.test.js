import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BET_STATUS,
  SELECTION_STATUS,
  aggregateBetStatus,
  computeSettledTotalOdds,
  settleGlobalSpecialBet,
  settleTicket
} from "../server-utils/globalSpecialBetSettlement.js";

/**
 * Settlement routing — which grader answers for which ticket.
 *
 * The interesting failures here are not arithmetic (Increment 3 proved that on
 * 1024 cases); they are a combo reaching the k-of-n grader, or a system reaching
 * the all-or-nothing one. So the tests are built around a pool of legs whose two
 * graders DISAGREE: three winners and two losers is LOST as a combo and WON as a
 * 3/5. If routing ever breaks, the status flips — no source inspection needed.
 *
 * Everything is in-memory. settleGlobalSpecialBet is pure, so no database is
 * involved and nothing here can touch a real bet.
 */

const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const KICKOFF = "2026-08-09T18:00:00.000Z";

/**
 * A leg whose settled outcome is decided by the fixture we hand it:
 *   W  Over 2.5 on a 3-0   → won
 *   L  Over 2.5 on a 0-0   → lost
 *   V  a cancelled fixture → void, whatever the market said
 *   P  a fixture still to be played → pending
 */
function legAndFixture(id, outcome, odds) {
  const selection = {
    id: `sel-${id}`,
    fixture_id: id,
    market: "ou",
    selection: "Over 2.5",
    side: "over",
    line: 2.5,
    odds,
    status: SELECTION_STATUS.PENDING,
    kickoff_at: KICKOFF
  };
  const fixture = {
    W: { status: "FT", score: { home: 3, away: 0 }, marketTotals: {} },
    L: { status: "FT", score: { home: 0, away: 0 }, marketTotals: {} },
    V: { status: "CANC", score: { home: null, away: null }, marketTotals: {} },
    P: { status: "NS", score: { home: null, away: null }, marketTotals: {} }
  }[outcome];
  return { selection, fixture };
}

/** Build the selections and fixture map for a pattern like "WWWLL". */
function ticket(pattern, odds = 2.0) {
  const selections = [];
  const fixturesById = new Map();
  [...pattern].forEach((ch, i) => {
    const id = 900 + i;
    const { selection, fixture } = legAndFixture(id, ch, Array.isArray(odds) ? odds[i] : odds);
    selections.push(selection);
    fixturesById.set(id, fixture);
  });
  return { selections, fixturesById };
}

/** Settle `pattern` as the given bet row. */
function settleAs(pattern, bet, odds) {
  const { selections, fixturesById } = ticket(pattern, odds);
  return settleGlobalSpecialBet({
    bet: { id: "bet-1", status: "pending", ...bet },
    selections,
    fixturesById,
    now: NOW
  });
}

const combo = (pattern, extra = {}, odds) => settleAs(pattern, { bet_kind: "combo", ...extra }, odds);
const legacy = (pattern, odds) => settleAs(pattern, {}, odds); // pre-052 row: no bet_kind at all
const system = (pattern, k, extra = {}, odds) =>
  settleAs(pattern, { bet_kind: "system", system_k: k, ...extra }, odds);

// ── A. Combo regression ───────────────────────────────────────────────────

test("[A1] a pre-052 row with no bet_kind settles as a Combo", () => {
  assert.equal(legacy("WWWWW").betStatus, BET_STATUS.WON);
  assert.equal(legacy("WWWWW").settledTotalOdds, 32.0);
  assert.equal(legacy("WWWLL").betStatus, BET_STATUS.LOST, "one lost leg still loses a combo");
});

test("[A2] bet_kind combo settles exactly as before", () => {
  assert.equal(combo("WWWWW").settledTotalOdds, 32.0);
  assert.equal(combo("WWWLL").betStatus, BET_STATUS.LOST);
  assert.equal(combo("WWWWV").settledTotalOdds, 16.0, "a void leg still contributes 1.00");
  assert.equal(combo("VVVVV").betStatus, BET_STATUS.VOID);
  assert.equal(combo("WWPWW").betStatus, BET_STATUS.PENDING);
});

test("[A3] a stray system_k is ignored for a Combo", () => {
  // The schema forbids this pairing, but a grader must not be the only thing
  // standing between a corrupt row and a wrong payout.
  const out = combo("WWWLL", { system_k: 3 });
  assert.equal(out.betStatus, BET_STATUS.LOST, "still all-or-nothing");
  assert.equal(out.settledTotalOdds, null);
});

test("[A4] an unrecognised bet_kind falls back to Combo rather than guessing", () => {
  assert.equal(settleAs("WWWLL", { bet_kind: "combi" }).betStatus, BET_STATUS.LOST);
  assert.equal(settleAs("WWWLL", { bet_kind: null }).betStatus, BET_STATUS.LOST);
});

test("[A5] direct comparison against the previous implementation, over a corpus", () => {
  // Every combo answer must equal what aggregateBetStatus + computeSettledTotalOdds
  // would have produced on their own — the functions that settled every combo
  // before this increment existed.
  const odds = [1.5, 1.6, 1.7, 1.8, 1.9];
  const patterns = [
    "WWWWW",
    "WWWWL",
    "WWWLL",
    "WWLLL",
    "WLLLL",
    "LLLLL",
    "VVVVV",
    "WWWWV",
    "WWVVV",
    "WVVLL",
    "WWPWW",
    "PPPPP",
    "WWPLL",
    "VPWLW"
  ];

  for (const pattern of patterns) {
    const { selections, fixturesById } = ticket(pattern, odds);
    const out = settleGlobalSpecialBet({
      bet: { id: "bet-1", status: "pending", bet_kind: "combo" },
      selections,
      fixturesById,
      now: NOW
    });

    const settled = out.selections.map((s) => ({ status: s.status, odds: s.odds }));
    const expectedStatus = aggregateBetStatus(settled.map((s) => s.status));
    assert.equal(out.betStatus, expectedStatus, `status for ${pattern}`);
    assert.equal(out.settledTotalOdds, computeSettledTotalOdds(settled, expectedStatus), `odds for ${pattern}`);
  }
});

// ── B. System ─────────────────────────────────────────────────────────────

test("[B1] System 3/5 wins on three legs", () => {
  const out = system("WWWLL", 3);
  assert.equal(out.betStatus, BET_STATUS.WON);
  assert.equal(out.settledTotalOdds, 0.8);
});

test("[B2] System 4/5 wins on four legs", () => {
  assert.equal(system("WWWWL", 4).betStatus, BET_STATUS.WON);
  assert.equal(system("WWWWL", 4).settledTotalOdds, 3.2);
});

test("[B3] System 5/5 needs all five", () => {
  assert.equal(system("WWWWW", 5).settledTotalOdds, 32.0);
  assert.equal(system("WWWWL", 5).betStatus, BET_STATUS.LOST);
});

test("[B4] System loses when too few legs survive", () => {
  const out = system("WWLLL", 3);
  assert.equal(out.betStatus, BET_STATUS.LOST);
  assert.equal(out.settledTotalOdds, null);
});

test("[B5] System holds while a leg is pending", () => {
  const out = system("WWPWW", 3);
  assert.equal(out.betStatus, BET_STATUS.PENDING);
  assert.equal(out.settledTotalOdds, null);
});

test("[B6] every leg void voids the System and returns the stake", () => {
  for (const k of [3, 4, 5]) {
    const out = system("VVVVV", k);
    assert.equal(out.betStatus, BET_STATUS.VOID, `k=${k}`);
    assert.equal(out.settledTotalOdds, 1.0, `k=${k}`);
  }
});

test("[B7] a void leg rides at 1.00 and does not shrink the ticket", () => {
  // WWVLL: only {W,W,V} survives → 2.00 × 2.00 × 1.00 × 0.1 = 0.40.
  const out = system("WWVLL", 3);
  assert.equal(out.betStatus, BET_STATUS.WON);
  assert.equal(out.settledTotalOdds, 0.4);
});

// ── C. A won ticket that lost money ───────────────────────────────────────

test("[C1] WON with a return below the stake stays WON", () => {
  const out = system("WWWLL", 3);
  assert.equal(out.betStatus, BET_STATUS.WON);
  assert.ok(out.settledTotalOdds < 1, `expected a sub-stake return, got ${out.settledTotalOdds}`);
  assert.notEqual(out.betStatus, BET_STATUS.LOST, "a thin win is not a loss");
});

// ── D. The numbers come from settleTicket, unaltered ──────────────────────

test("[D1] settled_total_odds is exactly the returnMultiple", () => {
  const odds = [1.5, 1.6, 1.7, 1.8, 1.9];
  for (const [pattern, k] of [
    ["WWWLL", 3],
    ["WWWWL", 3],
    ["WWWWW", 3],
    ["WWVWL", 3],
    ["WWWWL", 4],
    ["WWWWW", 5]
  ]) {
    const out = system(pattern, k, {}, odds);
    const legs = out.selections.map((s) => ({ status: s.status, odds: s.odds }));
    const direct = settleTicket({ selections: legs, k });

    assert.equal(out.betStatus, direct.status, `${pattern} k=${k}`);
    assert.equal(out.settledTotalOdds, direct.returnMultiple, `${pattern} k=${k}`);
    assert.equal(direct.combinationCount, k === 3 ? 10 : k === 4 ? 5 : 1);
  }
});

test("[D2] the winning combination count follows the surviving legs", () => {
  const legsOf = (pattern) =>
    settleGlobalSpecialBet({
      bet: { id: "b", status: "pending", bet_kind: "system", system_k: 3 },
      ...ticket(pattern),
      now: NOW
    }).selections.map((s) => ({ status: s.status, odds: s.odds }));

  assert.equal(settleTicket({ selections: legsOf("WWWWW"), k: 3 }).winningCombinationCount, 10);
  assert.equal(settleTicket({ selections: legsOf("WWWWL"), k: 3 }).winningCombinationCount, 4);
  assert.equal(settleTicket({ selections: legsOf("WWWLL"), k: 3 }).winningCombinationCount, 1);
  assert.equal(settleTicket({ selections: legsOf("WWLLL"), k: 3 }).winningCombinationCount, 0);
});

// ── E. Corrupt shapes refuse rather than guess ────────────────────────────

test("[E1] a System with no k is refused, not settled", () => {
  const out = system("WWWWW", undefined);
  assert.ok(out.error, "an unsettleable shape must be reported");
  assert.equal(out.changed, false, "and must write nothing");
  assert.equal(out.betStatus, BET_STATUS.PENDING);
  assert.equal(out.settledTotalOdds, null);
  assert.deepEqual(out.selectionChanges, [], "not even the legs are written");
});

test("[E2] a k outside 1..n is refused", () => {
  for (const k of [0, -1, 6, 2.5, "three", null]) {
    const out = system("WWWWW", k);
    assert.ok(out.error, `k=${JSON.stringify(k)} must be refused`);
    assert.equal(out.changed, false);
  }
});

test("[E3] a System asking for more winners than it has legs is refused", () => {
  const out = system("WWW", 5);
  assert.ok(out.error);
  assert.equal(out.changed, false);
});

test("[E4] a refusal names the bet and the shape", () => {
  const out = settleAs("WWWWW", { id: "bet-broken", bet_kind: "system", system_k: 9 });
  assert.match(out.error, /bet-broken/);
  assert.match(out.error, /system_k=9/);
  assert.match(out.error, /selections=5/);
});

// ── F. Idempotency ────────────────────────────────────────────────────────

test("[F1] settling an already-settled System changes nothing", () => {
  const first = system("WWWLL", 3);
  assert.equal(first.changed, true, "the first pass has work to do");

  // Replay with the end state the first pass intended, exactly as the database
  // would hold it on the next cron run.
  const { selections, fixturesById } = ticket("WWWLL");
  const stored = selections.map((s, i) => ({ ...s, status: first.selections[i].status }));
  const second = settleGlobalSpecialBet({
    bet: {
      id: "bet-1",
      status: first.betStatus,
      settled_total_odds: first.settledTotalOdds,
      bet_kind: "system",
      system_k: 3
    },
    selections: stored,
    fixturesById,
    now: NOW + 86_400_000
  });

  assert.equal(second.changed, false, "nothing left to write");
  assert.equal(second.betStatus, first.betStatus);
  assert.equal(second.settledTotalOdds, first.settledTotalOdds);
  assert.deepEqual(second.selectionChanges, []);
});

test("[F2] idempotency still holds for a Combo", () => {
  const first = combo("WWWWW");
  const { selections, fixturesById } = ticket("WWWWW");
  const stored = selections.map((s, i) => ({ ...s, status: first.selections[i].status }));
  const second = settleGlobalSpecialBet({
    bet: {
      id: "bet-1",
      status: first.betStatus,
      settled_total_odds: first.settledTotalOdds,
      bet_kind: "combo"
    },
    selections: stored,
    fixturesById,
    now: NOW + 86_400_000
  });
  assert.equal(second.changed, false);
});

// ── G. Routing, proved by disagreement ────────────────────────────────────

test("[G1] the same five legs settle differently as Combo and as System 3/5", () => {
  // This is the whole increment in one assertion. Three winners and two losers
  // is LOST all-or-nothing and WON three-of-five; if either ticket reached the
  // wrong grader, one of these two lines fails.
  const asCombo = combo("WWWLL");
  const asSystem = system("WWWLL", 3);

  assert.equal(asCombo.betStatus, BET_STATUS.LOST);
  assert.equal(asCombo.settledTotalOdds, null);

  assert.equal(asSystem.betStatus, BET_STATUS.WON);
  assert.equal(asSystem.settledTotalOdds, 0.8);
});

test("[G2] and identically where the two graders agree", () => {
  // k = n is the shared case: a 5/5 system and a five-leg combo are the same bet.
  for (const pattern of ["WWWWW", "WWWWL", "VVVVV", "WWWWV", "WWPWW"]) {
    const asCombo = combo(pattern);
    const asSystem = system(pattern, 5);
    assert.equal(asSystem.betStatus, asCombo.betStatus, `status for ${pattern}`);
    assert.equal(asSystem.settledTotalOdds, asCombo.settledTotalOdds, `odds for ${pattern}`);
  }
});

test("[G3] per-leg settlement is shared — only the aggregation differs", () => {
  const asCombo = combo("WWVLL");
  const asSystem = system("WWVLL", 3);
  assert.deepEqual(
    asSystem.selections.map((s) => s.status),
    asCombo.selections.map((s) => s.status),
    "a leg is graded the same way whichever ticket it belongs to"
  );
});
