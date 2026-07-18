/**
 * API-Football daily budget circuit breaker (C10).
 *
 * Soft (≥80% or low remaining): degrade expensive paths (predict → DB-only, warm skips teamstats).
 * Hard (≥95% or reserve exhausted): block upstream fetches in getWithCache; cron/warm skip.
 *
 * Env:
 *   API_BUDGET_SOFT_PCT (default 80)
 *   API_BUDGET_HARD_PCT (default 95)
 *   API_BUDGET_RESERVE_CALLS (default 80)
 *   API_BUDGET_CIRCUIT_DISABLED=1  — emergency bypass
 */

export function getBudgetThresholds() {
  const softPct = Math.max(50, Math.min(Number(process.env.API_BUDGET_SOFT_PCT || 80), 99));
  const hardPct = Math.max(softPct, Math.min(Number(process.env.API_BUDGET_HARD_PCT || 95), 100));
  const reserveCalls = Math.max(0, Number(process.env.API_BUDGET_RESERVE_CALLS || 80));
  return { softPct, hardPct, reserveCalls };
}

/**
 * Pure classifier — testable without KV.
 * @param {{ count?: number, limit?: number }} usage
 */
export function classifyApiBudget(usage, thresholds = getBudgetThresholds()) {
  const count = Math.max(0, Number(usage?.count) || 0);
  const limit = Math.max(0, Number(usage?.limit) || 0);
  const remaining = limit > 0 ? Math.max(0, limit - count) : Number.POSITIVE_INFINITY;
  const pct = limit > 0 ? (count / limit) * 100 : 0;

  const disabled = String(process.env.API_BUDGET_CIRCUIT_DISABLED || "").trim() === "1";
  if (disabled || limit <= 0) {
    return {
      count,
      limit,
      remaining: limit > 0 ? remaining : null,
      pct: Number(pct.toFixed(1)),
      softPct: thresholds.softPct,
      hardPct: thresholds.hardPct,
      reserveCalls: thresholds.reserveCalls,
      softStop: false,
      hardStop: false,
      mode: "ok",
      disabled
    };
  }

  const hardStop = pct >= thresholds.hardPct || remaining <= thresholds.reserveCalls;
  const softStop =
    hardStop || pct >= thresholds.softPct || remaining <= thresholds.reserveCalls * 2;

  return {
    count,
    limit,
    remaining,
    pct: Number(pct.toFixed(1)),
    softPct: thresholds.softPct,
    hardPct: thresholds.hardPct,
    reserveCalls: thresholds.reserveCalls,
    softStop,
    hardStop,
    mode: hardStop ? "hard" : softStop ? "soft" : "ok",
    disabled: false
  };
}

export async function evaluateApiBudget() {
  const { getApiUsage } = await import("./fetcher.js");
  const usage = await getApiUsage().catch(() => ({ count: 0, limit: 0 }));
  return classifyApiBudget(usage);
}
