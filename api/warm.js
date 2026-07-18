// api/warm.js — prefetch fixtures/standings/teamstats/odds into KV for predict reuse
import { readBearer } from "../server-utils/authAdmin.js";
import { checkAnonymousRateLimit } from "../server-utils/anonymousRateLimit.js";
import { getWithCache } from "../server-utils/fetcher.js";
import { prefetchOddsByDate } from "../server-utils/oddsPrefetch.js";
import { resolveAuthenticatedUsageContext } from "../server-utils/userDailyWarmPredictUsage.js";

function inferSeason(dateISO) {
  const [y, m] = String(dateISO || "").split("-").map(Number);
  if (!y || !m) return new Date().getFullYear() - 1;
  return m >= 7 ? y : y - 1;
}

export default async function handler(req, res) {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const leagueIdsStr = req.query.leagueIds || "";
  const leagueIds = leagueIdsStr.split(",").filter(Boolean).map(Number);
  const season = Number(req.query.season || inferSeason(date));

  const wantStandings = req.query.standings === "1";
  const wantTeamStats = req.query.teamstats === "1";
  const wantOdds = req.query.odds === "1";

  if (leagueIds.length === 0) {
    return res.status(400).json({ ok: false, error: "Lipsesc leagueIds." });
  }

  if (!readBearer(req)) {
    const maxPerHour = Math.max(1, Math.min(Number(process.env.ANON_RATE_WARM_PER_HOUR || 24), 200));
    const rl = await checkAnonymousRateLimit(req, { namespace: "warm", maxPerHour });
    if (!rl.ok) {
      return res.status(429).json({
        ok: false,
        error: "Prea multe cereri anonime pentru Warm. Autentifica-te sau incearca mai tarziu.",
        retryAfterSec: rl.retryAfterSec
      });
    }
  }

  const usageCtx = await resolveAuthenticatedUsageContext(req);
  if (usageCtx.error) {
    return res.status(usageCtx.error.status).json(usageCtx.error.body);
  }

  const warmed = [];
  const errors = [];
  let teamStatsPrefetched = 0;
  let teamStatsCached = 0;
  let oddsPrefetchSummary = null;

  // Align with predict cap (15 fixtures × ~2 teams) instead of 10 teams/league.
  const TEAMSTATS_WARM_LIMIT = Math.max(
    10,
    Math.min(Number(process.env.TEAMSTATS_WARM_LIMIT || 30), 60)
  );
  const PREDICT_FIXTURE_CAP = 15;

  const dayReq = await getWithCache("/fixtures", { date }, 21600);
  if (!dayReq.ok) {
    const status = Number(dayReq?.status);
    return res.status(Number.isFinite(status) && status >= 400 ? status : 502).json({
      ok: false,
      error: typeof dayReq.error === "string" ? dayReq.error : "Serviciul upstream /fixtures nu este disponibil.",
      provider: dayReq?.provider || null
    });
  }

  const allFixtures = dayReq.data.response || [];

  // Fixture-aligned unique teams in the same order predict will walk leagues.
  const prioritizedTeams = [];
  const seenTeamKeys = new Set();
  let fixtureSlots = 0;
  for (const leagueId of leagueIds) {
    const leagueFixtures = allFixtures.filter((f) => f.league?.id === leagueId);
    for (const f of leagueFixtures) {
      if (fixtureSlots >= PREDICT_FIXTURE_CAP) break;
      fixtureSlots += 1;
      for (const side of ["home", "away"]) {
        const tid = f.teams?.[side]?.id;
        if (!tid) continue;
        const key = `${leagueId}:${tid}`;
        if (seenTeamKeys.has(key)) continue;
        seenTeamKeys.add(key);
        prioritizedTeams.push({ leagueId, teamId: tid });
      }
    }
    if (fixtureSlots >= PREDICT_FIXTURE_CAP) break;
  }

  for (const leagueId of leagueIds) {
    const leagueFixtures = allFixtures.filter((f) => f.league?.id === leagueId);
    const summary = { leagueId, season, date, fixtures: leagueFixtures.length };

    if (wantStandings) {
      const stReq = await getWithCache("/standings", { league: leagueId, season }, 86400);
      if (!stReq.ok) errors.push({ leagueId, where: "standings", error: stReq.error });
      else summary.standings = stReq.fromCache ? "cached" : "fetched";
    }

    warmed.push(summary);
  }

  if (wantTeamStats) {
    const uniqTeams = prioritizedTeams.slice(0, TEAMSTATS_WARM_LIMIT);
    for (const { leagueId, teamId } of uniqTeams) {
      const tsReq = await getWithCache("/teams/statistics", { league: leagueId, season, team: teamId }, 86400);
      if (!tsReq.ok) {
        errors.push({ leagueId, teamId, where: "teamstats", error: tsReq.error });
      } else if (tsReq.fromCache) {
        teamStatsCached += 1;
      } else {
        teamStatsPrefetched += 1;
      }
    }
  }

  if (wantOdds) {
    oddsPrefetchSummary = await prefetchOddsByDate(date, {
      leagueIds,
      maxPages: Math.max(2, Math.min(Number(process.env.ODDS_PREFETCH_MAX_PAGES || 6), 12)),
      ttlSeconds: 86400
    });
  }

  return res.status(200).json({
    ok: errors.length === 0,
    warmed,
    teamStatsPrefetched,
    teamStatsCached,
    teamStatsLimit: TEAMSTATS_WARM_LIMIT,
    teamsTargeted: wantTeamStats ? Math.min(prioritizedTeams.length, TEAMSTATS_WARM_LIMIT) : 0,
    oddsPrefetch: oddsPrefetchSummary
      ? {
          pagesFetched: oddsPrefetchSummary.pagesFetched,
          pagesFromCache: oddsPrefetchSummary.pagesFromCache,
          fixturesMapped: oddsPrefetchSummary.fixturesMapped,
          upstreamCalls: oddsPrefetchSummary.upstreamCalls
        }
      : null,
    fixturesFromCache: Boolean(dayReq.fromCache),
    errors,
    note: "Datele au fost salvate în Vercel KV (Redis) pentru reutilizare de către /api/predict."
  });
}
