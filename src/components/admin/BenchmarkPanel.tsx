import { useCallback, useEffect, useState } from "react";
import { Card, StatTile, EmptyState, ErrorState, Skeleton } from "../../design-system";
import {
  loadBenchmarkByMarket,
  loadBenchmarkSummary,
  type BenchmarkAgreement,
  type BenchmarkHeadToHead,
  type BenchmarkPerformance
} from "../../services/predictionBenchmarkService";

/**
 * Admin Benchmark Dashboard — API-Football vs our own recommendation.
 * Comparison-only, read-only analytics; never renders API-Football's pick as
 * a recommendation, and this panel has no effect on PredictorV3 or any
 * recommendation shown elsewhere in the app.
 *
 * Layout follows BacktestAnalyticsPanel.tsx's conventions (StatTile grid +
 * Card sections); visual polish beyond this scaffold is deferred to a
 * follow-up pass, per the "architecture only" scope of this dashboard.
 */
export default function BenchmarkPanel() {
  const [days, setDays] = useState(45);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [performance, setPerformance] = useState<BenchmarkPerformance | null>(null);
  const [agreement, setAgreement] = useState<BenchmarkAgreement | null>(null);
  const [headToHead, setHeadToHead] = useState<BenchmarkHeadToHead | null>(null);
  const [byMarketFamily, setByMarketFamily] = useState<BenchmarkAgreement["byMarketFamily"]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summary, byMarket] = await Promise.all([loadBenchmarkSummary(days), loadBenchmarkByMarket(days)]);
      setPerformance(summary.performance);
      setAgreement(summary.agreement);
      setHeadToHead(summary.headToHead);
      setByMarketFamily(byMarket.agreementByMarketFamily);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load benchmark data.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <ErrorState message={error} onRetry={load} />;
  }

  if (!loading && agreement && agreement.comparableCount === 0) {
    return (
      <EmptyState
        title="No benchmark data yet"
        description="The API-Football comparison cron hasn't run, or PREDICTION_BENCHMARK_ENABLED is off. Once enabled, comparisons appear here as fixtures settle."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-[var(--fp-text)]">API-Football Benchmark</h2>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-2 py-1 text-xs text-[var(--fp-text)]"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={45}>Last 45 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {loading && !performance ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-[var(--fp-radius)]" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Our Win Rate" value={performance ? `${performance.hitRate}%` : "—"} loading={loading} />
            <StatTile label="Our ROI" value={performance ? `${performance.roi}%` : "—"} loading={loading} />
            <StatTile
              label="Realized Edge (ours)"
              value={performance ? `${performance.roi}%` : "—"}
              hint="ROI on our recommendation — API-Football publishes no odds, so an edge figure isn't computable for its side"
              loading={loading}
            />
            <StatTile
              label="Agreement Rate"
              value={agreement?.agreementRate != null ? `${agreement.agreementRate}%` : "—"}
              loading={loading}
            />
            <StatTile
              label="Disagreement Rate"
              value={agreement?.disagreementRate != null ? `${agreement.disagreementRate}%` : "—"}
              loading={loading}
            />
            <StatTile
              label="Our Head-to-Head Win Rate"
              value={headToHead?.ourWinRate != null ? `${headToHead.ourWinRate}%` : "—"}
              loading={loading}
            />
            <StatTile
              label="API Head-to-Head Win Rate"
              value={headToHead?.apiWinRate != null ? `${headToHead.apiWinRate}%` : "—"}
              loading={loading}
              tone="neutral"
            />
            <StatTile label="Comparable Fixtures" value={String(agreement?.comparableCount ?? 0)} loading={loading} />
          </div>

          <Card>
            <h3 className="font-display text-sm font-semibold text-[var(--fp-text)]">Head-to-head</h3>
            <p className="mt-1 text-xs text-[var(--fp-text-muted)]">
              Of {headToHead?.n ?? 0} settled fixtures where both sides had a gradeable pick.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Both correct" value={String(headToHead?.bothCorrect ?? 0)} tone="success" />
              <StatTile label="Both wrong" value={String(headToHead?.bothWrong ?? 0)} tone="danger" />
              <StatTile label="Only us correct" value={String(headToHead?.onlyOurCorrect ?? 0)} tone="accent" />
              <StatTile label="Only API correct" value={String(headToHead?.onlyApiCorrect ?? 0)} />
            </div>
          </Card>

          <Card>
            <h3 className="font-display text-sm font-semibold text-[var(--fp-text)]">Performance by market family</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-xs">
                <thead>
                  <tr className="text-[var(--fp-text-muted)]">
                    <th className="pb-2 pr-4 font-semibold">Family</th>
                    <th className="pb-2 pr-4 font-semibold">Comparable</th>
                    <th className="pb-2 pr-4 font-semibold">Agreed</th>
                    <th className="pb-2 font-semibold">Agreement rate</th>
                  </tr>
                </thead>
                <tbody>
                  {byMarketFamily.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-3 text-[var(--fp-text-muted)]">
                        No comparable fixtures for this window yet.
                      </td>
                    </tr>
                  ) : (
                    byMarketFamily.map((row) => (
                      <tr key={row.family} className="border-t border-[var(--fp-border)]">
                        <td className="py-2 pr-4 font-medium text-[var(--fp-text)]">{row.family}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.comparable}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.agree}</td>
                        <td className="py-2 tabular-nums">{row.agreementRate != null ? `${row.agreementRate}%` : "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
