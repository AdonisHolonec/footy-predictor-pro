import { assertAdmin, getRequester, readBearer } from "../server-utils/authAdmin.js";
import { calendarDateKeyEuropeBucharest } from "../server-utils/fixtureCalendarDateKey.js";
import { isAuthorizedCronOrInternalRequest } from "../server-utils/cronRequestAuth.js";
import { getWithCache } from "../server-utils/fetcher.js";
import { computeCardTotals } from "../server-utils/fixtureCardTotals.js";
import { resolveFixtureFirstHalfGoals } from "../server-utils/fixtureHalftimeGoals.js";
import { mapUserIdsToEmails } from "../server-utils/adminUserEmails.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import { settlePendingGlobalSpecialBets } from "../server-utils/globalSpecialBets.js";
import { handleGlobalSpecialBets } from "../server-utils/globalSpecialBetsApi.js";
import { captureClosingOdds } from "../server-utils/closingOddsCapture.js";
import {
  attachCardMarketsToPayload,
  deriveCardMarketPicks,
  needsMarketTotalsForSettlement,
  resolveRecommendedValidation
} from "../server-utils/cardMarketSettlement.js";
import { checkAnonymousRateLimit } from "../server-utils/anonymousRateLimit.js";
import { recordSyncRun, SYNC_KINDS } from "../server-utils/observability/syncTelemetry.js";
import {
  readPredictionsHistory,
  readPredictionsHistoryAggregateStats,
  readPredictionsHistoryForUser,
  resolveValueBetPick,
  validationFromMatch
} from "../server-utils/predictionsHistory.js";

function parseNumericStat(statistics, candidates) {
  if (!Array.isArray(statistics)) return null;
  for (const cand of candidates) {
    const row = statistics.find((s) => String(s?.type || "").toLowerCase() === cand.toLowerCase());
    if (!row) continue;
    const raw = row.value;
    if (raw == null) return null;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const parsed = Number(raw.replace(/[^\d.-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

async function fetchFixtureMarketTotals(fixtureId) {
  const statsReq = await getWithCache("/fixtures/statistics", { fixture: fixtureId }, 900);
  if (!statsReq.ok || !statsReq.data?.response || statsReq.data.response.length < 2) {
    return {
      cornersTotal: null,
      shotsOnTargetTotal: null,
      shotsTotal: null,
      cardsTotal: null,
      cardsPoints: null,
      firstHalfGoals: null,
      ok: false
    };
  }
  const homeStats = statsReq.data.response[0].statistics;
  const awayStats = statsReq.data.response[1].statistics;
  const cornersHome = parseNumericStat(homeStats, ["Corner Kicks"]);
  const cornersAway = parseNumericStat(awayStats, ["Corner Kicks"]);
  const shotsOnTargetHome = parseNumericStat(homeStats, ["Shots on Goal", "Shots on Target"]);
  const shotsOnTargetAway = parseNumericStat(awayStats, ["Shots on Goal", "Shots on Target"]);
  // Combined match shots, read from the SAME statistics response already fetched above —
  // no extra provider call. Mirrors api/fixtures.js, which has parsed "Total Shots" from
  // this payload all along; only the settlement path never picked it up.
  const shotsTotalHome = parseNumericStat(homeStats, ["Total Shots"]);
  const shotsTotalAway = parseNumericStat(awayStats, ["Total Shots"]);
  // Cards come from the SAME statistics response already fetched above — no extra
  // provider call. See fixtureCardTotals.js for the known-vs-unknown rule and for why
  // the raw count and the weighted points are both recorded.
  const { cardsTotal, cardsPoints } = computeCardTotals(homeStats, awayStats);

  let firstHalfGoals = null;
  try {
    const ht = await resolveFixtureFirstHalfGoals(fixtureId, getWithCache);
    firstHalfGoals = ht.firstHalfGoals;
  } catch {
    // ignore — corners/shots still usable
  }

  return {
    ok: true,
    cornersTotal: cornersHome != null && cornersAway != null ? cornersHome + cornersAway : null,
    shotsOnTargetTotal:
      shotsOnTargetHome != null && shotsOnTargetAway != null
        ? shotsOnTargetHome + shotsOnTargetAway
        : null,
    // Both sides required: a half-known total would settle Over/Under lines wrongly.
    shotsTotal:
      shotsTotalHome != null && shotsTotalAway != null ? shotsTotalHome + shotsTotalAway : null,
    cardsTotal,
    cardsPoints,
    firstHalfGoals
  };
}

const HISTORY_TABLE = "predictions_history";

/**
 * predictions_history rows carry a raw_payload measuring ~134KB at the median, so a
 * single upsert across the cron's 45-day window reaches ~29MB in one statement. Postgres
 * cancels it ("canceling statement due to statement timeout"), the handler throws, and
 * settlement never finishes — which is why finished fixtures sat ungraded for days.
 *
 * Same rows, same onConflict, same result: only split into bounded statements. Rows that
 * carry raw_payload get a small chunk; scalar-only updates batch far wider.
 */
const UPSERT_CHUNK_PAYLOAD = Math.max(1, Math.min(Number(process.env.HISTORY_SYNC_UPSERT_CHUNK || 25), 200));
const UPSERT_CHUNK_SCALAR = Math.max(1, Math.min(Number(process.env.HISTORY_SYNC_UPSERT_CHUNK_SCALAR || 200), 1000));

export async function upsertHistoryChunked(supabase, rows, chunkSize) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await supabase
      .from(HISTORY_TABLE)
      .upsert(rows.slice(i, i + chunkSize), { onConflict: "fixture_id" });
    if (error) throw error;
  }
  return rows.length;
}

async function isAuthorizedHistorySync(req) {
  // P0: history sync burns API-Football — cron or admin only (not any JWT).
  if (isAuthorizedCronOrInternalRequest(req)) return true;
  const admin = await assertAdmin(req);
  return admin.ok;
}

function resolveHistorySyncSource(req) {
  if (isAuthorizedCronOrInternalRequest(req)) {
    const ua = String(req.headers["user-agent"] || "").toLowerCase();
    return ua.includes("vercel-cron") ? "vercel_cron" : "cron_secret";
  }
  return "admin_jwt";
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

  const rl = await checkAnonymousRateLimit(req, {
    namespace: "history-public",
    maxPerHour: Math.max(30, Math.min(Number(process.env.ANON_RATE_HISTORY_PUBLIC || 90), 300))
  });
  if (!rl.ok) {
    if (rl.retryAfterSec) res.setHeader("Retry-After", String(rl.retryAfterSec));
    return res.status(429).json({ ok: false, error: "Prea multe cereri." });
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
    return res.status(403).json({
      ok: false,
      error: "History sync este permis doar pentru cron sau admin.",
      code: "history_sync_forbidden_for_user"
    });
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
    // Longer TTL for ids= chunks — same FT rows are polled often by client + cron.
    const idsTtl = Math.max(60, Math.min(Number(process.env.HISTORY_SYNC_IDS_TTL_SEC || 300), 1800));
    const IDS_CHUNK = 20;
    const allPendingIds = [
      ...new Set(
        candidates.map((row) => Number(row.fixture_id)).filter((id) => Number.isFinite(id) && id > 0)
      )
    ];

    const fixtureById = new Map();
    // Prefer batched /fixtures?ids= when cheaper than date×league fan-out
    // (typical: few pending fixtures across many leagues → ids wins).
    const idsOnlyCalls = Math.ceil(allPendingIds.length / IDS_CHUNK);
    const preferIdsFirst =
      String(process.env.HISTORY_SYNC_PREFER_IDS || "1") !== "0" &&
      (idsOnlyCalls <= groupMap.size || allPendingIds.length <= 80);

    let groupedFetchCalls = 0;
    let idsFetchCalls = 0;

    if (preferIdsFirst) {
      for (let i = 0; i < allPendingIds.length; i += IDS_CHUNK) {
        const chunk = allPendingIds.slice(i, i + IDS_CHUNK);
        const resp = await getWithCache("/fixtures", { ids: chunk.join("-") }, idsTtl);
        idsFetchCalls += 1;
        if (!resp.ok) continue;
        for (const fx of resp.data?.response || []) {
          const id = Number(fx?.fixture?.id);
          if (Number.isFinite(id)) fixtureById.set(id, fx);
        }
      }
    } else {
      for (const group of groupMap.values()) {
        const resp = await getWithCache("/fixtures", { date: group.date, league: group.leagueId }, dayLeagueTtl);
        groupedFetchCalls += 1;
        if (!resp.ok) continue;
        for (const fx of resp.data?.response || []) {
          const id = Number(fx?.fixture?.id);
          if (!Number.isFinite(id) || !group.fixtureIds.has(id)) continue;
          fixtureById.set(id, fx);
        }
      }
      const missingIds = allPendingIds.filter((id) => !fixtureById.has(id));
      for (let i = 0; i < missingIds.length; i += IDS_CHUNK) {
        const chunk = missingIds.slice(i, i + IDS_CHUNK);
        const resp = await getWithCache("/fixtures", { ids: chunk.join("-") }, idsTtl);
        idsFetchCalls += 1;
        if (!resp.ok) continue;
        for (const fx of resp.data?.response || []) {
          const id = Number(fx?.fixture?.id);
          if (Number.isFinite(id)) fixtureById.set(id, fx);
        }
      }
    }

    const estimatedCalls = groupedFetchCalls + idsFetchCalls;

    const updates = [];
    for (const row of candidates) {
      const fixtureId = Number(row.fixture_id);
      const fx = fixtureById.get(fixtureId);
      if (!fx) continue;
      const matchStatus = fx?.fixture?.status?.short || row.match_status || "";
      const scoreHome = typeof fx?.goals?.home === "number" ? fx.goals.home : null;
      const scoreAway = typeof fx?.goals?.away === "number" ? fx.goals.away : null;
      const score = { home: scoreHome, away: scoreAway };
      const raw = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
      const validation = resolveRecommendedValidation({
        pick: row.recommended_pick,
        family: raw.recommended?.family || null,
        status: matchStatus,
        score,
        marketTotals: {
          cornersTotal: raw.marketResults?.cornersTotal ?? null,
          shotsOnTargetTotal: raw.marketResults?.shotsOnTargetTotal ?? null,
          shotsTotal: raw.marketResults?.shotsTotal ?? null
        }
      });
      const vbPick = resolveValueBetPick(raw.valueBet?.type || raw.valueEngine?.bestMarket?.type || raw.valueEngine?.type);
      const valueBetValidation = vbPick
        ? validationFromMatch(matchStatus, vbPick, score)
        : row.value_bet_validation ?? null;

      const enrichedPayload = attachCardMarketsToPayload(
        {
          ...raw,
          recommended: raw.recommended || { pick: row.recommended_pick || "" },
          status: matchStatus,
          score
        },
        { status: matchStatus, score }
      );
      const cardChanged =
        JSON.stringify(raw.cardMarketValidations || null) !==
        JSON.stringify(enrichedPayload.cardMarketValidations || null);

      const statusChanged = String(matchStatus || "") !== String(row.match_status || "");
      const scoreChanged = scoreHome !== row.score_home || scoreAway !== row.score_away;
      const validationChanged = String(validation) !== String(row.validation || "");
      const vbValChanged = String(valueBetValidation ?? "") !== String(row.value_bet_validation ?? "");

      if (!statusChanged && !scoreChanged && !validationChanged && !vbValChanged && !cardChanged) continue;
      updates.push({
        fixture_id: fixtureId,
        match_status: matchStatus,
        score_home: scoreHome,
        score_away: scoreAway,
        validation,
        value_bet_validation: valueBetValidation,
        raw_payload: enrichedPayload,
        updated_at: new Date().toISOString()
      });
    }

    if (updates.length > 0) {
      await upsertHistoryChunked(supabase, updates, UPSERT_CHUNK_PAYLOAD);
    }

    // DB-only pass: grade multi-market value bets on already-finished rows
    // (cron used to skip them once recommended_pick was settled).
    let resettled = 0;
    const resettleUpdates = [];
    for (let offset = 0; offset < scanMaxRows; offset += scanChunkSize) {
      const { data: page, error: resettleErr } = await supabase
        .from(HISTORY_TABLE)
        .select(
          "fixture_id, recommended_pick, match_status, score_home, score_away, validation, value_bet_validation, raw_payload"
        )
        .gte("kickoff_at", cutoff)
        .in("match_status", ["FT", "AET", "PEN"])
        .or("value_bet_validation.is.null,value_bet_validation.eq.pending")
        .order("kickoff_at", { ascending: false })
        .order("fixture_id", { ascending: false })
        .range(offset, offset + scanChunkSize - 1);
      if (resettleErr) throw resettleErr;
      if (!page?.length) break;
      for (const row of page) {
        const raw = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
        const vbPick = resolveValueBetPick(
          raw.valueBet?.type || raw.valueEngine?.bestMarket?.type || raw.valueEngine?.type
        );
        if (!vbPick) continue;
        const score = { home: row.score_home, away: row.score_away };
        if (score.home == null || score.away == null) continue;
        const valueBetValidation = validationFromMatch(row.match_status, vbPick, score);
        if (valueBetValidation !== "win" && valueBetValidation !== "loss") continue;
        const validation =
          row.validation === "win" || row.validation === "loss"
            ? row.validation
            : resolveRecommendedValidation({
                pick: row.recommended_pick,
                family: raw.recommended?.family || null,
                status: row.match_status,
                score,
                marketTotals: {
                  cornersTotal: raw.marketResults?.cornersTotal ?? null,
                  shotsOnTargetTotal: raw.marketResults?.shotsOnTargetTotal ?? null,
                  shotsTotal: raw.marketResults?.shotsTotal ?? null
                }
              });
        if (String(valueBetValidation) === String(row.value_bet_validation || "") &&
            String(validation) === String(row.validation || "")) {
          continue;
        }
        resettleUpdates.push({
          fixture_id: Number(row.fixture_id),
          validation,
          value_bet_validation: valueBetValidation,
          updated_at: new Date().toISOString()
        });
      }
      if (page.length < scanChunkSize) break;
    }
    if (resettleUpdates.length > 0) {
      // Scalar columns only — no raw_payload, so these batch far wider.
      resettled = await upsertHistoryChunked(supabase, resettleUpdates, UPSERT_CHUNK_SCALAR);
    }

    // Resettle card markets (goals / corners / shots) on finished rows.
    // Corners & shots need /fixtures/statistics — capped per sync.
    const statsFetchCap = Math.max(
      0,
      Math.min(Number(process.env.HISTORY_SYNC_CARD_STATS_MAX || 80), 150)
    );
    /**
     * Separate, larger budget for fixtures whose *recommended* pick is still ungraded.
     * A recommended pick on a totals-backed family (Corners / Shots / Cards) cannot settle
     * until /fixtures/statistics arrives — `resolveRecommendedValidation` returns "pending"
     * while marketTotals are null. Sharing one budget with cosmetic market touch-ups meant a
     * busy window exhausted it on non-recommended rows and a recommended pick stayed pending
     * forever. That is the P0: Corners tile WIN, Recommended still "no result".
     */
    const recommendedStatsCap = Math.max(
      0,
      Math.min(Number(process.env.HISTORY_SYNC_RECOMMENDED_STATS_MAX || 250), 500)
    );
    let cardResettled = 0;
    let statsFetchCalls = 0;
    let recommendedStatsCalls = 0;
    const cardUpdates = [];
    const settlement = {
      finishedScanned: 0,
      recommendedPendingBefore: 0,
      recommendedSettledNow: 0,
      recommendedStillPending: 0,
      missingTotals: 0,
      syncSkippedBudget: 0,
      recommendedStatsCalls: 0,
      recommendedStatsCap,
      statsFetchCap
    };

    // Collect the finished window before grading so recommended-pending fixtures can be
    // processed ahead of everything else — priority is meaningless while paging inline.
    const finishedRows = [];
    for (let offset = 0; offset < scanMaxRows; offset += scanChunkSize) {
      const { data: page, error: cardErr } = await supabase
        .from(HISTORY_TABLE)
        .select(
          "fixture_id, recommended_pick, match_status, score_home, score_away, validation, raw_payload"
        )
        .gte("kickoff_at", cutoff)
        .in("match_status", ["FT", "AET", "PEN"])
        .order("kickoff_at", { ascending: false })
        .order("fixture_id", { ascending: false })
        .range(offset, offset + scanChunkSize - 1);
      if (cardErr) throw cardErr;
      if (!page?.length) break;
      finishedRows.push(...page);
      if (page.length < scanChunkSize) break;
    }

    /** Finished match + a recommended pick that never reached win/loss. */
    const recommendedUnsettled = (row) =>
      Boolean(row.recommended_pick) && row.validation !== "win" && row.validation !== "loss";

    settlement.finishedScanned = finishedRows.length;
    settlement.recommendedPendingBefore = finishedRows.filter(recommendedUnsettled).length;
    // Stable priority sort: recommended gaps first, kickoff/fixture order preserved within groups.
    finishedRows.sort((a, b) => Number(recommendedUnsettled(b)) - Number(recommendedUnsettled(a)));

    {
      for (const row of finishedRows) {
        const raw = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
        const score = { home: row.score_home, away: row.score_away };
        if (score.home == null || score.away == null) continue;

        const picks =
          raw.cardMarkets && typeof raw.cardMarkets === "object"
            ? raw.cardMarkets
            : deriveCardMarketPicks({
                ...raw,
                recommended: raw.recommended || { pick: row.recommended_pick || "" }
              });

        const storedVals = raw.cardMarketValidations;
        const hasAnyPick = Boolean(picks.recommended || picks.goals || picks.corners || picks.shots);
        const hasFirstHalfPick = Boolean(raw.probs?.firstHalf);
        const htKnown =
          raw.marketResults?.firstHalfGoals != null &&
          Number.isFinite(Number(raw.marketResults.firstHalfGoals));
        const missingHt = hasFirstHalfPick && !htKnown;
        if (!hasAnyPick && !missingHt) continue;

        const allSettled =
          storedVals &&
          typeof storedVals === "object" &&
          ["recommended", "goals", "corners", "shots"].every((key) => {
            if (!picks[key]) return true;
            return storedVals[key] === "win" || storedVals[key] === "loss";
          });
        if (allSettled && !missingHt) continue;

        let marketTotals = {
          cornersTotal: raw.marketResults?.cornersTotal ?? null,
          shotsOnTargetTotal: raw.marketResults?.shotsOnTargetTotal ?? null,
          shotsTotal: raw.marketResults?.shotsTotal ?? null,
          // Recorded, not yet graded against: Cards still short-circuits to "pending" in
          // resolveRecommendedValidation. Capturing the observed total is what makes the
          // later settlement/backtest work possible — it changes no outcome today.
          cardsTotal: raw.marketResults?.cardsTotal ?? null,
          cardsPoints: raw.marketResults?.cardsPoints ?? null,
          firstHalfGoals: htKnown ? Number(raw.marketResults.firstHalfGoals) : null
        };

        const provisional = attachCardMarketsToPayload(
          {
            ...raw,
            recommended: raw.recommended || { pick: row.recommended_pick || "" },
            cardMarkets: picks,
            status: row.match_status,
            score
          },
          { status: row.match_status, score, marketTotals }
        );

        const isRecommendedGap = recommendedUnsettled(row);
        const provisionalRecommended = provisional.cardMarketValidations?.recommended;
        const needsStats =
          needsMarketTotalsForSettlement(provisional.cardMarketValidations, picks) ||
          missingHt ||
          // Recommended still ungraded with the totals we hold — fetching them is the only
          // thing that can settle it, so it must not be starved by the general market budget.
          (isRecommendedGap &&
            provisionalRecommended !== "win" &&
            provisionalRecommended !== "loss");

        const withinBudget = isRecommendedGap
          ? recommendedStatsCalls < recommendedStatsCap
          : statsFetchCalls < statsFetchCap;

        if (needsStats && !withinBudget) settlement.syncSkippedBudget += 1;

        if (needsStats && withinBudget) {
          const totals = await fetchFixtureMarketTotals(Number(row.fixture_id));
          statsFetchCalls += 1;
          if (isRecommendedGap) recommendedStatsCalls += 1;
          if (totals.ok) {
            marketTotals = {
              cornersTotal: totals.cornersTotal ?? marketTotals.cornersTotal,
              shotsOnTargetTotal: totals.shotsOnTargetTotal ?? marketTotals.shotsOnTargetTotal,
              shotsTotal: totals.shotsTotal ?? marketTotals.shotsTotal,
              cardsTotal: totals.cardsTotal ?? marketTotals.cardsTotal,
              cardsPoints: totals.cardsPoints ?? marketTotals.cardsPoints,
              firstHalfGoals: totals.firstHalfGoals ?? marketTotals.firstHalfGoals
            };
          } else if (isRecommendedGap) {
            // Upstream had no statistics for this fixture — it stays pending, not mis-graded.
            settlement.missingTotals += 1;
          }
        }

        const enriched = attachCardMarketsToPayload(
          {
            ...raw,
            recommended: raw.recommended || { pick: row.recommended_pick || "" },
            cardMarkets: picks,
            status: row.match_status,
            score
          },
          { status: row.match_status, score, marketTotals }
        );

        const validation =
          row.validation === "win" || row.validation === "loss"
            ? row.validation
            : resolveRecommendedValidation({
                pick: row.recommended_pick,
                family: raw.recommended?.family || null,
                status: row.match_status,
                score,
                marketTotals
              });

        const cardChanged =
          JSON.stringify(raw.cardMarketValidations || null) !==
            JSON.stringify(enriched.cardMarketValidations || null) ||
          JSON.stringify(raw.cardMarkets || null) !== JSON.stringify(enriched.cardMarkets || null) ||
          JSON.stringify(raw.marketResults || null) !== JSON.stringify(enriched.marketResults || null);
        const validationChanged = String(validation) !== String(row.validation || "");
        if (!cardChanged && !validationChanged) continue;

        cardUpdates.push({
          fixture_id: Number(row.fixture_id),
          validation,
          raw_payload: enriched,
          updated_at: new Date().toISOString()
        });
      }
    }

    const settledNow = new Set(
      cardUpdates
        .filter((u) => u.validation === "win" || u.validation === "loss")
        .map((u) => Number(u.fixture_id))
    );
    settlement.recommendedSettledNow = finishedRows.filter(
      (r) => recommendedUnsettled(r) && settledNow.has(Number(r.fixture_id))
    ).length;
    settlement.recommendedStillPending =
      settlement.recommendedPendingBefore - settlement.recommendedSettledNow;
    settlement.recommendedStatsCalls = recommendedStatsCalls;

    // Persist the run so `recommendedStillPending` becomes a trend instead of a number
    // that only ever existed in one HTTP response. Never blocks the sync.
    void recordSyncRun(SYNC_KINDS.SETTLEMENT, settlement);

    if (cardUpdates.length > 0) {
      cardResettled = await upsertHistoryChunked(supabase, cardUpdates, UPSERT_CHUNK_PAYLOAD);
    }

    const updatedTotal = updates.length + resettled + cardResettled;
    const estimatedCallsTotal = estimatedCalls + statsFetchCalls;
    console.info(
      JSON.stringify({
        historySync: true,
        method: req.method || "",
        scanned: candidates.length,
        updated: updates.length,
        resettled,
        cardResettled,
        statsFetchCalls,
        cappedScan,
        // Settlement observability: a non-zero recommendedStillPending after a run means
        // finished matches whose recommended pick no surface can render as win/loss.
        ...settlement
      })
    );
    await persistHistorySyncStatus(supabase, req, {
      ok: true,
      scanned: candidates.length,
      updated: updatedTotal,
      estimatedCalls: estimatedCallsTotal
    });

    const closingOn =
      String(req.query.closing || "") === "1" || String(req.query.closing || "").toLowerCase() === "true";
    let closing = null;
    if (closingOn) {
      closing = await captureClosingOdds({
        hours: req.query.hours,
        limit: req.query.limit || 30,
        backfillDays: req.query.backfillDays ?? 7
      }).catch((err) => ({ ok: false, error: err?.message || "closing capture failed" }));
    }

    // Global Special Bet settlement runs last, on results this sync has just
    // refreshed. It is driven from the BETS side (status = 'pending'), not from
    // the finished-fixture scan above, which is why postponed and abandoned
    // fixtures and the 48-hour missing-statistics rule need no separate pass:
    // those bets are pending, so they are already in scope. Failures are
    // reported, never swallowed — a settlement that moved no rows is a failure.
    const globalSpecialBets = await settlePendingGlobalSpecialBets().catch((err) => ({
      scanned: 0,
      settled: 0,
      unchanged: 0,
      failures: [{ error: err?.message || "global special bet settlement failed" }]
    }));

    return res.status(200).json({
      ok: true,
      scanned: candidates.length,
      updated: updatedTotal,
      resettled,
      cardResettled,
      globalSpecialBets,
      cappedScan,
      estimatedCalls: estimatedCallsTotal,
      estimatedCallsBreakdown: {
        dayLeagueGroups: groupedFetchCalls,
        idsChunks: idsFetchCalls,
        cardStats: statsFetchCalls
      },
      settlement,
      ...(closing ? { closing } : {})
    });
  } catch (error) {
    const msg = error?.message || "Sincronizarea istoricului a eșuat.";
    await persistHistorySyncStatus(supabase, req, { ok: false, error: msg, scanned: 0, updated: 0, estimatedCalls: 0 });
    return res.status(500).json({ ok: false, error: msg });
  }
}

async function handleClosingOdds(req, res) {
  setNoStoreHeaders(res);
  if (req.method && req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }
  if (!(await isAuthorizedHistorySync(req))) {
    return res.status(403).json({
      ok: false,
      error: "Closing odds capture este permis doar pentru cron sau admin.",
      code: "history_closing_forbidden_for_user"
    });
  }

  const supabaseConfig = assertSupabaseConfigured();
  if (!supabaseConfig.ok) {
    return res.status(500).json({ ok: false, error: supabaseConfig.error });
  }

  try {
    const result = await captureClosingOdds({
      hours: req.query.hours,
      hoursBefore: req.query.hoursBefore,
      hoursAfter: req.query.hoursAfter,
      limit: req.query.limit,
      ttlSeconds: req.query.ttlSeconds,
      backfillDays: req.query.backfillDays ?? 7
    });
    if (!result.ok) {
      return res.status(500).json(result);
    }
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Captura closing odds a eșuat."
    });
  }
}

/**
 * GET /api/history — aggregate stats only (items=[]); no row payloads for anonymous/non-admin.
 * GET /api/history + Bearer + admin — full global predictions_history (admin observatory).
 * GET /api/history?mine=1 — scoped to the authenticated user (Bearer required).
 * GET or POST /api/history?sync=1 — sync scores/validation (replaces former /api/history/sync).
 * GET or POST /api/history?closing=1 — capture near-kickoff closing odds for CLV.
 * GET or POST /api/history?view=special-bets — Global Special Bet, reached as
 *   /api/special-bets through the rewrite in vercel.json (Hobby function cap).
 */
export default async function handler(req, res) {
  // Checked first: Global Special Bet is its own resource, not a projection of
  // predictions_history, and it must not inherit this handler's read defaults.
  if (String(req.query.view || "") === "special-bets") {
    return handleGlobalSpecialBets(req, res);
  }

  const syncOn = String(req.query.sync || "") === "1" || String(req.query.sync || "").toLowerCase() === "true";
  const closingOn =
    String(req.query.closing || "") === "1" || String(req.query.closing || "").toLowerCase() === "true";

  if (syncOn) {
    return handleHistorySync(req, res);
  }
  if (closingOn) {
    return handleClosingOdds(req, res);
  }
  const perfOn = String(req.query.performance || "") === "1" || String(req.query.performance || "").toLowerCase() === "true";
  if (perfOn) {
    return handlePerformanceRead(req, res);
  }
  return handleHistoryRead(req, res);
}
