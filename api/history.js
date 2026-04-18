import { getRequester } from "../server-utils/authAdmin.js";
import { calendarDateKeyEuropeBucharest } from "../server-utils/fixtureCalendarDateKey.js";
import { isAuthorizedCronOrInternalRequest } from "../server-utils/cronRequestAuth.js";
import { getWithCache } from "../server-utils/fetcher.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import { readPredictionsHistory, validationFromMatch } from "../server-utils/predictionsHistory.js";

const HISTORY_TABLE = "predictions_history";

async function isAuthorizedHistorySync(req) {
  if (isAuthorizedCronOrInternalRequest(req)) return true;
  const requester = await getRequester(req);
  return requester.ok;
}

async function handleHistoryRead(req, res) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const supabaseConfig = assertSupabaseConfigured();
  if (!supabaseConfig.ok) {
    return res.status(500).json({ ok: false, error: supabaseConfig.error });
  }

  const days = Number(req.query.days || 30);
  const limit = Number(req.query.limit || 500);

  try {
    const { items, stats } = await readPredictionsHistory(days, limit);
    return res.status(200).json({
      ok: true,
      days: Math.max(1, Math.min(days || 30, 120)),
      stats,
      items
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "History read failed." });
  }
}

async function handleHistorySync(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  if (!(await isAuthorizedHistorySync(req))) {
    return res.status(401).json({ ok: false, error: "Unauthorized sync request." });
  }

  const supabaseConfig = assertSupabaseConfigured();
  if (!supabaseConfig.ok) {
    return res.status(500).json({ ok: false, error: supabaseConfig.error });
  }

  const supabase = getSupabaseAdmin();
  const days = Math.max(1, Math.min(Number(req.query.days || 30), 120));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data: candidates, error: readError } = await supabase
      .from(HISTORY_TABLE)
      .select("fixture_id, league_id, kickoff_at, recommended_pick, match_status, score_home, score_away, validation")
      .gte("kickoff_at", cutoff)
      .or("validation.eq.pending,match_status.not.in.(FT,AET,PEN)")
      .limit(1000);

    if (readError) throw readError;
    if (!candidates || candidates.length === 0) {
      return res.status(200).json({ ok: true, scanned: 0, updated: 0, message: "No pending entries." });
    }

    const groupMap = new Map();
    for (const row of candidates) {
      const dateKey = calendarDateKeyEuropeBucharest(row.kickoff_at);
      const leagueId = Number(row.league_id);
      if (!dateKey || !Number.isFinite(leagueId)) continue;
      const key = `${dateKey}:${leagueId}`;
      if (!groupMap.has(key)) groupMap.set(key, { date: dateKey, leagueId, fixtureIds: new Set() });
      groupMap.get(key).fixtureIds.add(Number(row.fixture_id));
    }

    const fixtureById = new Map();
    for (const group of groupMap.values()) {
      const resp = await getWithCache("/fixtures", { date: group.date, league: group.leagueId }, 21600);
      if (!resp.ok) continue;
      const fixtures = resp.data?.response || [];
      for (const fx of fixtures) {
        const id = Number(fx?.fixture?.id);
        if (!Number.isFinite(id) || !group.fixtureIds.has(id)) continue;
        fixtureById.set(id, fx);
      }
    }

    const updates = [];
    for (const row of candidates) {
      const fixtureId = Number(row.fixture_id);
      const fx = fixtureById.get(fixtureId);
      if (!fx) continue;
      const matchStatus = fx?.fixture?.status?.short || row.match_status || "";
      const scoreHome = typeof fx?.goals?.home === "number" ? fx.goals.home : null;
      const scoreAway = typeof fx?.goals?.away === "number" ? fx.goals.away : null;
      const validation = validationFromMatch(matchStatus, row.recommended_pick, { home: scoreHome, away: scoreAway });

      const statusChanged = String(matchStatus || "") !== String(row.match_status || "");
      const scoreChanged = scoreHome !== row.score_home || scoreAway !== row.score_away;
      const validationChanged = String(validation) !== String(row.validation || "");

      if (!statusChanged && !scoreChanged && !validationChanged) continue;
      updates.push({
        fixture_id: fixtureId,
        match_status: matchStatus,
        score_home: scoreHome,
        score_away: scoreAway,
        validation,
        updated_at: new Date().toISOString()
      });
    }

    if (updates.length > 0) {
      const { error: updateError } = await supabase.from(HISTORY_TABLE).upsert(updates, { onConflict: "fixture_id" });
      if (updateError) throw updateError;
    }

    return res.status(200).json({
      ok: true,
      scanned: candidates.length,
      updated: updates.length
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "History sync failed." });
  }
}

/**
 * GET /api/history — read predictions_history (unchanged).
 * GET or POST /api/history?sync=1 — sync scores/validation (replaces former /api/history/sync).
 */
export default async function handler(req, res) {
  const syncOn = String(req.query.sync || "") === "1" || String(req.query.sync || "").toLowerCase() === "true";
  if (syncOn) {
    return handleHistorySync(req, res);
  }
  return handleHistoryRead(req, res);
}
