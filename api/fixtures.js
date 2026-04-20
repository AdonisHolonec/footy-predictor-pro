// Unified fixtures endpoint (consolidează fostele /api/fixtures/day, /api/fixtures/live-scores, /api/get-xg).
//
// Dispatch prin ?view=:
//   /api/fixtures                   → day (default, backward compat)
//   /api/fixtures?view=day          → day listing + usage
//   /api/fixtures?view=day&usageOnly=1   → usage only
//   /api/fixtures?view=day&syncBootstrapAdmin=1
//   /api/fixtures?view=day&warmPredictUsage=1
//   /api/fixtures?view=day&gdprExport=1
//   /api/fixtures?view=live&ids=123,456  → live scores
//   /api/fixtures?view=xg&fixtureId=123  → synthetic xG per fixture
//
// Păstrează neschimbate toate comportamentele fostelor fișiere.
import { getRequester } from "../server-utils/authAdmin.js";
import { handleClaimBootstrapAdmin } from "../server-utils/claimBootstrapAdmin.js";
import { getWithCache, getApiUsage, getApiUsageHistory } from "../server-utils/fetcher.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import {
  isWarmPredictQuotaExempt,
  peekWarmPredictUsage,
  resolveAuthenticatedUsageContext
} from "../server-utils/userDailyWarmPredictUsage.js";
import { calculateSyntheticXG } from "../server-utils/advancedMath.js";

// -------------------- Shared / default (day) handler --------------------

async function handleDay(req, res) {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const usageOnly = String(req.query.usageOnly || "") === "1";
  const usageDays = Math.max(1, Math.min(Number(req.query.usageDays) || 7, 60));
  const syncBootstrapAdmin = String(req.query.syncBootstrapAdmin || "") === "1";
  const warmPredictUsage = String(req.query.warmPredictUsage || "") === "1";
  const gdprExport = String(req.query.gdprExport || "") === "1";

  try {
    if (gdprExport) {
      if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "Method not allowed." });
      }
      const requester = await getRequester(req);
      if (!requester.ok) {
        return res.status(requester.status).json({ ok: false, error: requester.error });
      }
      const config = assertSupabaseConfigured();
      if (!config.ok) {
        return res.status(503).json({ ok: false, error: config.error });
      }
      const sb = getSupabaseAdmin();
      if (!sb) {
        return res.status(503).json({ ok: false, error: "Supabase admin unavailable." });
      }
      const uid = requester.user.id;
      const { data: profile, error: profileError } = await sb
        .from("profiles")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();
      if (profileError) {
        return res.status(500).json({ ok: false, error: profileError.message });
      }
      const authRes = await sb.auth.admin.getUserById(uid);
      if (authRes.error || !authRes.data?.user) {
        return res.status(500).json({
          ok: false,
          error: authRes.error?.message || "Unable to load auth user."
        });
      }
      let notificationDispatchLog = [];
      const logResult = await sb
        .from("notification_dispatch_log")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (!logResult.error) {
        notificationDispatchLog = logResult.data || [];
      } else {
        console.error("[gdprExport] notification_dispatch_log:", logResult.error.message);
      }
      const au = authRes.data.user;
      return res.status(200).json({
        ok: true,
        legalNotice:
          "Export pentru dreptul de acces și portabilitate (GDPR). Nu constituie consultanță juridică.",
        exportGeneratedAt: new Date().toISOString(),
        profile: profile ?? null,
        account: {
          id: au.id,
          email: au.email,
          phone: au.phone,
          created_at: au.created_at,
          last_sign_in_at: au.last_sign_in_at,
          confirmed_at: au.confirmed_at,
          user_metadata: au.user_metadata ?? {}
        },
        notificationDispatchLog,
        dataScopeNote:
          "Tabelul global predictions_history nu leagă predicții de user_id. Datele din localStorage din browser nu sunt incluse."
      });
    }

    if (syncBootstrapAdmin) {
      const result = await handleClaimBootstrapAdmin(req);
      return res.status(result.status).json(result.body);
    }

    if (warmPredictUsage) {
      const ctx = await resolveAuthenticatedUsageContext(req);
      if (ctx.error) return res.status(ctx.error.status).json(ctx.error.body);
      if (ctx.anonymous) {
        return res.status(401).json({ ok: false, error: "Autentificare necesara pentru contoarele zilnice." });
      }
      if (await isWarmPredictQuotaExempt(ctx.userId, ctx.userEmail)) {
        return res.status(200).json({
          ok: true,
          warmPredictUsage: {
            usage_day: ctx.usageDay,
            warm_count: 0,
            predict_count: 0,
            quota_exempt: true
          }
        });
      }
      const peek = await peekWarmPredictUsage(ctx.userId, ctx.usageDay);
      return res.status(200).json({
        ok: true,
        warmPredictUsage: {
          usage_day: ctx.usageDay,
          warm_count: peek.warm,
          predict_count: peek.predict
        }
      });
    }

    if (usageOnly) {
      const today = await getApiUsage();
      const yesterday = await getApiUsage(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
      const history = await getApiUsageHistory(usageDays);
      return res.status(200).json({
        ok: true,
        usage: today,
        yesterday,
        history
      });
    }

    const fixturesReq = await getWithCache("/fixtures", { date }, 21600);
    const allFixtures = fixturesReq.data?.response || fixturesReq.data || [];

    const usage = await getApiUsage();

    const leaguesMap = new Map();
    for (const fx of allFixtures) {
      const lId = fx.league?.id;
      if (lId) {
        if (!leaguesMap.has(lId)) {
          leaguesMap.set(lId, {
            id: lId,
            name: fx.league?.name || "Unknown",
            country: fx.league?.country || "Unknown",
            matches: 0
          });
        }
        leaguesMap.get(lId).matches += 1;
      }
    }

    const leagues = Array.from(leaguesMap.values());

    return res.status(200).json({ ok: true, date, totalFixtures: allFixtures.length, leagues, usage });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Eroare internă." });
  }
}

// -------------------- Live-scores handler --------------------

const LIVE_SCORES_CACHE_TTL_SEC = 30;

function parseIds(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  const parts = s.split(/[,]+/).map((x) => x.trim()).filter(Boolean);
  const nums = [];
  for (const p of parts) {
    const n = Number(p);
    if (Number.isFinite(n) && n > 0) nums.push(n);
  }
  return [...new Set(nums)].slice(0, 24);
}

async function handleLive(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }
  const ids = parseIds(req.query.ids);
  if (!ids.length) {
    return res.status(400).json({ ok: false, error: "Parametrul ids lipsește sau e invalid (ex: ?ids=123,456)." });
  }
  const idsParam = ids.join("-");
  try {
    const r = await getWithCache("/fixtures", { ids: idsParam }, LIVE_SCORES_CACHE_TTL_SEC);
    if (!r.ok) {
      return res.status(502).json({ ok: false, error: typeof r.error === "string" ? r.error : "Upstream fixtures error." });
    }
    const rows = r.data?.response || [];
    const fixtures = rows.map((fx) => ({
      id: fx?.fixture?.id,
      status: fx?.fixture?.status?.short || "",
      score: {
        home: typeof fx?.goals?.home === "number" ? fx.goals.home : null,
        away: typeof fx?.goals?.away === "number" ? fx.goals.away : null
      }
    }));
    return res.status(200).json({
      ok: true,
      fixtures,
      cacheTtlSec: LIVE_SCORES_CACHE_TTL_SEC,
      fromCache: Boolean(r.fromCache)
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Eroare internă." });
  }
}

// -------------------- xG handler --------------------

async function handleXg(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { fixtureId } = req.query;
  if (!fixtureId) {
    return res.status(400).json({ error: "fixtureId is missing" });
  }

  try {
    // `getWithCache` foloseşte Vercel KV + auto-detectează providerul (apisports direct sau RapidAPI)
    // şi partajează cache-ul cu restul pipeline-ului (nu mai avem cache separat pe xG).
    const statsReq = await getWithCache("/fixtures/statistics", { fixture: fixtureId }, 86400);
    if (!statsReq.ok) {
      return res.status(502).json({
        error: "Upstream fixtures/statistics error",
        message: typeof statsReq.error === "string" ? statsReq.error : JSON.stringify(statsReq.error)
      });
    }
    const result = statsReq.data;
    if (!result?.response || result.response.length < 2) {
      return res.status(404).json({ error: "Statistics not available yet for this match" });
    }

    const homeStats = result.response[0].statistics;
    const awayStats = result.response[1].statistics;
    const xGHome = calculateSyntheticXG(homeStats);
    const xGAway = calculateSyntheticXG(awayStats);

    return res.status(200).json({
      fixtureId,
      homeXG: xGHome,
      awayXG: xGAway,
      fromCache: Boolean(statsReq.fromCache),
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("🔴 xG handler error:", error.message);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
}

// -------------------- Dispatcher --------------------

export default async function handler(req, res) {
  const view = String(req.query.view || "").toLowerCase();
  if (view === "live") return handleLive(req, res);
  if (view === "xg") return handleXg(req, res);
  return handleDay(req, res);
}
