/**
 * Elo derivative — independent probability source alongside Poisson/DC.
 * Extracted verbatim from Stage07ModelFusion.js (no logic changes).
 */

import { lookupEloPair, eloProbabilities } from "../../teamElo.js";

/**
 * @param {{ lId: number, homeIdStr: string, awayIdStr: string, homeAdv: number }} params
 * @returns {Promise<{ eloHome: number, eloAway: number, eloSpread: number, thin: boolean, probs: object } | null>}
 */
export async function deriveEloInfo({ lId, homeIdStr, awayIdStr, homeAdv }) {
  if (!homeIdStr || !awayIdStr) return null;
  try {
    const pair = await lookupEloPair(lId, Number(homeIdStr), Number(awayIdStr));
    if (!pair) return null;
    const eloProbs = eloProbabilities(pair.eloHome, pair.eloAway, {
      homeAdvElo: 60 + (homeAdv - 1) * 200
    });
    return {
      eloHome: Number(pair.eloHome.toFixed(1)),
      eloAway: Number(pair.eloAway.toFixed(1)),
      eloSpread: Number((pair.eloHome - pair.eloAway).toFixed(1)),
      thin: pair.thin,
      probs: eloProbs
    };
  } catch {
    return null;
  }
}

export default deriveEloInfo;
