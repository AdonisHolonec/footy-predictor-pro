import { getSupabaseAdmin, assertSupabaseConfigured } from "../../server-utils/supabaseAdmin.js";

export default async function handler(req, res) {
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
