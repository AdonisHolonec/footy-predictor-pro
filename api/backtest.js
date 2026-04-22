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
      .select("snapshot_date, window_days, settled_bets, hit_rate, roi, max_drawdown, pnl_units")
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
        settled: Number(r.settled_bets || 0)
      }));

    return res.status(200).json({
      ok: true,
      days,
      latest: {
        date: latest.snapshot_date,
        settled: Number(latest.settled_bets || 0),
        hitRate: Number(latest.hit_rate || 0),
        roi: Number(latest.roi || 0),
        drawdown: Number(latest.max_drawdown || 0),
        pnlUnits: Number(latest.pnl_units || 0)
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

function getSelectedOdd(row, type) {
  if (type === "1") return Number(row.odds_home);
  if (type === "X") return Number(row.odds_draw);
  if (type === "2") return Number(row.odds_away);
  return null;
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
      .select("kickoff_at, validation, value_bet_validation, odds_home, odds_draw, odds_away, raw_payload")
      .gte("kickoff_at", cutoff)
      .in("validation", ["win", "loss"])
      .order("kickoff_at", { ascending: true })
      .limit(5000);

    if (error) throw error;
    const rows = data || [];

    let wins = 0;
    let losses = 0;
    let stakeSum = 0;
    let pnlUnits = 0;
    let evSum = 0;
    let evCount = 0;
    let maxDrawdown = 0;
    let peak = 0;

    for (const row of rows) {
      const payload = row.raw_payload || {};
      const valueBet = payload.valueBet || {};
      const stakePct = Math.min(Math.max(Number(valueBet.kelly || 0), 0), 3);
      const stake = stakePct / 100;
      const odd = getSelectedOdd(row, valueBet.type);
      const ev = Number(valueBet.ev);
      if (isFinite(ev)) {
        evSum += ev;
        evCount += 1;
      }
      if (stake <= 0 || !isFinite(odd) || odd <= 1) continue;

      const vbOutcome = row.value_bet_validation ?? payload.value_bet_validation;
      const won = vbOutcome === "win" || (vbOutcome == null && row.validation === "win");
      const lost = vbOutcome === "loss" || (vbOutcome == null && row.validation === "loss");
      if (!won && !lost) continue;

      stakeSum += stake;
      if (won) {
        wins += 1;
        pnlUnits += stake * (odd - 1);
      } else {
        losses += 1;
        pnlUnits -= stake;
      }

      peak = Math.max(peak, pnlUnits);
      maxDrawdown = Math.max(maxDrawdown, peak - pnlUnits);
    }

    const settled = wins + losses;
    const hitRate = settled ? (wins / settled) * 100 : 0;
    const roi = stakeSum > 0 ? (pnlUnits / stakeSum) * 100 : 0;
    const avgEv = evCount ? evSum / evCount : 0;
    const snapshotDate = new Date().toISOString().slice(0, 10);

    const { error: upsertError } = await supabase.from("backtest_snapshots").upsert(
      {
        snapshot_date: snapshotDate,
        window_days: days,
        settled_bets: settled,
        wins,
        losses,
        hit_rate: Number(hitRate.toFixed(4)),
        roi: Number(roi.toFixed(4)),
        pnl_units: Number(pnlUnits.toFixed(6)),
        total_stake_units: Number(stakeSum.toFixed(6)),
        avg_ev: Number(avgEv.toFixed(4)),
        max_drawdown: Number(maxDrawdown.toFixed(6))
      },
      { onConflict: "snapshot_date,window_days" }
    );

    if (upsertError) throw upsertError;

    return res.status(200).json({
      ok: true,
      snapshotDate,
      days,
      stats: { settled, wins, losses, hitRate, roi, avgEv, maxDrawdown }
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
 * GET /api/backtest?view=kpi&days=45 — KPI read (replaces /api/backtest/kpi).
 * GET or POST /api/backtest?view=snapshot&days=45 — snapshot job (replaces /api/backtest/snapshot).
 * GET /api/backtest?view=metrics&days=45 — Brier / log loss (cron/auth).
 */
export default async function handler(req, res) {
  const view = String(req.query.view || "").toLowerCase();
  if (view === "kpi") return handleKpi(req, res);
  if (view === "snapshot") return handleSnapshot(req, res);
  if (view === "metrics") return handleMetrics(req, res);
  return res.status(400).json({ ok: false, error: "Parametrul view lipsește sau este invalid. Folosește view=kpi, snapshot sau metrics." });
}
