/**
 * Flattens a prediction_benchmarks row into a BenchmarkEvent — analogous to
 * TipEvent.js's resolvePublishedTip(), but for the API-Football comparison
 * table. Reuses the existing market-family taxonomy (our_family is already
 * populated by BenchmarkConsensus using tipMarketFamily()) rather than
 * inventing a new one.
 *
 * Note on ROI/odds: API-Football's /predictions payload carries no pricing
 * (see docs/PREDICTION_BENCHMARK_RESEARCH.md, "Missing fields"). Fabricating
 * an implied odd for the API side would produce a misleading ROI figure, so
 * "Realized Edge" / ROI is computed for OUR track only (via
 * computeBacktestMetrics in benchmarkMetrics.js); the API side's performance
 * is expressed purely as win rate + head-to-head contingency, which is
 * meaningful without odds.
 */

/**
 * @param {object} row  a prediction_benchmarks row (snake_case DB columns)
 * @returns {object|null} BenchmarkEvent, or null when the row is unusable
 */
export function extractBenchmarkEvent(row) {
  if (!row) return null;
  const fixtureId = Number(row.fixture_id);
  if (!Number.isFinite(fixtureId)) return null;

  const ourResult = row.our_result;
  const apiResult = row.api_result;
  const ourWon = ourResult === "win" ? true : ourResult === "loss" ? false : null;
  const apiWon = apiResult === "win" ? true : apiResult === "loss" ? false : null;

  const ourOdd = Number.isFinite(Number(row.our_odd)) ? Number(row.our_odd) : null;
  const ourPnl = ourWon === true && ourOdd != null ? ourOdd - 1 : ourWon === false ? -1 : null;

  return {
    fixtureId,
    leagueId: row.league_id ?? null,
    kickoffAt: row.kickoff_at || null,
    marketFamily: row.our_family || "other",
    ourPick: row.our_pick || null,
    ourConfidence: Number.isFinite(Number(row.our_confidence)) ? Number(row.our_confidence) : null,
    ourOdd,
    ourWon,
    ourPnl,
    apiInferredPick: row.consensus?.apiPick?.inferredPick ?? null,
    apiConfidencePct: row.consensus?.apiPick?.confidencePct ?? null,
    apiWon,
    familyComparable: Boolean(row.consensus?.familyComparable),
    agree: row.agree ?? null,
    confidenceDelta: row.confidence_delta ?? null,
    settled: ourWon != null || apiWon != null
  };
}

/**
 * @param {object[]} rows  prediction_benchmarks rows
 * @returns {object[]} BenchmarkEvent[] (drops unusable rows)
 */
export function extractBenchmarkEvents(rows) {
  const out = [];
  for (const row of rows || []) {
    const event = extractBenchmarkEvent(row);
    if (event) out.push(event);
  }
  return out;
}

/** Maps a BenchmarkEvent onto the flat shape computeBacktestMetrics() expects
 * (server-utils/backtest/BacktestAnalytics.js), for OUR track only. */
export function toOurBetEvent(event) {
  return {
    market: event.marketFamily,
    leagueName: null,
    leagueId: event.leagueId,
    side: null,
    odd: event.ourOdd ?? 0,
    stake: 1,
    ev: null,
    confidence: event.ourConfidence,
    prob: null,
    clvPct: null,
    won: event.ourWon === true,
    pnl: event.ourWon === true ? (event.ourPnl ?? 0) : event.ourWon === false ? -1 : 0,
    kickoffAt: event.kickoffAt
  };
}

export default { extractBenchmarkEvent, extractBenchmarkEvents, toOurBetEvent };
