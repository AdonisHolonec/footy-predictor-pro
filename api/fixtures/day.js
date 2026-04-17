// api/fixtures/day.js
import { handleClaimBootstrapAdmin } from "../../server-utils/claimBootstrapAdmin.js";
import { getWithCache, getApiUsage, getApiUsageHistory } from '../../server-utils/fetcher.js';
import { peekWarmPredictUsage, resolveAuthenticatedUsageContext } from "../../server-utils/userDailyWarmPredictUsage.js";

export default async function handler(req, res) {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const usageOnly = String(req.query.usageOnly || "") === "1";
  const usageDays = Math.max(1, Math.min(Number(req.query.usageDays) || 7, 60));
  const syncBootstrapAdmin = String(req.query.syncBootstrapAdmin || "") === "1";
  const warmPredictUsage = String(req.query.warmPredictUsage || "") === "1";

  try {
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