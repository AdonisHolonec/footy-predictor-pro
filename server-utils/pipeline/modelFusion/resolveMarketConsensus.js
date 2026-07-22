/**
 * Match-winner market consensus + Shin de-vig.
 * Extracted verbatim from Stage07ModelFusion.js (no logic changes).
 */

import { getOddsForFixture } from "../../oddsPrefetch.js";
import { consensusMatchWinnerOdds } from "../../marketOdds.js";
import { shinImpliedProbs } from "../../advancedMath.js";

/**
 * @param {{ fixtureId: number, oddsByFixtureId: Map }} params
 * @returns {Promise<{ oddsReq: object, odds: object|null, marketProbs: {p1:number,pX:number,p2:number}|null }>}
 */
export async function resolveMarketConsensus({ fixtureId, oddsByFixtureId }) {
  const oddsReq = await getOddsForFixture(fixtureId, oddsByFixtureId, 86400);
  const consensus = oddsReq.ok ? consensusMatchWinnerOdds(oddsReq.data) : null;

  let odds = null;
  let marketProbs = null;
  if (consensus) {
    // Shin's method în loc de eliminarea proporţională a marjei — corectează long-shot bias.
    const shin = shinImpliedProbs(consensus.home, consensus.draw, consensus.away);
    marketProbs = shin ? { p1: shin.p1, pX: shin.pX, p2: shin.p2 } : null;
    odds = {
      home: consensus.home,
      draw: consensus.draw,
      away: consensus.away,
      bookmaker: `median(${consensus.bookmakersUsed})`,
      bookmakersUsed: consensus.bookmakersUsed,
      marginMethod: shin ? "shin" : "proportional",
      shinZ: shin && Number.isFinite(shin.z) ? Number(shin.z.toFixed(4)) : undefined
    };
    // Value / EV deferred to Stage08 on final fused pOut (single source of truth).
  }

  return { oddsReq, odds, marketProbs };
}

export default resolveMarketConsensus;
