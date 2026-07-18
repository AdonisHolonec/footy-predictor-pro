import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BacktestAnalyticsResponse, BacktestFilters, BacktestMetrics } from "../../types";
import { fetchAnalyticsExport, loadAnalytics } from "../../services/backtestService";
import {
  BreakdownBarChart,
  DailyPnlChart,
  DrawdownChart,
  EquityChart,
  KellyGrowthChart,
  ReturnsHistogramChart
} from "./BacktestCharts";

type PeriodKey = "7d" | "30d" | "season";

const EMPTY_METRICS: BacktestMetrics = {
  settled: 0,
  wins: 0,
  losses: 0,
  hitRate: 0,
  roi: 0,
  yield: 0,
  profit: 0,
  loss: 0,
  pnlUnits: 0,
  totalStake: 0,
  averageOdds: 0,
  averageConfidence: 0,
  expectedValue: 0,
  maxDrawdown: 0,
  winningStreak: 0,
  losingStreak: 0
};

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function MetricTile({
  label,
  value,
  hint,
  tone = "default"
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "bad" | "amber";
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
    <div className="rounded-xl border border-white/[0.07] bg-signal-void/35 px-3 py-2.5 shadow-inner">
      <div className="font-mono text-[8px] font-semibold uppercase tracking-[0.16em] text-signal-inkMuted">{label}</div>
      <div className={`mt-1 font-mono text-base font-bold tabular-nums ${valueClass}`}>{value}</div>
      {hint ? <div className="mt-0.5 font-mono text-[9px] text-signal-inkMuted/80">{hint}</div> : null}
    </div>
  );
}

export default function BacktestAnalyticsPanel() {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [leagueId, setLeagueId] = useState<string>("");
  const [competition, setCompetition] = useState("");
  const [market, setMarket] = useState("all");
  const [side, setSide] = useState<"all" | "home" | "away" | "draw">("all");
  const [minConfidence, setMinConfidence] = useState("");
  const [maxConfidence, setMaxConfidence] = useState("");
  const [minOdds, setMinOdds] = useState("");
  const [maxOdds, setMaxOdds] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<BacktestAnalyticsResponse | null>(null);

  const filters: LoadableFilters = useMemo(
    () => ({
      period,
      leagueId: leagueId ? Number(leagueId) : null,
      competition: competition.trim() || null,
      market,
      side,
      minConfidence: minConfidence === "" ? null : Number(minConfidence),
      maxConfidence: maxConfidence === "" ? null : Number(maxConfidence),
      minOdds: minOdds === "" ? null : Number(minOdds),
      maxOdds: maxOdds === "" ? null : Number(maxOdds)
    }),
    [period, leagueId, competition, market, side, minConfidence, maxConfidence, minOdds, maxOdds]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadAnalytics({ ...filters, includeBets: true });
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Failed to load backtest analytics");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const metrics = report?.metrics || EMPTY_METRICS;
  const facets = report?.facets;

  async function exportJson() {
    const payload = report || (await loadAnalytics({ ...filters, includeBets: true }));
    downloadBlob(
      `backtest-${period}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
  }

  async function exportCsv() {
    const res = await fetchAnalyticsExport(filters, "csv");
    const text = await res.text();
    if (!res.ok) {
      let message = "CSV export failed";
      try {
        message = (JSON.parse(text) as { error?: string })?.error || message;
      } catch {
        /* plain text error */
      }
      setError(message);
      return;
    }
    downloadBlob(`backtest-${period}.csv`, text, "text/csv;charset=utf-8");
  }

  return (
    <section className="lab-card mt-4 overflow-hidden sm:mt-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.06] px-3.5 py-3 sm:px-5">
        <div>
          <h3 className="lab-section-eyebrow">Backtest Lab</h3>
          <p className="mt-1 font-display text-sm font-semibold text-signal-ink sm:text-base">
            Value-bet analytics · filters · curves · export
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void exportCsv()}
            className="rounded-lg border border-white/10 bg-signal-void/50 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-signal-silver hover:bg-signal-mist/40"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void exportJson()}
            className="rounded-lg border border-white/10 bg-signal-void/50 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-signal-silver hover:bg-signal-mist/40"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-lg bg-signal-petrol px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-signal-petrolMuted disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3 border-b border-white/[0.06] px-4 py-3 sm:px-5">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { key: "7d" as const, label: "7 days" },
              { key: "30d" as const, label: "30 days" },
              { key: "season" as const, label: "Season" }
            ] as const
          ).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={`rounded-full border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide transition ${
                period === p.key
                  ? "border-signal-petrol/50 bg-signal-petrol/25 text-signal-mint"
                  : "border-white/10 bg-signal-void/40 text-signal-inkMuted hover:text-signal-silver"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <FilterField label="League">
            <select
              value={leagueId}
              onChange={(e) => setLeagueId(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-signal-void/60 px-2 py-1.5 font-mono text-[11px] text-signal-silver"
            >
              <option value="">All leagues</option>
              {(facets?.leagues || []).map((l) => (
                <option key={`${l.id}-${l.name}`} value={String(l.id)}>
                  {l.name || `League ${l.id}`}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Competition">
            <input
              list="bt-competitions"
              value={competition}
              onChange={(e) => setCompetition(e.target.value)}
              placeholder="Name contains…"
              className="w-full rounded-md border border-white/10 bg-signal-void/60 px-2 py-1.5 font-mono text-[11px] text-signal-silver placeholder:text-signal-inkMuted"
            />
            <datalist id="bt-competitions">
              {(facets?.competitions || []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </FilterField>
          <FilterField label="Market">
            <select
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-signal-void/60 px-2 py-1.5 font-mono text-[11px] text-signal-silver"
            >
              <option value="all">All markets</option>
              <option value="1">1 (Home)</option>
              <option value="X">X (Draw)</option>
              <option value="2">2 (Away)</option>
              {(facets?.markets || [])
                .filter((m) => !["1", "X", "2"].includes(m))
                .map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
            </select>
          </FilterField>
          <FilterField label="Home / Away">
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as typeof side)}
              className="w-full rounded-md border border-white/10 bg-signal-void/60 px-2 py-1.5 font-mono text-[11px] text-signal-silver"
            >
              <option value="all">All sides</option>
              <option value="home">Home</option>
              <option value="away">Away</option>
              <option value="draw">Draw</option>
            </select>
          </FilterField>
          <FilterField label="Confidence">
            <div className="flex gap-1">
              <input
                type="number"
                min={0}
                max={100}
                placeholder="min"
                value={minConfidence}
                onChange={(e) => setMinConfidence(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-signal-void/60 px-2 py-1.5 font-mono text-[11px] text-signal-silver"
              />
              <input
                type="number"
                min={0}
                max={100}
                placeholder="max"
                value={maxConfidence}
                onChange={(e) => setMaxConfidence(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-signal-void/60 px-2 py-1.5 font-mono text-[11px] text-signal-silver"
              />
            </div>
          </FilterField>
          <FilterField label="Odds">
            <div className="flex gap-1">
              <input
                type="number"
                min={1}
                step={0.05}
                placeholder="min"
                value={minOdds}
                onChange={(e) => setMinOdds(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-signal-void/60 px-2 py-1.5 font-mono text-[11px] text-signal-silver"
              />
              <input
                type="number"
                min={1}
                step={0.05}
                placeholder="max"
                value={maxOdds}
                onChange={(e) => setMaxOdds(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-signal-void/60 px-2 py-1.5 font-mono text-[11px] text-signal-silver"
              />
            </div>
          </FilterField>
        </div>
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-200 sm:mx-5">
          {error}
        </div>
      ) : null}

      {/* Metrics grid — Settled kept as first-class tile (do not remove) */}
      <div className="px-4 py-4 sm:px-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-signal-inkMuted">Performance metrics</div>
          <div className="font-mono text-[9px] text-signal-inkMuted">
            {loading ? "…" : `${report?.totalsUnfiltered?.filtered ?? 0} / ${report?.totalsUnfiltered?.settled ?? 0} bets`}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          <MetricTile label="Settled" value={String(metrics.settled)} hint="counter preserved" />
          <MetricTile
            label="ROI"
            value={`${metrics.roi.toFixed(2)}%`}
            tone={metrics.roi >= 0 ? "good" : "bad"}
          />
          <MetricTile
            label="Yield"
            value={`${metrics.yield.toFixed(2)}%`}
            tone={metrics.yield >= 0 ? "good" : "bad"}
          />
          <MetricTile label="Profit" value={`+${metrics.profit.toFixed(3)}u`} tone="good" />
          <MetricTile label="Loss" value={`−${metrics.loss.toFixed(3)}u`} tone="bad" />
          <MetricTile
            label="PnL"
            value={`${metrics.pnlUnits >= 0 ? "+" : ""}${metrics.pnlUnits.toFixed(3)}u`}
            tone={metrics.pnlUnits >= 0 ? "good" : "bad"}
          />
          <MetricTile label="Hit Rate" value={`${metrics.hitRate.toFixed(2)}%`} />
          <MetricTile label="Expected Value" value={`${metrics.expectedValue.toFixed(2)}%`} />
          <MetricTile label="Average Odds" value={metrics.averageOdds.toFixed(2)} />
          <MetricTile label="Average Confidence" value={`${metrics.averageConfidence.toFixed(1)}%`} />
          <MetricTile label="Max Drawdown" value={`${metrics.maxDrawdown.toFixed(3)}u`} tone="amber" />
          <MetricTile
            label="Streaks"
            value={`W${metrics.winningStreak} / L${metrics.losingStreak}`}
            hint="best win / worst loss"
          />
        </div>

        {/* Professional quant metrics */}
        <div className="mb-2 mt-4 font-mono text-[9px] uppercase tracking-[0.18em] text-signal-inkMuted">
          Quantitative metrics
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          <MetricTile
            label="Kelly Growth"
            value={`${(metrics.kellyGrowthPct ?? 0) >= 0 ? "+" : ""}${(metrics.kellyGrowthPct ?? 0).toFixed(1)}%`}
            hint={`bankroll ×${(metrics.kellyFinalBankroll ?? 1).toFixed(2)}`}
            tone={(metrics.kellyGrowthPct ?? 0) >= 0 ? "good" : "bad"}
          />
          <MetricTile
            label="Sharpe"
            value={(metrics.sharpe ?? 0).toFixed(2)}
            hint={`ann. ${(metrics.sharpeAnnualized ?? 0).toFixed(2)}`}
            tone={(metrics.sharpe ?? 0) >= 0 ? "good" : "bad"}
          />
          <MetricTile
            label="LogLoss"
            value={metrics.logLoss != null ? metrics.logLoss.toFixed(3) : "—"}
            hint="lower is better"
          />
          <MetricTile
            label="Brier"
            value={metrics.brier != null ? metrics.brier.toFixed(3) : "—"}
            hint="lower is better"
          />
          <MetricTile
            label="CLV"
            value={metrics.clvAvailable && metrics.clv != null ? `${metrics.clv >= 0 ? "+" : ""}${metrics.clv.toFixed(2)}%` : "n/a"}
            hint={metrics.clvAvailable ? `${metrics.clvCount ?? 0} bets · beat ${metrics.clvBeatRate ?? 0}%` : "no closing odds"}
            tone={metrics.clvAvailable && (metrics.clv ?? 0) >= 0 ? "good" : "default"}
          />
          <MetricTile
            label="Kelly DD"
            value={`${(metrics.kellyMaxDrawdownPct ?? 0).toFixed(1)}%`}
            hint="bankroll drawdown"
            tone="amber"
          />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 border-t border-white/[0.06] px-4 py-4 lg:grid-cols-2 sm:px-5">
        <ChartCard title="Equity curve" subtitle="Cumulative units">
          <EquityChart data={report?.series?.equity || []} />
        </ChartCard>
        <ChartCard title="Kelly bankroll growth" subtitle="Compounded ×">
          <KellyGrowthChart data={report?.series?.kelly || []} />
        </ChartCard>
        <ChartCard title="Drawdown" subtitle="Underwater curve">
          <DrawdownChart data={report?.series?.equity || []} />
        </ChartCard>
        <ChartCard title="Returns distribution" subtitle="Per-bet return buckets">
          <ReturnsHistogramChart data={report?.series?.returnsHistogram || []} />
        </ChartCard>
        <ChartCard title="Daily PnL" subtitle="Wins green · losses red">
          <DailyPnlChart data={report?.series?.daily || []} />
        </ChartCard>
        <ChartCard title="ROI by market" subtitle="Top markets">
          <BreakdownBarChart data={report?.series?.byMarket || []} valueKey="roi" name="ROI %" />
        </ChartCard>
        <ChartCard title="ROI by league" subtitle="Top leagues">
          <BreakdownBarChart data={report?.series?.byLeague || []} valueKey="roi" name="ROI %" />
        </ChartCard>
      </div>

      {/* Recent bets table */}
      <div className="border-t border-white/[0.06] px-4 py-4 sm:px-5">
        <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-signal-inkMuted">
          Settled bets (filtered)
        </div>
        <div className="max-h-64 overflow-auto rounded-xl border border-white/[0.06]">
          <table className="min-w-full text-left font-mono text-[10px]">
            <thead className="sticky top-0 bg-signal-void/95 text-signal-inkMuted">
              <tr>
                <th className="px-2 py-1.5 font-semibold">Date</th>
                <th className="px-2 py-1.5 font-semibold">Match</th>
                <th className="px-2 py-1.5 font-semibold">Mkt</th>
                <th className="px-2 py-1.5 font-semibold">Odds</th>
                <th className="px-2 py-1.5 font-semibold">Conf</th>
                <th className="px-2 py-1.5 font-semibold">EV</th>
                <th className="px-2 py-1.5 font-semibold">PnL</th>
              </tr>
            </thead>
            <tbody>
              {(report?.bets || []).slice(-80).reverse().map((b, i) => (
                <tr key={`${b.fixtureId}-${i}`} className="border-t border-white/[0.04] text-signal-silver">
                  <td className="whitespace-nowrap px-2 py-1 tabular-nums">{String(b.kickoffAt || "").slice(0, 10)}</td>
                  <td className="max-w-[180px] truncate px-2 py-1" title={`${b.homeTeam} vs ${b.awayTeam}`}>
                    {b.homeTeam} · {b.awayTeam}
                  </td>
                  <td className="px-2 py-1">{b.market}</td>
                  <td className="px-2 py-1 tabular-nums">{Number(b.odd || 0).toFixed(2)}</td>
                  <td className="px-2 py-1 tabular-nums">{b.confidence != null ? `${b.confidence}` : "—"}</td>
                  <td className="px-2 py-1 tabular-nums">{b.ev != null ? `${b.ev}` : "—"}</td>
                  <td className={`px-2 py-1 tabular-nums ${b.won ? "text-emerald-300" : "text-rose-300"}`}>
                    {b.won ? "+" : ""}
                    {Number(b.pnl || 0).toFixed(3)}
                  </td>
                </tr>
              ))}
              {!loading && !(report?.bets || []).length ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-signal-inkMuted">
                    No settled value bets for these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

type LoadableFilters = Partial<BacktestFilters>;

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[8px] font-semibold uppercase tracking-wider text-signal-inkMuted">
        {label}
      </span>
      {children}
    </label>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-signal-void/40 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-signal-silver">{title}</div>
        {subtitle ? <div className="font-mono text-[9px] text-signal-inkMuted">{subtitle}</div> : null}
      </div>
      {children}
    </div>
  );
}
