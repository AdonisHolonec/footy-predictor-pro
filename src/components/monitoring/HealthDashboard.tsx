import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { HealthDashboardBundle, OpsAlert } from "../../types";
import { loadHealthDashboard } from "../../services/healthService";
import HealthInsightGrid from "./HealthInsightGrid";
import { StatTile, Button } from "../../design-system";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

function fmtMs(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
}

function statusTone(status: string): string {
  if (status === "healthy") return "text-[var(--fp-success)]";
  if (status === "degraded") return "text-[var(--fp-warning)]";
  if (status === "critical") return "text-[var(--fp-danger)]";
  return "text-[var(--fp-text-muted)]";
}

function widgetTone(tone: "default" | "good" | "bad" | "amber"): "neutral" | "success" | "danger" | "warning" {
  if (tone === "good") return "success";
  if (tone === "bad") return "danger";
  if (tone === "amber") return "warning";
  return "neutral";
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
    <div className={`rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 sm:p-4 ${className}`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fp-text)]">{title}</h4>
        {subtitle ? <span className="font-mono text-[10px] text-[var(--fp-text-muted)]">{subtitle}</span> : null}
      </div>
      {children}
    </div>
  );
}

function AlertList({ alerts }: { alerts: OpsAlert[] }) {
  if (!alerts.length) {
    return (
      <div className="rounded-xl border border-fp-success/20 bg-fp-success/5 px-3 py-3 font-mono text-[11px] text-fp-success/90">
        No ops alerts — prediction / API / cache within thresholds.
      </div>
    );
  }
  return (
    <ul className="space-y-1.5">
      {alerts.map((a) => (
        <li
          key={a.id}
          className={`rounded-lg border px-2.5 py-2 font-mono text-[11px] ${
            a.level === "high"
              ? "border-fp-danger/30 bg-fp-danger/10 text-[var(--fp-danger)]"
              : "border-fp-warning/25 bg-fp-warning/10 text-[var(--fp-warning)]"
          }`}
        >
          <span className="mr-2 uppercase tracking-wide opacity-70">{a.level}</span>
          {a.message}
        </li>
      ))}
    </ul>
  );
}

const tip = {
  background: "var(--fp-bg-card)",
  border: "1px solid var(--fp-border)",
  borderRadius: 10,
  fontSize: 11,
  color: "var(--fp-text)"
};

export default function HealthDashboard() {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<HealthDashboardBundle | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadHealthDashboard(days);
      setBundle(data);
    } catch (err) {
      setBundle(null);
      setError(err instanceof Error ? err.message : "Failed to load health");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const perf = bundle?.performance;
  const hist = (bundle?.history || [])
    .slice()
    .reverse()
    .map((h) => ({
      date: String(h.date).slice(5),
      predictP95: h.routes.predict.p95Ms ?? 0,
      apiP95: h.routes.api.p95Ms ?? 0,
      cacheP95: h.routes.cache.p95Ms ?? 0,
      predFail: h.failures.prediction,
      apiFail: h.failures.api,
      cacheFail: h.failures.cache
    }));

  const latencyBars = perf
    ? [
        { key: "Predict", avg: perf.predictionLatency.avgMs, p95: perf.predictionLatency.p95Ms ?? 0 },
        { key: "API", avg: perf.apiLatency.avgMs, p95: perf.apiLatency.p95Ms ?? 0 },
        { key: "Cache", avg: perf.cacheLatency.avgMs, p95: perf.cacheLatency.p95Ms ?? 0 },
        { key: "Fixtures", avg: perf.fixturesLatency.avgMs, p95: perf.fixturesLatency.p95Ms ?? 0 }
      ]
    : [];

  return (
    <div className="mt-4 overflow-hidden rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-fp-sm sm:mt-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--fp-border)] px-3.5 py-3 sm:px-5">
        <div>
          <h3 className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fp-accent)]">
            Enterprise Monitoring
          </h3>
          <p className="mt-1 font-display text-sm font-semibold text-[var(--fp-text)] sm:text-base">
            Health Dashboard · latency · failures · daily reports
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {[3, 7, 14].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-full border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide ${
                days === d
                  ? "border-fp-accent/50 bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                  : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
              }`}
            >
              {d}D
            </button>
          ))}
          <Button variant="primary" size="sm" loading={loading} onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded-lg border border-fp-danger/30 bg-fp-danger/10 px-3 py-2 font-mono text-[11px] text-[var(--fp-danger)] sm:mx-5">
          {error}
        </div>
      ) : null}

      {bundle ? (
        <>
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--fp-border)] px-4 py-3 sm:px-5">
            <div className={`font-mono text-xs font-semibold uppercase tracking-[0.14em] ${statusTone(bundle.status)}`}>
              {bundle.status}
            </div>
            <div className="font-mono text-[10px] text-[var(--fp-text-muted)]">
              severity {bundle.severity} · {new Date(bundle.generatedAt).toLocaleString()}
            </div>
            <div className="font-mono text-[10px] text-[var(--fp-text-muted)]">
              KV {bundle.checks.kv.ok ? "ok" : "down"}
              {bundle.checks.kv.latencyMs != null ? ` ${bundle.checks.kv.latencyMs}ms` : ""}
              {" · "}
              Supabase {bundle.checks.supabase.ok ? "ok" : "down"}
              {bundle.checks.supabase.latencyMs != null ? ` ${bundle.checks.supabase.latencyMs}ms` : ""}
            </div>
          </div>

          {/* Interpretation before measurement: the reading of the numbers precedes the
              numbers themselves, so the page opens with an answer rather than a quiz. */}
          <HealthInsightGrid bundle={bundle} />

          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-6">
            <StatTile
              label="Prediction Latency"
              value={fmtMs(perf?.predictionLatency.p95Ms ?? perf?.predictionLatency.avgMs)}
              hint={`avg ${fmtMs(perf?.predictionLatency.avgMs)} · n=${perf?.predictionLatency.count ?? 0}`}
            />
            <StatTile
              label="API Latency"
              value={fmtMs(perf?.apiLatency.p95Ms ?? perf?.apiLatency.avgMs)}
              hint={`avg ${fmtMs(perf?.apiLatency.avgMs)} · err ${(perf?.apiLatency.errorRate ?? 0) * 100}%`}
            />
            <StatTile
              label="Cache Latency"
              value={fmtMs(perf?.cacheLatency.p95Ms ?? perf?.cacheLatency.avgMs)}
              hint={`avg ${fmtMs(perf?.cacheLatency.avgMs)} · hits ${bundle.cache.hits}`}
            />
            <StatTile
              label="Memory"
              value={`${bundle.process.memory.heapUsedMb.toFixed(0)} MB`}
              hint={`RSS ${bundle.process.memory.rssMb.toFixed(0)} · heap ${bundle.process.memory.heapTotalMb.toFixed(0)}`}
            />
            <StatTile
              label="CPU"
              value={
                bundle.process.cpu
                  ? `${((bundle.process.cpu.userUs + bundle.process.cpu.systemUs) / 1000).toFixed(0)}ms`
                  : "—"
              }
              hint={
                bundle.process.cpu
                  ? `user ${(bundle.process.cpu.userUs / 1000).toFixed(0)} · sys ${(bundle.process.cpu.systemUs / 1000).toFixed(0)}`
                  : "Snapshot per invoke"
              }
            />
            <StatTile
              label="Cache Hit Ratio"
              value={
                bundle.cache.hitRatio != null ? `${(bundle.cache.hitRatio * 100).toFixed(1)}%` : "—"
              }
              hint={`${bundle.cache.hits} / ${bundle.cache.hits + bundle.cache.misses}`}
              tone={widgetTone(
                bundle.cache.hitRatio != null && bundle.cache.hitRatio >= 0.4
                  ? "good"
                  : bundle.cache.hitRatio != null && bundle.cache.hitRatio < 0.15
                    ? "amber"
                    : "default"
              )}
            />
            <StatTile
              label="Prediction Failures"
              value={String(bundle.failures.prediction)}
              tone={widgetTone(bundle.failures.prediction >= 3 ? "bad" : "default")}
              hint="Today"
            />
            <StatTile
              label="API Failures"
              value={String(bundle.failures.api)}
              tone={widgetTone(bundle.failures.api >= 5 ? "bad" : "default")}
              hint="Today"
            />
            <StatTile
              label="Cache Failures"
              value={String(bundle.failures.cache)}
              tone={widgetTone(bundle.failures.cache >= 3 ? "bad" : "default")}
              hint="Today"
            />
            <StatTile
              label="API Remaining"
              value={String(bundle.usage.remaining)}
              hint={`${bundle.usage.count}/${bundle.usage.limit} · ${bundle.usage.pct}%`}
              tone={widgetTone(bundle.usage.pct >= 90 ? "bad" : bundle.usage.pct >= 70 ? "amber" : "good")}
            />
            <StatTile
              label="Uptime"
              value={`${bundle.process.uptimeSec.toFixed(0)}s`}
              hint={bundle.process.node || "process"}
            />
            <StatTile
              label="Daily Report"
              value={bundle.dailyReport?.status || "—"}
              hint={bundle.dailyReport?.date || "Cron 00:05 UTC"}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 px-4 pb-3 sm:px-5 lg:grid-cols-2">
            <ChartCard title="Latency" subtitle="Avg vs p95 (ms)">
              <div className="h-52 w-full sm:h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={latencyBars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--fp-border)" vertical={false} />
                    <XAxis dataKey="key" tick={{ fill: "var(--fp-text-muted)", fontSize: 10 }} />
                    <YAxis tick={{ fill: "var(--fp-text-muted)", fontSize: 10 }} width={40} />
                    <Tooltip contentStyle={tip} />
                    <Bar dataKey="avg" name="Avg" fill="var(--fp-accent)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="p95" name="P95" fill="var(--fp-purple)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
            <ChartCard title="Failures (history)" subtitle="Prediction · API · Cache">
              <div className="h-52 w-full sm:h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hist} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--fp-border)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "var(--fp-text-muted)", fontSize: 10 }} />
                    <YAxis tick={{ fill: "var(--fp-text-muted)", fontSize: 10 }} width={28} allowDecimals={false} />
                    <Tooltip contentStyle={tip} />
                    <Line type="monotone" dataKey="predFail" name="Predict" stroke="var(--fp-danger)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="apiFail" name="API" stroke="var(--fp-warning)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="cacheFail" name="Cache" stroke="var(--fp-accent)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-3 px-4 pb-4 sm:px-5 lg:grid-cols-2">
            <ChartCard title="Alerting" subtitle="Prediction · API · Cache failures">
              <AlertList alerts={bundle.alerts} />
            </ChartCard>
            <ChartCard title="Daily reports" subtitle="Recent digests">
              {(bundle.recentReports || []).length === 0 && !bundle.dailyReport ? (
                <div className="font-mono text-[11px] text-[var(--fp-text-muted)]">
                  No reports yet — cron runs at 00:05 UTC.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {(bundle.recentReports?.length ? bundle.recentReports : bundle.dailyReport ? [bundle.dailyReport] : []).map(
                    (r) => (
                      <li
                        key={r.date}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2.5 py-1.5 font-mono text-[11px]"
                      >
                        <span className="text-[var(--fp-text)]">{r.date}</span>
                        <span className={statusTone(r.status)}>{r.status}</span>
                        <span className="text-[var(--fp-text-muted)]">
                          alerts {r.alertCount ?? r.alerts?.length ?? 0}
                          {r.performance?.predictionP95 != null
                            ? ` · p95 ${fmtMs(r.performance.predictionP95)}`
                            : ""}
                        </span>
                      </li>
                    )
                  )}
                </ul>
              )}
            </ChartCard>
          </div>
        </>
      ) : !error && !loading ? (
        <div className="px-4 py-8 text-center font-mono text-[11px] text-[var(--fp-text-muted)]">No health data</div>
      ) : null}
    </div>
  );
}
