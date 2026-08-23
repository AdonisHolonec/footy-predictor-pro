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
  canonicalMarketTotals,
  resolveRecommendedValidation
} from "../server-utils/cardMarketSettlement.js";
import { checkAnonymousRateLimit } from "../server-utils/anonymousRateLimit.js";
import { recordSyncRun, SYNC_KINDS } from "../server-utils/observability/syncTelemetry.js";
import { withObservationScope } from "../server-utils/observability/metricsStore.js";
import {
  createTransportCollector,
  withTransportScope
} from "../server-utils/observability/transportTiming.js";
import {
  HISTORY_ROUTE,
  attachTransport,
  createHistoryTiming,
  emitHistoryTiming,
  markStage,
  recordError,
  recordFinalBytes,
  recordRows,
  timeStage
} from "../server-utils/observability/historyTiming.js";
import {
  SETTLEMENT_SELECT,
  isSettlementRowComplete,
  rehydrateSettlementRow,
  mapDbRowToHistoryEntry,
  readPredictionsHistory,
  readPredictionsHistoryList,
  readPredictionsHistoryListForUser,
  readPredictionsHistoryAggregateStats,
  readPredictionsHistoryForUser,
  readPredictionsForHydration,
  resolveValueBetPick,
  validationFromMatch
} from "../server-utils/predictionsHistory.js";
import { deriveMutableHistoryListColumns } from "../server-utils/historyListColumns.js";

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

/**
 * One history row, by primary key.
 *
 * The list response carries `raw_payload` for EVERY row purely so the match
 * modal can render without a fetch — at a measured ~261 KB per row that is
 * where /api/history spends its statement timeout. This is the detail source
 * the modal will eventually read instead; the list is deliberately unchanged
 * until it exists and is proven.
 *
 * Authorization deliberately matches the WEAKEST row-level access the list
 * already grants: `mine=1` requires a valid JWT, and anonymous callers get
 * `items: []`. So this requires a session and never becomes public. It does not
 * filter by user, because `predictions_history` has no user column — rows are
 * model output for public fixtures, and per-user scoping lives in the
 * `predictions_history_for_user` RPC rather than the table.
 */
export async function handleHistoryDetail(req, res, rawFixtureId, deps = {}) {
  // Dependencies are injectable so the tests run against fakes — no Postgres,
  // no network — the same shape supportApi.js uses.
  const requestUser = deps.getRequester || getRequester;
  const supabaseFor = deps.getSupabaseAdmin || getSupabaseAdmin;
  const mapRow = deps.mapDbRowToHistoryEntry || mapDbRowToHistoryEntry;

  const fixtureId = Number(rawFixtureId);
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    return res.status(400).json({ ok: false, error: "fixtureId invalid." });
  }

  const requester = await requestUser(req);
  if (!requester.ok) {
    return res.status(requester.status || 401).json({ ok: false, error: requester.error || "Neautorizat." });
  }

  const supabase = supabaseFor();
  if (!supabase) {
    return res.status(500).json({ ok: false, error: "Clientul Supabase nu este disponibil." });
  }

  try {
    // Primary-key lookup: no date window, no limit, no scan.
    const { data, error } = await supabase
      .from(HISTORY_TABLE)
      .select("*")
      .eq("fixture_id", fixtureId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ ok: false, error: "Fixture inexistent în istoric." });
    }
    // Same mapper the list uses, so the modal sees a byte-identical shape.
    return res.status(200).json({ ok: true, scope: "fixture_detail", item: mapRow(data) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Citirea istoricului a eșuat." });
  }
}

/**
 * Whether this request asks for one fixture rather than the list.
 *
 * Exported because it is the routing rule the whole split depends on: anything
 * that answers true here must never reach the windowed list query, and an
 * absent or blank fixtureId must leave the list path exactly as it was.
 */
/**
 * Whether this request opted into the light list projection.
 *
 * Exported so the routing rule is testable rather than asserted as a string.
 * Only the exact token `list` opts in — anything else, including the existing
 * `view=special-bets`, must leave the full default alone.
 */
export function shouldServeLightList(query) {
  return String(query?.view || "") === "list";
}

/**
 * Whether this request wants the prediction-board projection.
 *
 * Exported for the same reason as shouldServeLightList: the routing rule is
 * testable rather than asserted as a string. Only the exact token
 * `prediction-list` opts in — `list`, `special-bets` and anything else must
 * leave their own behaviour alone, and no `view` at all must stay FULL, because
 * historyService.loadHistory reads the full `mine=1` shape for the guest and
 * admin observatory surfaces.
 */
export function shouldServePredictionList(query) {
  return String(query?.view || "") === "prediction-list";
}

export function shouldServeFixtureDetail(query) {
  const raw = query?.fixtureId;
  return raw !== undefined && raw !== null && String(raw).trim() !== "";
}

/**
 * The windowed list read, and the routing between its three projections.
 *
 * `deps` is injectable for the same reason handleHistoryDetail's is: which
 * reader a query reaches is a rule worth asserting against fakes rather than
 * inferring. Three shapes share this one branch and must not be confused —
 * `view=list` (History list, columns only), `view=prediction-list` (the
 * prediction board) and no view at all (FULL, which historyService.loadHistory
 * still depends on for the guest and admin observatory).
 */
export async function handleHistoryRead(req, res, deps = {}) {
  const requestUser = deps.getRequester || getRequester;
  const readList = deps.readPredictionsHistoryListForUser || readPredictionsHistoryListForUser;
  const readPredictions = deps.readPredictionsForHydration || readPredictionsForHydration;
  const readFull = deps.readPredictionsHistoryForUser || readPredictionsHistoryForUser;
  // The anonymous and admin branches were previously unreachable from a test,
  // which is why their timing and error paths went unverified until production
  // showed them failing. Same injectable-deps convention as the readers above.
  const bearerOf = deps.readBearer || readBearer;
  const adminOf = deps.assertAdmin || assertAdmin;
  const rateLimit = deps.checkAnonymousRateLimit || checkAnonymousRateLimit;
  const readGlobalList = deps.readPredictionsHistoryList || readPredictionsHistoryList;
  const readGlobal = deps.readPredictionsHistory || readPredictionsHistory;
  const readAggregate = deps.readPredictionsHistoryAggregateStats || readPredictionsHistoryAggregateStats;

  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }

  const supabaseConfig = (deps.assertSupabaseConfigured || assertSupabaseConfigured)();
  if (!supabaseConfig.ok) {
    return res.status(500).json({ ok: false, error: supabaseConfig.error });
  }

  // Single fixture: answered by primary key, never by the windowed list query.
  if (shouldServeFixtureDetail(req.query)) {
    return handleHistoryDetail(req, res, req.query.fixtureId);
  }

  const days = Number(req.query.days || 30);
  const limit = Number(req.query.limit || 500);
  const mine =
    String(req.query.mine || "") === "1" ||
    String(req.query.mine || "").toLowerCase() === "true";
  /*
    Opt-in light projection. The default stays FULL because this endpoint is
    also a prediction source: usePredictionsCache.rehydratePredictionsFromHistory()
    pipes the response into setPreds, and a light row there would both degrade
    the prediction cards and keep looking "legacy" to hasLegacyPredictionShape,
    re-triggering the very fetch that produced it.

    `view` is an existing parameter (view=special-bets, dispatched above), and
    sync/closing/performance are all resolved before this handler runs, so
    sync=1 keeps winning regardless of view.
  */
  const listView = shouldServeLightList(req.query);
  const predictionListView = shouldServePredictionList(req.query);

  if (mine) {
    const timing = deps.timing;
    const requester = await timeStage(timing, "authMs", () => requestUser(req));
    if (!requester.ok) {
      return res.status(requester.status || 401).json({ ok: false, error: requester.error || "Neautorizat." });
    }
    try {
      /*
        One span around the whole read: the RPC, the row mapping and the card
        aggregate all live inside these functions. Splitting further would mean
        threading a timer through predictionsHistory's signatures, which is a
        change to P3-B's code for a diagnostic — deliberately left to a later
        phase. `dbReadMs` vs `responseMs` is already the split that separates
        "the database was slow" from "the payload was large".
      */
      const { items, stats } = await timeStage(timing, "dbReadMs", () =>
        listView
          ? readList(requester.user.id, days, limit)
          : predictionListView
            ? readPredictions(requester.user.id, days, limit)
            : readFull(requester.user.id, days, limit)
      );
      return res.status(200).json({
        ok: true,
        mine: true,
        days: Math.max(1, Math.min(days || 30, 120)),
        stats,
        items
      });
    } catch (error) {
      recordError(deps.timing, error, "dbReadMs");
      return res.status(500).json({ ok: false, error: error?.message || "Citirea istoricului a eșuat." });
    }
  }

  const safeDays = Math.max(1, Math.min(days || 30, 120));
  const safeLimit = Math.max(1, Math.min(limit || 500, 2000));

  if (bearerOf(req)) {
    const adminCheck = await timeStage(deps.timing, "authMs", () => adminOf(req));
    if (adminCheck.ok) {
      try {
        const { items, stats } = await timeStage(deps.timing, "dbReadMs", () =>
          listView ? readGlobalList(days, limit) : readGlobal(days, limit)
        );
        return res.status(200).json({
          ok: true,
          days: safeDays,
          stats,
          items,
          scope: "global_admin"
        });
      } catch (error) {
        recordError(deps.timing, error, "dbReadMs");
        return res.status(500).json({ ok: false, error: error?.message || "Citirea istoricului a eșuat." });
      }
    }
  }

  /*
    Timed separately: this is the anonymous branch's FIRST await and it talks to
    Redis, not Postgres. Production showed 12-29s anonymous 500s with 100% of
    the duration unattributed, and a limiter stall would look exactly like a
    slow query without this boundary.
  */
  const rl = await timeStage(deps.timing, "rateLimitMs", () =>
    rateLimit(req, {
      namespace: "history-public",
      maxPerHour: Math.max(30, Math.min(Number(process.env.ANON_RATE_HISTORY_PUBLIC || 90), 300))
    })
  );
  if (!rl.ok) {
    if (rl.retryAfterSec) res.setHeader("Retry-After", String(rl.retryAfterSec));
    return res.status(429).json({ ok: false, error: "Prea multe cereri." });
  }

  try {
    const { stats } = await timeStage(deps.timing, "dbReadMs", () =>
      readAggregate(safeDays, safeLimit, deps.timing)
    );
    return res.status(200).json({
      ok: true,
      days: safeDays,
      stats,
      // Always empty by design: the public scope serves aggregate stats only,
      // which is why a healthy anonymous response is ~136 bytes with rows 0.
      items: [],
      scope: "aggregate_public"
    });
  } catch (error) {
    // Previously absent here, which is why every production anonymous 500
    // emitted a record with no errorKind at all.
    recordError(deps.timing, error, "dbReadMs");
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
  /*
    D8 mitigation, kept after the read-path fix as defence in depth.

    Scans 1 and 2 still read raw_payload (they need valueBet/valueEngine, which are
    not promoted), so their statement size still tracks document growth: ~353 KB/row
    in August against ~10 KB in May. Measured, 100 rows of raw_payload is 31 MB and
    2.2 s while 250 rows times out, so 100 is the largest page that demonstrably
    commits. Scan 3 no longer reads the document at all and is unaffected by this
    number — it is bounded by the projection, not by the chunk.
  */
  const scanChunkSize = Math.max(25, Math.min(Number(process.env.HISTORY_SYNC_SCAN_CHUNK || 100), 2000));
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
        // Only the four columns settlement can move, derived from the payload
        // written on the line above. recommended/logos are untouched by
        // attachCardMarketsToPayload, so writing them here would be a no-op that
        // could hide a future regression.
        ...deriveMutableHistoryListColumns(enrichedPayload),
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
      /*
        PROMOTED COLUMNS ONLY — never raw_payload. This scan covers every FINAL row
        in the window (472 in production), and at ~353 KB/row the document read is
        ~151 MB in one statement. Production reproduces the failure at a quarter of
        that: limit=250 with raw_payload → 10,441 ms → 57014 statement timeout,
        against 269 ms for this projection. The throw aborted the whole handler, so
        the only pass that can settle Corners / Shots / SOT / Cards never ran and
        those families stayed pending while score-derived ones went through scan 1.
      */
      const { data: page, error: cardErr } = await supabase
        .from(HISTORY_TABLE)
        .select(SETTLEMENT_SELECT)
        .gte("kickoff_at", cutoff)
        .in("match_status", ["FT", "AET", "PEN"])
        .order("kickoff_at", { ascending: false })
        .order("fixture_id", { ascending: false })
        .range(offset, offset + scanChunkSize - 1);
      if (cardErr) throw cardErr;
      if (!page?.length) break;
      // Columns → the shape the settlement helpers already expect, so they cannot
      // tell the difference. `probs`/`marketOdds` stay absent by design.
      finishedRows.push(...page.map(rehydrateSettlementRow));
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

        // D8b: "complete" also requires the top-level validation to be graded when
        // a recommended pick exists — settled markets alone used to skip rows whose
        // `validation` was never promoted, leaving them pending on every run.
        if (
          isSettlementRowComplete({
            picks,
            storedValidations: storedVals,
            validation: row.validation,
            missingFirstHalf: missingHt
          })
        )
          continue;

        let marketTotals = {
          cornersTotal: raw.marketResults?.cornersTotal ?? null,
          shotsOnTargetTotal: raw.marketResults?.shotsOnTargetTotal ?? null,
          shotsTotal: raw.marketResults?.shotsTotal ?? null,
          // Graded against since D8: resolveRecommendedValidation settles a Cards pick on
          // cardsTotal (null stays pending). cardsPoints is carried, never graded.
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
          // C2: compare the canonical totals, not the document shape. The rehydrated row
          // carries only observed totals while the enriched one carries every key (nulls
          // included), so a byte comparison re-wrote every still-pending row on every run.
          JSON.stringify(canonicalMarketTotals(raw.marketResults)) !==
            JSON.stringify(canonicalMarketTotals(enriched.marketResults));
        const validationChanged = String(validation) !== String(row.validation || "");
        if (!cardChanged && !validationChanged) continue;

        cardUpdates.push({
          fixture_id: Number(row.fixture_id),
          validation,
          /*
            NO raw_payload. This pass no longer reads the document, so it must not
            write it either: persisting `enriched` here would store a payload
            rebuilt from columns, silently truncating every key the projection does
            not carry (probs, marketOdds, valueEngine, momentum, ...).

            The columns are what the read paths use — the History list, the detail
            endpoint and the aggregate all read them, and none reads
            raw_payload.cardMarkets / cardMarketValidations. So the settlement
            result is fully published by the columns below.

            The derivation rule at the top of historyListColumns.js still holds,
            with `enriched` as the exact object being persisted-from: preservation
            is inside it, because rehydrateSettlementRow put the previous column
            values into marketResults and attachCardMarketsToPayload carries them
            forward when no new totals arrived. The carrier changed from the
            document to the columns; the rule did not.

            Consequence, stated plainly: raw_payload.cardMarketValidations now goes
            stale on newly settled rows. That is acceptable only because the columns
            are authoritative for every reader — it is not a licence for a future
            reader to prefer the payload copy.
          */
          ...deriveMutableHistoryListColumns(enriched),
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
async function handlerImpl(req, res, timing) {
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
  return handleHistoryRead(req, res, { timing });
}

/**
 * One buffered metrics document per invocation: every recordObservation /
 * bumpCounter inside this handler is applied to a single read and written back
 * once, instead of a GET+SET each. Wrapping is required HERE because this is
 * the invocation boundary — requestMonitor only covers predict and fixtures,
 * and the warm/cron paths that issue the most cache telemetry never reach it.
 */
/**
 * Observes rows and final bytes without re-serialising anything.
 *
 * `res.json` already stringifies the body; measuring it again solely for
 * telemetry would mean a second pass over a payload that reaches 7.7MB on the
 * full `mine=1` path. So the row count comes from the array that is already in
 * hand, and the size comes from the Content-Length the runtime has already
 * computed — absent that header, bytes stay UNKNOWN rather than guessed.
 */
function observeResponse(res, timing) {
  const original = typeof res?.json === "function" ? res.json.bind(res) : null;
  if (!original) return;
  res.json = (body) => {
    recordRows(timing, Array.isArray(body?.items) ? body.items.length : null);
    const startedAt = Date.now();
    try {
      return original(body);
    } finally {
      markStage(timing, "responseMs", Date.now() - startedAt);
      recordFinalBytes(timing, readContentLength(res));
    }
  };
}

function readContentLength(res) {
  try {
    const raw = typeof res?.getHeader === "function" ? res.getHeader("content-length") : null;
    const n = Number(Array.isArray(raw) ? raw[0] : raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * One buffered metrics document per invocation, and one timing record.
 *
 * The wrapper is the only place that can cover every branch — special-bets,
 * sync, closing, performance, detail and the read views all return from
 * handlerImpl — so total duration, status, mode, rows and bytes are captured
 * once here rather than duplicated into each path.
 */
export default async function handler(req, res) {
  const timing = createHistoryTiming(req?.query || {}, req?.method);
  const startedAt = Date.now();
  observeResponse(res, timing);
  // D4: bind a transport collector to the async context so the module-cached
  // Supabase client — which has no idea which request it is serving — can
  // attribute its HTTP phases back to this invocation.
  const transport = createTransportCollector(HISTORY_ROUTE);
  attachTransport(timing, transport);
  try {
    return await withTransportScope(transport, () =>
      withObservationScope(() => handlerImpl(req, res, timing))
    );
  } catch (error) {
    recordError(timing, error);
    throw error;
  } finally {
    emitHistoryTiming(timing, { status: res?.statusCode, durationMs: Date.now() - startedAt });
  }
}
