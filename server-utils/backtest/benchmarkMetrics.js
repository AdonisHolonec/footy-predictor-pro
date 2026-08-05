/**
 * Benchmark-specific aggregate metrics — the only genuinely new metric math
 * for the Admin Benchmark Dashboard. Win Rate / ROI / Realized Edge / by
 * market family reuse computeBacktestMetrics() from BacktestAnalytics.js
 * (via toOurBetEvent()) rather than duplicating that math; only Agreement
 * Rate and Head-to-Head are new here, since nothing like them exists yet.
 */

import { computeBacktestMetrics } from "./BacktestAnalytics.js";
import { toOurBetEvent } from "./benchmarkEvents.js";

function round(n, digits = 2) {
  const f = 10 ** digits;
  return Math.round(Number(n) * f) / f;
}

/**
 * Win Rate / ROI / Realized Edge / performance-by-market-family for OUR
 * track only — API-Football publishes no odds, so ROI can't be computed for
 * its side without fabricating a price (see benchmarkEvents.js note).
 * @param {object[]} events BenchmarkEvent[]
 */
export function computeOurPerformance(events) {
  const settled = (events || []).filter((e) => e.ourWon != null);
  return computeBacktestMetrics(settled.map(toOurBetEvent));
}

/**
 * @param {object[]} events BenchmarkEvent[]
 * @returns {{ comparableCount: number, agreeCount: number, disagreeCount: number,
 *   agreementRate: number|null, disagreementRate: number|null,
 *   byMarketFamily: Array<{ family: string, comparable: number, agree: number, agreementRate: number|null }> }}
 */
export function computeAgreementRate(events) {
  const comparable = (events || []).filter((e) => e.familyComparable && e.agree != null);
  const agreeCount = comparable.filter((e) => e.agree === true).length;
  const disagreeCount = comparable.filter((e) => e.agree === false).length;

  const byFamilyMap = new Map();
  for (const e of comparable) {
    const key = e.marketFamily || "other";
    if (!byFamilyMap.has(key)) byFamilyMap.set(key, { family: key, comparable: 0, agree: 0 });
    const bucket = byFamilyMap.get(key);
    bucket.comparable += 1;
    if (e.agree === true) bucket.agree += 1;
  }

  return {
    comparableCount: comparable.length,
    agreeCount,
    disagreeCount,
    agreementRate: comparable.length ? round((agreeCount / comparable.length) * 100) : null,
    disagreementRate: comparable.length ? round((disagreeCount / comparable.length) * 100) : null,
    byMarketFamily: Array.from(byFamilyMap.values())
      .map((b) => ({ ...b, agreementRate: b.comparable ? round((b.agree / b.comparable) * 100) : null }))
      .sort((a, b) => b.comparable - a.comparable)
  };
}

/**
 * 2x2 contingency table between our settled result and API-Football's
 * settled result, plus each side's plain win rate. Deterministic counting,
 * no statistics library needed.
 * @param {object[]} events BenchmarkEvent[]
 * @returns {{ n: number, ourWinRate: number|null, apiWinRate: number|null,
 *   bothCorrect: number, bothWrong: number, onlyOurCorrect: number, onlyApiCorrect: number }}
 */
export function computeHeadToHead(events) {
  const both = (events || []).filter((e) => e.ourWon != null && e.apiWon != null);

  let bothCorrect = 0;
  let bothWrong = 0;
  let onlyOurCorrect = 0;
  let onlyApiCorrect = 0;
  let ourWins = 0;
  let apiWins = 0;

  for (const e of both) {
    if (e.ourWon) ourWins += 1;
    if (e.apiWon) apiWins += 1;
    if (e.ourWon && e.apiWon) bothCorrect += 1;
    else if (!e.ourWon && !e.apiWon) bothWrong += 1;
    else if (e.ourWon && !e.apiWon) onlyOurCorrect += 1;
    else if (!e.ourWon && e.apiWon) onlyApiCorrect += 1;
  }

  return {
    n: both.length,
    ourWinRate: both.length ? round((ourWins / both.length) * 100) : null,
    apiWinRate: both.length ? round((apiWins / both.length) * 100) : null,
    bothCorrect,
    bothWrong,
    onlyOurCorrect,
    onlyApiCorrect
  };
}

export default { computeOurPerformance, computeAgreementRate, computeHeadToHead };
