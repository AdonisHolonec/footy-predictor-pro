/**
 * Top-pick selection across all markets (1X2 / GG-NGG / O-U lines) plus
 * resolution of the recommended quote's odd/source for whichever pick won.
 * Extracted verbatim from Stage08Decision.js (no logic changes).
 */

import { selectTopPick, clampPct } from "../predictHelpers.js";

/**
 * @param {{ marketProbsAligned: object, p1Adj: number, pXAdj: number, p2Adj: number,
 *   leagueMultiplier: number, qualityPenalty: number, odds: object|null, bttsQuote: object|null,
 *   goals15Quote: object|null, goals25Quote: object|null, goals35Quote: object|null }} params
 * @returns {{ topSelection: object, topPick: string, maxConf: number, recommendedQuote: object }}
 */
export function selectTopPickAndQuote({
  marketProbsAligned,
  p1Adj,
  pXAdj,
  p2Adj,
  leagueMultiplier,
  qualityPenalty,
  odds,
  bttsQuote,
  goals15Quote,
  goals25Quote,
  goals35Quote
}) {
  const topSelection = selectTopPick(
    {
      pO15: marketProbsAligned.pO15,
      pO25: marketProbsAligned.pO25,
      pU35: marketProbsAligned.pU35,
      pGG: marketProbsAligned.pGG
    },
    p1Adj,
    pXAdj,
    p2Adj
  );
  const topPick = topSelection.pick;
  const maxConf = clampPct(topSelection.prob * leagueMultiplier * qualityPenalty);
  const pickLc = String(topPick || "").trim().toLowerCase();
  const recommendedQuote = (() => {
    if (!pickLc) return { odd: null, source: null, bookmakersUsed: 0 };
    if (pickLc === "1") {
      return {
        odd: Number.isFinite(Number(odds?.home)) ? Number(odds.home) : null,
        source: odds ? `median(${odds.bookmakersUsed || 0})` : null,
        bookmakersUsed: odds?.bookmakersUsed || 0
      };
    }
    if (pickLc === "x") {
      return {
        odd: Number.isFinite(Number(odds?.draw)) ? Number(odds.draw) : null,
        source: odds ? `median(${odds.bookmakersUsed || 0})` : null,
        bookmakersUsed: odds?.bookmakersUsed || 0
      };
    }
    if (pickLc === "2") {
      return {
        odd: Number.isFinite(Number(odds?.away)) ? Number(odds.away) : null,
        source: odds ? `median(${odds.bookmakersUsed || 0})` : null,
        bookmakersUsed: odds?.bookmakersUsed || 0
      };
    }
    if (pickLc === "gg" || pickLc === "ngg") {
      const odd = pickLc === "gg" ? bttsQuote?.yes : bttsQuote?.no;
      return {
        odd: Number.isFinite(Number(odd)) ? Number(odd) : null,
        source: bttsQuote ? `median(${bttsQuote.bookmakersUsed || 0})` : null,
        bookmakersUsed: bttsQuote?.bookmakersUsed || 0
      };
    }
    const ou = pickLc.match(/^(peste|sub)\s*(1[.,]5|2[.,]5|3[.,]5)$/);
    if (ou) {
      const side = ou[1] === "peste" ? "over" : "under";
      const lineRaw = ou[2].replace(",", ".");
      const quote = lineRaw === "1.5" ? goals15Quote : lineRaw === "2.5" ? goals25Quote : goals35Quote;
      const odd = quote?.[side];
      return {
        odd: Number.isFinite(Number(odd)) ? Number(odd) : null,
        source: quote ? `median(${quote.bookmakersUsed || 0})` : null,
        bookmakersUsed: quote?.bookmakersUsed || 0
      };
    }
    return { odd: null, source: null, bookmakersUsed: 0 };
  })();

  return { topSelection, topPick, maxConf, recommendedQuote };
}

export default selectTopPickAndQuote;
