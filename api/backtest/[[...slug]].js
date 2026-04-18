import { createClient } from "@supabase/supabase-js";
import { isAuthorizedCronOrInternalRequest } from "../../server-utils/cronRequestAuth.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../../server-utils/supabaseAdmin.js";
import { slugSegmentsFromRequest } from "../../server-utils/vercelCatchAllSlug.js";

async function handleKpi(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const config = assertSupabaseConfigured();
  if (!config.ok) {
    return res.status(500).json({ ok: false, error: config.error || "Supabase not configured" });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ ok: false, error: "Supabase client unavailable" });
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
    return res.status(500).json({ ok: false, error: error.message || "KPI read failed" });
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
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!isAuthorizedCronOrInternalRequest(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const days = Math.max(7, Math.min(Number(req.query.days || process.env.BACKTEST_DAYS || 45), 365));
  if (!url || !key) {
    return res.status(500).json({ ok: false, error: "Missing SUPABASE env" });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("predictions_history")
      .select("kickoff_at, validation, odds_home, odds_draw, odds_away, raw_payload")
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

      stakeSum += stake;
      if (row.validation === "win") {
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
    return res.status(500).json({ ok: false, error: error.message || "Snapshot failed" });
  }
}

export default async function handler(req, res) {
  const parts = slugSegmentsFromRequest(req, "/api/backtest");
  if (parts.length === 1 && parts[0] === "kpi") {
    return handleKpi(req, res);
  }
  if (parts.length === 1 && parts[0] === "snapshot") {
    return handleSnapshot(req, res);
  }
  return res.status(404).json({ ok: false, error: "Not found." });
}
