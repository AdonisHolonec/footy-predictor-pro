/**
 * Correct Score odds fallback (Sprint 8).
 *
 * Root cause, corrected during Sprint 8 implementation: the original Stage08Decision.js
 * (present unchanged since the Sprint 1 commit, e40b9b00) called
 * consensusCorrectScoreOdds(oddsReq) directly on the odds request WRAPPER
 * ({ok, fromCache, fromBatch, data}) instead of oddsReq.data — the raw
 * odds-api-response shape the parser actually expects (response[0].bookmakers).
 * Every other market parser (consensusMatchWinnerOdds, consensusBttsOdds,
 * consensusOverUnderOddsAtLine, etc., see resolveMarketConsensus.js and
 * resolveSideMarketQuotes.js) already unwraps .data correctly — Correct Score
 * was the one exception, so it returned null on every single prediction
 * regardless of Sprint 6's name/format parser fix, and regardless of whether
 * the underlying odds came from the batch or per-fixture endpoint.
 *
 * On top of that fix, this module also keeps the batch-fallback safety net
 * originally planned (Sprint 7 observed the batch date-listing endpoint,
 * /odds?date=..., sometimes omits secondary markets like Correct Score/Cards
 * that the per-fixture endpoint, /odds?fixture=X, includes): if Correct Score
 * is still missing after correctly reading oddsReq.data, and that data came
 * from the batch endpoint, retry ONCE with a forced per-fixture fetch. It
 * never touches oddsReq itself, so every other market (Match Winner, BTTS,
 * Over/Under, Corners, Cards, etc.), which all read the original oddsReq
 * elsewhere in Stage08, is completely unaffected.
 */

import { consensusCorrectScoreOdds } from "../../marketOdds.js";
import { getOddsForFixture } from "../../oddsPrefetch.js";

/**
 * @param {object|null} oddsReq the batch-resolved odds request already computed
 *   for this fixture (Stage07ModelFusion -> resolveMarketConsensus). Never mutated.
 * @param {number} fixtureId
 * @param {{ fetchFixtureOdds?: Function, ttlSeconds?: number }} [opts]
 *   fetchFixtureOdds is injectable for tests; defaults to the real getOddsForFixture.
 * @returns {Promise<{ scores: Record<string, number>, bookmakersUsed: number, bookmakerNames: string[] } | null>}
 */
export async function resolveCorrectScoreOddsWithFallback(oddsReq, fixtureId, opts = {}) {
  const fetchFixtureOdds = typeof opts.fetchFixtureOdds === "function" ? opts.fetchFixtureOdds : getOddsForFixture;
  const ttlSeconds = Number(opts.ttlSeconds) || 86400;

  const primary = consensusCorrectScoreOdds(oddsReq?.data);
  if (primary) return primary;
  if (!oddsReq?.fromBatch) return null; // not a batch response -> nothing more to try, preserve old behavior

  // batchMap=null forces the per-fixture endpoint; still routed through the
  // existing cache layer inside getOddsForFixture (getWithCache), never bypassed.
  const fixtureOddsReq = await fetchFixtureOdds(fixtureId, null, ttlSeconds);
  if (!fixtureOddsReq?.ok) return null;

  return consensusCorrectScoreOdds(fixtureOddsReq.data);
}

export default resolveCorrectScoreOddsWithFallback;
