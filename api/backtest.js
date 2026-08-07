import { createClient } from "@supabase/supabase-js";
import { isAuthorizedCronOrInternalRequest } from "../server-utils/cronRequestAuth.js";
import { assertAdmin } from "../server-utils/authAdmin.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import {
  actual1x2FromScore,
  brier1x2,
  bucketConfidence,
  expectedCalibrationError,
  logLoss1x2
} from "../server-utils/probabilityMetrics.js";
import {
  betsToCsv,
  buildBacktestReport,
  computeBacktestMetrics,
  extractBetEvent,
  parseFilters,
  resolveWindowDays,
  seasonStartIso,
  selectionClosingOdd
} from "../server-utils/backtest/BacktestAnalytics.js";
import { buildClvReport, computeClvPct } from "../server-utils/backtest/ClvReport.js";
import { resolvePublishedTip } from "../server-utils/backtest/TipEvent.js";
import { extractBenchmarkEvents } from "../server-utils/backtest/benchmarkEvents.js";
import {
  computeAgreementRate,
  computeHeadToHead,
  computeOurPerformance
} from "../server-utils/backtest/benchmarkMetrics.js";
import { loadMetaDataHealth } from "../server-utils/metaLearning/runMetaLearningRefresh.js";
import { evaluateTipClvReport } from "../server-utils/validation/TipClvReport.js";
import { checkAnonymousRateLimit } from "../server-utils/anonymousRateLimit.js";
import { buildHealthBundle, generateDailyReport } from "../server-utils/observability/healthBundle.js";
import { getDailyReport, listDailyReports } from "../server-utils/observability/metricsStore.js";
import { logInfo } from "../server-utils/observability/logger.js";
import { runModelLab } from "../server-utils/modelLab/ModelLab.js";
import {
  runAutoSelection,
  runAndPromote,
  getActiveModel
} from "../server-utils/modelLab/BlendRecipeSelection.js";

/**
 * Auto Model Selection — every model competes over 30/90/365-day windows.
 * GET  /api/backtest?view=model-select            → current active model + latest competition
 * GET  /api/backtest?view=model-select&run=1      → run + promote (cron/admin auth)
 */
async function handleModelSelect(req, res) {
  const config = assertSupabaseConfigured();
  if (!config.ok) return res.status(500).json({ ok: false, error: config.error || "Supabase nu este configurat" });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: "Clientul Supabase nu este disponibil" });

  const doRun = String(req.query.run || "") === "1" || req.method === "POST";
  if (doRun && !(await isAuthorizedForMetrics(req))) {
    return res.status(401).json({ ok: false, error: "Neautorizat pentru promovare model" });
  }

  const cutoffIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from("predictions_history")
      .select("fixture_id, league_id, kickoff_at, score_home, score_away, odds_home, odds_draw, odds_away, luck_hxg, luck_axg, raw_payload")
      .gte("kickoff_at", cutoffIso)
      .in("validation", ["win", "loss"])
      .order("kickoff_at", { ascending: true })
      .limit(12000);
    if (error) throw error;

    if (doRun) {
      const result = await runAndPromote(data || []);
      return res.status(200).json({ ok: true, ran: true, ...result });
    }
    const selection = runAutoSelection(data || []);
    const active = await getActiveModel();
    return res.status(200).json({ ok: true, ran: false, active, ...selection });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Auto model selection a eșuat" });
  }
}

/**
 * Model Laboratory — evaluate multiple prediction models over settled history.
 * GET /api/backtest?view=model-lab&days=45
 */
async function handleModelLab(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
  }
  const config = assertSupabaseConfigured();
  if (!config.ok) return res.status(500).json({ ok: false, error: config.error || "Supabase nu este configurat" });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: "Clientul Supabase nu este disponibil" });

  const days = Math.max(7, Math.min(Number(req.query.days || 90), 365));
  const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabase
      .from("predictions_history")
      .select("fixture_id, league_id, kickoff_at, score_home, score_away, odds_home, odds_draw, odds_away, luck_hxg, luck_axg, raw_payload")
      .gte("kickoff_at", cutoffIso)
      .in("validation", ["win", "loss"])
      .order("kickoff_at", { ascending: true })
      .limit(6000);
    if (error) throw error;

    const lab = runModelLab(data || []);
    return res.status(200).json({ ok: true, days, cutoff: cutoffIso, ...lab });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Model lab a eșuat" });
  }
}

/**
 * Enterprise Monitoring — folded into backtest to stay within Hobby serverless limits.
 * GET /api/backtest?view=health
 * GET /api/backtest?view=health&sub=live
 * GET /api/backtest?view=health&sub=report
 */
async function handleHealth(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
  }

  const sub = String(req.query.sub || req.query.healthView || "dashboard").toLowerCase();
  const days = Math.max(1, Math.min(Number(req.query.days || 7), 30));

  try {
    if (sub === "live") {
      const bundle = await buildHealthBundle({ historyDays: 1 });
      return res.status(bundle.ok ? 200 : 503).json({
        ok: bundle.ok,
        status: bundle.status,
        severity: bundle.severity,
        generatedAt: bundle.generatedAt
      });
    }

    if (sub === "report") {
      if (String(req.query.generate || "") === "1" || req.method === "POST") {
        const report = await generateDailyReport(req.query.date || undefined);
        return res.status(200).json({ ok: true, report });
      }
      const latest = await getDailyReport(req.query.date || undefined);
      const recent = await listDailyReports(days);
      return res.status(200).json({ ok: true, report: latest, recent });
    }

    const bundle = await buildHealthBundle({ historyDays: days });
    logInfo("health.dashboard", { status: bundle.status, alerts: bundle.alerts.length });
    return res.status(200).json({ ok: true, ...bundle });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Health check failed" });
  }
}

async function isAuthorizedForMetrics(req) {
  if (isAuthorizedCronOrInternalRequest(req)) return true;
  const admin = await assertAdmin(req);
  return admin.ok;
}

async function handleKpi(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
  }

  const config = assertSupabaseConfigured();
  if (!config.ok) {
    return res.status(500).json({ ok: false, error: config.error || "Supabase nu este configurat" });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ ok: false, error: "Clientul Supabase nu este disponibil" });
  }

  const days = Math.max(7, Math.min(Number(req.query.days || 45), 365));
  try {
    const { data, error } = await supabase
      .from("backtest_snapshots")
      .select(
        "snapshot_date, window_days, settled_bets, wins, losses, hit_rate, roi, max_drawdown, pnl_units, total_stake_units, avg_ev"
      )
      .eq("window_days", days)
      .order("snapshot_date", { ascending: false })
      .limit(7);

    if (error) throw error;
    const rows = data || [];
    if (rows.length === 0) {
      return res.status(200).json({
        ok: true,
        days,
        latest: null,
        trend: []
      });
    }

    const latest = rows[0];
    const prev = rows[1] || null;
    const trend = rows
      .slice()
      .reverse()
      .map((r) => ({
        date: r.snapshot_date,
        hitRate: Number(r.hit_rate || 0),
        roi: Number(r.roi || 0),
        drawdown: Number(r.max_drawdown || 0),
        settled: Number(r.settled_bets || 0),
        pnlUnits: Number(r.pnl_units || 0)
      }));

    const settled = Number(latest.settled_bets || 0);
    const pnlUnits = Number(latest.pnl_units || 0);
    const totalStake = Number(latest.total_stake_units || 0);
    const roi = Number(latest.roi || 0);

    return res.status(200).json({
      ok: true,
      days,
      latest: {
        date: latest.snapshot_date,
        settled,
        wins: Number(latest.wins || 0),
        losses: Number(latest.losses || 0),
        hitRate: Number(latest.hit_rate || 0),
        roi,
        yield: roi,
        drawdown: Number(latest.max_drawdown || 0),
        pnlUnits,
        profit: pnlUnits > 0 ? pnlUnits : 0,
        loss: pnlUnits < 0 ? Math.abs(pnlUnits) : 0,
        totalStake,
        expectedValue: Number(latest.avg_ev || 0)
      },
      delta: prev
        ? {
            hitRate: Number((Number(latest.hit_rate || 0) - Number(prev.hit_rate || 0)).toFixed(3)),
            roi: Number((Number(latest.roi || 0) - Number(prev.roi || 0)).toFixed(3)),
            drawdown: Number((Number(latest.max_drawdown || 0) - Number(prev.max_drawdown || 0)).toFixed(3))
          }
        : null,
      trend
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Citirea KPI a eșuat" });
  }
}

async function handleAnalytics(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
  }

  const config = assertSupabaseConfigured();
  if (!config.ok) {
    return res.status(500).json({ ok: false, error: config.error || "Supabase nu este configurat" });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ ok: false, error: "Clientul Supabase nu este disponibil" });
  }

  const filters = parseFilters(req.query || {});
  const format = String(req.query.format || "json").toLowerCase();
  const includeBets = String(req.query.includeBets || "1") !== "0";

  let cutoffIso;
  if (filters.period === "season" || filters.days == null) {
    cutoffIso = seasonStartIso();
  } else {
    const days = resolveWindowDays(filters.period, filters.days) || 45;
    cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  try {
    const { data, error } = await supabase
      .from("predictions_history")
      .select(
        "fixture_id, league_id, league_name, home_team, away_team, kickoff_at, validation, value_bet_validation, odds_home, odds_draw, odds_away, closing_odds_home, closing_odds_draw, closing_odds_away, score_home, score_away, recommended_pick, recommended_confidence, raw_payload"
      )
      .gte("kickoff_at", cutoffIso)
      .or("validation.in.(win,loss),value_bet_validation.in.(win,loss)")
      .order("kickoff_at", { ascending: true })
      .limit(8000);

    if (error) throw error;

    const report = buildBacktestReport(data || [], req.query || {});
    const payload = {
      ok: true,
      track: filters.track || "value",
      cutoff: cutoffIso,
      filters: report.filters,
      metrics: report.metrics,
      dashboard: report.dashboard,
      facets: report.facets,
      totalsUnfiltered: report.totalsUnfiltered,
      // Keep chart series compact; full equity curve can be long.
      series: {
        equity: report.metrics.equityCurve,
        kelly: report.metrics.kellyCurve,
        returnsHistogram: report.metrics.returnsHistogram,
        daily: report.metrics.daily,
        byMarket: report.metrics.byMarket,
        byLeague: report.metrics.byLeague.slice(0, 12),
        bySide: report.metrics.bySide
      },
      bets: includeBets ? report.bets : undefined
    };

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="backtest-${filters.period || "custom"}.csv"`);
      return res.status(200).send(betsToCsv(report.bets));
    }

    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Analiza backtest a eșuat" });
  }
}

async function handleSnapshot(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
  }
  if (!isAuthorizedCronOrInternalRequest(req)) {
    return res.status(401).json({ ok: false, error: "Neautorizat" });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const days = Math.max(7, Math.min(Number(req.query.days || process.env.BACKTEST_DAYS || 45), 365));
  if (!url || !key) {
    return res.status(500).json({ ok: false, error: "Lipsesc variabilele SUPABASE din mediu" });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("predictions_history")
      .select(
        "kickoff_at, validation, value_bet_validation, odds_home, odds_draw, odds_away, closing_odds_home, closing_odds_draw, closing_odds_away, score_home, score_away, recommended_pick, raw_payload"
      )
      .gte("kickoff_at", cutoff)
      .or("validation.in.(win,loss),value_bet_validation.in.(win,loss)")
      .order("kickoff_at", { ascending: true })
      .limit(5000);

    if (error) throw error;
    const events = (data || []).map(extractBetEvent).filter(Boolean);
    const metrics = computeBacktestMetrics(events);
    const snapshotDate = new Date().toISOString().slice(0, 10);

    const { error: upsertError } = await supabase.from("backtest_snapshots").upsert(
      {
        snapshot_date: snapshotDate,
        window_days: days,
        settled_bets: metrics.settled,
        wins: metrics.wins,
        losses: metrics.losses,
        hit_rate: Number(metrics.hitRate.toFixed(4)),
        roi: Number(metrics.roi.toFixed(4)),
        pnl_units: Number(metrics.pnlUnits.toFixed(6)),
        total_stake_units: Number(metrics.totalStake.toFixed(6)),
        avg_ev: Number(metrics.expectedValue.toFixed(4)),
        max_drawdown: Number(metrics.maxDrawdown.toFixed(6)),
        avg_clv: metrics.clvAvailable ? Number(Number(metrics.clv).toFixed(4)) : null,
        clv_count: Number(metrics.clvCount || 0),
        clv_beat_rate: metrics.clvBeatRate != null ? Number(Number(metrics.clvBeatRate).toFixed(4)) : null
      },
      { onConflict: "snapshot_date,window_days" }
    );

    if (upsertError) throw upsertError;

    return res.status(200).json({
      ok: true,
      snapshotDate,
      days,
      stats: {
        settled: metrics.settled,
        wins: metrics.wins,
        losses: metrics.losses,
        hitRate: metrics.hitRate,
        roi: metrics.roi,
        yield: metrics.yield,
        profit: metrics.profit,
        loss: metrics.loss,
        avgEv: metrics.expectedValue,
        maxDrawdown: metrics.maxDrawdown,
        averageOdds: metrics.averageOdds,
        averageConfidence: metrics.averageConfidence,
        winningStreak: metrics.winningStreak,
        losingStreak: metrics.losingStreak,
        clv: metrics.clv,
        clvAvailable: metrics.clvAvailable,
        clvCount: metrics.clvCount,
        clvBeatRate: metrics.clvBeatRate
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Snapshot-ul a eșuat" });
  }
}

async function handleMetrics(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
  }
  if (!(await isAuthorizedForMetrics(req))) {
    return res.status(401).json({ ok: false, error: "Neautorizat" });
  }

  const config = assertSupabaseConfigured();
  if (!config.ok) {
    return res.status(500).json({ ok: false, error: config.error });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ ok: false, error: "Supabase nu este disponibil" });
  }

  const days = Math.max(7, Math.min(Number(req.query.days || 45), 365));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabase
      .from("predictions_history")
      .select("league_id, league_name, score_home, score_away, match_status, raw_payload, model_version, recommended_confidence, recommended_pick")
      .gte("kickoff_at", cutoff)
      .limit(8000);

    if (error) throw error;
    const rows = (data || []).filter((row) => {
      const fin = ["FT", "AET", "PEN"].includes(String(row.match_status || ""));
      return fin && row.score_home != null && row.score_away != null;
    });

    let sumBrier = 0;
    let sumLogLoss = 0;
    let nProb = 0;

    const byMethod = new Map();
    const byLeague = new Map();
    const byDq = new Map();
    const byVersion = new Map();
    const calib = new Map();

    for (const row of rows) {
      const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
      const actual = actual1x2FromScore(row.score_home, row.score_away);
      if (!actual) continue;

      const ev = payload.evaluation?.modelProbs1x2Pct;
      const probs = payload.probs;
      const p1p = (ev?.p1 ?? probs?.p1 ?? 0) / 100;
      const pXp = (ev?.pX ?? probs?.pX ?? 0) / 100;
      const p2p = (ev?.p2 ?? probs?.p2 ?? 0) / 100;
      const s = p1p + pXp + p2p;
      if (s < 0.1) continue;
      const n1 = p1p / s;
      const nX = pXp / s;
      const n2 = p2p / s;

      const b = brier1x2(n1, nX, n2, actual);
      const ll = logLoss1x2(n1, nX, n2, actual);
      sumBrier += b;
      sumLogLoss += ll;
      nProb += 1;

      const method = String(payload.modelMeta?.method || "unknown");
      const lid = Number(row.league_id) || 0;
      const dq = Number(payload.modelMeta?.dataQuality ?? 0);
      const dqBucket = dq >= 0.75 ? "high" : dq >= 0.55 ? "mid" : "low";
      const ver = String(row.model_version || payload.modelVersion || "unknown");
      const buck = bucketConfidence(Number(row.recommended_confidence ?? payload.recommended?.confidence ?? 0));

      const bump = (map, key, delta) => {
        if (!map.has(key)) map.set(key, { brier: 0, logLoss: 0, n: 0 });
        const o = map.get(key);
        o.brier += delta.b;
        o.logLoss += delta.ll;
        o.n += 1;
      };

      const delta = { b: b, ll: ll };
      bump(byMethod, method, delta);
      bump(byLeague, String(lid), delta);
      bump(byDq, dqBucket, delta);
      bump(byVersion, ver, delta);

      const pick = String(payload.evaluation?.recommended1x2 || payload.predictions?.oneXtwo || "").trim();
      if (["1", "X", "2"].includes(pick)) {
        const hit = pick === actual ? 1 : 0;
        if (!calib.has(buck)) calib.set(buck, { sumConf: 0, sumHit: 0, n: 0 });
        const c = calib.get(buck);
        c.sumConf += Number(row.recommended_confidence ?? 0);
        c.sumHit += hit;
        c.n += 1;
      }
    }

    const serialize = (map) =>
      Array.from(map.entries()).map(([k, v]) => ({
        key: k,
        n: v.n,
        brier: v.n ? Number((v.brier / v.n).toFixed(5)) : 0,
        logLoss: v.n ? Number((v.logLoss / v.n).toFixed(5)) : 0
      }));

    const calibration = Array.from(calib.entries()).map(([k, v]) => ({
      bucket: k,
      n: v.n,
      avgConfidence: v.n ? Number((v.sumConf / v.n).toFixed(2)) : 0,
      accuracy1x2: v.n ? Number(((v.sumHit / v.n) * 100).toFixed(2)) : 0
    }));

    return res.status(200).json({
      ok: true,
      days,
      nRows: rows.length,
      nProb,
      brier1x2: nProb ? Number((sumBrier / nProb).toFixed(5)) : null,
      logLoss1x2: nProb ? Number((sumLogLoss / nProb).toFixed(5)) : null,
      ece1x2: expectedCalibrationError(calibration),
      byMethod: serialize(byMethod),
      byLeague: serialize(byLeague),
      byDataQuality: serialize(byDq),
      byModelVersion: serialize(byVersion),
      calibration1x2: calibration
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Calculul metricilor a eșuat" });
  }
}

/**
 * Public verified track record — no auth.
 * GET /api/backtest?view=public-track&days=45
 * Sanitized aggregates only (no bet rows, no CSV, no ops).
 */
async function handlePublicTrack(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
  }

  const config = assertSupabaseConfigured();
  if (!config.ok) {
    return res.status(500).json({ ok: false, error: config.error || "Supabase nu este configurat" });
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ ok: false, error: "Clientul Supabase nu este disponibil" });
  }

  const allowedDays = new Set([30, 45, 90]);
  const daysRaw = Number(req.query.days || 45);
  const days = allowedDays.has(daysRaw) ? daysRaw : 45;

  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");

  try {
    // Prefer pre-aggregated snapshots (cron).
    const { data: snapRows, error: snapError } = await supabase
      .from("backtest_snapshots")
      .select(
        "snapshot_date, window_days, settled_bets, wins, losses, hit_rate, roi, max_drawdown, pnl_units, total_stake_units, avg_ev, avg_clv, clv_count, clv_beat_rate"
      )
      .eq("window_days", days)
      .order("snapshot_date", { ascending: false })
      .limit(14);

    if (snapError) throw snapError;
    const rows = snapRows || [];
    const latestSnap = rows[0] || null;
    const snapSettled = latestSnap ? Number(latestSnap.settled_bets || 0) : 0;

    if (latestSnap && snapSettled > 0) {
      const clvCount = Number(latestSnap.clv_count || 0);
      const trend = rows
        .slice()
        .reverse()
        .map((r) => ({
          date: r.snapshot_date,
          hitRate: Number(r.hit_rate || 0),
          roi: Number(r.roi || 0),
          settled: Number(r.settled_bets || 0),
          pnlUnits: Number(r.pnl_units || 0),
          clv: r.avg_clv != null ? Number(r.avg_clv) : null
        }));

      return res.status(200).json({
        ok: true,
        public: true,
        source: "snapshots",
        days,
        asOf: latestSnap.snapshot_date,
        summary: {
          settled: snapSettled,
          wins: Number(latestSnap.wins || 0),
          losses: Number(latestSnap.losses || 0),
          hitRate: Number(latestSnap.hit_rate || 0),
          roi: Number(latestSnap.roi || 0),
          pnlUnits: Number(latestSnap.pnl_units || 0),
          drawdown: Number(latestSnap.max_drawdown || 0),
          totalStake: Number(latestSnap.total_stake_units || 0),
          expectedValue: Number(latestSnap.avg_ev || 0),
          clv: clvCount > 0 && latestSnap.avg_clv != null ? Number(latestSnap.avg_clv) : null,
          clvAvailable: clvCount > 0,
          clvCount,
          clvBeatRate: latestSnap.clv_beat_rate != null ? Number(latestSnap.clv_beat_rate) : null
        },
        trend,
        disclaimer:
          "Track record verificat pe predicții settled (win/loss). CLV apare după acumularea liniilor de closing. Nu este sfat financiar; performanța trecută nu garantează rezultate viitoare."
      });
    }

    // Fallback: live aggregate from settled history (no bet list exposed).
    // Used when snapshots are missing or empty (settled=0).
    const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data: histRows, error: histError } = await supabase
      .from("predictions_history")
      .select(
        "fixture_id, league_id, league_name, home_team, away_team, kickoff_at, validation, value_bet_validation, odds_home, odds_draw, odds_away, closing_odds_home, closing_odds_draw, closing_odds_away, score_home, score_away, recommended_pick, recommended_confidence, raw_payload"
      )
      .gte("kickoff_at", cutoffIso)
      .or("validation.in.(win,loss),value_bet_validation.in.(win,loss)")
      .order("kickoff_at", { ascending: true })
      .limit(5000);

    if (histError) throw histError;

    const report = buildBacktestReport(histRows || [], { days, includeBets: "0" });
    const m = report.metrics || {};
    const equity = Array.isArray(m.equityCurve) ? m.equityCurve : [];
    const trend = equity
      .filter((_, i) => i % Math.max(1, Math.floor(equity.length / 14)) === 0 || i === equity.length - 1)
      .slice(-14)
      .map((p) => ({
        date: null,
        i: p.i,
        hitRate: null,
        roi: null,
        settled: null,
        pnlUnits: Number(p.equity || 0)
      }));

    return res.status(200).json({
      ok: true,
      public: true,
      source: "live_settled",
      days,
      asOf: new Date().toISOString().slice(0, 10),
      summary: {
        settled: Number(m.settled || 0),
        wins: Number(m.wins || 0),
        losses: Number(m.losses || 0),
        hitRate: Number(m.hitRate || 0),
        roi: Number(m.roi || 0),
        pnlUnits: Number(m.pnlUnits || 0),
        drawdown: Number(m.maxDrawdown || 0),
        totalStake: Number(m.totalStake || 0),
        expectedValue: Number(m.expectedValue || 0),
        clv: m.clvAvailable ? Number(m.clv) : null,
        clvAvailable: Boolean(m.clvAvailable),
        clvCount: Number(m.clvCount || 0),
        clvBeatRate: m.clvBeatRate != null ? Number(m.clvBeatRate) : null
      },
      trend,
      byMarket: (m.byMarket || []).slice(0, 6).map((row) => ({
        key: row.key,
        settled: row.settled,
        hitRate: row.hitRate,
        roi: row.roi
      })),
      disclaimer:
        "Track record verificat pe predicții settled (win/loss). CLV apare după acumularea liniilor de closing. Nu este sfat financiar; performanța trecută nu garantează rezultate viitoare."
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Track record public a eșuat" });
  }
}

/**
 * GET /api/backtest?view=kpi&days=45 — KPI read (replaces /api/backtest/kpi).
 * GET /api/backtest?view=analytics&period=30d — filtered advanced analytics (+ format=csv).
 * GET /api/backtest?view=public-track&days=45 — public verified track record (no auth).
 * GET or POST /api/backtest?view=snapshot&days=45 — snapshot job (replaces /api/backtest/snapshot).
 * GET /api/backtest?view=metrics&days=45 — Brier / log loss (cron/auth).
 */
async function handleClv(req, res) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }
  const config = assertSupabaseConfigured();
  if (!config.ok) return res.status(500).json({ ok: false, error: config.error || "Supabase nu este configurat" });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: "Clientul Supabase nu este disponibil" });

  const days = Math.max(7, Math.min(Number(req.query.days) || 45, 365));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from("predictions_history")
      .select(
        "fixture_id, league_id, kickoff_at, model_version, recommended_pick, recommended_odd, recommended_confidence, closing_odds_home, closing_odds_draw, closing_odds_away, validation, match_status, score_home, score_away, raw_payload"
      )
      .gte("kickoff_at", cutoff)
      .in("match_status", ["FT", "AET", "PEN"])
      .order("kickoff_at", { ascending: false })
      .limit(5000);
    if (error) throw error;

    const events = (data || []).map((row) => {
      const tip = resolvePublishedTip(row);
      if (!tip) {
        return {
          settled: true,
          clvPct: null,
          odd: null,
          closingOdd: null,
          leagueId: row.league_id,
          market: "recommended",
          modelVersion: row.model_version,
          kickoffAt: row.kickoff_at
        };
      }
      const closingOdd = tip.closingOdd ?? selectionClosingOdd(row.raw_payload || {}, row, tip.pick);
      const clvPct = computeClvPct(tip.odd, closingOdd);
      return {
        settled: tip.settled,
        clvPct,
        odd: tip.odd,
        closingOdd,
        leagueId: tip.leagueId,
        market: tip.market || "recommended",
        modelVersion: tip.modelVersion,
        kickoffAt: tip.kickoffAt,
        pick: tip.pick,
        won: tip.won
      };
    });

    const report = buildClvReport(events);
    return res.status(200).json({ ok: true, days, track: "published_tip", ...report });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "CLV report failed" });
  }
}

async function handleWalkForwardTip(req, res) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }
  const config = assertSupabaseConfigured();
  if (!config.ok) return res.status(500).json({ ok: false, error: config.error || "Supabase nu este configurat" });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: "Clientul Supabase nu este disponibil" });

  const days = Math.max(30, Math.min(Number(req.query.days) || 180, 720));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from("predictions_history")
      .select(
        "fixture_id, league_id, kickoff_at, model_version, recommended_pick, recommended_odd, recommended_confidence, closing_odds_home, closing_odds_draw, closing_odds_away, validation, match_status, score_home, score_away, raw_payload"
      )
      .gte("kickoff_at", cutoff)
      .in("match_status", ["FT", "AET", "PEN"])
      .order("kickoff_at", { ascending: true })
      .limit(8000);
    if (error) throw error;

    const result = evaluateTipClvReport(data || [], {
      minTrain: Math.max(20, Number(req.query.minTrain) || 40),
      testSize: Math.max(10, Number(req.query.testSize) || 20),
      step: Math.max(5, Number(req.query.step) || 20)
    });
    return res.status(200).json({ ok: true, days, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Tip walk-forward failed" });
  }
}

/**
 * Prediction benchmark views — comparison-only vs API-Football's own /predictions,
 * folded into api/backtest.js's view= dispatch for Hobby serverless function limits
 * (was api/predictionBenchmark.js). Never read by PredictorV3/Stage00-08 or the
 * Recommendation Engine — admin/cron reporting only.
 *
 *   GET /api/backtest?view=benchmark-summary&days=45
 *   GET /api/backtest?view=benchmark-by-market&days=45
 *   GET /api/backtest?view=benchmark-head-to-head&days=45
 *   GET /api/backtest?view=benchmark-agreement-rate&days=45
 */
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

async function handleBenchmarkSummary(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed." });
  const loaded = await loadBenchmarkEvents(req);
  if (!loaded.ok) return res.status(500).json({ ok: false, error: loaded.error });
  const performance = computeOurPerformance(loaded.events);
  const agreement = computeAgreementRate(loaded.events);
  const headToHead = computeHeadToHead(loaded.events);
  return res.status(200).json({ ok: true, days: loaded.days, performance, agreement, headToHead });
}

async function handleBenchmarkByMarket(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed." });
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

async function handleBenchmarkHeadToHead(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed." });
  const loaded = await loadBenchmarkEvents(req);
  if (!loaded.ok) return res.status(500).json({ ok: false, error: loaded.error });
  return res.status(200).json({ ok: true, days: loaded.days, ...computeHeadToHead(loaded.events) });
}

async function handleBenchmarkAgreementRate(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed." });
  const loaded = await loadBenchmarkEvents(req);
  if (!loaded.ok) return res.status(500).json({ ok: false, error: loaded.error });
  return res.status(200).json({ ok: true, days: loaded.days, ...computeAgreementRate(loaded.events) });
}

/**
 * Meta Learning & Benchmark Intelligence — Data Health (Sprint 1).
 *
 * Reports coverage and statistical POWER, never a performance verdict: with a ~10%
 * comparability ceiling this is the view that tells an operator whether any future
 * who-is-better claim is answerable yet. Read-only over the derived meta_* tables.
 *
 *   GET /api/backtest?view=meta-data-health&days=90
 */
async function handleMetaDataHealth(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed." });
  const config = assertSupabaseConfigured();
  if (!config.ok) return res.status(500).json({ ok: false, error: config.error });
  const result = await loadMetaDataHealth({
    days: req.query.days != null ? Number(req.query.days) : 90,
    modelVersion: req.query.modelVersion || undefined
  });
  if (!result.ok) return res.status(500).json(result);
  return res.status(200).json(result);
}

export default async function handler(req, res) {
  const view = String(req.query.view || "").toLowerCase();
  // Public track record is intentionally ungated (sanitized aggregates only) + rate-limited.
  if (view === "public-track" || view === "publictrack" || view === "track-record") {
    const rl = await checkAnonymousRateLimit(req, {
      namespace: "public-track",
      maxPerHour: Math.max(30, Math.min(Number(process.env.ANON_RATE_PUBLIC_TRACK || 90), 300))
    });
    if (!rl.ok) {
      if (rl.retryAfterSec) res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ ok: false, error: "Prea multe cereri." });
    }
    return handlePublicTrack(req, res);
  }
  // P0: previously open read views — cron or admin JWT only.
  const gatedViews = new Set([
    "kpi",
    "analytics",
    "health",
    "model-lab",
    "modellab",
    "model-select",
    "modelselect",
    "clv",
    "metrics",
    "walk-forward-tip",
    "walkforwardtip",
    "tip-wf",
    "benchmark-summary",
    "benchmarksummary",
    "benchmark-by-market",
    "benchmarkbymarket",
    "benchmark-head-to-head",
    "benchmarkheadtohead",
    "benchmark-agreement-rate",
    "benchmarkagreementrate",
    "meta-data-health",
    "metadatahealth"
  ]);
  if (gatedViews.has(view) && !(await isAuthorizedForMetrics(req))) {
    return res.status(401).json({ ok: false, error: "Neautorizat. Autentificare admin sau cron necesară." });
  }
  if (view === "kpi") return handleKpi(req, res);
  if (view === "analytics") return handleAnalytics(req, res);
  if (view === "snapshot") return handleSnapshot(req, res);
  if (view === "metrics") return handleMetrics(req, res);
  if (view === "health") return handleHealth(req, res);
  if (view === "clv") return handleClv(req, res);
  if (view === "walk-forward-tip" || view === "walkforwardtip" || view === "tip-wf") {
    return handleWalkForwardTip(req, res);
  }
  if (view === "model-lab" || view === "modellab") return handleModelLab(req, res);
  if (view === "model-select" || view === "modelselect") return handleModelSelect(req, res);
  if (view === "benchmark-summary" || view === "benchmarksummary") return handleBenchmarkSummary(req, res);
  if (view === "benchmark-by-market" || view === "benchmarkbymarket") return handleBenchmarkByMarket(req, res);
  if (view === "benchmark-head-to-head" || view === "benchmarkheadtohead") return handleBenchmarkHeadToHead(req, res);
  if (view === "benchmark-agreement-rate" || view === "benchmarkagreementrate") {
    return handleBenchmarkAgreementRate(req, res);
  }
  if (view === "meta-data-health" || view === "metadatahealth") return handleMetaDataHealth(req, res);
  return res.status(400).json({
    ok: false,
    error:
      "Parametrul view lipsește sau este invalid. Folosește view=kpi, analytics, public-track, snapshot, metrics, health, clv, walk-forward-tip, model-lab sau benchmark-summary."
  });
}
