import { fetchWithAuth } from "../utils/apiAuth";

/** Mirrors server-utils/backtest/BacktestAnalytics.js#computeBacktestMetrics's
 * output shape — reused here rather than redefined, since computeOurPerformance
 * in benchmarkMetrics.js delegates straight to it. */
export type BenchmarkPerformance = {
  settled: number;
  wins: number;
  losses: number;
  hitRate: number;
  roi: number;
  yield: number;
  averageOdds: number;
  averageConfidence: number;
  byMarket: Array<{ key: string; n: number; [k: string]: unknown }>;
};

export type BenchmarkAgreement = {
  comparableCount: number;
  agreeCount: number;
  disagreeCount: number;
  agreementRate: number | null;
  disagreementRate: number | null;
  byMarketFamily: Array<{ family: string; comparable: number; agree: number; agreementRate: number | null }>;
};

export type BenchmarkHeadToHead = {
  n: number;
  ourWinRate: number | null;
  apiWinRate: number | null;
  bothCorrect: number;
  bothWrong: number;
  onlyOurCorrect: number;
  onlyApiCorrect: number;
};

export type BenchmarkSummary = {
  ok: boolean;
  days: number;
  performance: BenchmarkPerformance;
  agreement: BenchmarkAgreement;
  headToHead: BenchmarkHeadToHead;
};

async function getJson<T>(url: string, notFoundMessage: string): Promise<T> {
  const res = await fetchWithAuth(url);
  const json = (await res.json()) as T & { ok: boolean; error?: string };
  if (!json?.ok) throw new Error(json?.error || notFoundMessage);
  return json;
}

export async function loadBenchmarkSummary(days = 45): Promise<BenchmarkSummary> {
  return getJson<BenchmarkSummary>(
    `/api/backtest?view=benchmark-summary&days=${days}`,
    "Could not load benchmark summary."
  );
}

export async function loadBenchmarkByMarket(
  days = 45
): Promise<{ ok: boolean; days: number; byMarketFamily: BenchmarkPerformance["byMarket"]; agreementByMarketFamily: BenchmarkAgreement["byMarketFamily"] }> {
  return getJson(`/api/backtest?view=benchmark-by-market&days=${days}`, "Could not load by-market breakdown.");
}

export async function loadBenchmarkHeadToHead(days = 45): Promise<BenchmarkHeadToHead & { ok: boolean; days: number }> {
  return getJson(`/api/backtest?view=benchmark-head-to-head&days=${days}`, "Could not load head-to-head.");
}
