import { isAuthorizedCronOrInternalRequest } from "../../server-utils/cronRequestAuth.js";
import { todayCalendarEuropeBucharest } from "../../server-utils/fixtureCalendarDateKey.js";
import { TOP_LEAGUE_IDS } from "../../server-utils/modelConstants.js";

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
      historySync
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
