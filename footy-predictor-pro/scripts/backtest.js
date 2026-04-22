import { createClient } from "@supabase/supabase-js";

function pct(n) {
  return `${(Number(n) || 0).toFixed(2)}%`;
}

function getSelectedOdd(row, type) {
  if (!row || !type) return null;
  if (type === "1") return Number(row.odds_home);
  if (type === "X") return Number(row.odds_draw);
  if (type === "2") return Number(row.odds_away);
  return null;
}

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const days = Math.max(7, Math.min(Number(process.env.BACKTEST_DAYS || 45), 365));

  if (!url || !key) {
    console.error("Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("predictions_history")
    .select("fixture_id, kickoff_at, validation, recommended_pick, odds_home, odds_draw, odds_away, raw_payload")
    .gte("kickoff_at", cutoff)
    .in("validation", ["win", "loss"])
    .order("kickoff_at", { ascending: true })
    .limit(5000);

  if (error) {
    console.error("Supabase query failed:", error.message);
    process.exit(1);
  }

  const rows = data || [];
  if (!rows.length) {
    console.log(`No settled rows found in last ${days} days.`);
    return;
  }

  let wins = 0;
  let losses = 0;
  let stakeSum = 0;
  let pnlUnits = 0;
  let evSum = 0;
  let evCount = 0;
  let maxDrawdown = 0;
  let peak = 0;
  let equity = 0;

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

    equity = pnlUnits;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const settled = wins + losses;
  const hitRate = settled ? (wins / settled) * 100 : 0;
  const roi = stakeSum > 0 ? (pnlUnits / stakeSum) * 100 : 0;
  const avgEv = evCount ? evSum / evCount : 0;

  console.log("=== Backtest Report ===");
  console.log(`Window: last ${days} days`);
  console.log(`Settled bets: ${settled}`);
  console.log(`Wins/Losses: ${wins}/${losses}`);
  console.log(`Hit rate: ${pct(hitRate)}`);
  console.log(`Total stake (units): ${stakeSum.toFixed(4)}`);
  console.log(`PnL (units): ${pnlUnits.toFixed(4)}`);
  console.log(`ROI: ${pct(roi)}`);
  console.log(`Avg EV (proxy CLV): ${pct(avgEv)}`);
  console.log(`Max drawdown (units): ${maxDrawdown.toFixed(4)}`);

  const snapshotDate = new Date().toISOString().slice(0, 10);
  const { error: snapshotError } = await supabase
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

  if (snapshotError) {
    console.warn("Snapshot upsert failed:", snapshotError.message);
  } else {
    console.log(`Snapshot saved: ${snapshotDate} (window=${days}d)`);
  }
}

run().catch((err) => {
  console.error("Backtest crashed:", err?.message || err);
  process.exit(1);
});
