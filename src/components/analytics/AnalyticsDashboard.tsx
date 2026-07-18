import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { BacktestAnalyticsResponse, DashboardBundle } from "../../types";
import type { UsageSnapshot } from "../../types/index";
import { loadAnalytics } from "../../services/backtestService";
import {
  ApiUsageBarChart,
  ConfidenceAreaChart,
  LeagueBarChart,
  LeagueMarketHeatmap,
  MarketPieChart,
  PerformanceRadarChart,
  ProfitLineChart
} from "./AnalyticsCharts";

export type AnalyticsDashboardProps = {
  usageCount: number;
  usageLimit: number;
  usagePct: number;
  usageSnapshot?: UsageSnapshot | null;
  onLoadUsage?: () => void;
};

const EMPTY_DASH: DashboardBundle = {
  predictionAccuracy: 0,
  roi: 0,
  yield: 0,
  dailyProfit: 0,
  weeklyProfit: 0,
  monthlyProfit: 0,
  leaguePerformance: [],
  marketPerformance: [],
  confidenceDistribution: [],
  accuracyByLeague: [],
  accuracyByMarket: [],
  bestLeagues: [],
  worstLeagues: [],
  heatmap: { leagues: [], markets: ["1", "X", "2"], cells: [] },
  radar: [],
  profitLine: []
};

function pnlTone(n: number): "good" | "bad" | "default" {
  if (n > 0) return "good";
  if (n < 0) return "bad";
  return "default";
}

function Widget({
  label,
  value,
  hint,
  tone = "default",
  className = ""
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "bad" | "amber";
  className?: string;
}) {
  const valueClass =
    tone === "good"
      ? "text-emerald-300"
      : tone === "bad"
        ? "text-rose-300"
        : tone === "amber"
          ? "text-amber-200"
          : "text-signal-silver";
  return (
    <div className={`lab-stat ${className}`}>
      <div className="lab-stat-label">{label}</div>
      <div className={`lab-stat-value text-lg sm:text-xl ${valueClass}`}>{value}</div>
      {hint ? <div className="mt-1 text-[10px] text-signal-inkMuted/85">{hint}</div> : null}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  className = ""
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-white/[0.07] bg-signal-void/35 p-3 sm:p-4 ${className}`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-signal-silver">{title}</h4>
        {subtitle ? <span className="font-mono text-[9px] text-signal-inkMuted">{subtitle}</span> : null}
      </div>
      {children}
    </div>
  );
}

function RankList({
  title,
  rows,
  mode
}: {
  title: string;
  rows: Array<{ key: string; roi: number; hitRate: number; settled: number }>;
  mode: "best" | "worst";
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-signal-void/35 p-3 sm:p-4">
      <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-signal-silver">{title}</h4>
      <ul className="space-y-1.5">
        {(rows || []).length === 0 ? (
          <li className="font-mono text-[11px] text-signal-inkMuted">Insufficient sample</li>
        ) : (
          rows.map((r, i) => (
            <li
              key={`${r.key}-${i}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.04] bg-signal-mist/10 px-2.5 py-1.5"
            >
              <span className="truncate font-mono text-[11px] text-signal-silver">
                <span className="mr-1.5 text-signal-inkMuted">{i + 1}.</span>
                {r.key}
              </span>
              <span
                className={`shrink-0 font-mono text-[11px] tabular-nums ${
                  mode === "best" ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {r.roi >= 0 ? "+" : ""}
                {r.roi.toFixed(1)}% · {r.hitRate.toFixed(0)}%
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/**
 * Professional Analytics Dashboard — responsive widget grid + Line/Bar/Pie/Heatmap/Radar charts.
 * Does not replace SuccessRateTracker or KPI Settled counters.
 */
export default function AnalyticsDashboard({
  usageCount,
  usageLimit,
  usagePct,
  usageSnapshot,
  onLoadUsage
}: AnalyticsDashboardProps) {
  const [period, setPeriod] = useState<"7d" | "30d" | "season">("30d");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<BacktestAnalyticsResponse | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadAnalytics({ period, includeBets: false });
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!usageSnapshot && onLoadUsage) onLoadUsage();
  }, [usageSnapshot, onLoadUsage]);

  const dash = report?.dashboard || EMPTY_DASH;
  const usageHistory = usageSnapshot?.history || [];

  return (
    <section className="lab-card mt-4 overflow-hidden sm:mt-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.06] px-3.5 py-3 sm:px-5">
        <div>
          <h3 className="lab-section-eyebrow">
            Analytics Dashboard
          </h3>
          <p className="mt-1 font-display text-sm font-semibold text-signal-ink sm:text-base">
            Performance overview · prediction · value · API
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { key: "7d" as const, label: "7D" },
              { key: "30d" as const, label: "30D" },
              { key: "season" as const, label: "Season" }
            ] as const
          ).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={`rounded-full border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide ${
                period === p.key
                  ? "border-signal-petrol/50 bg-signal-petrol/25 text-signal-mint"
                  : "border-white/10 bg-signal-void/50 text-signal-inkMuted hover:text-signal-silver"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-lg bg-signal-petrol px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-signal-petrolMuted disabled:opacity-50"
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-200 sm:mx-5">
          {error}
        </div>
      ) : null}

      {/* KPI widgets */}
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-5">
        <Widget label="Prediction Accuracy" value={`${dash.predictionAccuracy.toFixed(1)}%`} hint="Hit rate" />
        <Widget label="ROI" value={`${dash.roi.toFixed(2)}%`} tone={pnlTone(dash.roi)} />
        <Widget label="Yield" value={`${dash.yield.toFixed(2)}%`} tone={pnlTone(dash.yield)} />
        <Widget
          label="Calls Used"
          value={`${usageCount} / ${usageLimit}`}
          hint={`${usagePct.toFixed(0)}% of daily limit`}
          tone={usagePct >= 90 ? "bad" : usagePct >= 70 ? "amber" : "default"}
        />
        <Widget
          label="API Usage"
          value={usageSnapshot ? String(usageSnapshot.today?.count ?? usageCount) : String(usageCount)}
          hint={
            usageSnapshot
              ? `Today · yday ${usageSnapshot.yesterday?.count ?? "—"} · ${usageHistory.length}d hist`
              : "Live day counter"
          }
        />
        <Widget
          label="Daily Profit"
          value={`${dash.dailyProfit >= 0 ? "+" : ""}${dash.dailyProfit.toFixed(3)}u`}
          tone={pnlTone(dash.dailyProfit)}
        />
        <Widget
          label="Weekly Profit"
          value={`${dash.weeklyProfit >= 0 ? "+" : ""}${dash.weeklyProfit.toFixed(3)}u`}
          tone={pnlTone(dash.weeklyProfit)}
        />
        <Widget
          label="Monthly Profit"
          value={`${dash.monthlyProfit >= 0 ? "+" : ""}${dash.monthlyProfit.toFixed(3)}u`}
          tone={pnlTone(dash.monthlyProfit)}
        />
        <Widget
          label="League Performance"
          value={dash.leaguePerformance[0] ? dash.leaguePerformance[0].key : "—"}
          hint={
            dash.leaguePerformance[0]
              ? `Top volume · ROI ${dash.leaguePerformance[0].roi.toFixed(1)}%`
              : "No leagues yet"
          }
        />
        <Widget
          label="Market Performance"
          value={dash.marketPerformance[0] ? `Mkt ${dash.marketPerformance[0].key}` : "—"}
          hint={
            dash.marketPerformance[0]
              ? `ROI ${dash.marketPerformance[0].roi.toFixed(1)}% · Hit ${dash.marketPerformance[0].hitRate.toFixed(0)}%`
              : "No markets yet"
          }
        />
      </div>

      {/* Charts row 1: Line + Radar + Pie */}
      <div className="grid grid-cols-1 gap-3 px-4 pb-3 sm:px-5 lg:grid-cols-2 xl:grid-cols-3">
        <ChartCard title="Profit line" subtitle="Equity + hit rate" className="xl:col-span-1">
          <ProfitLineChart data={dash.profitLine} />
        </ChartCard>
        <ChartCard title="Performance radar" subtitle="Multi-metric profile">
          <PerformanceRadarChart data={dash.radar} />
        </ChartCard>
        <ChartCard title="Market mix" subtitle="Pie · settled share">
          <MarketPieChart data={dash.marketPerformance} />
        </ChartCard>
      </div>

      {/* Charts row 2: Bars + Confidence */}
      <div className="grid grid-cols-1 gap-3 px-4 pb-3 sm:px-5 lg:grid-cols-2">
        <ChartCard title="Accuracy by league" subtitle="Bar · hit rate">
          <LeagueBarChart
            data={dash.accuracyByLeague.map((r) => ({ key: r.key, hitRate: r.hitRate, roi: r.hitRate }))}
            valueKey="hitRate"
          />
        </ChartCard>
        <ChartCard title="Accuracy by market" subtitle="Bar · hit rate">
          <LeagueBarChart
            data={dash.accuracyByMarket.map((r) => ({ key: r.key, hitRate: r.hitRate, roi: r.hitRate }))}
            valueKey="hitRate"
          />
        </ChartCard>
        <ChartCard title="League ROI" subtitle="Bar · performance">
          <LeagueBarChart data={dash.leaguePerformance} valueKey="roi" />
        </ChartCard>
        <ChartCard title="Confidence distribution" subtitle="Area · volume + hit">
          <ConfidenceAreaChart data={dash.confidenceDistribution} />
        </ChartCard>
      </div>

      {/* Heatmap + ranks + API usage */}
      <div className="grid grid-cols-1 gap-3 px-4 pb-4 sm:px-5 lg:grid-cols-2 xl:grid-cols-3">
        <ChartCard title="Heatmap" subtitle="League × market accuracy" className="lg:col-span-2 xl:col-span-1">
          <LeagueMarketHeatmap data={dash.heatmap} />
        </ChartCard>
        <RankList title="Best leagues" rows={dash.bestLeagues} mode="best" />
        <RankList title="Worst leagues" rows={dash.worstLeagues} mode="worst" />
        <ChartCard title="API usage history" subtitle="Calls vs limit" className="lg:col-span-2 xl:col-span-3">
          {usageHistory.length ? (
            <ApiUsageBarChart history={usageHistory} />
          ) : (
            <div className="flex h-40 flex-col items-center justify-center gap-2 font-mono text-[11px] text-signal-inkMuted">
              <span>Usage history not loaded</span>
              {onLoadUsage ? (
                <button
                  type="button"
                  onClick={() => onLoadUsage()}
                  className="rounded-md border border-white/10 px-3 py-1 text-[10px] uppercase tracking-wide text-signal-silver hover:bg-signal-mist/20"
                >
                  Load API usage
                </button>
              ) : null}
            </div>
          )}
        </ChartCard>
      </div>
    </section>
  );
}
