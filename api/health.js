/**
 * Enterprise Monitoring — health checks, performance metrics, ops alerts, daily reports.
 *
 * GET /api/health              → full Health Dashboard bundle
 * GET /api/health?view=live    → lightweight liveness { ok, status }
 * GET /api/health?view=report  → latest daily report (+ history via days=)
 */
import { buildHealthBundle, generateDailyReport } from "../server-utils/observability/healthBundle.js";
import { getDailyReport, listDailyReports } from "../server-utils/observability/metricsStore.js";
import { logInfo } from "../server-utils/observability/logger.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
  }

  const view = String(req.query.view || "dashboard").toLowerCase();
  const days = Math.max(1, Math.min(Number(req.query.days || 7), 30));

  try {
    if (view === "live") {
      const bundle = await buildHealthBundle({ historyDays: 1 });
      return res.status(bundle.ok ? 200 : 503).json({
        ok: bundle.ok,
        status: bundle.status,
        severity: bundle.severity,
        generatedAt: bundle.generatedAt
      });
    }

    if (view === "report") {
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
