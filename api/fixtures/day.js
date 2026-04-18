// api/fixtures/day.js
import { getRequester } from "../../server-utils/authAdmin.js";
import { handleClaimBootstrapAdmin } from "../../server-utils/claimBootstrapAdmin.js";
import { getWithCache, getApiUsage, getApiUsageHistory } from '../../server-utils/fetcher.js';
import { assertSupabaseConfigured, getSupabaseAdmin } from "../../server-utils/supabaseAdmin.js";
import {
  isWarmPredictQuotaExempt,
  peekWarmPredictUsage,
  resolveAuthenticatedUsageContext
} from "../../server-utils/userDailyWarmPredictUsage.js";

export default async function handler(req, res) {
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

    // 1. Aducem meciurile (dacă nu sunt în cache, fetcher.js se duce la API și FURA HEADERELE)
    const fixturesReq = await getWithCache('/fixtures', { date }, 21600);
    const allFixtures = fixturesReq.data?.response || fixturesReq.data || [];

    // 2. Citim consumul proaspăt salvat în memoria serverului nostru
    const usage = await getApiUsage();

    // 3. Grupăm meciurile pe Ligi
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