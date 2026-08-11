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

import { poissonOverLine, poissonOverLineCorrelated } from "../../math.js";
import { consensusOverUnderOddsAtLine, listOverUnderLinesOffered } from "../../marketOdds.js";

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
 * Model probability for one side of one line, taken from the market block.
 *
 * @param {{ total?: Record<string, number>, lambdaHome?: number, lambdaAway?: number,
 *   correlation?: number }|null|undefined} block Poisson market block (corners / SOT /
 *   shots total / cards) as built by buildPoissonMarketBlock.
 * @param {"over"|"under"} side
 * @param {number} line the bookmaker's line — never the model's
 * @returns {{ probabilityPct: number, probabilityLine: number, source: "ladder"|"analytic" } | null}
 *   null when the model cannot price this line at all.
 */
export function priceLineFromBlock(block, side, line) {
  const target = Number(line);
  if (!block || !Number.isFinite(target)) return null;
  const wantUnder = String(side).toLowerCase() === "under";

  const key = ladderKeyForLine(target);
  const fromLadder = key ? Number(block.total?.[key]) : NaN;
  if (Number.isFinite(fromLadder)) {
    return {
      probabilityPct: roundPct(wantUnder ? 100 - fromLadder : fromLadder),
      probabilityLine: target,
      source: "ladder"
    };
  }

  // Analytic fallback — identical math to the ladder, evaluated off-ladder.
  const lh = Number(block.lambdaHome);
  const la = Number(block.lambdaAway);
  if (!Number.isFinite(lh) || !Number.isFinite(la) || lh + la <= 0) return null;
  const corr = Number(block.correlation);
  const pOver =
    Number.isFinite(corr) && corr > 0
      ? poissonOverLineCorrelated(target, lh, la, corr)
      : poissonOverLine(target, lh + la);
  if (!Number.isFinite(pOver)) return null;

  const overPct = roundPct(pOver * 100);
  return {
    probabilityPct: wantUnder ? roundPct(100 - overPct) : overPct,
    probabilityLine: target,
    source: "analytic"
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
 * @param {{ block: object|null, side: "over"|"under", requestedLine: number,
 *   quote: { line?: number, over?: number|null, under?: number|null,
 *     bookmakersUsed?: number }|null|undefined }} params
 * @returns {{ side: "over"|"under", requestedLine: number|null, bookLine: number|null,
 *   lineExact: boolean, probabilityLine: number|null, probabilityPct: number|null,
 *   odd: number|null, bookmakersUsed: number, tradable: boolean,
 *   repriced: "ladder"|"analytic"|false, reason: string|null }}
 */
export function repriceCandidateLine({ block, side, requestedLine, quote } = {}) {
  const wantUnder = String(side).toLowerCase() === "under";
  const normalizedSide = wantUnder ? "under" : "over";
  const requested = Number(requestedLine);
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
    reason: /** @type {string|null} */ (null)
  };

  const bookLine = Number(quote?.line);
  if (!quote || !Number.isFinite(bookLine)) {
    return { ...base, reason: "no_bookmaker_quote" };
  }

  const lineExact = Number.isFinite(requested) && Math.abs(bookLine - requested) < 1e-9;

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
    reason: null
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
        quote
      });
      if (sel.tradable) selections.push(sel);
    }
  }

  return selections.sort(
    (a, b) => b.probabilityPct - a.probabilityPct || a.bookLine - b.bookLine || (a.side < b.side ? -1 : 1)
  );
}

export default repriceCandidateLine;
