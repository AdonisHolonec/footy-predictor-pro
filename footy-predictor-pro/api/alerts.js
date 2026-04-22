import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";

function asNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function reasonCodesFromRow(row) {
  const payload = row?.raw_payload || {};
  const fromAudit = Array.isArray(payload?.auditLog?.reasonCodes) ? payload.auditLog.reasonCodes : [];
  const fromValue = Array.isArray(payload?.valueBet?.reasons) ? payload.valueBet.reasons : [];
  const fromMeta = Array.isArray(payload?.modelMeta?.reasonCodes) ? payload.modelMeta.reasonCodes : [];
  return [...fromAudit, ...fromValue, ...fromMeta];
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const cfg = assertSupabaseConfigured();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase client unavailable" });

  const days = Math.max(3, Math.min(Number(req.query.days || 7), 30));
  const drawdownThreshold = Math.max(0.5, Math.min(Number(req.query.drawdown || 3), 20));
  const driftThreshold = Math.max(5, Math.min(Number(req.query.drift || 24), 100));
  const qualityThreshold = Math.max(0.05, Math.min(Number(req.query.lowDataShare || 0.35), 0.95));

  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data: kpiRows, error: kpiError } = await supabase
      .from("backtest_snapshots")
      .select("snapshot_date, max_drawdown, roi, hit_rate")
      .eq("window_days", 45)
      .order("snapshot_date", { ascending: false })
      .limit(1);
    if (kpiError) throw kpiError;

    const { data: histRows, error: histError } = await supabase
      .from("predictions_history")
      .select("kickoff_at, raw_payload")
      .gte("kickoff_at", cutoff)
      .order("kickoff_at", { ascending: false })
      .limit(350);
    if (histError) throw histError;

    const latestKpi = kpiRows?.[0] || null;
    const rows = histRows || [];
    const sampleSize = rows.length;

    let driftHits = 0;
    let lowDataHits = 0;
    for (const row of rows) {
      const payload = row.raw_payload || {};
      const reasonCodes = reasonCodesFromRow(row);
      const driftPenalty = asNum(payload?.modelMeta?.driftPenalty);
      const dataQuality = asNum(payload?.modelMeta?.dataQuality);
      if (driftPenalty >= driftThreshold || reasonCodes.includes("drift_penalty")) driftHits += 1;
      if (dataQuality > 0 && dataQuality < 0.55) lowDataHits += 1;
      else if (reasonCodes.includes("low_data_quality")) lowDataHits += 1;
    }

    const drawdown = asNum(latestKpi?.max_drawdown);
    const lowDataShare = sampleSize > 0 ? lowDataHits / sampleSize : 0;
    const driftShare = sampleSize > 0 ? driftHits / sampleSize : 0;

    const alerts = [];
    if (drawdown >= drawdownThreshold) {
      alerts.push({
        id: "drawdown",
        level: drawdown >= drawdownThreshold * 1.25 ? "high" : "medium",
        message: `Drawdown ridicat: ${drawdown.toFixed(2)}u`,
        value: Number(drawdown.toFixed(3))
      });
    }
    if (driftShare >= 0.2) {
      alerts.push({
        id: "drift",
        level: driftShare >= 0.35 ? "high" : "medium",
        message: `Drift crescut: ${(driftShare * 100).toFixed(1)}% meciuri`,
        value: Number((driftShare * 100).toFixed(2))
      });
    }
    if (lowDataShare >= qualityThreshold) {
      alerts.push({
        id: "low_data_quality",
        level: lowDataShare >= qualityThreshold * 1.35 ? "high" : "medium",
        message: `Low data quality: ${(lowDataShare * 100).toFixed(1)}%`,
        value: Number((lowDataShare * 100).toFixed(2))
      });
    }

    return res.status(200).json({
      ok: true,
      days,
      thresholds: {
        drawdown: drawdownThreshold,
        drift: driftThreshold,
        lowDataShare: qualityThreshold
      },
      metrics: {
        sampleSize,
        drawdown: Number(drawdown.toFixed(3)),
        driftShare: Number((driftShare * 100).toFixed(2)),
        lowDataShare: Number((lowDataShare * 100).toFixed(2))
      },
      alerts,
      severity: alerts.some((a) => a.level === "high") ? "high" : alerts.length ? "medium" : "none"
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Alert check failed" });
  }
}
