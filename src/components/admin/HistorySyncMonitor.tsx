import type { Dispatch, SetStateAction } from "react";
import type { MlAdminStatus } from "../../types";

type HistorySync = NonNullable<MlAdminStatus["historySync"]>;

function syncHealthTone(health?: "ok" | "warn" | "fail") {
  if (health === "ok") return "text-[var(--fp-success)]";
  if (health === "fail") return "text-[var(--fp-danger)]";
  return "text-[var(--fp-warning)]";
}

function syncHintTone(level?: "ok" | "warn" | "fail") {
  if (level === "ok") return "border-[var(--fp-success)]/25 bg-[var(--fp-success)]/5 text-[var(--fp-success)]";
  if (level === "fail") return "border-[var(--fp-danger)]/25 bg-[var(--fp-danger)]/5 text-[var(--fp-danger)]";
  return "border-[var(--fp-warning)]/25 bg-[var(--fp-warning)]/5 text-[var(--fp-warning)]";
}

function reliabilityTone(reliability?: string) {
  if (reliability === "HEALTHY") return "border-[var(--fp-success)]/30 bg-[var(--fp-success)]/10 text-[var(--fp-success)]";
  if (reliability === "CRITICAL") return "border-[var(--fp-danger)]/35 bg-[var(--fp-danger)]/12 text-[var(--fp-danger)]";
  return "border-[var(--fp-warning)]/30 bg-[var(--fp-warning)]/10 text-[var(--fp-warning)]";
}

function callsBudgetTone(level?: string) {
  if (level === "critical") return "text-[var(--fp-danger)]";
  if (level === "warn") return "text-[var(--fp-warning)]";
  return "text-[var(--fp-success)]";
}

type HistorySyncMonitorProps = {
  historySync: HistorySync;
  snoozedAlerts: Record<string, number>;
  setSnoozedAlerts: Dispatch<SetStateAction<Record<string, number>>>;
  snoozeAlert: (code: string, minutes?: number) => void;
  showOnlySyncFailures: boolean;
  setShowOnlySyncFailures: Dispatch<SetStateAction<boolean>>;
};

export function HistorySyncMonitor({
  historySync,
  snoozedAlerts,
  setSnoozedAlerts,
  snoozeAlert,
  showOnlySyncFailures,
  setShowOnlySyncFailures
}: HistorySyncMonitorProps) {
  const visibleSyncAlerts = (historySync.alerts || []).filter((alert) => {
    const code = String(alert.code || "");
    if (!code) return true;
    const until = snoozedAlerts[code];
    return !(Number.isFinite(until) && until > Date.now());
  });
  const syncRecentRows = (historySync.recent || [])
    .slice()
    .sort((a, b) => {
      if (a.ok !== b.ok) return a.ok ? 1 : -1;
      const ta = a.ranAt ? new Date(a.ranAt).getTime() : 0;
      const tb = b.ranAt ? new Date(b.ranAt).getTime() : 0;
      return tb - ta;
    })
    .filter((row) => (showOnlySyncFailures ? !row.ok : true));

  return (
    <div className="mt-4 rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-accent-hover)]">History sync monitor</span>
        <span className={`font-mono text-[10px] uppercase tracking-wider ${syncHealthTone(historySync.health)}`}>
          {historySync.health || "warn"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-2 sm:col-span-3">
          <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">Reliability</div>
          <div className="mt-1">
            <span className={`inline-flex rounded px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider ${reliabilityTone(historySync.summary?.reliability)}`}>
              {historySync.summary?.reliability || "DEGRADED"}
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-2">
          <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">Last run</div>
          <div className="mt-1 font-mono text-[10px] text-[var(--fp-text)]">
            {historySync.last?.ranAt ? new Date(historySync.last.ranAt).toLocaleString() : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-2">
          <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">Last updated</div>
          <div className="mt-1 font-mono text-[10px] text-[var(--fp-text)]">{historySync.last?.updated ?? 0}</div>
        </div>
        <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-2">
          <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">Last est. calls</div>
          <div className="mt-1 font-mono text-[10px] text-[var(--fp-text)]">{historySync.last?.estimatedCalls ?? 0}</div>
        </div>
        <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-2">
          <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">Recent failures</div>
          <div className="mt-1 font-mono text-[10px] text-[var(--fp-text)]">
            {historySync.summary?.failures ?? 0} / {historySync.summary?.runs ?? 0}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-2 sm:col-span-3">
          <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">Sync age (hours)</div>
          <div
            className={`mt-1 font-mono text-[10px] ${
              (historySync.summary?.hoursSinceLastRun ?? 999) > 8 ? "text-[var(--fp-danger)]" : "text-[var(--fp-text)]"
            }`}
          >
            {historySync.summary?.hoursSinceLastRun != null ? historySync.summary.hoursSinceLastRun.toFixed(2) : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-2 sm:col-span-3">
          <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">Last successful run</div>
          <div className="mt-1 font-mono text-[10px] text-[var(--fp-text)]">
            {historySync.lastSuccessfulRun?.ranAt
              ? new Date(historySync.lastSuccessfulRun.ranAt).toLocaleString()
              : "No successful run in recent window"}
          </div>
          <div
            className={`mt-1 font-mono text-[9px] ${
              (historySync.summary?.hoursSinceLastSuccess ?? 999) > 8 ? "text-[var(--fp-danger)]" : "text-[var(--fp-text-muted)]"
            }`}
          >
            age:{" "}
            {historySync.summary?.hoursSinceLastSuccess != null
              ? `${historySync.summary.hoursSinceLastSuccess.toFixed(2)}h`
              : "—"}
          </div>
        </div>
      </div>
      {historySync.last?.error && (
        <div className="mt-2 rounded-lg border border-[var(--fp-danger)]/25 bg-[var(--fp-danger)]/5 px-3 py-2 font-mono text-[10px] text-[var(--fp-danger)]">
          {historySync.last.error}
        </div>
      )}
      {historySync.hint && (
        <div className={`mt-2 rounded-lg border px-3 py-2 font-mono text-[10px] ${syncHintTone(historySync.hint.level)}`}>
          <div className="font-semibold uppercase tracking-wider">{historySync.hint.title || "Sync hint"}</div>
          <div className="mt-1">{historySync.hint.message || "—"}</div>
        </div>
      )}
      {Array.isArray(historySync.alerts) && visibleSyncAlerts.length > 0 && (
        <div className="mt-2 space-y-1">
          {Object.keys(snoozedAlerts).length > 0 && (
            <div className="mb-1 flex justify-end">
              <button
                type="button"
                onClick={() => setSnoozedAlerts({})}
                className="rounded border border-[var(--fp-border)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[var(--fp-text)] hover:bg-[var(--fp-bg-muted)]"
                title="Reafișează toate alertele ascunse local."
              >
                Reset snoozed alerts
              </button>
            </div>
          )}
          {visibleSyncAlerts.map((alert, idx) => (
            <div
              key={`${alert.code || "alert"}-${idx}`}
              className={`rounded-lg border px-3 py-2 font-mono text-[10px] ${
                alert.level === "fail"
                  ? "border-[var(--fp-danger)]/35 bg-[var(--fp-danger)]/10 text-[var(--fp-danger)]"
                  : "border-[var(--fp-warning)]/30 bg-[var(--fp-warning)]/10 text-[var(--fp-warning)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span>{alert.message || "Atenție operațională."}</span>
                <button
                  type="button"
                  onClick={() => snoozeAlert(String(alert.code || ""), 60)}
                  className="rounded border border-[var(--fp-border)] px-2 py-0.5 text-[9px] uppercase tracking-wide text-[var(--fp-text)] hover:bg-[var(--fp-bg-muted)]"
                  title="Ascunde alerta 60 minute (local)."
                >
                  Snooze 60m
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 font-mono text-[10px] text-[var(--fp-text)]">
          24h runs: <span className="text-[var(--fp-text)]">{historySync.summary?.runs24h ?? 0}</span>
        </div>
        <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 font-mono text-[10px] text-[var(--fp-text)]">
          24h success: <span className={(historySync.summary?.successRate24h ?? 0) >= 90 ? "text-[var(--fp-success)]" : "text-[var(--fp-warning)]"}>
            {historySync.summary?.successRate24h != null ? `${historySync.summary.successRate24h.toFixed(1)}%` : "—"}
          </span>
        </div>
        <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 font-mono text-[10px] text-[var(--fp-text)]">
          24h updated: <span className="text-[var(--fp-text)]">{historySync.summary?.updated24h ?? 0}</span>
        </div>
        <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 font-mono text-[10px] text-[var(--fp-text)] sm:col-span-3">
          24h scanned: <span className="text-[var(--fp-text)]">{historySync.summary?.scanned24h ?? 0}</span>
        </div>
        <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 font-mono text-[10px] text-[var(--fp-text)]">
          24h est. calls: <span className="text-[var(--fp-text)]">{historySync.summary?.estimatedCalls24h ?? 0}</span>
        </div>
        <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 font-mono text-[10px] text-[var(--fp-text)] sm:col-span-2">
          Avg est. calls/run: <span className="text-[var(--fp-text)]">
            {historySync.summary?.avgEstimatedCallsPerRun != null
              ? historySync.summary.avgEstimatedCallsPerRun.toFixed(1)
              : "—"}
          </span>
        </div>
        <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 font-mono text-[10px] text-[var(--fp-text)] sm:col-span-3">
          Calls budget:
          {" "}
          <span className={callsBudgetTone(historySync.summary?.callsBudgetLevel)}>
            {String(historySync.summary?.callsBudgetLevel || "ok").toUpperCase()}
          </span>
          {" "}
          <span className="text-[var(--fp-text-muted)]">
            ({historySync.summary?.estimatedCalls24h ?? 0} / warn {historySync.summary?.callsBudgetWarn24h ?? 500} / critical {historySync.summary?.callsBudgetCritical24h ?? 1000})
          </span>
        </div>
      </div>
      {Array.isArray(historySync.recent) && historySync.recent.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => setShowOnlySyncFailures((prev) => !prev)}
              className={`rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide ${
                showOnlySyncFailures
                  ? "border-[var(--fp-danger)]/35 bg-[var(--fp-danger)]/10 text-[var(--fp-danger)]"
                  : "border-[var(--fp-border)] text-[var(--fp-text)] hover:bg-[var(--fp-bg-muted)]"
              }`}
              title="Afișează doar rulările eșuate."
            >
              {showOnlySyncFailures ? "Showing failures only" : "Show only failures"}
            </button>
          </div>
          <table className="w-full min-w-[420px] font-mono text-[10px] tabular-nums">
            <thead className="text-left text-[var(--fp-text-muted)]">
              <tr>
                <th className="py-1 pr-2">Ran at</th>
                <th className="py-1 pr-2">Source</th>
                <th className="py-1 pr-2 text-right">Est.calls</th>
                <th className="py-1 pr-2 text-right">Updated</th>
                <th className="py-1 pr-2 text-right">OK</th>
              </tr>
            </thead>
            <tbody className="text-[var(--fp-text)]">
              {syncRecentRows.slice(0, 6).map((row, idx) => (
                <tr key={`${row.ranAt || "na"}-${idx}`} className="border-t border-[var(--fp-border)]">
                  <td className="py-1 pr-2">{row.ranAt ? new Date(row.ranAt).toLocaleString() : "—"}</td>
                  <td className="py-1 pr-2">{row.source || "—"}</td>
                  <td className="py-1 pr-2 text-right">{row.estimatedCalls ?? 0}</td>
                  <td className="py-1 pr-2 text-right">{row.updated ?? 0}</td>
                  <td className={`py-1 pr-2 text-right ${row.ok ? "text-[var(--fp-success)]" : "text-[var(--fp-danger)]"}`}>{row.ok ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {historySync.persist && (
        <div className="mt-3 rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-2">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">Predict persist telemetry</div>
          <div className="grid grid-cols-2 gap-2 font-mono text-[10px] text-[var(--fp-text)] sm:grid-cols-3">
            <div>runs: {historySync.persist.runs ?? 0}</div>
            <div>inserted: {historySync.persist.inserted ?? 0}</div>
            <div>updated: {historySync.persist.updated ?? 0}</div>
            <div>skip final: {historySync.persist.skippedFinal ?? 0}</div>
            <div>skip stale: {historySync.persist.skippedStale ?? 0}</div>
            <div>skip prekickoff: {historySync.persist.skippedPrekickoff ?? 0}</div>
          </div>
        </div>
      )}
    </div>
  );
}
