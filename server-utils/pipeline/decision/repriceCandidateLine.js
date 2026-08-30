/**
 * Bookmaker-line repricing primitive.
 *
 * The bookmaker, not the model, decides which lines exist. When the model's
 * preferred line is not quoted, we must NEVER carry the model line's probability
 * (or its label) onto the bookmaker's price — that produces a selection the user
 * cannot actually place, priced against a different event. See the Aug 2026 audit:
 * `Over 6.5 shots @ 1.75` where 1.75 was in fact the book's Over 8.5 quote.
 *
 * Instead we re-read the model AT the bookmaker's line:
 *   1. ladder lookup  — the per-line table Stage05 already computed
 *   2. analytic       — the SAME function and the SAME lambdas that built that
 *                       ladder (buildPoissonMarketBlock -> poissonOverLineCorrelated),
 *                       evaluated at the book's line. Not a new model: the existing
 *                       model read at another point.
 *   3. neither        — the selection is model-only and NOT tradable.
 *
 * Pure and deterministic: no I/O, no clock, no randomness.
 */

import { consensusOverUnderOddsAtLine, listOverUnderLinesOffered } from "../../marketOdds.js";
import { expectedIdentityForKind } from "../../marketIdentity.js";
import { asianOuDistribution } from "../../asianTotals.js";

/** Ladder keys are `o<line with . replaced by _>` (see buildPoissonMarketBlock). */
export function ladderKeyForLine(line) {
  const n = Number(line);
  if (!Number.isFinite(n)) return null;
  return `o${String(n).replace(".", "_")}`;
}

/** The lines a market block carries a precomputed probability for, ascending. */
export function ladderLinesFromBlock(block) {
  const keys = Object.keys(block?.total || {});
  const lines = [];
  for (const k of keys) {
    const m = /^o(\d+)_(\d+)$/.exec(k);
    if (!m) continue;
    const n = Number(`${m[1]}.${m[2]}`);
    if (Number.isFinite(n)) lines.push(n);
  }
  return lines.sort((a, b) => a - b);
}

function roundPct(n) {
  return Number(Number(n).toFixed(1));
}

/**
 * MARKET SCALE GUARD (Total Shots only) — a bookmaker "Total Shots" line is only a
 * line for the total-shots block if the model leaves both sides of it live.
 *
 * Production audit, fixture 1557383 (Liverpool 2–2 Nottingham Forest): one preferred
 * bookmaker's "Total Shots" board was quoted at 10.5 — a shots-on-target scale —
 * while the other books sat at 27.5–29.5 and the model's total-shots ladder ran
 * 18.5–24.5 (λ_total 26.9). The board passed the Market Identity Contract (its
 * name IS a full-match, match-scope total), was priced analytically at 10.5
 * (P(over) = 0.9997) and became "Shots Over 10.5 — 100% @2.95": a certain event
 * at a long price, which then won the probability-first Recommended on 73 rows.
 *
 * The invariant is expressed in the model's own distribution, not in bookmaker
 * names, league constants or a p×odds ceiling: a total-shots line the model already
 * resolves with ≥ 99% certainty on one side is not a line on this block's scale.
 * 1% is below every legitimate total-shots recommendation ever persisted (the lowest
 * contestable mass on a real total-shots line was 2.9%) and far above every
 * pathological row (max 0.08%). Both sides of such a line are refused — the
 * "impossible" Over and the hopeless Under alike.
 *
 * SCOPE — `kind === "shots_total"` only. The same threshold was measured against the
 * other Poisson families in the final safety gate and it removed legitimate
 * candidates there: corners lines the books really quote at 2.5–5.5 and 13–18.5
 * (88 of 1946 selections on one day's boards; 4 persisted Recommended rows such as
 * Over 7.5 @1.41 from five books with the model at 99.1%) and a real SOT tile
 * (Over 6.5 @1.10, model 99.4%). Those are on-scale lines with a confident model,
 * not scale errors, so the guard must not touch them. The defect is a Total Shots
 * board quoted at shots-on-target scale; only that path is corrected.
 */
export const MIN_CONTESTABLE_LINE_MASS = 0.01;

/** Discovery kinds whose bookmaker lines are checked against the model's scale. */
export const SCALE_GUARDED_KINDS = Object.freeze(["shots_total"]);

/**
 * @param {string|null|undefined} kind discovery kind (see expectedIdentityForKind)
 * @returns {boolean} true when repriceCandidateLine must refuse off-scale lines for it
 */
export function isScaleGuardedKind(kind) {
  return SCALE_GUARDED_KINDS.includes(String(kind || ""));
}

/**
 * @param {{ pWin: number, pLoss: number }|null|undefined} asian outcome distribution
 *   for one side of one line (fractions)
 * @returns {boolean} true when both outright outcomes carry at least
 *   MIN_CONTESTABLE_LINE_MASS of probability
 */
export function isContestableLine(asian) {
  const pWin = Number(asian?.pWin);
  const pLoss = Number(asian?.pLoss);
  if (!Number.isFinite(pWin) || !Number.isFinite(pLoss)) return false;
  return Math.min(pWin, pLoss) >= MIN_CONTESTABLE_LINE_MASS;
}

/**
 * Model probability for one side of one line, taken from the market block —
 * with full Asian semantics (Increment B).
 *
 * `probabilityPct` is P(FULL WIN), the product's approved ranking semantics:
 * for a half line that is the familiar strict probability (no push exists);
 * for an integer line the push mass P(X == L) is EXCLUDED (Under 10 no longer
 * borrows P(X = 10), the audit's systematic integer-line inflation); for a
 * quarter line it is the probability BOTH split components win. The complete
 * outcome distribution rides along in `asian` so EV and settlement can use
 * push / half-outcome mass without re-deriving it.
 *
 * Distribution source: the SAME discrete model, read only at .5 boundaries —
 * ladder first, the block's own lambdas otherwise (asianTotals.js).
 *
 * @param {{ total?: Record<string, number>, lambdaHome?: number, lambdaAway?: number,
 *   correlation?: number }|null|undefined} block Poisson market block (corners / SOT /
 *   shots total / cards) as built by buildPoissonMarketBlock.
 * @param {"over"|"under"} side
 * @param {number} line the bookmaker's line — never the model's
 * @returns {{ probabilityPct: number, probabilityLine: number,
 *   source: "ladder"|"analytic"|"mixed",
 *   asian: { pWin: number, pPush: number, pHalfWin: number, pHalfLoss: number,
 *     pLoss: number } } | null}
 *   null when the model cannot price this line at all.
 */
export function priceLineFromBlock(block, side, line) {
  const target = Number(line);
  if (!block || !Number.isFinite(target)) return null;
  const wantUnder = String(side).toLowerCase() === "under";

  const dist = asianOuDistribution(block, wantUnder ? "under" : "over", target);
  if (!dist) return null;
  const { source, ...asian } = dist;
  return {
    probabilityPct: roundPct(asian.pWin * 100),
    probabilityLine: target,
    source,
    asian
  };
}

/**
 * Resolve the full line/probability/odds contract for one Over-Under selection.
 *
 * INVARIANT (asserted by tests): `tradable === true` implies
 * `probabilityLine === bookLine`, and `odd` is the bookmaker's price for that
 * exact line and side. There is no path returning a tradable candidate whose
 * probability belongs to a different line.
 *
 * MARKET IDENTITY GUARD: when `expectedMarket` ({ betType, period, scope }) is
 * provided, the quote must carry a matching identity (`quote.market`, attached by
 * consensusOverUnderOddsAtLine). A quote for another period, scope or bet
 * structure is NOT this selection's price, whatever the line number says — it
 * degrades to non-tradable with an explicit reason instead of being "close
 * enough". Nearest-line logic only ever applies WITHIN one identity.
 *
 * @param {{ block: object|null, side: "over"|"under", requestedLine: number,
 *   quote: { line?: number, over?: number|null, under?: number|null,
 *     bookmakersUsed?: number, market?: { betType?: string, period?: string,
 *     scope?: string } }|null|undefined,
 *   expectedMarket?: { betType?: string, period?: string, scope?: string }|null,
 *   kind?: string|null }} params `kind` is the discovery kind this selection is FOR;
 *   the market scale guard applies only to kinds listed in SCALE_GUARDED_KINDS.
 * @returns {{ side: "over"|"under", requestedLine: number|null, bookLine: number|null,
 *   lineExact: boolean, probabilityLine: number|null, probabilityPct: number|null,
 *   odd: number|null, bookmakersUsed: number, tradable: boolean,
 *   repriced: "ladder"|"analytic"|false, reason: string|null,
 *   betType: string|null, period: string|null, scope: string|null }}
 */
export function repriceCandidateLine({
  block,
  side,
  requestedLine,
  quote,
  expectedMarket = null,
  kind = null
} = {}) {
  const wantUnder = String(side).toLowerCase() === "under";
  const normalizedSide = wantUnder ? "under" : "over";
  const requested = Number(requestedLine);
  const identity = quote?.market ?? null;
  const base = {
    side: normalizedSide,
    requestedLine: Number.isFinite(requested) ? requested : null,
    bookLine: null,
    lineExact: false,
    probabilityLine: null,
    probabilityPct: null,
    odd: null,
    bookmakersUsed: 0,
    tradable: false,
    repriced: /** @type {"ladder"|"analytic"|false} */ (false),
    reason: /** @type {string|null} */ (null),
    betType: identity?.betType ?? null,
    period: identity?.period ?? null,
    scope: identity?.scope ?? null
  };

  const bookLine = Number(quote?.line);
  if (!quote || !Number.isFinite(bookLine)) {
    return { ...base, reason: "no_bookmaker_quote" };
  }

  const lineExact = Number.isFinite(requested) && Math.abs(bookLine - requested) < 1e-9;

  if (expectedMarket) {
    const unknownIdentity =
      !identity ||
      !identity.betType || identity.betType === "unknown" ||
      !identity.period || identity.period === "unknown" ||
      !identity.scope || identity.scope === "unknown";
    if (unknownIdentity) {
      // A quote that cannot say what market it belongs to is not a price for
      // anything. Unknown may exist internally; it may never become tradable.
      return { ...base, bookLine, lineExact, reason: "unknown_market_identity" };
    }
    if (expectedMarket.betType && identity.betType !== expectedMarket.betType) {
      return { ...base, bookLine, lineExact, reason: "cross_market_quote" };
    }
    if (expectedMarket.period && identity.period !== expectedMarket.period) {
      return { ...base, bookLine, lineExact, reason: "cross_period_quote" };
    }
    if (expectedMarket.scope && identity.scope !== expectedMarket.scope) {
      return { ...base, bookLine, lineExact, reason: "cross_scope_quote" };
    }
  }

  const rawOdd = wantUnder ? quote.under : quote.over;
  const odd = Number(rawOdd);
  if (!Number.isFinite(odd) || odd <= 1) {
    return { ...base, bookLine, lineExact, reason: "no_odd_for_side" };
  }

  const priced = priceLineFromBlock(block, normalizedSide, bookLine);
  if (!priced) {
    // Model cannot price the line the bookmaker actually offers -> model-only.
    return {
      ...base,
      bookLine,
      lineExact,
      bookmakersUsed: Number(quote.bookmakersUsed) || 0,
      reason: "no_model_probability_at_book_line"
    };
  }

  if (isScaleGuardedKind(kind) && !isContestableLine(priced.asian)) {
    // A Total Shots board off this block's scale (see MIN_CONTESTABLE_LINE_MASS):
    // whatever the market is called, this is not a price for the event the model
    // is describing. Non-tradable, never a candidate — same shape as the other
    // refusals so callers and reporting treat it identically.
    return {
      ...base,
      bookLine,
      lineExact,
      bookmakersUsed: Number(quote.bookmakersUsed) || 0,
      reason: "line_off_model_scale"
    };
  }

  return {
    side: normalizedSide,
    requestedLine: Number.isFinite(requested) ? requested : null,
    bookLine,
    lineExact,
    probabilityLine: priced.probabilityLine,
    probabilityPct: priced.probabilityPct,
    odd,
    bookmakersUsed: Number(quote.bookmakersUsed) || 0,
    tradable: true,
    // Exact lines are still priced at the book line — flagged as repriced only when
    // the line actually moved, so reporting can separate the two.
    repriced: lineExact ? false : priced.source,
    reason: null,
    // Full Asian outcome distribution (fractions, sum 1). probabilityPct above is
    // P(full win); EV and settlement read push / half-outcome mass from here.
    asian: priced.asian,
    // Market identity travels with the selection so candidates, Stage09 and the
    // UI can all attest WHAT this is a price for (period/scope, not just a line).
    betType: identity?.betType ?? expectedMarket?.betType ?? null,
    period: identity?.period ?? expectedMarket?.period ?? null,
    scope: identity?.scope ?? expectedMarket?.scope ?? null
  };
}

/**
 * Every tradable Over/Under selection a bookmaker actually offers for one market.
 *
 * The bookmaker's board is the source of truth: we ask which lines it quotes
 * (listOverUnderLinesOffered) and price the model at each of those. We never start from
 * an internal list of lines and hope the book happens to offer them — that ordering
 * silently skipped real, tradable lines whenever they fell outside our ladder.
 *
 * For each discovered line the probability comes from the ladder when the model already
 * has it, and analytically off the block's own lambdas when it does not. A line the model
 * cannot price either way is dropped here, so callers cannot accidentally surface it.
 *
 * Pure: parses the already-fetched payload, no network, no cache, no clock.
 *
 * @returns {Array<object>} repriceCandidateLine() results, probability DESC
 */
export function enumerateLineSelections({
  oddsData,
  marketNames,
  kind = "generic",
  block,
  preferredLine = null,
  preferredBookmakers
} = {}) {
  if (!oddsData || !block) return [];
  const opts = preferredBookmakers ? { kind, preferredBookmakers } : { kind };
  // Market Identity Contract: what this enumeration is FOR. Discovery and the
  // consensus quotes already enforce it; repriceCandidateLine re-verifies it so
  // no future caller can pair this block with a quote from another market.
  const expectedMarket = expectedIdentityForKind(kind);

  const offeredLines = listOverUnderLinesOffered(oddsData, marketNames, opts);
  if (!offeredLines.length) return [];

  /** @type {Map<number, object>} bookLine -> consensus quote at exactly that line */
  const quotesByLine = new Map();
  for (const bookLine of offeredLines) {
    const quote = consensusOverUnderOddsAtLine(oddsData, marketNames, bookLine, {
      ...opts,
      maxLineDelta: 0
    });
    if (quote && Number.isFinite(Number(quote.line))) quotesByLine.set(Number(quote.line), quote);
  }

  const preferred = Number(preferredLine);
  const requested = Number.isFinite(preferred) ? preferred : null;
  const selections = [];
  for (const [bookLine, quote] of quotesByLine) {
    for (const side of ["over", "under"]) {
      const sel = repriceCandidateLine({
        block,
        side,
        requestedLine: requested ?? bookLine,
        quote,
        expectedMarket,
        kind
      });
      if (sel.tradable) selections.push(sel);
    }
  }

  return selections.sort(
    (a, b) => b.probabilityPct - a.probabilityPct || a.bookLine - b.bookLine || (a.side < b.side ? -1 : 1)
  );
}

export default repriceCandidateLine;
