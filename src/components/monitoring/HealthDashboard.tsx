import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { HealthDashboardBundle, OpsAlert } from "../../types";
import { loadHealthDashboard } from "../../services/healthService";
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
  if (status === "healthy") return "text-emerald-300";
  if (status === "degraded") return "text-amber-200";
  if (status === "critical") return "text-rose-300";
  return "text-signal-silver";
}

function Widget({
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
    <div className="lab-stat">
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

function AlertList({ alerts }: { alerts: OpsAlert[] }) {
  if (!alerts.length) {
    return (
      <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-3 py-3 font-mono text-[11px] text-emerald-200/90">
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
              ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
              : "border-amber-400/25 bg-amber-500/10 text-amber-100"
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
  background: "rgba(10, 16, 24, 0.96)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  fontSize: 11,
  color: "#d5dee8"
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
    <section className="lab-card mt-4 overflow-hidden sm:mt-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.06] px-3.5 py-3 sm:px-5">
        <div>
          <h3 className="lab-section-eyebrow">Enterprise Monitoring</h3>
          <p className="mt-1 font-display text-sm font-semibold text-signal-ink sm:text-base">
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
                  ? "border-signal-petrol/50 bg-signal-petrol/25 text-signal-mint"
                  : "border-white/10 bg-signal-void/50 text-signal-inkMuted hover:text-signal-silver"
              }`}
            >
              {d}D
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

      {bundle ? (
        <>
          <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.04] px-4 py-3 sm:px-5">
            <div className={`font-mono text-xs font-semibold uppercase tracking-[0.18em] ${statusTone(bundle.status)}`}>
              {bundle.status}
            </div>
            <div className="font-mono text-[10px] text-signal-inkMuted">
              severity {bundle.severity} · {new Date(bundle.generatedAt).toLocaleString()}
            </div>
            <div className="font-mono text-[10px] text-signal-inkMuted">
              KV {bundle.checks.kv.ok ? "ok" : "down"}
              {bundle.checks.kv.latencyMs != null ? ` ${bundle.checks.kv.latencyMs}ms` : ""}
              {" · "}
              Supabase {bundle.checks.supabase.ok ? "ok" : "down"}
              {bundle.checks.supabase.latencyMs != null ? ` ${bundle.checks.supabase.latencyMs}ms` : ""}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-6">
            <Widget
              label="Prediction Latency"
              value={fmtMs(perf?.predictionLatency.p95Ms ?? perf?.predictionLatency.avgMs)}
              hint={`avg ${fmtMs(perf?.predictionLatency.avgMs)} · n=${perf?.predictionLatency.count ?? 0}`}
            />
            <Widget
              label="API Latency"
              value={fmtMs(perf?.apiLatency.p95Ms ?? perf?.apiLatency.avgMs)}
              hint={`avg ${fmtMs(perf?.apiLatency.avgMs)} · err ${(perf?.apiLatency.errorRate ?? 0) * 100}%`}
            />
            <Widget
              label="Cache Latency"
              value={fmtMs(perf?.cacheLatency.p95Ms ?? perf?.cacheLatency.avgMs)}
              hint={`avg ${fmtMs(perf?.cacheLatency.avgMs)} · hits ${bundle.cache.hits}`}
            />
            <Widget
              label="Memory"
              value={`${bundle.process.memory.heapUsedMb.toFixed(0)} MB`}
              hint={`RSS ${bundle.process.memory.rssMb.toFixed(0)} · heap ${bundle.process.memory.heapTotalMb.toFixed(0)}`}
            />
            <Widget
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
            <Widget
              label="Cache Hit Ratio"
              value={
                bundle.cache.hitRatio != null ? `${(bundle.cache.hitRatio * 100).toFixed(1)}%` : "—"
              }
              hint={`${bundle.cache.hits} / ${bundle.cache.hits + bundle.cache.misses}`}
              tone={
                bundle.cache.hitRatio != null && bundle.cache.hitRatio >= 0.4
                  ? "good"
                  : bundle.cache.hitRatio != null && bundle.cache.hitRatio < 0.15
                    ? "amber"
                    : "default"
              }
            />
            <Widget
              label="Prediction Failures"
              value={String(bundle.failures.prediction)}
              tone={bundle.failures.prediction >= 3 ? "bad" : "default"}
              hint="Today"
            />
            <Widget
              label="API Failures"
              value={String(bundle.failures.api)}
              tone={bundle.failures.api >= 5 ? "bad" : "default"}
              hint="Today"
            />
            <Widget
              label="Cache Failures"
              value={String(bundle.failures.cache)}
              tone={bundle.failures.cache >= 3 ? "bad" : "default"}
              hint="Today"
            />
            <Widget
              label="API Remaining"
              value={String(bundle.usage.remaining)}
              hint={`${bundle.usage.count}/${bundle.usage.limit} · ${bundle.usage.pct}%`}
              tone={bundle.usage.pct >= 90 ? "bad" : bundle.usage.pct >= 70 ? "amber" : "good"}
            />
            <Widget
              label="Uptime"
              value={`${bundle.process.uptimeSec.toFixed(0)}s`}
              hint={bundle.process.node || "process"}
            />
            <Widget
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
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="key" tick={{ fill: "#8a9aaa", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#7a8a9a", fontSize: 10 }} width={40} />
                    <Tooltip contentStyle={tip} />
                    <Bar dataKey="avg" name="Avg" fill="#6a9bb8" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="p95" name="P95" fill="#5ec4b6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
            <ChartCard title="Failures (history)" subtitle="Prediction · API · Cache">
              <div className="h-52 w-full sm:h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hist} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "#7a8a9a", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#7a8a9a", fontSize: 10 }} width={28} allowDecimals={false} />
                    <Tooltip contentStyle={tip} />
                    <Line type="monotone" dataKey="predFail" name="Predict" stroke="#e07a7a" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="apiFail" name="API" stroke="#e0b46a" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="cacheFail" name="Cache" stroke="#6a9bb8" strokeWidth={2} dot={false} />
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
                <div className="font-mono text-[11px] text-signal-inkMuted">
                  No reports yet — cron runs at 00:05 UTC.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {(bundle.recentReports?.length ? bundle.recentReports : bundle.dailyReport ? [bundle.dailyReport] : []).map(
                    (r) => (
                      <li
                        key={r.date}
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.04] bg-signal-mist/10 px-2.5 py-1.5 font-mono text-[11px]"
                      >
                        <span className="text-signal-silver">{r.date}</span>
                        <span className={statusTone(r.status)}>{r.status}</span>
                        <span className="text-signal-inkMuted">
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
        <div className="px-4 py-8 text-center font-mono text-[11px] text-signal-inkMuted">No health data</div>
      ) : null}
    </section>
  );
}
