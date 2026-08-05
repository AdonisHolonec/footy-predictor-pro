import { isAuthorizedCronOrInternalRequest } from "../../server-utils/cronRequestAuth.js";
import { getWithCache } from "../../server-utils/fetcher.js";
import { runBenchmarkSweep } from "../../server-utils/predictionBenchmark/runBenchmarkSweep.js";

/**
 * Cron-only sweep: fetches API-Football's /predictions for recently-persisted
 * predictions_history rows and stores the comparison in prediction_benchmarks.
 * Fully decoupled from /api/predict — reads data Stage10Persistence.js already
 * committed, never shares a call stack with PredictorV3 / the Recommendation
 * Engine. Off by default (PREDICTION_BENCHMARK_ENABLED=0) — a no-op until
 * explicitly enabled.
 */
export default async function handler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }
  if (!isAuthorizedCronOrInternalRequest(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized cron request." });
  }

  if (String(process.env.PREDICTION_BENCHMARK_ENABLED || "0") !== "1") {
    return res.status(200).json({ ok: true, skipped: "flag_disabled" });
  }

  try {
    const result = await runBenchmarkSweep({ getWithCache });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    // Never throw past the cron boundary — log-and-continue, same convention as Stage10Persistence.js.
    console.error("[predictionBenchmarkSweep]", err?.message || err);
    return res.status(200).json({ ok: false, error: err?.message || "sweep_failed" });
  }
}
