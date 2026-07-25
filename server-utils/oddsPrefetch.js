import { getWithCache } from "./fetcher.js";

/**
 * Batch-prefetch Match Winner odds per league (API-Football `/odds?date=&league=&season=`).
 * `season` is required by the upstream provider — querying `/odds?date=` alone (no league/season)
 * errors out with "The Season field is required" and silently maps zero fixtures for the whole day.
 * One call per requested league (each cached independently) also avoids racing our target leagues
 * against an unbounded global date listing (tens of thousands of fixtures/odds worldwide per day,
 * paginated ~10 per page) where a league we care about could land past any reasonable page cap.
 *
 * @param {string} dateISO
 * @param {{ leagueSeasonById: Map<number, number>, maxPagesPerLeague?: number, ttlSeconds?: number }} options
 * @returns {Promise<{
 *   byFixtureId: Map<number, object>,
 *   pagesFetched: number,
 *   pagesFromCache: number,
 *   fixturesMapped: number,
 *   upstreamCalls: number,
 *   leaguesQueried: number,
 *   leaguesFailed: number
 * }>}
 */
export async function prefetchOddsByDate(dateISO, options = {}) {
  const date = String(dateISO || "").slice(0, 10);
  const maxPagesPerLeague = Math.max(1, Math.min(Number(options.maxPagesPerLeague) || 3, 10));
  const ttlSeconds = Math.max(300, Number(options.ttlSeconds) || 86400);
  const leagueSeasonById = options.leagueSeasonById instanceof Map ? options.leagueSeasonById : new Map();

  const byFixtureId = new Map();
  let pagesFetched = 0;
  let pagesFromCache = 0;
  let upstreamCalls = 0;
  let leaguesQueried = 0;
  let leaguesFailed = 0;

  if (!date || leagueSeasonById.size === 0) {
    return { byFixtureId, pagesFetched, pagesFromCache, fixturesMapped: 0, upstreamCalls, leaguesQueried, leaguesFailed };
  }

  for (const [leagueIdRaw, seasonRaw] of leagueSeasonById) {
    const leagueId = Number(leagueIdRaw);
    const season = Number(seasonRaw);
    if (!Number.isFinite(leagueId) || leagueId <= 0 || !Number.isFinite(season)) continue;
    leaguesQueried += 1;

    for (let page = 1; page <= maxPagesPerLeague; page++) {
      const req = await getWithCache("/odds", { date, league: leagueId, season, page }, ttlSeconds);
      pagesFetched += 1;
      if (req.fromCache) pagesFromCache += 1;
      else upstreamCalls += 1;

      if (!req.ok) {
        leaguesFailed += 1;
        break;
      }

      const rows = Array.isArray(req.data?.response) ? req.data.response : [];
      for (const row of rows) {
        const fixtureId = Number(row?.fixture?.id);
        if (!Number.isFinite(fixtureId) || fixtureId <= 0) continue;
        // Shape expected by consensusMatchWinnerOdds / consensusBttsOdds helpers.
        byFixtureId.set(fixtureId, { response: [row] });
      }

      const totalPages = Number(req.data?.paging?.total) || 1;
      const current = Number(req.data?.paging?.current) || page;
      if (current >= totalPages || rows.length === 0) break;
    }
  }

  return {
    byFixtureId,
    pagesFetched,
    pagesFromCache,
    fixturesMapped: byFixtureId.size,
    upstreamCalls,
    leaguesQueried,
    leaguesFailed
  };
}

/**
 * Resolve odds for a fixture: prefer batch map, else fall back to per-fixture cached call.
 */
export async function getOddsForFixture(fixtureId, batchMap, ttlSeconds = 86400) {
  const id = Number(fixtureId);
  if (batchMap && batchMap.has(id)) {
    return { ok: true, fromCache: true, fromBatch: true, data: batchMap.get(id) };
  }
  const req = await getWithCache("/odds", { fixture: id }, ttlSeconds);
  return { ...req, fromBatch: false };
}
