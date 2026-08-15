/**
 * Side-market quote resolution (corners / SOT / shots total / first-half /
 * goals lines / BTTS / double chance / cards).
 * Extracted verbatim from Stage07ModelFusion.js (no logic changes) — this was
 * the single largest, most self-contained block in that file.
 */

import {
  consensusOverUnderOddsAtLine,
  consensusBttsOdds,
  consensusDoubleChanceOdds,
  resolveShotsOnTargetMarketQuote,
  FIRST_HALF_GOALS_MARKET_NAMES,
  SHOTS_TOTAL_MARKET_NAMES
} from "../../marketOdds.js";
import { deriveBestOverUnderPick } from "../predictHelpers.js";
import { repriceCandidateLine } from "../decision/repriceCandidateLine.js";
import { expectedIdentityForKind, formatLineLabel } from "../../marketIdentity.js";

/**
 * Bookmaker labels for the lined side markets. Exported so the decision stage can
 * enumerate every line the book offers for these markets without re-declaring the
 * lists (Stage08Decision -> enumerateLineSelections).
 */
export const CORNERS_MARKET_NAMES = [
  "Corners Over Under",
  "Corners Over/Under",
  "Total Corners",
  "Total Corners Over/Under",
  "Corner Over/Under",
  "Corners"
];

/**
 * Two markets, two units, and they are not interchangeable.
 *
 * A "Total Cards" line counts physical cards — a yellow is 1 and a red is 1 — so the line
 * sits where the card model lives, roughly 3.5 to 6.5. A "Bookings" line counts BOOKING
 * POINTS on the industry scale, where a yellow is 10 and a red is 25, so the same match is
 * quoted around 25.5 to 45.5. The two were listed together, which meant a bookings quote
 * could be priced against a cards λ of about 3 to 5 as though the numbers meant the same
 * thing. `enumerateLineSelections` applies no magnitude filter, so nothing downstream would
 * have caught it: P(under 25.5) against λ≈4 is ~100%, and a near-certainty is exactly what
 * a value engine is built to notice.
 *
 * This is not the old `red*2 + yellow` convention either. That weighting matched neither
 * market — booking points weight a red 2.5x, not 2x — which is part of why it had no
 * consumer.
 */
export const CARDS_MARKET_NAMES = [
  "Cards Over/Under",
  "Total Cards",
  "Cards",
  "Yellow Cards Over/Under"
];

/**
 * Booking-points markets. DEFINED, NOT PRICED: nothing builds a λ in booking points, so
 * these names are deliberately wired to no pricing path. They are named here so the
 * exclusion is a recorded decision rather than a silent deletion, and so a future
 * booking-points model has one place to claim.
 *
 * Do not convert between the two units. Reconstructing 10/25 points from a card total
 * would require the yellow/red split, which a total does not carry.
 */
export const BOOKING_POINTS_MARKET_NAMES = ["Bookings", "Total Bookings"];

/** The unit a discipline market is quoted in. */
export const MARKET_UNIT = Object.freeze({
  CARDS_COUNT: "cards_count",
  BOOKING_POINTS: "booking_points"
});

const normalizeDisciplineName = (name) => String(name ?? "").toLowerCase().replace(/\s+/g, " ").trim();

const CARDS_COUNT_LOOKUP = new Set(CARDS_MARKET_NAMES.map(normalizeDisciplineName));
const BOOKING_POINTS_LOOKUP = new Set(BOOKING_POINTS_MARKET_NAMES.map(normalizeDisciplineName));

/**
 * Which unit a discipline market is quoted in, or null when it is neither.
 *
 * Exact match on the normalised name, never substring: "Total Bookings" contains
 * "Bookings" and "Total Cards" contains "Cards", so a loose test would classify by
 * whichever list happened to be consulted first. Unknown returns null rather than a guess —
 * an unclassifiable market is not a permitted market, the same rule marketIdentity.js
 * applies to bet shape.
 *
 * @param {string|null|undefined} marketName
 * @returns {"cards_count"|"booking_points"|null}
 */
export function classifyDisciplineMarketUnit(marketName) {
  const n = normalizeDisciplineName(marketName);
  if (!n) return null;
  if (CARDS_COUNT_LOOKUP.has(n)) return MARKET_UNIT.CARDS_COUNT;
  if (BOOKING_POINTS_LOOKUP.has(n)) return MARKET_UNIT.BOOKING_POINTS;
  return null;
}

/** Under/sub first — never treat "under" as over via includes("over"). */
function selectOddByPick(quote, pick) {
  if (!quote || !pick) return null;
  const s = String(pick).toLowerCase().replace(/\s+/g, " ").trim();
  if (/(?:^|\s)(under|sub)\b/.test(s) || s.startsWith("under") || s.startsWith("sub")) {
    return quote.under ?? null;
  }
  if (/(?:^|\s)(over|peste)\b/.test(s) || s.startsWith("over") || s.startsWith("peste")) {
    return quote.over ?? null;
  }
  return null;
}

/**
 * Build the stored quote for a lined Over/Under market under the tradability contract.
 *
 * The old implementation snapped the *label* to the book line for true SOT quotes but
 * kept the model line for cross-market fallbacks — while attaching the book's odd in
 * both cases. Either way the probability stayed the model line's. That produced rows
 * like `Over 6.5 shots @ 1.75` where 1.75 was the book's Over 8.5 price (Aug 2026 audit).
 *
 * Now the line, the probability and the odd are resolved together, at the bookmaker's
 * own line, or the quote is marked non-tradable and carries no odd at all:
 *
 *   tradable === true  =>  pick label, `line`, `probabilityLine` and `odd` all agree
 *   tradable === false =>  odd/over/under are null; the UI must render "—"
 *
 * `expectSourceKind` guards cross-market substitution: a total-shots or team-SOT quote
 * is a different market, so its price may never stand in for match SOT even when the
 * line number happens to match. Those degrade to non-tradable rather than borrowing.
 */
function buildOuQuotePayload(pick, quote, block, sourceKind = null, expectSourceKind = null, expectedMarket = null) {
  if (!pick) return undefined;
  const side = String(pick.pick || "").toLowerCase().includes("under") ? "under" : "over";
  const sideLabel = side === "over" ? "Over" : "Under";
  const src = sourceKind || quote?.sourceKind || null;
  const crossMarket = Boolean(expectSourceKind && src && src !== expectSourceKind);
  // Structural identity this row is FOR. The quote's own identity (attached by
  // consensusOverUnderOddsAtLine) is verified against it inside repriceCandidateLine.
  const expected = expectedMarket ?? expectedIdentityForKind("generic");

  const priced = crossMarket
    ? { tradable: false, bookLine: Number(quote?.line) || null, lineExact: false, reason: "cross_market_quote" }
    : repriceCandidateLine({ block, side, requestedLine: pick.line, quote, expectedMarket: expected });

  if (!priced.tradable) {
    return {
      // Model-only: the model's own line is still worth showing as a read, but it
      // carries no price, because no price for it exists.
      pick: `${sideLabel} ${formatLineLabel(pick.line)}`,
      line: pick.line,
      odd: null,
      over: null,
      under: null,
      requestedLine: pick.line,
      bookLine: priced.bookLine ?? null,
      lineExact: priced.lineExact ?? null,
      probabilityLine: null,
      probabilityPct: null,
      bookmaker: null,
      bookmakersUsed: 0,
      oddSource: src,
      tradable: false,
      repriced: false,
      untradableReason: priced.reason || "not_tradable",
      period: expected.period,
      scope: expected.scope
    };
  }

  const bookLine = priced.bookLine;
  return {
    pick: `${sideLabel} ${formatLineLabel(bookLine)}`,
    line: bookLine,
    odd: priced.odd,
    // Both sides belong to this same book line, so they remain safe to expose.
    over: quote?.over ?? null,
    under: quote?.under ?? null,
    requestedLine: pick.line,
    bookLine,
    lineExact: priced.lineExact,
    probabilityLine: priced.probabilityLine,
    probabilityPct: priced.probabilityPct,
    bookmaker: `median(${priced.bookmakersUsed})`,
    bookmakersUsed: priced.bookmakersUsed,
    oddSource: src,
    tradable: true,
    repriced: priced.repriced,
    // Market Identity Contract: what this quote is a price for.
    period: priced.period ?? expected.period,
    scope: priced.scope ?? expected.scope
  };
}

/**
 * @param {{ oddsReq: object, cornersBlock: object|null, shotsOnTargetBlock: object|null,
 *   shotsTotalBlock: object|null, firstHalfProbs: object|null }} params
 */
export function resolveSideMarketQuotes({ oddsReq, cornersBlock, shotsOnTargetBlock, shotsTotalBlock, firstHalfProbs }) {
  let marketOdds;
  let goals15Quote = null;
  let goals25Quote = null;
  let goals35Quote = null;
  let bttsQuote = null;
  let doubleChanceQuote = null;
  let cardsQuote = null;
  let cornersPick = null;

  if (oddsReq.ok && oddsReq.data) {
    try {
      cornersPick = cornersBlock ? deriveBestOverUnderPick(cornersBlock.total) : null;
      const shotsOnTargetPick = shotsOnTargetBlock ? deriveBestOverUnderPick(shotsOnTargetBlock.total) : null;
      const shotsOnTargetHomePick = shotsOnTargetBlock?.home
        ? deriveBestOverUnderPick(shotsOnTargetBlock.home)
        : null;
      const shotsOnTargetAwayPick = shotsOnTargetBlock?.away
        ? deriveBestOverUnderPick(shotsOnTargetBlock.away)
        : null;
      const shotsTotalPick = shotsTotalBlock ? deriveBestOverUnderPick(shotsTotalBlock.total) : null;
      const firstHalfPick = firstHalfProbs
        ? (Number(firstHalfProbs.pO15) || 0) >= 50
          ? { pick: "Over 1.5 FH", line: 1.5 }
          : { pick: "Under 1.5 FH", line: 1.5 }
        : null;

      const cornersQuote = cornersPick
        ? consensusOverUnderOddsAtLine(
            oddsReq.data,
            CORNERS_MARKET_NAMES,
            cornersPick.line,
            { maxLineDelta: 1, kind: "corners" }
          )
        : null;
      const shotsOnTargetQuote = shotsOnTargetPick
        ? resolveShotsOnTargetMarketQuote(oddsReq.data, {
            matchLine: shotsOnTargetPick.line,
            homeLine: shotsOnTargetHomePick?.line ?? null,
            awayLine: shotsOnTargetAwayPick?.line ?? null
          })
        : null;
      const shotsTotalQuote = shotsTotalPick
        ? consensusOverUnderOddsAtLine(oddsReq.data, SHOTS_TOTAL_MARKET_NAMES, shotsTotalPick.line, {
            maxLineDelta: 2,
            kind: "shots_total"
          })
        : null;
      const firstHalfQuote = firstHalfPick
        ? consensusOverUnderOddsAtLine(oddsReq.data, FIRST_HALF_GOALS_MARKET_NAMES, firstHalfPick.line, {
            maxLineDelta: 0.5,
            kind: "first_half_goals"
          })
        : null;
      goals15Quote = consensusOverUnderOddsAtLine(
        oddsReq.data,
        ["Goals Over/Under", "Goals Over Under", "Total Goals"],
        1.5
      );
      goals25Quote = consensusOverUnderOddsAtLine(
        oddsReq.data,
        ["Goals Over/Under", "Goals Over Under", "Total Goals"],
        2.5
      );
      goals35Quote = consensusOverUnderOddsAtLine(
        oddsReq.data,
        ["Goals Over/Under", "Goals Over Under", "Total Goals"],
        3.5
      );
      bttsQuote = consensusBttsOdds(oddsReq.data);
      doubleChanceQuote = consensusDoubleChanceOdds(oddsReq.data);
      const cardsLine = Number(process.env.VALUE_CARDS_LINE || 3.5);
      cardsQuote = consensusOverUnderOddsAtLine(oddsReq.data, CARDS_MARKET_NAMES, cardsLine);
      if (cardsQuote) cardsQuote.line = cardsLine;

      // Goals lines are requested exact-only (maxLineDelta defaults to 0), so the book
      // line always equals the model line — these are tradable by construction.
      const exactGoalsPayload = (quote, line) =>
        quote
          ? {
              pick: `Over ${line}`,
              line,
              odd: quote.over,
              over: quote.over ?? null,
              under: quote.under ?? null,
              requestedLine: line,
              bookLine: line,
              lineExact: true,
              probabilityLine: line,
              bookmaker: `median(${quote.bookmakersUsed})`,
              bookmakersUsed: quote.bookmakersUsed || 0,
              tradable: true,
              repriced: false,
              period: "full_match",
              scope: "match"
            }
          : undefined;

      marketOdds = {
        goals15: exactGoalsPayload(goals15Quote, 1.5),
        goals25: exactGoalsPayload(goals25Quote, 2.5),
        goals35: exactGoalsPayload(goals35Quote, 3.5),
        btts: bttsQuote
          ? {
              pick: "GG",
              odd: bttsQuote.yes,
              bookmaker: `median(${bttsQuote.bookmakersUsed})`,
              bookmakersUsed: bttsQuote.bookmakersUsed || 0,
              // No line exists for BTTS, so there is nothing to disagree about.
              tradable: true,
              lineExact: true,
              repriced: false,
              period: "full_match",
              scope: "match"
            }
          : undefined,
        corners: buildOuQuotePayload(
          cornersPick,
          cornersQuote,
          cornersBlock,
          null,
          null,
          expectedIdentityForKind("corners")
        ),
        // Only a genuine match-SOT quote may price the SOT row. resolveShotsOnTargetMarketQuote
        // still falls back to total-shots / team-SOT markets, but those are different markets:
        // they are recorded as non-tradable rather than lending their price to SOT.
        shotsOnTarget: buildOuQuotePayload(
          shotsOnTargetPick,
          shotsOnTargetQuote,
          shotsOnTargetBlock,
          shotsOnTargetQuote?.sourceKind || null,
          "sot",
          expectedIdentityForKind("shots_on_target")
        ),
        shotsTotal: buildOuQuotePayload(
          shotsTotalPick,
          shotsTotalQuote,
          shotsTotalBlock,
          "shots_total",
          null,
          expectedIdentityForKind("shots_total")
        ),
        // First-half goals: the model only produces pO15, so a book line other than 1.5
        // cannot be repriced. Rather than lend a 2.5 price to the 1.5 read, the row goes
        // non-tradable and shows no odd.
        firstHalfGoals: firstHalfPick
          ? (() => {
              const bookLine = Number(firstHalfQuote?.line);
              const exact = Number.isFinite(bookLine) && Math.abs(bookLine - firstHalfPick.line) < 1e-9;
              const odd = exact ? selectOddByPick(firstHalfQuote, firstHalfPick.pick) : null;
              const tradable = Boolean(odd);
              return {
                pick: firstHalfPick.pick,
                line: firstHalfPick.line,
                odd: odd ?? null,
                over: tradable ? firstHalfQuote?.over ?? null : null,
                under: tradable ? firstHalfQuote?.under ?? null : null,
                requestedLine: firstHalfPick.line,
                bookLine: Number.isFinite(bookLine) ? bookLine : null,
                lineExact: exact,
                probabilityLine: tradable ? firstHalfPick.line : null,
                bookmaker: tradable ? `median(${firstHalfQuote.bookmakersUsed})` : null,
                bookmakersUsed: tradable ? firstHalfQuote?.bookmakersUsed || 0 : 0,
                tradable,
                repriced: false,
                // The one row whose period is NOT full_match — and it says so.
                period: "first_half",
                scope: "match",
                ...(tradable ? {} : { untradableReason: "no_model_probability_at_book_line" })
              };
            })()
          : undefined,
        doubleChance: doubleChanceQuote
          ? {
              homeDraw: doubleChanceQuote.homeDraw,
              homeAway: doubleChanceQuote.homeAway,
              drawAway: doubleChanceQuote.drawAway,
              bookmaker: `median(${doubleChanceQuote.bookmakersUsed})`,
              bookmakersUsed: doubleChanceQuote.bookmakersUsed || 0,
              // No line exists for Double Chance.
              tradable: true,
              lineExact: true,
              repriced: false,
              period: "full_match",
              scope: "match"
            }
          : undefined,
        // Cards are requested exact-only at VALUE_CARDS_LINE, so book line == model line.
        cards: cardsQuote
          ? {
              pick: "Cards Over/Under",
              line: cardsQuote.line ?? 3.5,
              odd: cardsQuote.over,
              over: cardsQuote.over,
              under: cardsQuote.under,
              requestedLine: cardsQuote.line ?? 3.5,
              bookLine: cardsQuote.line ?? 3.5,
              lineExact: true,
              probabilityLine: cardsQuote.line ?? 3.5,
              bookmaker: `median(${cardsQuote.bookmakersUsed})`,
              bookmakersUsed: cardsQuote.bookmakersUsed || 0,
              tradable: true,
              repriced: false,
              period: "full_match",
              scope: "match"
            }
          : undefined
      };
    } catch {
      // Defensive: market-specific odds extraction must never fail the whole predict pipeline.
      marketOdds = undefined;
    }
  }

  return {
    marketOdds,
    goals15Quote,
    goals25Quote,
    goals35Quote,
    bttsQuote,
    doubleChanceQuote,
    cardsQuote,
    cornersPick
  };
}

export default resolveSideMarketQuotes;
