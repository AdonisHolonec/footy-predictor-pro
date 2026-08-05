import { isAuthorizedCronOrInternalRequest } from "../server-utils/cronRequestAuth.js";
import { assertAdmin } from "../server-utils/authAdmin.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import { extractBenchmarkEvents } from "../server-utils/backtest/benchmarkEvents.js";
import { computeAgreementRate, computeHeadToHead, computeOurPerformance } from "../server-utils/backtest/benchmarkMetrics.js";

/**
 * Admin Benchmark Dashboard read API — dispatch shape mirrors api/backtest.js's
 * view= convention. Admin/cron-only for every view; this comparison data
 * never needs a public track (unlike api/backtest.js's public-track).
 *
 *   GET /api/predictionBenchmark?view=summary&days=45
 *   GET /api/predictionBenchmark?view=by-market&days=45
 *   GET /api/predictionBenchmark?view=head-to-head&days=45
 *   GET /api/predictionBenchmark?view=agreement-rate&days=45
 */

async function isAuthorizedForBenchmark(req) {
  if (isAuthorizedCronOrInternalRequest(req)) return true;
  const admin = await assertAdmin(req);
  return admin.ok;
}

async function loadBenchmarkEvents(req) {
  const config = assertSupabaseConfigured();
  if (!config.ok) return { ok: false, error: config.error };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, error: "Supabase client unavailable" };

  const days = Math.max(1, Math.min(Number(req.query.days || 45), 365));
  const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("prediction_benchmarks")
    .select(
      "fixture_id, league_id, kickoff_at, our_pick, our_family, our_confidence, our_odd, consensus, agree, confidence_delta, our_result, api_result"
    )
    .gte("kickoff_at", cutoffIso)
    .order("kickoff_at", { ascending: false })
    .limit(10000);

  if (error) return { ok: false, error: error.message };
  return { ok: true, events: extractBenchmarkEvents(data || []), days };
}

async function handleSummary(req, res) {
  const loaded = await loadBenchmarkEvents(req);
  if (!loaded.ok) return res.status(500).json({ ok: false, error: loaded.error });
  const performance = computeOurPerformance(loaded.events);
  const agreement = computeAgreementRate(loaded.events);
  const headToHead = computeHeadToHead(loaded.events);
  return res.status(200).json({ ok: true, days: loaded.days, performance, agreement, headToHead });
}

async function handleByMarket(req, res) {
  const loaded = await loadBenchmarkEvents(req);
  if (!loaded.ok) return res.status(500).json({ ok: false, error: loaded.error });
  const performance = computeOurPerformance(loaded.events);
  const agreement = computeAgreementRate(loaded.events);
  return res.status(200).json({
    ok: true,
    days: loaded.days,
    byMarketFamily: performance.byMarket,
    agreementByMarketFamily: agreement.byMarketFamily
  });
}

async function handleHeadToHead(req, res) {
  const loaded = await loadBenchmarkEvents(req);
  if (!loaded.ok) return res.status(500).json({ ok: false, error: loaded.error });
  return res.status(200).json({ ok: true, days: loaded.days, ...computeHeadToHead(loaded.events) });
}

async function handleAgreementRate(req, res) {
  const loaded = await loadBenchmarkEvents(req);
  if (!loaded.ok) return res.status(500).json({ ok: false, error: loaded.error });
  return res.status(200).json({ ok: true, days: loaded.days, ...computeAgreementRate(loaded.events) });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }
  if (!(await isAuthorizedForBenchmark(req))) {
    return res.status(401).json({ ok: false, error: "Unauthorized. Admin or cron authentication required." });
  }

  const view = String(req.query.view || "").toLowerCase();
  if (view === "summary") return handleSummary(req, res);
  if (view === "by-market" || view === "bymarket") return handleByMarket(req, res);
  if (view === "head-to-head" || view === "headtohead") return handleHeadToHead(req, res);
  if (view === "agreement-rate" || view === "agreementrate") return handleAgreementRate(req, res);
  return res.status(400).json({
    ok: false,
    error: "Missing or invalid view parameter. Use view=summary, by-market, head-to-head, or agreement-rate."
  });
}
