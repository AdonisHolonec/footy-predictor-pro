/**
 * Global Special Bet — settlement logic.
 *
 * Pure and deterministic: no clock, no I/O, no Supabase. `now` is an argument,
 * exactly as in the selection engine, so a 48-hour boundary is testable instead
 * of being whatever the machine happened to think the time was.
 *
 * Reuses the settlement the server already has — `validationFromOu` for totals
 * markets and `evaluateTopPick` for 1X2 / Double Chance / BTTS. Nothing here
 * re-implements a grader, and nothing parses a selection out of prose: the
 * snapshot stores `market`, `side` and `line` explicitly, which is what stops
 * the class of bug fixed in d0feb89e from ever applying here.
 *
 * Persistence lives in globalSpecialBets.js; this module only decides.
 */

import { CANCELLED } from "./closingOddsCapture.js";
import { validationFromOu } from "./cardMarketSettlement.js";
import { evaluateTopPick, isFinalStatus } from "./predictionsHistory.js";

/**
 * How long a finished fixture may go without the official statistic a selection
 * needs before the selection is voided rather than left pending forever.
 * Measured from kickoff.
 */
export const MISSING_STATS_VOID_AFTER_MS = 48 * 60 * 60 * 1000;

/** Families settled against an observed total. */
const TOTALS_FAMILIES = new Set(["ou", "corners", "shots"]);
/** Families settled against the final score by their pick label. */
const PICK_FAMILIES = new Set(["1x2", "dc", "btts"]);

export const SELECTION_STATUS = Object.freeze({
  PENDING: "pending",
  WON: "won",
  LOST: "lost",
  VOID: "void"
});

export const BET_STATUS = SELECTION_STATUS;

/**
 * The official figure a totals selection settles against.
 *
 * Goals come from the score; corners and shots on target from the fixture
 * statistics the history sync already hydrates into `marketResults`.
 */
export function officialTotalForFamily(market, { score, marketTotals } = {}) {
  if (market === "ou") {
    if (score?.home == null || score?.away == null) return null;
    const total = Number(score.home) + Number(score.away);
    return Number.isFinite(total) ? total : null;
  }
  const raw = market === "corners" ? marketTotals?.cornersTotal : marketTotals?.shotsOnTargetTotal;
  if (raw === null || raw === undefined || raw === "") return null;
  const total = Number(raw);
  return Number.isFinite(total) ? total : null;
}

/**
 * Settle one stored selection.
 *
 * @param {{ market: string, side: string|null, line: number|null, selection: string, kickoff_at: string }} selection
 * @param {{ status: string, score: {home: number|null, away: number|null}, marketTotals: object }} fixture
 * @param {number} now
 * @returns {"pending"|"won"|"lost"|"void"}
 */
export function settleSelection(selection, fixture, now) {
  const status = String(fixture?.status || "").toUpperCase();

  // A fixture that will never produce a result voids its selection immediately;
  // waiting 48 hours for a postponed match to settle would be theatre.
  if (CANCELLED.has(status)) return SELECTION_STATUS.VOID;

  let outcome = "pending";
  const market = String(selection?.market || "");

  if (TOTALS_FAMILIES.has(market)) {
    // An absent total is rejected inside settleOuValidation, which is the one
    // place that decides what "no answer" means. This module previously guarded
    // here as well; that duplicate is gone now the boundary itself is correct.
    outcome = validationFromOu(
      status,
      selection?.side,
      selection?.line,
      officialTotalForFamily(market, fixture)
    );
  } else if (PICK_FAMILIES.has(market)) {
    if (isFinalStatus(status)) {
      const hit = evaluateTopPick(selection?.selection, fixture?.score);
      outcome = hit === null ? "pending" : hit ? "win" : "loss";
    }
  }
  // Any other family cannot be graded. The engine refuses to select one
  // (SETTLEABLE_MARKET_FAMILIES), so reaching here means a legacy row — it stays
  // pending and is voided by the 48-hour rule rather than guessed at.

  if (outcome === "win") return SELECTION_STATUS.WON;
  if (outcome === "loss") return SELECTION_STATUS.LOST;
  // Asian push: the stake is returned. VOID is exactly that here — the leg
  // contributes 1.00 to settled odds and the bet continues on its other legs
  // (aggregateBetStatus / computeSettledTotalOdds already treat VOID this way).
  if (outcome === "push") return SELECTION_STATUS.VOID;
  // half_win / half_loss cannot be represented by the status CHECK (043) or by
  // a per-leg multiplier column, so quarter lines are refused at bet-generation
  // time (globalSpecialBetEngine). A legacy quarter leg that somehow reaches a
  // half outcome stays PENDING and falls to the 48-hour void below rather than
  // being settled as a full win or loss it did not earn.

  // Still ungraded: the official statistic never arrived. Void it once the
  // window has passed so a bet cannot hang on a number that is not coming.
  const kickoffMs = Date.parse(selection?.kickoff_at || "");
  if (Number.isFinite(kickoffMs) && now - kickoffMs >= MISSING_STATS_VOID_AFTER_MS) {
    return SELECTION_STATUS.VOID;
  }
  return SELECTION_STATUS.PENDING;
}

/**
 * The bet's status from its selections' statuses.
 *
 * Order matters and is not interchangeable:
 *   1. any LOST wins outright — a lost leg is final, whatever the others do
 *   2. otherwise any PENDING holds — no verdict while something is undecided
 *   3. otherwise all VOID means the bet never really ran
 *   4. otherwise it is won
 *
 * Putting PENDING before LOST would postpone a verdict that is already certain,
 * which is the conflicting case the rules have to resolve explicitly.
 */
export function aggregateBetStatus(statuses) {
  const list = Array.isArray(statuses) ? statuses : [];
  if (list.length === 0) return BET_STATUS.PENDING;
  if (list.includes(SELECTION_STATUS.LOST)) return BET_STATUS.LOST;
  if (list.includes(SELECTION_STATUS.PENDING)) return BET_STATUS.PENDING;
  if (list.every((s) => s === SELECTION_STATUS.VOID)) return BET_STATUS.VOID;
  return BET_STATUS.WON;
}

/**
 * The odds the bet actually settled at.
 *
 * A void leg contributes 1.00 — the standard treatment, and the reason this is
 * a separate column: `total_odds` remains what was promised at generation and
 * is never rewritten.
 *
 * Convention: NULL for a lost or still-pending bet. A lost bet has no payout to
 * express, and a pending one has no final answer yet; storing a number for
 * either would invite it to be read as a payout that does not exist.
 */
export function computeSettledTotalOdds(selectionStatuses, betStatus) {
  if (betStatus !== BET_STATUS.WON && betStatus !== BET_STATUS.VOID) return null;
  const product = (selectionStatuses || []).reduce((acc, s) => {
    if (s.status === SELECTION_STATUS.VOID) return acc * 1;
    return acc * Number(s.odds);
  }, 1);
  return Number.isFinite(product) ? Number(product.toFixed(3)) : null;
}

/**
 * Settle a whole bet: every selection, then the aggregate, then the settled odds.
 *
 * Returns the intended end state rather than writing it — the caller decides
 * whether anything changed and performs the update. Re-running on an already
 * settled bet produces exactly the same object, which is what makes the cron
 * safe to run twice.
 *
 * PER-LEG SETTLEMENT IS SHARED. A leg is a leg: settleSelection grades it the
 * same way whichever kind of ticket it belongs to. Only the aggregation differs,
 * and the branch is on `bet.bet_kind` alone:
 *
 *   combo (or absent)  aggregateBetStatus + computeSettledTotalOdds — untouched
 *   system             settleTicket({ selections, k: bet.system_k })
 *
 * Absent is combo on purpose: every row written before migration 052 carries no
 * kind, and reading one of those as a system would grade it against a k it never
 * had. `settled_total_odds` means the same thing on both branches — gross return
 * per unit staked — so no column changes meaning.
 *
 * @param {{ bet: object, selections: object[], fixturesById: Map<number, object>, now: number }} params
 * @returns {{ selections: object[], betStatus: string, settledTotalOdds: number|null,
 *             selectionChanges: object[], changed: boolean, isTerminal: boolean,
 *             error?: string }} `error` means nothing may be written for this bet
 */
export function settleGlobalSpecialBet({ bet, selections, fixturesById, now }) {
  const settledSelections = (selections || []).map((selection) => {
    const fixture = fixturesById?.get(Number(selection.fixture_id));
    // No fixture row at all is indistinguishable from missing statistics: leave
    // it pending, and let the 48-hour rule decide.
    const status = fixture
      ? settleSelection(selection, fixture, now)
      : settleSelection(selection, { status: "", score: {}, marketTotals: {} }, now);
    return { id: selection.id, odds: Number(selection.odds), status, previousStatus: selection.status };
  });

  // Which grader answers for the whole ticket. Absent or unrecognised bet_kind
  // is a COMBO: every row written before migration 052 has no kind at all, and
  // guessing "system" for one of them would grade it against a k it never had.
  const isSystem = bet?.bet_kind === "system";

  let betStatus;
  let settledTotalOdds;
  if (isSystem) {
    const outcome = settleTicket({ selections: settledSelections, k: Number(bet?.system_k) });
    if (!outcome) {
      // A system row whose shape cannot be settled — a k that is missing, not an
      // integer, or outside 1..n. Refusing is the only safe answer: writing a
      // status derived from a k we do not have would be a corrupt settlement,
      // and leaving it pending keeps it visible for the next run and for the
      // failure list the caller reports.
      return {
        selections: settledSelections,
        betStatus: BET_STATUS.PENDING,
        settledTotalOdds: null,
        selectionChanges: [],
        changed: false,
        isTerminal: false,
        error:
          `system bet ${bet?.id} has an unsettleable shape ` +
          `(system_k=${bet?.system_k}, selections=${settledSelections.length})`
      };
    }
    betStatus = outcome.status;
    settledTotalOdds = outcome.returnMultiple;
  } else {
    betStatus = aggregateBetStatus(settledSelections.map((s) => s.status));
    settledTotalOdds = computeSettledTotalOdds(settledSelections, betStatus);
  }

  const selectionChanges = settledSelections.filter((s) => s.status !== s.previousStatus);
  const betChanged =
    bet?.status !== betStatus ||
    Number(bet?.settled_total_odds ?? Number.NaN) !== Number(settledTotalOdds ?? Number.NaN);

  return {
    selections: settledSelections,
    betStatus,
    settledTotalOdds,
    selectionChanges,
    // Nothing to write when the answer is unchanged — the cheapest form of
    // idempotency is not issuing the update at all.
    changed: selectionChanges.length > 0 || betChanged,
    // A bet only reaches a terminal state once; settled_at is stamped then.
    isTerminal: betStatus !== BET_STATUS.PENDING
  };
}

// ── k-of-n tickets ─────────────────────────────────────────────────────────
//
// A system ticket is n selections of which any k must win, staked across every
// k-sized combination of them. Combo is the k = n case of exactly this model,
// and the equality is asserted rather than claimed in a comment: the suite
// enumerates all 4^5 status combinations and requires settleTicket at k = n to
// agree with aggregateBetStatus + computeSettledTotalOdds on every one.
//
// Nothing below is reachable from production. The persistence layer neither
// reads bet_kind nor passes a k, and the database refuses to store a system
// ticket at all (migration 052, `system_not_enabled`).

/** C(n, k), exact at the sizes a ticket uses. */
export function ticketCombinationCount(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

/** Every k-sized subset of `items`, in index order. n is 5, so at most 10 subsets. */
function subsetsOfSize(items, k) {
  const out = [];
  const pick = (start, chosen) => {
    if (chosen.length === k) {
      out.push(chosen);
      return;
    }
    for (let i = start; i < items.length; i += 1) pick(i + 1, [...chosen, items[i]]);
  };
  pick(0, []);
  return out;
}

/**
 * A leg's multiplier inside a combination.
 *
 * VOID contributes 1.00 — the stake for that leg comes back. This is not a new
 * rule invented for systems: computeSettledTotalOdds has always treated a void
 * leg this way, and applying it per combination is what makes Combo fall out of
 * the general model unchanged.
 *
 * The alternative considered and rejected was reducing the ticket (3/5 becomes
 * 3/4 once a leg voids). It changes the number of combinations AFTER the bet
 * was placed, which retroactively rewrites the stake each combination carries,
 * and it pays nothing for a fixture the punter actually got right — a 3/5 with
 * two winners, one void and two losers returns 4.00 under this model and 0.00
 * under that one.
 */
function legMultiplier(selection) {
  return selection?.status === SELECTION_STATUS.VOID ? 1 : Number(selection?.odds);
}

/**
 * Settle a k-of-n ticket from its already-settled legs.
 *
 * @param {{ selections: Array<{status: string, odds: number}>, k: number }} params
 * @returns {{ status: string, returnMultiple: number|null, winningCombinationCount: number,
 *             combinationCount: number }|null} null when the shape is not a ticket
 *
 * `returnMultiple` is GROSS RETURN PER UNIT OF TOTAL STAKE, which is the same
 * quantity `settled_total_odds` already holds for a combo — no column changes
 * meaning. It is null for LOST and PENDING, matching the existing convention: a
 * lost bet has no payout to express and a pending one has no answer yet.
 *
 * Stake is not a parameter because the multiple is invariant to it. A caller
 * that has a stake multiplies; the product currently has none.
 */
export function settleTicket({ selections, k } = {}) {
  const legs = Array.isArray(selections) ? selections : null;
  if (!legs || legs.length === 0) return null;
  const n = legs.length;
  if (!Number.isInteger(k) || k < 1 || k > n) return null;

  const combinationCount = ticketCombinationCount(n, k);
  const lost = legs.filter((s) => s?.status === SELECTION_STATUS.LOST).length;

  // Decided early, exactly as a combo decides early on its first lost leg: once
  // too few legs survive to reach k, no later result can change the answer.
  // At k = n this reduces to "one lost leg loses the bet".
  if (n - lost < k) {
    return { status: BET_STATUS.LOST, returnMultiple: null, winningCombinationCount: 0, combinationCount };
  }
  if (legs.some((s) => s?.status === SELECTION_STATUS.PENDING)) {
    return { status: BET_STATUS.PENDING, returnMultiple: null, winningCombinationCount: 0, combinationCount };
  }

  // A combination wins when none of its legs lost. Voids ride along at 1.00.
  const surviving = legs.filter((s) => s?.status !== SELECTION_STATUS.LOST);
  const winners = subsetsOfSize(surviving, k);
  const stakePerCombination = 1 / combinationCount;
  const gross = winners.reduce(
    (acc, combo) => acc + combo.reduce((product, leg) => product * legMultiplier(leg), 1) * stakePerCombination,
    0
  );

  // Every leg void means every combination returns exactly its own stake, so the
  // ticket returns the stake and nothing was really played. The general formula
  // produces that on its own — this branch only names it.
  const status = legs.every((s) => s?.status === SELECTION_STATUS.VOID) ? BET_STATUS.VOID : BET_STATUS.WON;

  return {
    status,
    returnMultiple: Number.isFinite(gross) ? Number(gross.toFixed(3)) : null,
    winningCombinationCount: winners.length,
    combinationCount
  };
}

export default {
  MISSING_STATS_VOID_AFTER_MS,
  SELECTION_STATUS,
  BET_STATUS,
  aggregateBetStatus,
  computeSettledTotalOdds,
  officialTotalForFamily,
  settleGlobalSpecialBet,
  settleSelection,
  ticketCombinationCount,
  settleTicket
};
