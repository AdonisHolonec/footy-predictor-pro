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

function shotsSourceLabel(sourceKind) {
  if (sourceKind === "shots_total") return "total shots";
  if (sourceKind === "team_home") return "home SOT";
  if (sourceKind === "team_away") return "away SOT";
  return "SOT";
}

/** Align stored pick/line to the quoted book line when nearest-line fallback was used. */
function buildOuQuotePayload(pick, quote, sourceKind = null) {
  if (!pick) return undefined;
  const side = String(pick.pick || "").toLowerCase().includes("under") ? "under" : "over";
  const src = sourceKind || quote?.sourceKind || null;
  // Cross-market fallbacks keep the model SOT line; only true SOT quotes may snap line.
  const allowSnap = !src || src === "sot";
  const matchedLine = Number(quote?.line);
  const line = allowSnap && Number.isFinite(matchedLine) ? matchedLine : pick.line;
  const pickLabel = `${side === "over" ? "Over" : "Under"} ${Number(line).toFixed(1)}`;
  const odd = selectOddByPick(quote, side === "over" ? "Over" : "Under");
  const bookLabel = quote
    ? src && src !== "sot"
      ? `${shotsSourceLabel(src)} · median(${quote.bookmakersUsed})`
      : `median(${quote.bookmakersUsed})`
    : null;
  return {
    pick: pickLabel,
    line,
    odd: odd ?? null,
    over: quote?.over ?? null,
    under: quote?.under ?? null,
    requestedLine: pick.line,
    bookLine: Number.isFinite(matchedLine) ? matchedLine : null,
    lineExact: quote ? Boolean(quote.lineExact) : null,
    bookmaker: bookLabel,
    bookmakersUsed: quote?.bookmakersUsed || 0,
    oddSource: src
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
            [
              "Corners Over Under",
              "Corners Over/Under",
              "Total Corners",
              "Total Corners Over/Under",
              "Corner Over/Under",
              "Corners"
            ],
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
      cardsQuote = consensusOverUnderOddsAtLine(
        oddsReq.data,
        ["Cards Over/Under", "Total Cards", "Bookings", "Cards", "Yellow Cards Over/Under", "Total Bookings"],
        cardsLine
      );
      if (cardsQuote) cardsQuote.line = cardsLine;

      marketOdds = {
        goals15: goals15Quote
          ? {
              pick: "Over 1.5",
              line: 1.5,
              odd: goals15Quote.over,
              over: goals15Quote.over ?? null,
              under: goals15Quote.under ?? null,
              bookmaker: `median(${goals15Quote.bookmakersUsed})`,
              bookmakersUsed: goals15Quote.bookmakersUsed || 0
            }
          : undefined,
        goals25: goals25Quote
          ? {
              pick: "Over 2.5",
              line: 2.5,
              odd: goals25Quote.over,
              over: goals25Quote.over ?? null,
              under: goals25Quote.under ?? null,
              bookmaker: `median(${goals25Quote.bookmakersUsed})`,
              bookmakersUsed: goals25Quote.bookmakersUsed || 0
            }
          : undefined,
        goals35: goals35Quote
          ? {
              pick: "Over 3.5",
              line: 3.5,
              odd: goals35Quote.over,
              over: goals35Quote.over ?? null,
              under: goals35Quote.under ?? null,
              bookmaker: `median(${goals35Quote.bookmakersUsed})`,
              bookmakersUsed: goals35Quote.bookmakersUsed || 0
            }
          : undefined,
        btts: bttsQuote
          ? {
              pick: "GG",
              odd: bttsQuote.yes,
              bookmaker: `median(${bttsQuote.bookmakersUsed})`,
              bookmakersUsed: bttsQuote.bookmakersUsed || 0
            }
          : undefined,
        corners: buildOuQuotePayload(cornersPick, cornersQuote),
        shotsOnTarget: buildOuQuotePayload(
          shotsOnTargetPick,
          shotsOnTargetQuote,
          shotsOnTargetQuote?.sourceKind || null
        ),
        shotsTotal: buildOuQuotePayload(shotsTotalPick, shotsTotalQuote, "shots_total"),
        firstHalfGoals: firstHalfPick
          ? {
              pick: firstHalfPick.pick,
              line: Number.isFinite(Number(firstHalfQuote?.line)) ? Number(firstHalfQuote.line) : firstHalfPick.line,
              odd: selectOddByPick(firstHalfQuote, firstHalfPick.pick),
              over: firstHalfQuote?.over ?? null,
              under: firstHalfQuote?.under ?? null,
              bookmaker: firstHalfQuote ? `median(${firstHalfQuote.bookmakersUsed})` : null,
              bookmakersUsed: firstHalfQuote?.bookmakersUsed || 0
            }
          : undefined,
        doubleChance: doubleChanceQuote
          ? {
              homeDraw: doubleChanceQuote.homeDraw,
              homeAway: doubleChanceQuote.homeAway,
              drawAway: doubleChanceQuote.drawAway,
              bookmaker: `median(${doubleChanceQuote.bookmakersUsed})`,
              bookmakersUsed: doubleChanceQuote.bookmakersUsed || 0
            }
          : undefined,
        cards: cardsQuote
          ? {
              pick: "Cards Over/Under",
              line: cardsQuote.line ?? 3.5,
              odd: cardsQuote.over,
              over: cardsQuote.over,
              under: cardsQuote.under,
              bookmaker: `median(${cardsQuote.bookmakersUsed})`,
              bookmakersUsed: cardsQuote.bookmakersUsed || 0
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
