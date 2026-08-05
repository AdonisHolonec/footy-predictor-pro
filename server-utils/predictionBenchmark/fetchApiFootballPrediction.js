/**
 * PredictionBenchmarkProvider — fetch + cache layer.
 *
 * Fetches API-Football's /predictions endpoint for a single fixture,
 * normalizes it, and returns a plain result object. Comparison-only: this
 * module has zero inbound/outbound dependency on server-utils/PredictionEngine,
 * server-utils/confidence, server-utils/value, or any pipeline stage — it is a
 * leaf module that never touches PredictorV3.
 *
 * getWithCache is injected (not imported directly) so this stays trivially
 * unit-testable, same DI convention as server-utils/fixtureHalftimeGoals.js.
 * Caching, KV, inflight-dedupe, dual-provider fallback, and the
 * apiBudgetCircuit.js circuit breaker are all inherited for free from the
 * injected getWithCache — nothing is reimplemented here.
 */

import { normalizeApiFootballPrediction } from "./normalizeApiFootballPrediction.js";

const PREDICTION_BENCHMARK_TTL_SEC = Math.max(
  3600, // min 1h — a fixture's API-Football prediction doesn't change meaningfully within an hour
  Math.min(Number(process.env.PREDICTION_BENCHMARK_CACHE_TTL_SEC || 21600), 86400) // default 6h, max 24h
);

/**
 * @param {number|string} fixtureId
 * @param {(endpoint: string, params: object, ttlSeconds: number) => Promise<{ok: boolean, data?: any}>} getWithCache
 * @returns {Promise<{ ok: boolean, prediction: object|null, source: "api-football"|null, error?: string }>}
 */
export async function fetchApiFootballPrediction(fixtureId, getWithCache) {
  const id = Number(fixtureId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, prediction: null, source: null, error: "invalid_fixture_id" };
  }

  try {
    const req = await getWithCache("/predictions", { fixture: id }, PREDICTION_BENCHMARK_TTL_SEC);
    if (!req.ok) {
      return { ok: false, prediction: null, source: null, error: "upstream_not_ok" };
    }
    const normalized = normalizeApiFootballPrediction(req.data?.response?.[0], id);
    if (!normalized) {
      return { ok: false, prediction: null, source: null, error: "empty_response" };
    }
    return { ok: true, prediction: normalized, source: "api-football" };
  } catch (err) {
    return { ok: false, prediction: null, source: null, error: err?.message || "fetch_failed" };
  }
}

export default { fetchApiFootballPrediction };
