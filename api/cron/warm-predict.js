import { isAuthorizedCronOrInternalRequest } from "../../server-utils/cronRequestAuth.js";
import { todayCalendarEuropeBucharest } from "../../server-utils/fixtureCalendarDateKey.js";
import { parseCronLeagueIds } from "../../server-utils/cronLeagueIds.js";
import { getApiUsage, getWithCache } from "../../server-utils/fetcher.js";
import {
  extractFixtureMarketStats,
  aggregateRollingForTeam,
  loadTeamMarketRolling,
  persistTeamMarketRolling
} from "../../server-utils/teamMarketRolling.js";
import {
  buildSeasonTransitionWindow,
  DEFAULT_TRANSITION_TARGET
} from "../../server-utils/rolling/seasonTransitionWindow.js";

const MARKET_REFRESH_BUDGET_CALLS = Math.max(
  0,
  Math.min(Number(process.env.CRON_MARKET_REFRESH_BUDGET || 0), 60)
);
const MARKET_REFRESH_WINDOW_DAYS = Math.max(1, Math.min(Number(process.env.CRON_MARKET_REFRESH_WINDOW_DAYS || 3), 7));
const MARKET_REFRESH_ROLLING_WINDOW = 15;

/**
 * Season transition rolling. OFF by default — the mechanism ships inert and is switched on
 * only by an explicit deployment decision, so this change cannot move a single published
 * prediction on its own.
 */
const SEASON_TRANSITION_ENABLED = String(process.env.ROLLING_SEASON_TRANSITION || "").trim() === "1";
const SEASON_TRANSITION_TARGET = DEFAULT_TRANSITION_TARGET;

/** Match statuses that count as played, shared by both season paths. */
const ROLLING_FINAL_STATUSES = ["FT", "AET", "PEN"];

/**
 * Finished fixtures belonging to ONE competition.
 *
 * Both filters have to be applied together and in one place. A team-scoped provider query
 * returns every competition the team appears in, so without the league check a domestic
 * rolling average quietly absorbs cup ties and European fixtures — matches played against
 * different opposition strength, often with rotated sides. For a promoted team the previous
 * season is an entirely different division.
 *
 * `leagueId` is compared numerically because the provider and the caller disagree about
 * string vs number often enough for `===` on raw values to silently drop everything.
 *
 * @param {Array<object>|null|undefined} fixtures provider-shaped fixtures
 * @param {number|string} leagueId
 * @returns {Array<object>}
 */
export function selectLeagueRollingFixtures(fixtures, leagueId) {
  const target = Number(leagueId);
  if (!Number.isFinite(target)) return [];
  return (Array.isArray(fixtures) ? fixtures : []).filter(
    (fx) =>
      ROLLING_FINAL_STATUSES.includes(fx?.fixture?.status?.short || "") &&
      Number(fx?.league?.id) === target
  );
}

/**
 * Collect one team's rolling inputs — ALL OR NOTHING.
 *
 * The API budget is spent per uncached /fixtures/statistics call, so it can run out partway
 * through a team's window. Before this guard, the loop simply `break`ed and the caller went
 * on to aggregate and persist whatever had been gathered — a team's 15-match rolling row
 * could be overwritten by an average of 2 matches. That row then falls below
 * MIN_MARKET_SAMPLES and demotes the team from "real signal" to "league fallback", and it
 * does so silently. Production already carries this damage: Champions League rows with
 * matches_sampled of 1-2 and three teams recorded at corners_for_avg = 0.00.
 *
 * So an incomplete collection returns NO matches at all. A partial aggregate is not
 * something the caller has to remember to reject — there is nothing to aggregate. The team
 * keeps its previous snapshot and gets a full pass on the next run: better stale than
 * corrupt.
 *
 * The budget check sits at the TOP of each iteration, so a budget that reaches zero exactly
 * as the last fixture is consumed still leaves the team complete — the loop ends because
 * there is nothing left to fetch, not because it ran out.
 *
 * @param {object} p
 * @param {number} p.teamId
 * @param {Array<object>} p.teamFixtures finished fixtures, provider shape
 * @param {number} p.budget remaining uncached-call allowance
 * @param {(fixtureId: number) => Promise<{ok: boolean, data?: object, fromCache?: boolean}>} p.fetchStats
 * @returns {Promise<{matches: Array<object>, budget: number, complete: boolean,
 *   requested: number, processed: number, reason: string|null}>}
 */
export async function collectTeamRollingMatches({ teamId, teamFixtures, budget, fetchStats }) {
  const fixtures = Array.isArray(teamFixtures) ? teamFixtures : [];
  const matches = [];
  let remaining = Number(budget) || 0;
  let processed = 0;

  for (const fx of fixtures) {
    if (remaining <= 0) {
      return {
        matches: [],
        budget: remaining,
        complete: false,
        requested: fixtures.length,
        processed,
        reason: "budget_exhausted_mid_team"
      };
    }
    const fixtureId = Number(fx?.fixture?.id);
    if (!fixtureId) continue;

    const statReq = await fetchStats(fixtureId);
    if (!statReq?.fromCache) remaining -= 1;
    processed += 1;
    if (!statReq?.ok) continue;

    const stats = extractFixtureMarketStats(statReq.data);
    const mapByTeam = new Map();
    for (const s of stats) if (s.teamId) mapByTeam.set(s.teamId, s);
    const teamStats = mapByTeam.get(teamId);
    const isHome = Number(fx?.teams?.home?.id) === teamId;
    const opponentId = isHome ? Number(fx?.teams?.away?.id) : Number(fx?.teams?.home?.id);
    const oppStats = mapByTeam.get(opponentId);
    if (!teamStats || !oppStats) continue;

    matches.push({
      fixtureId,
      date: fx?.fixture?.date,
      isHome,
      teamStats,
      opponentStats: oppStats
    });
  }

  return {
    matches,
    budget: remaining,
    complete: true,
    requested: fixtures.length,
    processed,
    reason: null
  };
}
const MARKET_REFRESH_STALE_HOURS = 36;

/**
 * Actualizează rolling stats pentru echipele care au jucat în ultimele MARKET_REFRESH_WINDOW_DAYS
 * şi ale căror înregistrări sunt mai vechi de MARKET_REFRESH_STALE_HOURS (sau lipsesc).
 *
 * Respectă un budget strict de MARKET_REFRESH_BUDGET_CALLS apeluri /fixtures/statistics per rulare.
 * Dacă sunt mai multe meciuri de procesat, restul rămân pentru rularea următoare.
 */
async function refreshMarketRolling({ leagueIds, season }) {
  if (MARKET_REFRESH_BUDGET_CALLS === 0) {
    return { skipped: true, reason: "budget_disabled" };
  }

  const cutoff = new Date(Date.now() - MARKET_REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const staleThresholdMs = MARKET_REFRESH_STALE_HOURS * 60 * 60 * 1000;
  const now = Date.now();
  let budget = MARKET_REFRESH_BUDGET_CALLS;
  const summary = {
    budget: MARKET_REFRESH_BUDGET_CALLS,
    leaguesProcessed: 0,
    fixturesFetched: 0,
    teamsUpdated: 0,
    teamsSkippedBudget: 0,
    skipped: [],
    seasonTransition: [],
    errors: []
  };

  for (const leagueId of leagueIds) {
    if (budget <= 0) break;

    // fixture-urile din fereastra vizată, terminate, per ligă
    const daysBack = Math.max(1, MARKET_REFRESH_WINDOW_DAYS);
    const allFixtureRows = [];
    for (let i = 0; i < daysBack; i++) {
      const d = new Date(cutoff.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const req = await getWithCache("/fixtures", { league: leagueId, season, date: d }, 6 * 60 * 60);
      if (!req.ok) continue;
      const rows = req.data?.response || [];
      for (const fx of rows) {
        const status = fx?.fixture?.status?.short || "";
        if (["FT", "AET", "PEN"].includes(status)) allFixtureRows.push(fx);
      }
    }
    if (allFixtureRows.length === 0) continue;

    // verificăm ce team-uri au rolling stale sau lipsă
    const rollingMap = await loadTeamMarketRolling(leagueId, season);
    const teamsInvolved = new Set();
    for (const fx of allFixtureRows) {
      if (fx?.teams?.home?.id) teamsInvolved.add(Number(fx.teams.home.id));
      if (fx?.teams?.away?.id) teamsInvolved.add(Number(fx.teams.away.id));
    }
    const teamsToUpdate = new Set();
    for (const tid of teamsInvolved) {
      const existing = rollingMap.get(tid);
      if (!existing) {
        teamsToUpdate.add(tid);
        continue;
      }
      const age = existing.updated_at ? now - new Date(existing.updated_at).getTime() : Infinity;
      if (age > staleThresholdMs) teamsToUpdate.add(tid);
    }
    if (teamsToUpdate.size === 0) continue;

    // pentru fiecare echipă stale, fetch ultimele MARKET_REFRESH_ROLLING_WINDOW meciuri
    const updatedRows = [];
    for (const teamId of teamsToUpdate) {
      if (budget <= 0) break;
      // iau istoricul recent al echipei (terminat) via /fixtures?team=X&season=Y&last=N
      const histReq = await getWithCache(
        "/fixtures",
        { team: teamId, season, last: MARKET_REFRESH_ROLLING_WINDOW },
        6 * 60 * 60
      );
      if (!histReq.ok) {
        summary.errors.push({ where: "fixtures_by_team", teamId, error: histReq.error });
        continue;
      }
      // TEAM FIXTURE HISTORY — competition-agnostic, exactly as the provider returns it.
      // /fixtures?team=X&season=Y is scoped to a team, not a competition, so this list also
      // holds domestic cup ties and continental nights.
      const teamFixtureHistory = histReq.data?.response || [];

      // LEAGUE-SCOPED TEAM ROLLING HISTORY — the only list allowed to reach rolling.
      // A `team_market_rolling` row answers "how does this team behave in THIS competition";
      // a Champions League night or a cup tie against lower-division opposition answers a
      // different question and was silently being averaged in. This is the single
      // consumer of the list, so narrowing it here cannot affect anything else.
      const currentInLeague = selectLeagueRollingFixtures(teamFixtureHistory, leagueId);

      // Season transition window. INACTIVE unless ROLLING_SEASON_TRANSITION=1. League
      // scoping applies either way — it is a correctness rule, not part of the flag.
      let windowResult = {
        matches: currentInLeague,
        fromCurrent: currentInLeague.length,
        fromPrevious: 0,
        source: "current_only"
      };

      if (SEASON_TRANSITION_ENABLED) {
        let previousInLeague = [];
        if (currentInLeague.length < SEASON_TRANSITION_TARGET) {
          const prevReq = await getWithCache(
            "/fixtures",
            { team: teamId, season: Number(season) - 1, last: MARKET_REFRESH_ROLLING_WINDOW },
            6 * 60 * 60
          );
          if (prevReq.ok) {
            // Same rule for the previous season. For a promoted side this is what keeps
            // second-division form out of a top-flight rolling average.
            previousInLeague = selectLeagueRollingFixtures(prevReq.data?.response, leagueId);
          }
        }
        windowResult = buildSeasonTransitionWindow(currentInLeague, previousInLeague, {
          target: SEASON_TRANSITION_TARGET
        });
        summary.seasonTransition.push({
          team_id: teamId,
          league_id: Number(leagueId),
          season: Number(season),
          from_current: windowResult.fromCurrent,
          from_previous: windowResult.fromPrevious,
          source: windowResult.source
        });
      }

      const teamFixtures = windowResult.matches;
      if (teamFixtures.length === 0) continue;

      const collected = await collectTeamRollingMatches({
        teamId,
        teamFixtures,
        budget,
        fetchStats: (fixtureId) =>
          getWithCache("/fixtures/statistics", { fixture: fixtureId }, 30 * 24 * 60 * 60)
      });
      budget = collected.budget;
      summary.fixturesFetched += collected.processed;

      if (!collected.complete) {
        // Better stale than corrupt: this team keeps whatever snapshot it already had.
        summary.teamsSkippedBudget += 1;
        const skip = {
          rolling_refresh_skip_reason: collected.reason,
          team_id: teamId,
          league_id: Number(leagueId),
          season: Number(season),
          requested_fixture_count: collected.requested,
          processed_fixture_count: collected.processed,
          remaining_budget: budget
        };
        summary.skipped.push(skip);
        console.warn("[rolling-refresh]", JSON.stringify(skip));
        continue;
      }

      if (collected.matches.length === 0) continue;
      const agg = aggregateRollingForTeam(collected.matches);
      if (agg.matches_sampled === 0) continue;
      updatedRows.push({
        team_id: teamId,
        league_id: Number(leagueId),
        season: Number(season),
        ...agg
      });
    }

    if (updatedRows.length > 0) {
      const persistResult = await persistTeamMarketRolling(updatedRows);
      if (!persistResult.ok) {
        summary.errors.push({ where: "persist", leagueId, error: persistResult.error });
      } else {
        summary.teamsUpdated += persistResult.count;
      }
    }
    summary.leaguesProcessed += 1;
  }

  summary.budgetRemaining = budget;
  return summary;
}

function inferSeason(dateISO) {
  const [y, m] = String(dateISO || "").split("-").map(Number);
  if (!y || !m) return new Date().getFullYear() - 1;
  return m >= 7 ? y : y - 1;
}

function resolvePublicBaseUrl() {
  const explicit = String(process.env.CRON_WARM_PREDICT_BASE_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const v = String(process.env.VERCEL_URL || "").trim();
  if (v) return `https://${v}`;
  const port = process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

async function readJsonBody(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _parseError: true, snippet: text.slice(0, 800) };
  }
}

function summarizePredictBody(body) {
  if (Array.isArray(body)) {
    return { type: "predictions", count: body.length };
  }
  if (body && typeof body === "object") return { type: "object", keys: Object.keys(body).slice(0, 12) };
  return { type: typeof body };
}

/**
 * Vercel Cron: authorize with CRON_SECRET, then call /api/warm and /api/predict on this deployment
 * with CRON_SECRET forwarded (cron path — no per-user daily quota).
 * After a successful predict, POST /api/history?sync=1 with the same CRON_SECRET to refresh scores / validation.
 */
export default async function handler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }

  if (!isAuthorizedCronOrInternalRequest(req)) {
    return res.status(401).json({ ok: false, error: "Cerere cron neautorizată." });
  }

  const dateRaw = String(req.query.date || process.env.CRON_WARM_PREDICT_DATE || todayCalendarEuropeBucharest()).slice(
    0,
    10
  );
  // Processing ORDER, not the supported set — see cronLeagueIds.js. Unset or malformed
  // falls back to the canonical list in full, so the cron can never be narrowed by a typo.
  const leagueIds = parseCronLeagueIds(
    process.env.CRON_WARM_PREDICT_LEAGUE_IDS || process.env.PREWARM_LEAGUE_IDS
  );
  const season = Number(req.query.season || process.env.PREWARM_SEASON || inferSeason(dateRaw));
  const syncDays = Math.max(1, Math.min(Number(req.query.syncDays || process.env.CRON_HISTORY_SYNC_DAYS || 45), 120));
  const base = resolvePublicBaseUrl();
  const startedAt = new Date().toISOString();
  // C10: shared soft/hard circuit (defaults 80% / 95%, reserve 80). Legacy CRON_* envs still override soft/hard %.
  const { classifyApiBudget, getBudgetThresholds } = await import("../../server-utils/apiBudgetCircuit.js");
  const defaults = getBudgetThresholds();
  const softPct = Math.max(
    1,
    Math.min(Number(req.query.usageBudgetThresholdPct || process.env.CRON_USAGE_BUDGET_THRESHOLD_PCT || defaults.softPct), 99)
  );
  const hardPct = Math.max(
    softPct,
    Math.min(Number(req.query.usageHardStopPct || process.env.CRON_USAGE_HARD_STOP_PCT || defaults.hardPct), 100)
  );
  const reserveCalls = Math.max(
    0,
    Number(req.query.reserveCalls || process.env.CRON_USAGE_RESERVE_CALLS || process.env.API_BUDGET_RESERVE_CALLS || defaults.reserveCalls)
  );
  const usageSnapshot = await getApiUsage();
  const budget = classifyApiBudget(usageSnapshot, { softPct, hardPct, reserveCalls });
  const usageLimit = budget.limit;
  const usageCount = budget.count;
  const usagePct = budget.pct;
  const usageRemaining = budget.remaining;
  const budgetMode = budget.softStop;
  const hardStopMode = budget.hardStop;
  const usageBudgetThresholdPct = softPct;
  const usageHardStopPct = hardPct;

  const warmQs = new URLSearchParams({
    date: dateRaw,
    leagueIds: leagueIds.join(","),
    season: String(season),
    standings: "1",
    // Prefetch odds by date so predict hits KV instead of 15× /odds?fixture=.
    odds: hardStopMode ? "0" : "1",
    // Budget mode reduces expensive teamstats prefetch while keeping odds+standings warm.
    teamstats: hardStopMode ? "0" : budgetMode ? "0" : "1"
  });

  try {
    if (hardStopMode) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: "daily_api_budget_hard_stop",
        date: dateRaw,
        season,
        leagueIds,
        usageBudget: {
          count: usageCount,
          limit: usageLimit,
          pct: Number(usagePct.toFixed(1)),
        remaining: usageRemaining,
          thresholdPct: usageBudgetThresholdPct,
          hardStopPct: usageHardStopPct,
        reserveCalls,
          budgetMode,
          hardStopMode
        }
      });
    }

    const cronSecret = String(process.env.CRON_SECRET || "");
    const cronHeaders = {
      Accept: "application/json",
      "x-internal-cron": "warm-predict"
    };
    if (cronSecret) {
      cronHeaders.Authorization = `Bearer ${cronSecret}`;
      cronHeaders["x-cron-secret"] = cronSecret;
    }

    const warmRes = await fetch(`${base}/api/warm?${warmQs.toString()}`, {
      method: "GET",
      headers: cronHeaders
    });
    const warmBody = await readJsonBody(warmRes);

    if (!warmRes.ok) {
      return res.status(502).json({
        ok: false,
        step: "warm",
        status: warmRes.status,
        date: dateRaw,
        season,
        leagueIds,
        base,
        warm: warmBody,
        startedAt
      });
    }

    const predictQs = new URLSearchParams({
      date: dateRaw,
      leagueIds: leagueIds.join(","),
      season: String(season),
      limit: hardStopMode ? "10" : budgetMode ? "15" : "30"
    });

    const predictRes = await fetch(`${base}/api/predict?${predictQs.toString()}`, {
      method: "GET",
      headers: cronHeaders
    });
    const predictBody = await readJsonBody(predictRes);

    // Cost mode: history sync runs on its dedicated cron schedule,
    // not inline after every warm-predict run.
    const historySync = {
      skipped: true,
      reason: "handled_by_dedicated_history_cron",
      plannedSyncDays: syncDays
    };

    // refresh incremental rolling stats (buget strict de apeluri noi la /fixtures/statistics)
    let marketRefresh = null;
    try {
      marketRefresh = await refreshMarketRolling({ leagueIds, season });
    } catch (err) {
      marketRefresh = { error: err?.message || "market_refresh_failed" };
    }

    const pipelineOk = predictRes.ok;
    return res.status(pipelineOk ? 200 : 502).json({
      ok: pipelineOk,
      step: !predictRes.ok ? "predict" : "done",
      date: dateRaw,
      season,
      leagueIds,
      syncDays,
      usageBudget: {
        count: usageCount,
        limit: usageLimit,
        pct: Number(usagePct.toFixed(1)),
        remaining: usageRemaining,
        thresholdPct: usageBudgetThresholdPct,
        hardStopPct: usageHardStopPct,
        reserveCalls,
        budgetMode,
        hardStopMode
      },
      base,
      startedAt,
      finishedAt: new Date().toISOString(),
      warm: {
        httpStatus: warmRes.status,
        ok: warmBody?.ok,
        warmedCount: Array.isArray(warmBody?.warmed) ? warmBody.warmed.length : null,
        errorsCount: Array.isArray(warmBody?.errors) ? warmBody.errors.length : null
      },
      predict: {
        httpStatus: predictRes.status,
        summary: summarizePredictBody(predictBody),
        error: predictBody?.error || null
      },
      historySync,
      marketRefresh
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Cron warm-predict a eșuat.",
      date: dateRaw,
      season,
      leagueIds,
      base,
      startedAt
    });
  }
}
