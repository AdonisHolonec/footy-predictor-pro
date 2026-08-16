import { StatTile } from "../../design-system";
import { HistorySyncMonitor } from "./HistorySyncMonitor";
import { useModelMetrics } from "./useModelMetrics";

// =============================================================================
// MODEL METRICS PANEL — vizibil doar pentru admin autentificat.
// Afişează Brier 1X2, log-loss, ECE, defalcări per metodă/ligă/versiune model
// şi status pentru pipeline-ul ML (calibration maps, stacker, Elo).
// =============================================================================

type AdminModelMetricsPanelProps = {
  accessToken: string | null | undefined;
  /** Zile window pentru metrici (default 45). */
  days?: number;
};

type MetricTone = "neutral" | "accent" | "success" | "danger" | "warning";

function healthTone(value: number | null | undefined, good: number, warn: number, lowerIsBetter = true): MetricTone {
  if (value == null || !Number.isFinite(value)) return "neutral";
  const v = Number(value);
  const bad = lowerIsBetter ? v > warn : v < warn;
  const ok = lowerIsBetter ? v <= good : v >= good;
  if (ok) return "success";
  if (bad) return "danger";
  return "warning";
}

export function AdminModelMetricsPanel({ accessToken, days = 45 }: AdminModelMetricsPanelProps) {
  const {
    metrics,
    mlStatus,
    loading,
    err,
    refreshing,
    training,
    syncingHistoryNow,
    snoozedAlerts,
    setSnoozedAlerts,
    showOnlySyncFailures,
    setShowOnlySyncFailures,
    trainReport,
    load,
    snoozeAlert,
    invalidate,
    trainNow,
    runHistorySyncNow
  } = useModelMetrics({ accessToken, days });

  if (!accessToken) return null;

  const brier = metrics?.brier1x2 ?? null;
  const logLoss = metrics?.logLoss1x2 ?? null;
  const ece = metrics?.ece1x2 ?? null;

  return (
    <section className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 shadow-fp-sm md:p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--fp-accent-hover)]">Model metrics</h2>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">
            window {days}d · {metrics?.nProb ?? 0} settled cu probabilităţi
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mlStatus && (
            <div className="hidden font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text)] sm:block">
              cal · {mlStatus.calibrationMaps ?? 0} · stk · {mlStatus.activeStackerWeights ?? 0} · elo · {mlStatus.eloTeams ?? 0}
            </div>
          )}
          <button
            type="button"
            onClick={trainNow}
            disabled={training}
            className="touch-manipulation rounded-lg border border-fp-success/25 bg-fp-success/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-success)] hover:bg-fp-success/15 disabled:cursor-not-allowed disabled:opacity-50"
            title="Rulează acum agentul de antrenare ML (calibration + stacker) pe baza istoricului."
          >
            {training ? "Training…" : "Train now"}
          </button>
          <button
            type="button"
            onClick={invalidate}
            disabled={refreshing}
            className="touch-manipulation rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-accent)] hover:bg-[var(--fp-border)] disabled:cursor-not-allowed disabled:opacity-50"
            title="Invalidează cache-ul de calibrare/stacker/elo (le reîncarcă la următorul predict)"
          >
            {refreshing ? "…" : "Refresh cache"}
          </button>
          <button
            type="button"
            onClick={runHistorySyncNow}
            disabled={syncingHistoryNow}
            className="touch-manipulation rounded-lg border border-fp-success/25 bg-fp-success/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-success)] hover:bg-fp-success/15 disabled:cursor-not-allowed disabled:opacity-50"
            title="Rulează manual /api/history?sync=1 și reîncarcă monitorizarea."
          >
            {syncingHistoryNow ? "Syncing…" : "Run history sync"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="touch-manipulation rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text)] hover:bg-[var(--fp-border)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "…" : "Reload"}
          </button>
        </div>
      </div>

      {err && <div className="mb-3 rounded-lg border border-fp-danger/25 bg-fp-danger/5 px-3 py-2 text-[11px] text-[var(--fp-danger)]">{err}</div>}
      {trainReport && (
        <div className="mb-3 rounded-lg border border-fp-success/35 bg-fp-success/10 px-3 py-2">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--fp-success)]">Last training run</div>
          <div className="mt-1 grid grid-cols-1 gap-1 font-mono text-[10px] text-[var(--fp-accent)] sm:grid-cols-2">
            <div>Mode: <span className="text-[var(--fp-text)]">{trainReport.mode || "all"}</span></div>
            <div>Model: <span className="text-[var(--fp-text)]">{trainReport.modelVersion || "—"}</span></div>
            <div>Calibration: <span className="text-[var(--fp-text)]">{trainReport.calibrationRows || 0} rows · {trainReport.calibrationSummary || 0} maps</span></div>
            <div>Stacker: <span className="text-[var(--fp-text)]">{trainReport.stackerRows || 0} rows · {trainReport.stackerSamples || 0} samples · {trainReport.stackerTrained || 0} weights</span></div>
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">
            finished {trainReport.finishedAt ? new Date(trainReport.finishedAt).toLocaleString() : "—"}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Brier 1X2" value={brier != null ? brier.toFixed(4) : "—"} hint="lower = better" tone={healthTone(brier, 0.185, 0.205)} />
        <StatTile label="LogLoss" value={logLoss != null ? logLoss.toFixed(4) : "—"} hint="multinomial CE" tone={healthTone(logLoss, 0.98, 1.05)} />
        <StatTile label="ECE 1X2" value={ece != null ? `${ece.toFixed(2)}%` : "—"} hint="calibration gap" tone={healthTone(ece, 3, 6)} />
        <StatTile
          label="Pipeline"
          value={(mlStatus?.calibrationMaps || 0) > 0 ? ((mlStatus?.activeStackerWeights || 0) > 0 ? "ML + CAL" : "CAL") : "DC only"}
          hint={mlStatus?.modelVersion || "—"}
          tone={(mlStatus?.activeStackerWeights || 0) > 0 ? "success" : (mlStatus?.calibrationMaps || 0) > 0 ? "accent" : "neutral"}
        />
      </div>

      {mlStatus?.seasonInfo && (
        <div className="mt-3 rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 font-mono text-[10px] text-[var(--fp-text)]">
          <span className="mr-3">Effective season: <span className="text-[var(--fp-text)]">{mlStatus.seasonInfo.effectiveSeason ?? "—"}</span></span>
          <span className="mr-3">Inferred: <span className="text-[var(--fp-text)]">{mlStatus.seasonInfo.inferredSeason ?? "—"}</span></span>
          <span className={mlStatus.seasonInfo.overrideActive ? "text-[var(--fp-warning)]" : "text-[var(--fp-success)]"}>
            {mlStatus.seasonInfo.overrideActive ? "Override active" : "Auto season"}
          </span>
        </div>
      )}

      {mlStatus?.historySync && (
        <HistorySyncMonitor
          historySync={mlStatus.historySync}
          snoozedAlerts={snoozedAlerts}
          setSnoozedAlerts={setSnoozedAlerts}
          snoozeAlert={snoozeAlert}
          showOnlySyncFailures={showOnlySyncFailures}
          setShowOnlySyncFailures={setShowOnlySyncFailures}
        />
      )}

      {metrics?.calibration1x2 && metrics.calibration1x2.length > 0 && (
        <div className="mt-5 rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-accent-hover)]">Calibration buckets</span>
            <span className="font-mono text-[9px] text-[var(--fp-text-muted)]">confidence vs accuracy</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[380px] font-mono text-[10px] tabular-nums">
              <thead className="text-left text-[var(--fp-text-muted)]">
                <tr>
                  <th className="py-1 pr-2">Bucket</th>
                  <th className="py-1 pr-2 text-right">n</th>
                  <th className="py-1 pr-2 text-right">Avg conf</th>
                  <th className="py-1 pr-2 text-right">Accuracy</th>
                  <th className="py-1 pr-2 text-right">Gap</th>
                </tr>
              </thead>
              <tbody className="text-[var(--fp-text)]">
                {metrics.calibration1x2.map((b) => {
                  const gap = b.avgConfidence - b.accuracy1x2;
                  const tone = Math.abs(gap) <= 3 ? "text-[var(--fp-success)]" : Math.abs(gap) <= 6 ? "text-[var(--fp-warning)]" : "text-[var(--fp-danger)]";
                  return (
                    <tr key={b.bucket} className="border-t border-[var(--fp-border)]">
                      <td className="py-1 pr-2">{b.bucket}</td>
                      <td className="py-1 pr-2 text-right">{b.n}</td>
                      <td className="py-1 pr-2 text-right">{b.avgConfidence.toFixed(1)}%</td>
                      <td className="py-1 pr-2 text-right">{b.accuracy1x2.toFixed(1)}%</td>
                      <td className={`py-1 pr-2 text-right ${tone}`}>{gap > 0 ? "+" : ""}{gap.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {metrics?.byModelVersion && metrics.byModelVersion.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <BreakdownTable title="By model version" rows={metrics.byModelVersion.slice(0, 6)} />
          {metrics.byMethod && <BreakdownTable title="By method" rows={metrics.byMethod.slice(0, 6)} />}
        </div>
      )}

      {mlStatus?.helpers?.scripts && (
        <details className="mt-5 rounded-xl border border-dashed border-[var(--fp-border)] bg-[var(--fp-bg)] p-3 font-mono text-[10px] text-[var(--fp-text-muted)]">
          <summary className="cursor-pointer text-[var(--fp-accent-hover)]">Refit scripts</summary>
          <ul className="mt-2 space-y-1 list-inside">
            {mlStatus.helpers.scripts.map((s) => (
              <li key={s} className="break-all">
                <code className="text-[var(--fp-text)]">{s}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function BreakdownTable({
  title,
  rows
}: {
  title: string;
  rows: Array<{ key: string; n: number; brier: number; logLoss: number }>;
}) {
  return (
    <div className="rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg)] p-3">
      <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-[var(--fp-accent-hover)]">{title}</div>
      <table className="w-full font-mono text-[10px] tabular-nums">
        <thead className="text-left text-[var(--fp-text-muted)]">
          <tr>
            <th className="py-1 pr-2">Key</th>
            <th className="py-1 pr-2 text-right">n</th>
            <th className="py-1 pr-2 text-right">Brier</th>
            <th className="py-1 pr-2 text-right">LogLoss</th>
          </tr>
        </thead>
        <tbody className="text-[var(--fp-text)]">
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-[var(--fp-border)]">
              <td className="py-1 pr-2 max-w-[140px] truncate" title={r.key}>{r.key}</td>
              <td className="py-1 pr-2 text-right">{r.n}</td>
              <td className="py-1 pr-2 text-right">{r.brier.toFixed(4)}</td>
              <td className="py-1 pr-2 text-right">{r.logLoss.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
