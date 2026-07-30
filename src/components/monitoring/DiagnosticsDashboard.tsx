import { useCallback, useEffect, useState } from "react";
import type { HealthDashboardBundle, LatencyChannelStats } from "../../types";
import { loadHealthDashboard } from "../../services/healthService";
import { StatTile, Button } from "../../design-system";

type LambdaRouteKey =
  | "lambdaPredictionEngine"
  | "lambdaStrengthRatings"
  | "lambdaStandings"
  | "lambdaPartialStats"
  | "lambdaUefaFallback"
  | "lambdaInsufficientData";

const LAMBDA_SOURCES: { key: LambdaRouteKey; label: string }[] = [
  { key: "lambdaPredictionEngine", label: "PredictionEngine" },
  { key: "lambdaStrengthRatings", label: "StrengthRatings" },
  { key: "lambdaStandings", label: "Standings" },
  { key: "lambdaPartialStats", label: "PartialStats" },
  { key: "lambdaUefaFallback", label: "UEFAFallback" },
  { key: "lambdaInsufficientData", label: "InsufficientData" }
];

type HealthTone = "ok" | "warn" | "error" | "unknown";

const TONE_STYLES: Record<HealthTone, { dot: string; text: string; bg: string; border: string; label: string }> = {
  ok: {
    dot: "bg-[var(--fp-success)]",
    text: "text-[var(--fp-success)]",
    bg: "bg-[var(--fp-success)]/8",
    border: "border-[var(--fp-success)]/30",
    label: "OK"
  },
  warn: {
    dot: "bg-[var(--fp-warning)]",
    text: "text-[var(--fp-warning)]",
    bg: "bg-[var(--fp-warning)]/8",
    border: "border-[var(--fp-warning)]/30",
    label: "Warning"
  },
  error: {
    dot: "bg-[var(--fp-danger)]",
    text: "text-[var(--fp-danger)]",
    bg: "bg-[var(--fp-danger)]/8",
    border: "border-[var(--fp-danger)]/30",
    label: "Error"
  },
  unknown: {
    dot: "bg-[var(--fp-text-faint)]",
    text: "text-[var(--fp-text-muted)]",
    bg: "bg-[var(--fp-bg-muted)]",
    border: "border-[var(--fp-border)]",
    label: "No data"
  }
};

function HealthCard({ title, tone, hint }: { title: string; tone: HealthTone; hint: string }) {
  const s = TONE_STYLES[tone];
  return (
    <div className={`rounded-[var(--fp-radius)] border ${s.border} ${s.bg} p-3 shadow-[var(--fp-shadow-sm)]`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
        <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fp-text-muted)]">
          {title}
        </span>
      </div>
      <div className={`mt-1.5 font-display text-lg font-semibold ${s.text}`}>{s.label}</div>
      <div className="mt-1 text-[10px] text-[var(--fp-text-muted)]/85">{hint}</div>
    </div>
  );
}

function LambdaSourceRow({ label, count, pct }: { label: string; count: number; pct: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 truncate text-[11px] font-semibold text-[var(--fp-text)] sm:w-44">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--fp-bg-muted)]">
        <div
          className="h-full w-full origin-left rounded-full bg-[var(--fp-accent)] transition-transform duration-500"
          style={{ transform: `scaleX(${Math.max(0, Math.min(100, pct)) / 100})` }}
        />
      </div>
      <span className="w-24 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--fp-text-muted)]">
        {count} · {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "—";
}

function hoursSince(iso?: string | null): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / (1000 * 60 * 60) : Infinity;
}

export default function DiagnosticsDashboard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<HealthDashboardBundle | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadHealthDashboard(1);
      setBundle(data);
    } catch (err) {
      setBundle(null);
      setError(err instanceof Error ? err.message : "Failed to load diagnostics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const routes = bundle?.metrics?.routes;
  const zeroChannel: LatencyChannelStats = { count: 0, errors: 0, errorRate: 0, avgMs: 0, maxMs: 0, p50Ms: null, p95Ms: null };

  const sources = LAMBDA_SOURCES.map((s) => ({
    label: s.label,
    count: routes?.[s.key]?.count ?? zeroChannel.count
  }));
  const total = sources.reduce((sum, s) => sum + s.count, 0);
  const sortedSources = [...sources]
    .sort((a, b) => b.count - a.count)
    .map((s) => ({ ...s, pct: total > 0 ? (s.count / total) * 100 : 0 }));

  const insufficientCount = routes?.lambdaInsufficientData?.count ?? 0;
  const successfulCount = Math.max(0, total - insufficientCount);
  const coveragePct = total > 0 ? (successfulCount / total) * 100 : null;

  const predictionTone: HealthTone =
    total === 0 ? "unknown" : coveragePct != null && coveragePct >= 90 ? "ok" : coveragePct != null && coveragePct >= 70 ? "warn" : "error";

  const usagePct = bundle?.usage?.pct ?? 0;
  const apiErrorRate = bundle?.performance?.apiLatency?.errorRate ?? 0;
  const apiTone: HealthTone = !bundle
    ? "unknown"
    : usagePct >= 95 || apiErrorRate >= 0.35
      ? "error"
      : usagePct >= 80 || apiErrorRate >= 0.15
        ? "warn"
        : "ok";

  const hitRatio = bundle?.cache?.hitRatio ?? null;
  const cacheTone: HealthTone = hitRatio == null ? "unknown" : hitRatio >= 0.4 ? "ok" : hitRatio >= 0.15 ? "warn" : "error";

  const telemetryUpdatedAt = bundle?.metrics?.updatedAt ?? null;
  const telemetryAgeHours = hoursSince(telemetryUpdatedAt);
  const telemetryTone: HealthTone = !telemetryUpdatedAt
    ? "unknown"
    : telemetryAgeHours <= 2
      ? "ok"
      : telemetryAgeHours <= 24
        ? "warn"
        : "error";

  return (
    <div className="mt-4 overflow-hidden rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-[var(--fp-shadow-sm)] sm:mt-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--fp-border)] px-3.5 py-3 sm:px-5">
        <div>
          <h3 className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fp-accent)]">
            Internal Monitoring
          </h3>
          <p className="mt-1 font-display text-sm font-semibold text-[var(--fp-text)] sm:text-base">
            Diagnostics · lambda sources · coverage · health
          </p>
        </div>
        <Button variant="primary" size="sm" loading={loading} onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded-lg border border-[var(--fp-danger)]/30 bg-[var(--fp-danger)]/10 px-3 py-2 font-mono text-[11px] text-[var(--fp-danger)] sm:mx-5">
          {error}
        </div>
      ) : null}

      {bundle ? (
        <div className="space-y-5 p-4 sm:p-5">
          <section>
            <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--fp-text)]">
              Lambda Sources
            </h4>
            <div className="space-y-2.5 rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg)] p-3">
              {sortedSources.map((s) => (
                <LambdaSourceRow key={s.label} label={s.label} count={s.count} pct={s.pct} />
              ))}
            </div>
          </section>

          <section>
            <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--fp-text)]">
              Prediction Coverage
            </h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="Total Today" value={String(total)} />
              <StatTile label="Successful" value={String(successfulCount)} tone="success" />
              <StatTile label="Insufficient Data" value={String(insufficientCount)} tone={insufficientCount > 0 ? "warning" : "neutral"} />
              <StatTile label="Coverage" value={coveragePct != null ? `${coveragePct.toFixed(1)}%` : "—"} tone="accent" />
            </div>
          </section>

          <section>
            <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--fp-text)]">
              Health
            </h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <HealthCard title="Prediction Engine" tone={predictionTone} hint={coveragePct != null ? `${coveragePct.toFixed(1)}% coverage` : "No predictions yet"} />
              <HealthCard title="API" tone={apiTone} hint={`quota ${usagePct.toFixed(0)}%`} />
              <HealthCard title="Cache" tone={cacheTone} hint={hitRatio != null ? `hit ratio ${(hitRatio * 100).toFixed(0)}%` : "no data"} />
              <HealthCard title="Telemetry" tone={telemetryTone} hint={telemetryUpdatedAt ? fmtDateTime(telemetryUpdatedAt) : "no data"} />
            </div>
          </section>

          <section>
            <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--fp-text)]">
              Last Update
            </h4>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <StatTile label="Last Telemetry Update" value={fmtDateTime(telemetryUpdatedAt)} />
              <StatTile label="Predictions Processed Today" value={String(total)} />
            </div>
          </section>
        </div>
      ) : !error && !loading ? (
        <div className="px-4 py-8 text-center font-mono text-[11px] text-[var(--fp-text-muted)]">No diagnostics data</div>
      ) : null}
    </div>
  );
}
