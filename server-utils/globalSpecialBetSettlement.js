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
    // An absent total is rejected inside evaluateOuLine, which is the one place
    // that decides what "no answer" means. This module previously guarded here
    // as well; that duplicate is gone now the boundary itself is correct.
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
 * @param {{ bet: object, selections: object[], fixturesById: Map<number, object>, now: number }} params
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

  const betStatus = aggregateBetStatus(settledSelections.map((s) => s.status));
  const settledTotalOdds = computeSettledTotalOdds(settledSelections, betStatus);

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

export default {
  MISSING_STATS_VOID_AFTER_MS,
  SELECTION_STATUS,
  BET_STATUS,
  aggregateBetStatus,
  computeSettledTotalOdds,
  officialTotalForFamily,
  settleGlobalSpecialBet,
  settleSelection
};
