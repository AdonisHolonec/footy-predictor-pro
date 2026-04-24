import { assertAdmin, getRequester, readBearer } from "../server-utils/authAdmin.js";
import { calendarDateKeyEuropeBucharest } from "../server-utils/fixtureCalendarDateKey.js";
import { isAuthorizedCronOrInternalRequest } from "../server-utils/cronRequestAuth.js";
import { getWithCache } from "../server-utils/fetcher.js";
import { mapUserIdsToEmails } from "../server-utils/adminUserEmails.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import {
  readPredictionsHistory,
  readPredictionsHistoryAggregateStats,
  readPredictionsHistoryForUser,
  validationFromMatch
} from "../server-utils/predictionsHistory.js";

const HISTORY_TABLE = "predictions_history";

async function isAuthorizedHistorySync(req) {
  if (isAuthorizedCronOrInternalRequest(req)) return true;
  const requester = await getRequester(req);
  return requester.ok;
}

function resolveHistorySyncSource(req) {
  if (isAuthorizedCronOrInternalRequest(req)) {
    const ua = String(req.headers["user-agent"] || "").toLowerCase();
    return ua.includes("vercel-cron") ? "vercel_cron" : "cron_secret";
  }
  return "jwt_user";
}

/** Ultimul sync scris în `history_sync_status` (id=1) — vizibil în Supabase fără Vercel Logs. */
async function persistHistorySyncStatus(supabase, req, payload) {
  try {
    const source = resolveHistorySyncSource(req);
    const method = String(req.method || "GET").toUpperCase();
    const nowIso = new Date().toISOString();
    const scanned = Math.max(0, Number(payload.scanned) || 0);
    const updated = Math.max(0, Number(payload.updated) || 0);
    const estimatedCalls = Math.max(0, Number(payload.estimatedCalls) || 0);
    const ok = payload.ok !== false;
    const errorText = payload.error != null ? String(payload.error).slice(0, 2000) : null;

    // Try schema with estimated call telemetry first; fallback if migration not applied yet.
    let { error } = await supabase.from("history_sync_status").upsert(
      {
        id: 1,
        last_ran_at: nowIso,
        last_source: source,
        last_method: method,
        last_scanned: scanned,
        last_updated: updated,
        last_estimated_calls: estimatedCalls,
        last_ok: ok,
        last_error: errorText
      },
      { onConflict: "id" }
    );
    if (error) {
      const retry = await supabase.from("history_sync_status").upsert(
        {
          id: 1,
          last_ran_at: nowIso,
          last_source: source,
          last_method: method,
          last_scanned: scanned,
          last_updated: updated,
          last_ok: ok,
          last_error: errorText
        },
        { onConflict: "id" }
      );
      error = retry.error;
    }
    if (error) throw error;

    let { error: logError } = await supabase.from("history_sync_log").insert({
      ran_at: nowIso,
      source,
      method,
      ok,
      scanned,
      updated,
      estimated_calls: estimatedCalls,
      error: errorText
    });
    if (logError) {
      const retry = await supabase.from("history_sync_log").insert({
        ran_at: nowIso,
        source,
        method,
        ok,
        scanned,
        updated,
        error: errorText
      });
      logError = retry.error;
    }
    if (logError) throw logError;
  } catch (e) {
    console.error("[history_sync_status]", e?.message || e);
  }
}

function buildPerformancePayload(rows, requesterUserId, isAdmin) {
  const scoped = isAdmin ? rows || [] : (rows || []).filter((r) => String(r.user_id) === String(requesterUserId));
  const byUserLeague = scoped.map((r) => {
    const wins = Number(r.wins) || 0;
    const losses = Number(r.losses) || 0;
    const pending = Number(r.pending) || 0;
    const settled = Number(r.settled) || 0;
    return {
      userId: r.user_id,
      leagueId: Number(r.league_id) || 0,
      leagueName: r.league_name || "",
      wins,
      losses,
      pending,
      settled,
      winRate: settled > 0 ? (wins / settled) * 100 : 0
    };
  });
  const byUserMap = new Map();
  for (const r of byUserLeague) {
    if (!byUserMap.has(r.userId)) {
      byUserMap.set(r.userId, { userId: r.userId, wins: 0, losses: 0, pending: 0, settled: 0 });
    }
    const u = byUserMap.get(r.userId);
    u.wins += r.wins;
    u.losses += r.losses;
    u.pending += r.pending;
    u.settled += r.settled;
  }
  const byUser = Array.from(byUserMap.values()).map((u) => ({
    ...u,
    winRate: u.settled > 0 ? (u.wins / u.settled) * 100 : 0
  }));
  byUser.sort((a, b) => b.settled - a.settled);
  byUserLeague.sort((a, b) => {
    const c = String(a.userId).localeCompare(String(b.userId));
    if (c !== 0) return c;
    return b.settled - a.settled;
  });
  return { byUser, byUserLeague };
}

function setNoStoreHeaders(res) {
  res.setHeader("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("CDN-Cache-Control", "no-store");
}

async function handlePerformanceRead(req, res) {
  setNoStoreHeaders(res);
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }
  const requester = await getRequester(req);
  if (!requester.ok) {
    return res.status(requester.status || 401).json({ ok: false, error: requester.error || "Neautorizat." });
  }
  const supabaseConfig = assertSupabaseConfigured();
  if (!supabaseConfig.ok) {
    return res.status(500).json({ ok: false, error: supabaseConfig.error });
  }
  const days = Math.max(1, Math.min(Number(req.query.days || 30), 120));
  const supabase = getSupabaseAdmin();
  try {
    const { data, error } = await supabase.rpc("performance_counter_by_user_league", { p_days: days });
    if (error) throw error;
    const adminCheck = await assertAdmin(req);
    const isAdmin = adminCheck.ok;
    const { byUser, byUserLeague } = buildPerformancePayload(data || [], requester.user.id, isAdmin);
    const requesterEmail = typeof requester.user?.email === "string" ? requester.user.email.trim() : "";
    let emailByUserId = new Map();
    if (isAdmin) {
      const ids = [...new Set([...byUser.map((u) => u.userId), ...byUserLeague.map((r) => r.userId)])];
      emailByUserId = await mapUserIdsToEmails(supabase, ids);
    }
    const withEmail = (row) => ({
      ...row,
      email: isAdmin ? emailByUserId.get(row.userId) || null : requesterEmail || null
    });
    return res.status(200).json({
      ok: true,
      days,
      isAdmin,
      byUser: byUser.map(withEmail),
      byUserLeague: byUserLeague.map(withEmail)
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Defalcarea performanței a eșuat." });
  }
}

async function handleHistoryRead(req, res) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }

  const supabaseConfig = assertSupabaseConfigured();
  if (!supabaseConfig.ok) {
    return res.status(500).json({ ok: false, error: supabaseConfig.error });
  }

  const days = Number(req.query.days || 30);
  const limit = Number(req.query.limit || 500);
  const mine =
    String(req.query.mine || "") === "1" ||
    String(req.query.mine || "").toLowerCase() === "true";

  if (mine) {
    const requester = await getRequester(req);
    if (!requester.ok) {
      return res.status(requester.status || 401).json({ ok: false, error: requester.error || "Neautorizat." });
    }
    try {
      const { items, stats } = await readPredictionsHistoryForUser(requester.user.id, days, limit);
      return res.status(200).json({
        ok: true,
        mine: true,
        days: Math.max(1, Math.min(days || 30, 120)),
        stats,
        items
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "Citirea istoricului a eșuat." });
    }
  }

  const safeDays = Math.max(1, Math.min(days || 30, 120));
  const safeLimit = Math.max(1, Math.min(limit || 500, 2000));

  if (readBearer(req)) {
    const adminCheck = await assertAdmin(req);
    if (adminCheck.ok) {
      try {
        const { items, stats } = await readPredictionsHistory(days, limit);
        return res.status(200).json({
          ok: true,
          days: safeDays,
          stats,
          items,
          scope: "global_admin"
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error?.message || "Citirea istoricului a eșuat." });
      }
    }
  }

  try {
    const { stats } = await readPredictionsHistoryAggregateStats(safeDays, safeLimit);
    return res.status(200).json({
      ok: true,
      days: safeDays,
      stats,
      items: [],
      scope: "aggregate_public"
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Citirea istoricului a eșuat." });
  }
}

async function handleHistorySync(req, res) {
  setNoStoreHeaders(res);
  if (req.method && req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }

  if (!(await isAuthorizedHistorySync(req))) {
    return res.status(401).json({ ok: false, error: "Cerere de sincronizare neautorizată." });
  }

  const supabaseConfig = assertSupabaseConfigured();
  if (!supabaseConfig.ok) {
    return res.status(500).json({ ok: false, error: supabaseConfig.error });
  }

  const supabase = getSupabaseAdmin();
  const days = Math.max(1, Math.min(Number(req.query.days || 30), 120));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const scanChunkSize = Math.max(200, Math.min(Number(process.env.HISTORY_SYNC_SCAN_CHUNK || 1000), 2000));
  const scanMaxRows = Math.max(scanChunkSize, Math.min(Number(process.env.HISTORY_SYNC_SCAN_MAX_ROWS || 10000), 50000));

  try {
    const candidates = [];
    for (let offset = 0; offset < scanMaxRows; offset += scanChunkSize) {
      const { data: page, error: readError } = await supabase
        .from(HISTORY_TABLE)
        .select("fixture_id, league_id, kickoff_at, recommended_pick, match_status, score_home, score_away, validation, value_bet_validation, raw_payload")
        .gte("kickoff_at", cutoff)
        .or("validation.eq.pending,match_status.not.in.(FT,AET,PEN)")
        .order("kickoff_at", { ascending: false })
        .order("fixture_id", { ascending: false })
        .range(offset, offset + scanChunkSize - 1);
      if (readError) throw readError;
      if (!page?.length) break;
      candidates.push(...page);
      if (page.length < scanChunkSize) break;
    }

    if (!candidates || candidates.length === 0) {
      console.info(
        JSON.stringify({ historySync: true, scanned: 0, updated: 0, note: "no_pending_or_nonfinal_rows" })
      );
      await persistHistorySyncStatus(supabase, req, { ok: true, scanned: 0, updated: 0 });
      return res.status(200).json({ ok: true, scanned: 0, updated: 0, message: "Nu există înregistrări în așteptare." });
    }
    const cappedScan = candidates.length >= scanMaxRows;

    const groupMap = new Map();
    for (const row of candidates) {
      const dateKey = calendarDateKeyEuropeBucharest(row.kickoff_at);
      const leagueId = Number(row.league_id);
      if (!dateKey || !Number.isFinite(leagueId)) continue;
      const key = `${dateKey}:${leagueId}`;
      if (!groupMap.has(key)) groupMap.set(key, { date: dateKey, leagueId, fixtureIds: new Set() });
      groupMap.get(key).fixtureIds.add(Number(row.fixture_id));
    }

    /** Short TTL so nightly cron / sync nu citesc listing de acum 6h (FT lipsă). */
    const dayLeagueTtl = Math.max(60, Math.min(Number(process.env.HISTORY_SYNC_DAY_LEAGUE_TTL_SEC || 300), 7200));

    const fixtureById = new Map();
    for (const group of groupMap.values()) {
      const resp = await getWithCache("/fixtures", { date: group.date, league: group.leagueId }, dayLeagueTtl);
      if (!resp.ok) continue;
      const fixtures = resp.data?.response || [];
      for (const fx of fixtures) {
        const id = Number(fx?.fixture?.id);
        if (!Number.isFinite(id) || !group.fixtureIds.has(id)) continue;
        fixtureById.set(id, fx);
      }
    }

    const missingIds = [
      ...new Set(
        candidates
          .map((row) => Number(row.fixture_id))
          .filter((id) => Number.isFinite(id) && id > 0 && !fixtureById.has(id))
      )
    ];
    const IDS_CHUNK = 20;
    const idsTtl = Math.max(30, Math.min(Number(process.env.HISTORY_SYNC_IDS_TTL_SEC || 120), 600));
    const groupedFetchCalls = groupMap.size;
    const idsFetchCalls = Math.ceil(missingIds.length / IDS_CHUNK);
    const estimatedCalls = groupedFetchCalls + idsFetchCalls;
    for (let i = 0; i < missingIds.length; i += IDS_CHUNK) {
      const chunk = missingIds.slice(i, i + IDS_CHUNK);
      const idsParam = chunk.join("-");
      const resp = await getWithCache("/fixtures", { ids: idsParam }, idsTtl);
      if (!resp.ok) continue;
      const fixtures = resp.data?.response || [];
      for (const fx of fixtures) {
        const id = Number(fx?.fixture?.id);
        if (!Number.isFinite(id)) continue;
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
      const raw = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
      const vbRaw = raw.valueBet?.type ? String(raw.valueBet.type).trim().toUpperCase() : "";
      const vbPick = ["1", "X", "2"].includes(vbRaw) ? vbRaw : null;
      const valueBetValidation = vbPick
        ? validationFromMatch(matchStatus, vbPick, { home: scoreHome, away: scoreAway })
        : row.value_bet_validation ?? null;

      const statusChanged = String(matchStatus || "") !== String(row.match_status || "");
      const scoreChanged = scoreHome !== row.score_home || scoreAway !== row.score_away;
      const validationChanged = String(validation) !== String(row.validation || "");
      const vbValChanged = String(valueBetValidation ?? "") !== String(row.value_bet_validation ?? "");

      if (!statusChanged && !scoreChanged && !validationChanged && !vbValChanged) continue;
      updates.push({
        fixture_id: fixtureId,
        match_status: matchStatus,
        score_home: scoreHome,
        score_away: scoreAway,
        validation,
        value_bet_validation: valueBetValidation,
        updated_at: new Date().toISOString()
      });
    }

    if (updates.length > 0) {
      const { error: updateError } = await supabase.from(HISTORY_TABLE).upsert(updates, { onConflict: "fixture_id" });
      if (updateError) throw updateError;
    }

    console.info(
      JSON.stringify({
        historySync: true,
        method: req.method || "",
        scanned: candidates.length,
        updated: updates.length,
        cappedScan
      })
    );
    await persistHistorySyncStatus(supabase, req, {
      ok: true,
      scanned: candidates.length,
        updated: updates.length,
        estimatedCalls
    });
    return res.status(200).json({
      ok: true,
      scanned: candidates.length,
      updated: updates.length,
        cappedScan,
        estimatedCalls,
        estimatedCallsBreakdown: {
          dayLeagueGroups: groupedFetchCalls,
          idsChunks: idsFetchCalls
        }
    });
  } catch (error) {
    const msg = error?.message || "Sincronizarea istoricului a eșuat.";
    await persistHistorySyncStatus(supabase, req, { ok: false, error: msg, scanned: 0, updated: 0, estimatedCalls: 0 });
    return res.status(500).json({ ok: false, error: msg });
  }
}

/**
 * GET /api/history — aggregate stats only (items=[]); no row payloads for anonymous/non-admin.
 * GET /api/history + Bearer + admin — full global predictions_history (admin observatory).
 * GET /api/history?mine=1 — scoped to the authenticated user (Bearer required).
 * GET or POST /api/history?sync=1 — sync scores/validation (replaces former /api/history/sync).
 */
export default async function handler(req, res) {
  const syncOn = String(req.query.sync || "") === "1" || String(req.query.sync || "").toLowerCase() === "true";
  if (syncOn) {
    return handleHistorySync(req, res);
  }
  const perfOn = String(req.query.performance || "") === "1" || String(req.query.performance || "").toLowerCase() === "true";
  if (perfOn) {
    return handlePerformanceRead(req, res);
  }
  return handleHistoryRead(req, res);
}
