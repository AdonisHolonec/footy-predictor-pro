// api/warm.js
import { getWithCache } from '../server-utils/fetcher.js';

export default async function handler(req, res) {
  // Pe Vercel, query params sunt automat în req.query
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const leagueIdsStr = req.query.leagueIds || "";
  const leagueIds = leagueIdsStr.split(',').filter(Boolean).map(Number);
  const season = req.query.season || new Date().getFullYear();
  
  const wantStandings = req.query.standings === "1";
  const wantTeamStats = req.query.teamstats === "1";

  if (leagueIds.length === 0) {
    return res.status(400).json({ ok: false, error: "Missing leagueIds" });
  }

  const warmed = [];
  const errors = [];
  let teamStatsPrefetched = 0;

  // 1. Aducem meciurile zilei (cache 6 ore = 21600 sec)
  const dayReq = await getWithCache('/fixtures', { date }, 21600);
  if (!dayReq.ok) {
    return res.status(500).json({ ok: false, error: dayReq.error });
  }

  const allFixtures = dayReq.data.response || [];

  // 2. Trecem prin fiecare ligă selectată
  for (const leagueId of leagueIds) {
    const leagueFixtures = allFixtures.filter(f => f.league?.id === leagueId);
    const summary = { leagueId, season, date, fixtures: leagueFixtures.length };

    // Standings (cache 24 ore = 86400 sec)
    if (wantStandings) {
      const stReq = await getWithCache('/standings', { league: leagueId, season }, 86400);
      if (!stReq.ok) errors.push({ leagueId, where: "standings", error: stReq.error });
      else summary.standings = stReq.fromCache ? "cached" : "fetched";
    }

    // Team Stats (limita la 10 echipe pentru a nu consuma planul RapidAPI brusc)
    if (wantTeamStats) {
      const teamIds = new Set();
      leagueFixtures.forEach(f => {
        if (f.teams?.home?.id) teamIds.add(f.teams.home.id);
        if (f.teams?.away?.id) teamIds.add(f.teams.away.id);
      });

      const uniqTeams = Array.from(teamIds).slice(0, 10); // TEAMSTATS_WARM_LIMIT

      for (const teamId of uniqTeams) {
        const tsReq = await getWithCache('/teams/statistics', { league: leagueId, season, team: teamId }, 86400);
        if (!tsReq.ok) {
          errors.push({ leagueId, teamId, where: "teamstats", error: tsReq.error });
        } else {
          if (!tsReq.fromCache) teamStatsPrefetched++;
        }
      }
    }

    warmed.push(summary);
  }

  return res.status(200).json({
    ok: errors.length === 0,
    warmed,
    teamStatsPrefetched,
    errors,
    note: "Datele au fost salvate în Vercel KV (Redis)."
  });
}