// api/warm.js
import { readBearer } from "../server-utils/authAdmin.js";
import { checkAnonymousRateLimit } from "../server-utils/anonymousRateLimit.js";
import { getWithCache } from '../server-utils/fetcher.js';
import {
  commitWarmPredictIncrement,
  isWarmPredictQuotaExempt,
  peekWarmPredictUsage,
  resolveAuthenticatedUsageContext
} from "../server-utils/userDailyWarmPredictUsage.js";

export default async function handler(req, res) {
  // Pe Vercel, query params sunt automat în req.query
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const leagueIdsStr = req.query.leagueIds || "";
  const leagueIds = leagueIdsStr.split(',').filter(Boolean).map(Number);
  const season = req.query.season || new Date().getFullYear();
  
  const wantStandings = req.query.standings === "1";
  const wantTeamStats = req.query.teamstats === "1";

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
  let enforceWarmPredictQuota = false;
  if (!usageCtx.anonymous && usageCtx.userId) {
    const exempt = await isWarmPredictQuotaExempt(usageCtx.userId, usageCtx.userEmail);
    enforceWarmPredictQuota = !exempt;
  }
  if (enforceWarmPredictQuota) {
    const peek = await peekWarmPredictUsage(usageCtx.userId, usageCtx.usageDay);
    if (peek.warm >= 3) {
      return res.status(429).json({
        ok: false,
        error: "Limita zilnica Warm atinsa (maximum 3/zi).",
        usage: { warm_count: peek.warm, predict_count: peek.predict, usage_day: usageCtx.usageDay }
      });
    }
  }

  const warmed = [];
  const errors = [];
  let teamStatsPrefetched = 0;

  // 1. Aducem meciurile zilei (cache 6 ore = 21600 sec)
  const dayReq = await getWithCache('/fixtures', { date }, 21600);
  if (!dayReq.ok) {
    const status = Number(dayReq?.status);
    return res.status(Number.isFinite(status) && status >= 400 ? status : 502).json({
      ok: false,
      error: typeof dayReq.error === "string" ? dayReq.error : "Serviciul upstream /fixtures nu este disponibil.",
      provider: dayReq?.provider || null
    });
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

  const payload = {
    ok: errors.length === 0,
    warmed,
    teamStatsPrefetched,
    errors,
    note: "Datele au fost salvate în Vercel KV (Redis)."
  };

  if (enforceWarmPredictQuota) {
    const inc = await commitWarmPredictIncrement(usageCtx.userId, usageCtx.usageDay, "warm");
    if (!inc?.ok) {
      return res.status(429).json({
        ok: false,
        error: "Limita zilnica Warm atinsa (maximum 3/zi).",
        usage: inc
      });
    }
    payload.usage = {
      warm_count: inc.warm_count,
      predict_count: inc.predict_count,
      usage_day: usageCtx.usageDay
    };
  }

  return res.status(200).json(payload);
}