// api/warm.js — prefetch fixtures/standings/teamstats/odds into KV for predict reuse
import {
  resolveEffectiveTierFromProfile,
  tierDailyActionLimit,
  USER_TIERS
} from "../server-utils/accessTier.js";
import { getWithCache } from "../server-utils/fetcher.js";
import { prefetchOddsByDate } from "../server-utils/oddsPrefetch.js";
import {
  commitWarmPredictIncrement,
  isWarmPredictQuotaExempt,
  resolveAuthenticatedUsageContext
} from "../server-utils/userDailyWarmPredictUsage.js";
import { isAuthorizedCronOrInternalRequest } from "../server-utils/cronRequestAuth.js";
import { getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import {
  inferSeason,
  resolveLeagueSeasonFromFixtures,
  fetchTeamStatisticsWithSeasonFallback,
  loadStandingsMap
} from "../server-utils/pipeline/predictHelpers.js";

export default async function handler(req, res) {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const leagueIdsStr = req.query.leagueIds || "";
  const leagueIds = leagueIdsStr.split(",").filter(Boolean).map(Number);
  const season = Number(req.query.season || inferSeason(date));

  if (leagueIds.length === 0) {
    return res.status(400).json({ ok: false, error: "Lipsesc leagueIds." });
  }

  let wantStandings = req.query.standings === "1";
  let wantTeamStats = req.query.teamstats === "1";
  let wantOdds = req.query.odds === "1";

  // P0: warm requires cron secret or authenticated user (no anonymous upstream spend).
  const isCron = isAuthorizedCronOrInternalRequest(req);

  // C10: hard stop — do not warm (upstream) when daily API budget is exhausted.
  try {
    const { evaluateApiBudget } = await import("../server-utils/apiBudgetCircuit.js");
    const budget = await evaluateApiBudget();
    if (budget.hardStop) {
      if (isCron) {
        // Cron/internal callers: report success-with-skip — this is an expected, recurring
        // condition near the daily quota, not a failure the scheduler should alert on.
        return res.status(200).json({
          ok: true,
          skipped: true,
          reason: "api_budget_hard_stop",
          usageBudget: budget,
          warmed: []
        });
      }
      // Interactive callers: surface a real error. getWithCache() (used by predict's own
      // pipeline stages) already treats this exact condition as ok:false — returning a fake
      // 200 success here let the UI show "Warm succeeded" while nothing was prefetched, so
      // the follow-up Predict call then hit a cold cache with no visible error either way.
      return res.status(503).json({
        ok: false,
        error: "Bugetul zilnic API-Football este epuizat. Încearcă din nou mai târziu.",
        reason: "api_budget_hard_stop",
        usageBudget: budget,
        warmed: []
      });
    }
    // Soft stop: skip expensive teamstats prefetch.
    if (budget.softStop) {
      wantTeamStats = false;
    }
  } catch {
    /* fail-open */
  }

  if (!isCron) {
    const usageCtx = await resolveAuthenticatedUsageContext(req);
    if (usageCtx.error) {
      return res.status(usageCtx.error.status).json(usageCtx.error.body);
    }
    if (usageCtx.anonymous) {
      return res.status(401).json({ ok: false, error: "Autentificare necesară pentru Warm." });
    }

    if (!(await isWarmPredictQuotaExempt(usageCtx.userId, usageCtx.userEmail))) {
      let effectiveTier;
      try {
        const sb = getSupabaseAdmin();
        const { data: profile } = await sb
          .from("profiles")
          .select("tier, subscription_expires_at, premium_trial_activated_at, ultra_trial_activated_at")
          .eq("user_id", usageCtx.userId)
          .maybeSingle();
        effectiveTier = resolveEffectiveTierFromProfile(profile || {}).effectiveTier;
      } catch {
        effectiveTier = USER_TIERS.FREE;
      }
      const actionMax = tierDailyActionLimit(effectiveTier);
      const actionInc = await commitWarmPredictIncrement(
        usageCtx.userId,
        usageCtx.usageDay,
        "warm",
        actionMax
      );
      if (!actionInc?.ok) {
        return res.status(429).json({
          ok: false,
          error: "Ai atins limita zilnică de Warm pentru abonamentul tău.",
          reason: actionInc?.reason || "warm_limit",
          warmCount: actionInc?.warm_count,
          predictCount: actionInc?.predict_count,
          actionLimit: actionMax
        });
      }
    }
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

  const leagueSeasonById = new Map();
  for (const leagueId of leagueIds) {
    const leagueFixtures = allFixtures.filter((f) => f.league?.id === leagueId);
    const leagueSeason = resolveLeagueSeasonFromFixtures(leagueFixtures, season);
    leagueSeasonById.set(leagueId, leagueSeason);
    const summary = { leagueId, season: leagueSeason, date, fixtures: leagueFixtures.length };

    if (wantStandings) {
      try {
        const st = await loadStandingsMap(leagueId, leagueSeason, 86400);
        summary.standings = st.fromCache ? "cached" : "fetched";
      } catch (err) {
        errors.push({ leagueId, where: "standings", error: err?.message || "standings_failed" });
      }
    }

    warmed.push(summary);
  }

  if (wantTeamStats) {
    const uniqTeams = prioritizedTeams.slice(0, TEAMSTATS_WARM_LIMIT);
    for (const { leagueId, teamId } of uniqTeams) {
      const leagueSeason = leagueSeasonById.get(leagueId) || season;
      const ts = await fetchTeamStatisticsWithSeasonFallback({
        leagueId,
        season: leagueSeason,
        teamId,
        ttlSeconds: 86400
      });
      if (!ts.ok) {
        errors.push({ leagueId, teamId, where: "teamstats", error: "no_usable_team_stats" });
      } else if (ts.fromCache) {
        teamStatsCached += 1;
      } else {
        teamStatsPrefetched += 1;
      }
    }
  }

  if (wantOdds) {
    oddsPrefetchSummary = await prefetchOddsByDate(date, {
      leagueSeasonById,
      maxPagesPerLeague: Math.max(1, Math.min(Number(process.env.ODDS_PREFETCH_MAX_PAGES_PER_LEAGUE || 3), 10)),
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
          upstreamCalls: oddsPrefetchSummary.upstreamCalls,
          leaguesQueried: oddsPrefetchSummary.leaguesQueried,
          leaguesFailed: oddsPrefetchSummary.leaguesFailed
        }
      : null,
    fixturesFromCache: Boolean(dayReq.fromCache),
    errors,
    note: "Datele au fost salvate în Vercel KV (Redis) pentru reutilizare de către /api/predict."
  });
}
