import { isAuthorizedCronOrInternalRequest } from "../../server-utils/cronRequestAuth.js";
import { todayCalendarEuropeBucharest } from "../../server-utils/fixtureCalendarDateKey.js";
import { TOP_LEAGUE_IDS } from "../../server-utils/modelConstants.js";
import { getWithCache } from "../../server-utils/fetcher.js";
import {
  extractFixtureMarketStats,
  aggregateRollingForTeam,
  loadTeamMarketRolling,
  persistTeamMarketRolling
} from "../../server-utils/teamMarketRolling.js";

const MARKET_REFRESH_BUDGET_CALLS = Math.max(
  0,
  Math.min(Number(process.env.CRON_MARKET_REFRESH_BUDGET || 20), 60)
);
const MARKET_REFRESH_WINDOW_DAYS = Math.max(1, Math.min(Number(process.env.CRON_MARKET_REFRESH_WINDOW_DAYS || 3), 7));
const MARKET_REFRESH_ROLLING_WINDOW = 15;
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
      const teamFixtures = (histReq.data?.response || []).filter((fx) =>
        ["FT", "AET", "PEN"].includes(fx?.fixture?.status?.short || "")
      );
      if (teamFixtures.length === 0) continue;

      // fetch statistics pentru fiecare fixture (cache agresiv TTL 30 zile — imuabile)
      const enriched = [];
      for (const fx of teamFixtures) {
        if (budget <= 0) break;
        const fixtureId = Number(fx?.fixture?.id);
        if (!fixtureId) continue;
        const statReq = await getWithCache(
          "/fixtures/statistics",
          { fixture: fixtureId },
          30 * 24 * 60 * 60
        );
        if (!statReq.fromCache) budget -= 1;
        summary.fixturesFetched += 1;
        if (!statReq.ok) continue;
        const stats = extractFixtureMarketStats(statReq.data);
        const mapByTeam = new Map();
        for (const s of stats) if (s.teamId) mapByTeam.set(s.teamId, s);
        const teamStats = mapByTeam.get(teamId);
        const isHome = Number(fx?.teams?.home?.id) === teamId;
        const opponentId = isHome ? Number(fx?.teams?.away?.id) : Number(fx?.teams?.home?.id);
        const oppStats = mapByTeam.get(opponentId);
        if (!teamStats || !oppStats) continue;
        enriched.push({
          fixtureId,
          date: fx?.fixture?.date,
          isHome,
          teamStats,
          opponentStats: oppStats
        });
      }
      if (enriched.length === 0) continue;
      const agg = aggregateRollingForTeam(enriched);
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

function parseLeagueIds(raw) {
  const src = String(raw || "")
    .split(",")
    .map((v) => Number(String(v).trim()))
    .filter((v) => Number.isFinite(v));
  return src.length ? Array.from(new Set(src)) : TOP_LEAGUE_IDS.slice();
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
 * without a user JWT (anonymous path — no per-user daily quota).
 * After a successful predict, POST /api/history?sync=1 with the same CRON_SECRET to refresh scores / validation.
 */
export default async function handler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  if (!isAuthorizedCronOrInternalRequest(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized cron request." });
  }

  const dateRaw = String(req.query.date || process.env.CRON_WARM_PREDICT_DATE || todayCalendarEuropeBucharest()).slice(
    0,
    10
  );
  const leagueIds = parseLeagueIds(process.env.CRON_WARM_PREDICT_LEAGUE_IDS || process.env.PREWARM_LEAGUE_IDS);
  const season = Number(req.query.season || process.env.PREWARM_SEASON || inferSeason(dateRaw));
  const syncDays = Math.max(1, Math.min(Number(req.query.syncDays || process.env.CRON_HISTORY_SYNC_DAYS || 30), 120));
  const cronSecret = String(process.env.CRON_SECRET || "");

  const base = resolvePublicBaseUrl();
  const startedAt = new Date().toISOString();

  const warmQs = new URLSearchParams({
    date: dateRaw,
    leagueIds: leagueIds.join(","),
    season: String(season),
    standings: "1",
    teamstats: "1"
  });

  try {
    const warmRes = await fetch(`${base}/api/warm?${warmQs.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json", "x-internal-cron": "warm-predict" }
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
      limit: "50"
    });

    const predictRes = await fetch(`${base}/api/predict?${predictQs.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json", "x-internal-cron": "warm-predict" }
    });
    const predictBody = await readJsonBody(predictRes);

    let historySync = null;
    if (predictRes.ok) {
      const syncHeaders = {
        Accept: "application/json",
        "x-internal-cron": "warm-predict"
      };
      if (cronSecret) syncHeaders.Authorization = `Bearer ${cronSecret}`;
      const syncRes = await fetch(`${base}/api/history?sync=1&days=${syncDays}`, {
        method: "POST",
        headers: syncHeaders
      });
      const syncBody = await readJsonBody(syncRes);
      historySync = {
        httpStatus: syncRes.status,
        ok: syncRes.ok && syncBody?.ok !== false,
        scanned: syncBody?.scanned,
        updated: syncBody?.updated,
        message: syncBody?.message,
        error: syncBody?.error || (!cronSecret ? "CRON_SECRET unset; history sync likely rejected in production." : null)
      };
    }

    // refresh incremental rolling stats (buget strict de apeluri noi la /fixtures/statistics)
    let marketRefresh = null;
    try {
      marketRefresh = await refreshMarketRolling({ leagueIds, season });
    } catch (err) {
      marketRefresh = { error: err?.message || "market_refresh_failed" };
    }

    const pipelineOk = predictRes.ok && (historySync === null || historySync.ok);
    return res.status(pipelineOk ? 200 : 502).json({
      ok: pipelineOk,
      step: !predictRes.ok ? "predict" : historySync && !historySync.ok ? "history-sync" : "done",
      date: dateRaw,
      season,
      leagueIds,
      syncDays,
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
      error: error?.message || "Cron warm-predict failed.",
      date: dateRaw,
      season,
      leagueIds,
      base,
      startedAt
    });
  }
}
