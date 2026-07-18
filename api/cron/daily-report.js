import { isAuthorizedCronOrInternalRequest } from "../../server-utils/cronRequestAuth.js";
import { generateDailyReport } from "../../server-utils/observability/healthBundle.js";
import { logError, logInfo } from "../../server-utils/observability/logger.js";

/**
 * Vercel Cron: persist daily ops report (latency, failures, cache, usage, alerts).
 */
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
  }
  if (!isAuthorizedCronOrInternalRequest(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized cron request" });
  }

  try {
    const report = await generateDailyReport();
    logInfo("cron.daily_report", { date: report?.date, status: report?.status });
    return res.status(200).json({ ok: true, report });
  } catch (err) {
    logError("cron.daily_report_failed", { error: err?.message || String(err) });
    return res.status(500).json({ ok: false, error: err?.message || "Daily report failed" });
  }
}
