import { isAuthorizedCronOrInternalRequest } from "../../server-utils/cronRequestAuth.js";
import { getWithCache, getApiUsage } from "../../server-utils/fetcher.js";

function parseLeagueIds(raw) {
  const fallback = [39, 140, 135, 78, 61, 2, 3, 283];
  const src = String(raw || "")
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v));
  return src.length ? Array.from(new Set(src)) : fallback;
}

export default async function handler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }
  if (!isAuthorizedCronOrInternalRequest(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized prewarm request." });
  }

  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const season = Number(req.query.season || process.env.PREWARM_SEASON || new Date().getFullYear());
  const leagueIds = parseLeagueIds(req.query.leagueIds || process.env.PREWARM_LEAGUE_IDS);

  const result = {
    date,
    season,
    leagueIds,
    fixtures: { fromCache: 0, fetched: 0 },
    standings: { fromCache: 0, fetched: 0 },
    teamStats: { fromCache: 0, fetched: 0 },
    odds: { fromCache: 0, fetched: 0 },
    totalFixturesInLeagues: 0,
    errors: []
  };

  try {
    // Vercel cron uses UTC; this gate ensures real run at 00:01 Europe/Bucharest.
    const force = String(req.query.force || "") === "1";
    const nowInRo = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Bucharest",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date());
    if (!force && nowInRo !== "00:01") {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: `Outside Romania schedule window. Current Europe/Bucharest time: ${nowInRo}`
      });
    }

    const fixturesReq = await getWithCache("/fixtures", { date }, 21600);
    if (!fixturesReq.ok) {
      return res.status(500).json({ ok: false, error: fixturesReq.error || "Fixtures prewarm failed." });
    }
    if (fixturesReq.fromCache) result.fixtures.fromCache += 1;
    else result.fixtures.fetched += 1;

    const allFixtures = fixturesReq.data?.response || fixturesReq.data || [];

    for (const leagueId of leagueIds) {
      const standingsReq = await getWithCache("/standings", { league: leagueId, season }, 86400);
      if (!standingsReq.ok) {
        result.errors.push({ where: "standings", leagueId, error: standingsReq.error || "standings error" });
      } else if (standingsReq.fromCache) {
        result.standings.fromCache += 1;
      } else {
        result.standings.fetched += 1;
      }

      const leagueFixtures = allFixtures.filter((f) => Number(f?.league?.id) === Number(leagueId));
      result.totalFixturesInLeagues += leagueFixtures.length;

      const teamIds = new Set();
      for (const fx of leagueFixtures) {
        if (fx?.teams?.home?.id) teamIds.add(Number(fx.teams.home.id));
        if (fx?.teams?.away?.id) teamIds.add(Number(fx.teams.away.id));
      }

      for (const teamId of Array.from(teamIds).slice(0, 20)) {
        const tsReq = await getWithCache("/teams/statistics", { league: leagueId, season, team: teamId }, 86400);
        if (!tsReq.ok) {
          result.errors.push({ where: "teamstats", leagueId, teamId, error: tsReq.error || "teamstats error" });
        } else if (tsReq.fromCache) {
          result.teamStats.fromCache += 1;
        } else {
          result.teamStats.fetched += 1;
        }
      }

      for (const fx of leagueFixtures.slice(0, 50)) {
        const fixtureId = Number(fx?.fixture?.id);
        if (!Number.isFinite(fixtureId)) continue;
        const oddsReq = await getWithCache("/odds", { fixture: fixtureId }, 86400);
        if (!oddsReq.ok) {
          result.errors.push({ where: "odds", leagueId, fixtureId, error: oddsReq.error || "odds error" });
        } else if (oddsReq.fromCache) {
          result.odds.fromCache += 1;
        } else {
          result.odds.fetched += 1;
        }
      }
    }

    const usage = await getApiUsage();
    return res.status(200).json({
      ok: result.errors.length === 0,
      prewarm: result,
      usage
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Prewarm failed.", prewarm: result });
  }
}
