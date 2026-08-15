import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BET_STATUS,
  SELECTION_STATUS,
  aggregateBetStatus,
  computeSettledTotalOdds,
  settleTicket,
  ticketCombinationCount
} from "../server-utils/globalSpecialBetSettlement.js";
import { systemTicketProbability } from "../server-utils/globalSpecialBetEngine.js";

/**
 * GSB System settlement — the k-of-n model, and the proof that Combo is its
 * k = n case.
 *
 * Two independent things live here, and the suite keeps them apart on purpose:
 * the MODEL probability (what we think will happen, Poisson-binomial) and the
 * SETTLEMENT result (what did happen, enumerated over combinations). They share
 * no code and must never be mistaken for one another.
 *
 * The payout numbers below all use odds of exactly 2.00 and one unit of total
 * stake, so every figure can be checked by hand.
 */

const { WON, LOST, VOID, PENDING } = SELECTION_STATUS;

/** Legs from a status string like "WWVLL", all priced at 2.00 unless told otherwise. */
function legs(pattern, odds = 2.0) {
  const map = { W: WON, L: LOST, V: VOID, P: PENDING };
  return [...pattern].map((ch, i) => ({
    status: map[ch],
    odds: Array.isArray(odds) ? odds[i] : odds
  }));
}

const settle = (pattern, k, odds) => settleTicket({ selections: legs(pattern, odds), k });

// ── Model probability: P(X >= k), exactly ─────────────────────────────────

test("[P1] the mandated example: five legs at 0.70", () => {
  const p = [0.7, 0.7, 0.7, 0.7, 0.7];

  assert.equal(systemTicketProbability(p, 3).toFixed(5), "0.83692");
  assert.equal(systemTicketProbability(p, 4).toFixed(5), "0.52822");
  assert.equal(systemTicketProbability(p, 5).toFixed(5), "0.16807");
});

test("[P2] Πp is only right at k = n, and wrong by multiples below it", () => {
  const p = [0.7, 0.7, 0.7, 0.7, 0.7];
  const product = p.reduce((acc, value) => acc * value, 1);

  assert.equal(systemTicketProbability(p, 5).toFixed(10), product.toFixed(10), "k = n IS the product");
  // A 3/5 is five times likelier to win than Πp claims, and a 4/5 three times.
  assert.ok(systemTicketProbability(p, 3) / product > 4.9);
  assert.ok(systemTicketProbability(p, 4) / product > 3.1);
});

test("[P3] k = n equals Πp for unequal probabilities too", () => {
  const p = [0.62, 0.71, 0.88, 0.65, 0.79];
  const product = p.reduce((acc, value) => acc * value, 1);
  assert.equal(systemTicketProbability(p, 5).toFixed(12), product.toFixed(12));
});

test("[P4] k = 1 equals 1 − Π(1 − p)", () => {
  const p = [0.62, 0.71, 0.88, 0.65, 0.79];
  const none = p.reduce((acc, value) => acc * (1 - value), 1);
  assert.equal(systemTicketProbability(p, 1).toFixed(12), (1 - none).toFixed(12));
});

test("[P5] the tail is monotone in k", () => {
  const p = [0.62, 0.71, 0.88, 0.65, 0.79];
  const tails = [1, 2, 3, 4, 5].map((k) => systemTicketProbability(p, k));
  for (let i = 1; i < tails.length; i += 1) assert.ok(tails[i] < tails[i - 1], `k=${i + 1} must be rarer`);
});

test("[P6] certainties stay exactly one, without float drift", () => {
  assert.equal(systemTicketProbability([1, 1, 1, 1, 1], 5), 1);
  assert.equal(systemTicketProbability([1, 1, 1, 1, 1], 3), 1);
  assert.equal(systemTicketProbability([0.8], 1), 0.8);
});

test("[P7] an unusable ticket has no probability, never a zero", () => {
  const p = [0.7, 0.7, 0.7, 0.7, 0.7];
  assert.equal(systemTicketProbability(p, 6), null, "k above n");
  assert.equal(systemTicketProbability(p, 0), null);
  assert.equal(systemTicketProbability(p, 2.5), null);
  assert.equal(systemTicketProbability([], 1), null);
  assert.equal(systemTicketProbability(null, 3), null);
  // A missing leg probability is an unanswerable question, not a zero-chance leg.
  assert.equal(systemTicketProbability([0.7, null, 0.7, 0.7, 0.7], 3), null);
  assert.equal(systemTicketProbability([0.7, 0, 0.7, 0.7, 0.7], 3), null);
  assert.equal(systemTicketProbability([0.7, 1.2, 0.7, 0.7, 0.7], 3), null);
  assert.equal(systemTicketProbability([0.7, "", 0.7, 0.7, 0.7], 3), null);
});

// ── Combination counts ────────────────────────────────────────────────────

test("[C1] C(5,k) is 10, 5 and 1", () => {
  assert.equal(ticketCombinationCount(5, 3), 10);
  assert.equal(ticketCombinationCount(5, 4), 5);
  assert.equal(ticketCombinationCount(5, 5), 1);
  assert.equal(ticketCombinationCount(5, 6), 0);
});

// ── Settlement: the worked examples from the approved specification ───────

test("[A] System 3/5, all five win — 10 winning combinations", () => {
  const out = settle("WWWWW", 3);
  assert.equal(out.status, BET_STATUS.WON);
  assert.equal(out.winningCombinationCount, 10);
  assert.equal(out.combinationCount, 10);
  // 10 combinations × 2.00³ × 0.1 stake each
  assert.equal(out.returnMultiple, 8.0);
});

test("[B] System 3/5, exactly three win — WON, and still a loss in money", () => {
  const out = settle("WWWLL", 3);
  assert.equal(out.status, BET_STATUS.WON);
  assert.equal(out.winningCombinationCount, 1);
  // 1 × 8.00 × 0.1 = 0.80 back for every 1.00 staked.
  assert.equal(out.returnMultiple, 0.8);
  assert.ok(out.returnMultiple < 1, "a won system ticket can return less than its stake");
});

test("[B2] System 3/5, exactly four win", () => {
  const out = settle("WWWWL", 3);
  assert.equal(out.winningCombinationCount, 4);
  assert.equal(out.returnMultiple, 3.2);
});

test("[C] System 3/5, only two win — no combination survives", () => {
  const out = settle("WWLLL", 3);
  assert.equal(out.status, BET_STATUS.LOST);
  assert.equal(out.winningCombinationCount, 0);
  assert.equal(out.returnMultiple, null, "a lost bet has no payout to express");
});

test("[D] System 4/5, exactly four win", () => {
  const out = settle("WWWWL", 4);
  assert.equal(out.status, BET_STATUS.WON);
  assert.equal(out.combinationCount, 5);
  assert.equal(out.winningCombinationCount, 1);
  // 1 × 2.00⁴ × 0.2 = 3.20
  assert.equal(out.returnMultiple, 3.2);
});

test("[D2] System 4/5, all five win", () => {
  const out = settle("WWWWW", 4);
  assert.equal(out.winningCombinationCount, 5);
  assert.equal(out.returnMultiple, 16.0);
});

test("[D3] System 4/5, three win — lost", () => {
  assert.equal(settle("WWWLL", 4).status, BET_STATUS.LOST);
});

test("[E] System 5/5, all win — one combination, the whole product", () => {
  const out = settle("WWWWW", 5);
  assert.equal(out.status, BET_STATUS.WON);
  assert.equal(out.combinationCount, 1);
  assert.equal(out.returnMultiple, 32.0);
});

test("[E2] System 5/5, four win — lost, exactly as a combo would be", () => {
  assert.equal(settle("WWWWL", 5).status, BET_STATUS.LOST);
});

// ── VOID: the leg contributes 1.00 and the ticket keeps its shape ─────────

test("[F] System 3/5 with one void, two winners and two losers", () => {
  // A W, B W, C VOID, D L, E L. Only ABC survives: 2.00 × 2.00 × 1.00 = 4.00.
  const out = settle("WWVLL", 3);
  assert.equal(out.status, BET_STATUS.WON);
  assert.equal(out.winningCombinationCount, 1);
  assert.equal(out.returnMultiple, 0.4);
  // The rejected "reduce to 3/4" model would have paid 0.00 here — it discards
  // a fixture the punter got right because a different one was cancelled.
});

test("[F2] System 3/5 with one void and three winners", () => {
  // ABC=4, ABD=8, ACD=4, BCD=4 → 20 × 0.1 = 2.00
  const out = settle("WWVWL", 3);
  assert.equal(out.winningCombinationCount, 4);
  assert.equal(out.returnMultiple, 2.0);
});

test("[G] System 3/5 with two voids and three winners", () => {
  // All ten combinations survive; the voids ride along at 1.00. Sum = 38.
  const out = settle("WWWVV", 3);
  assert.equal(out.winningCombinationCount, 10);
  assert.equal(out.returnMultiple, 3.8);
});

test("[G2] System 3/5 with two voids, one winner and two losers", () => {
  // Only {W,V,V} survives: 2.00 × 1.00 × 1.00 = 2.00 × 0.1 = 0.20
  const out = settle("WVVLL", 3);
  assert.equal(out.winningCombinationCount, 1);
  assert.equal(out.returnMultiple, 0.2);
});

test("[G3] System 3/5 with three voids and two losers returns the void stake only", () => {
  const out = settle("VVVLL", 3);
  assert.equal(out.status, BET_STATUS.WON);
  assert.equal(out.returnMultiple, 0.1, "one combination of three voids returns its own stake");
});

test("[G4] every leg void is a VOID ticket that returns exactly the stake", () => {
  for (const k of [3, 4, 5]) {
    const out = settle("VVVVV", k);
    assert.equal(out.status, BET_STATUS.VOID, `k=${k}`);
    assert.equal(out.returnMultiple, 1.0, `k=${k} must return the stake, no more and no less`);
  }
});

test("[G5] a void cannot rescue a ticket that already lost too many legs", () => {
  // Three losers leave two survivors; a 3-fold cannot be formed at all.
  const out = settle("VVLLL", 3);
  assert.equal(out.status, BET_STATUS.LOST);
  assert.equal(out.winningCombinationCount, 0);
});

test("[G6] 5/5 with one void settles like a combo with a void leg", () => {
  const out = settle("WWWWV", 5);
  assert.equal(out.status, BET_STATUS.WON);
  assert.equal(out.returnMultiple, 16.0, "2.00⁴ × 1.00");
});

// ── Pending and early decisions ───────────────────────────────────────────

test("[H1] a pending leg holds the verdict", () => {
  const out = settle("WWPWW", 3);
  assert.equal(out.status, BET_STATUS.PENDING);
  assert.equal(out.returnMultiple, null);
});

test("[H2] a verdict already certain is not postponed for a pending leg", () => {
  // Three losers: no 3-fold can survive, whatever the pending legs do.
  const out = settle("PPLLL", 3);
  assert.equal(out.status, BET_STATUS.LOST);
});

test("[H3] at k = n a single loss decides immediately, pending legs or not", () => {
  assert.equal(settle("PPPPL", 5).status, BET_STATUS.LOST);
});

// ── Invalid shapes are absences, not guesses ──────────────────────────────

test("[I1] a ticket that is not a ticket settles to null", () => {
  assert.equal(settleTicket({ selections: [], k: 3 }), null);
  assert.equal(settleTicket({ selections: legs("WWWWW"), k: 0 }), null);
  assert.equal(settleTicket({ selections: legs("WWWWW"), k: 6 }), null);
  assert.equal(settleTicket({ selections: legs("WWWWW"), k: 2.5 }), null);
  assert.equal(settleTicket({ selections: null, k: 3 }), null);
  assert.equal(settleTicket(), null);
});

// ── The proof: Combo is the k = n case ────────────────────────────────────

test("[EQ] at k = n, settleTicket agrees with the combo path on all 4^5 outcomes", () => {
  // Not a sample: every reachable combination of five leg statuses, against the
  // functions that settle every combo in production today. Distinct odds so a
  // wrong product cannot hide behind a symmetric one.
  const odds = [1.5, 1.6, 1.7, 1.8, 1.9];
  const alphabet = ["W", "L", "V", "P"];
  let checked = 0;

  for (const a of alphabet) {
    for (const b of alphabet) {
      for (const c of alphabet) {
        for (const d of alphabet) {
          for (const e of alphabet) {
            const pattern = a + b + c + d + e;
            const selections = legs(pattern, odds);

            const expectedStatus = aggregateBetStatus(selections.map((s) => s.status));
            const expectedOdds = computeSettledTotalOdds(selections, expectedStatus);
            const actual = settleTicket({ selections, k: 5 });

            assert.equal(actual.status, expectedStatus, `status for ${pattern}`);
            assert.equal(actual.returnMultiple, expectedOdds, `settled odds for ${pattern}`);
            checked += 1;
          }
        }
      }
    }
  }

  assert.equal(checked, 1024, "every five-leg outcome must have been compared");
});
