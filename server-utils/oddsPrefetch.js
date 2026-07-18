import { getWithCache } from "./fetcher.js";

/**
 * Batch-prefetch Match Winner odds by calendar date (API-Football `/odds?date=`).
 * Replaces up to N per-fixture `/odds?fixture=` calls with a few paginated date queries.
 *
 * @returns {Promise<{
 *   byFixtureId: Map<number, object>,
 *   pagesFetched: number,
 *   pagesFromCache: number,
 *   fixturesMapped: number,
 *   upstreamCalls: number
 * }>}
 */
export async function prefetchOddsByDate(dateISO, options = {}) {
  const date = String(dateISO || "").slice(0, 10);
  const maxPages = Math.max(1, Math.min(Number(options.maxPages) || 8, 20));
  const ttlSeconds = Math.max(300, Number(options.ttlSeconds) || 86400);
  const leagueFilter = Array.isArray(options.leagueIds)
    ? new Set(options.leagueIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0))
    : null;

  const byFixtureId = new Map();
  let pagesFetched = 0;
  let pagesFromCache = 0;
  let upstreamCalls = 0;

  if (!date) {
    return { byFixtureId, pagesFetched, pagesFromCache, fixturesMapped: 0, upstreamCalls };
  }

  for (let page = 1; page <= maxPages; page++) {
    const params = { date, page };
    // Optional league scoping when a single league is requested (API supports league+season+date).
    if (options.leagueId != null && options.season != null) {
      params.league = Number(options.leagueId);
      params.season = Number(options.season);
    }

    const req = await getWithCache("/odds", params, ttlSeconds);
    pagesFetched += 1;
    if (req.fromCache) pagesFromCache += 1;
    else upstreamCalls += 1;

    if (!req.ok) break;

    const rows = Array.isArray(req.data?.response) ? req.data.response : [];
    for (const row of rows) {
      const fixtureId = Number(row?.fixture?.id);
      if (!Number.isFinite(fixtureId) || fixtureId <= 0) continue;
      if (leagueFilter && leagueFilter.size > 0) {
        const lid = Number(row?.league?.id);
        if (!leagueFilter.has(lid)) continue;
      }
      // Shape expected by consensusMatchWinnerOdds / consensusBttsOdds helpers.
      byFixtureId.set(fixtureId, { response: [row] });
    }

    const totalPages = Number(req.data?.paging?.total) || 1;
    const current = Number(req.data?.paging?.current) || page;
    if (current >= totalPages || rows.length === 0) break;
  }

  return {
    byFixtureId,
    pagesFetched,
    pagesFromCache,
    fixturesMapped: byFixtureId.size,
    upstreamCalls
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
