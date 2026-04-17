import { createClient } from "@supabase/supabase-js";

function getSelectedOdd(row, type) {
  if (type === "1") return Number(row.odds_home);
  if (type === "X") return Number(row.odds_draw);
  if (type === "2") return Number(row.odds_away);
  return null;
}

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const provided = req.headers["x-cron-secret"]
    || req.headers["authorization"]?.replace(/^Bearer\s+/i, "")
    || req.query.secret;
  return provided === secret;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!isAuthorized(req)) {
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

    const { error: upsertError } = await supabase
      .from("backtest_snapshots")
      .upsert({
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
      }, { onConflict: "snapshot_date,window_days" });

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
