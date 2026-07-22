import { useCallback, useEffect, useState } from "react";
import type { ModelLabBundle, ModelLabResult, ModelSelectionBundle } from "../../types";
import { loadModelLab, loadModelSelection } from "../../services/backtestService";
import { Button } from "../../design-system";

function metricTone(value: number, kind: "roi" | "ev"): string {
  if (kind === "roi" || kind === "ev") {
    if (value > 0) return "text-[var(--fp-success)]";
    if (value < 0) return "text-[var(--fp-danger)]";
  }
  return "text-[var(--fp-text-muted)]";
}

function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2.5 py-2 font-mono text-[11px] tabular-nums ${className}`}>{children}</td>;
}

export default function ModelLabPanel() {
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lab, setLab] = useState<ModelLabBundle | null>(null);
  const [selection, setSelection] = useState<ModelSelectionBundle | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [labRes, selRes] = await Promise.allSettled([loadModelLab(days), loadModelSelection()]);
      setLab(labRes.status === "fulfilled" ? labRes.value : null);
      setSelection(selRes.status === "fulfilled" ? selRes.value : null);
      if (labRes.status === "rejected" && selRes.status === "rejected") {
        throw labRes.reason instanceof Error ? labRes.reason : new Error("Failed to load model lab");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load model lab");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const models: ModelLabResult[] = lab?.models || [];

  return (
    <div className="mt-4 overflow-hidden rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-[var(--fp-shadow-sm)] sm:mt-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--fp-border)] px-3.5 py-3 sm:px-5">
        <div>
          <h3 className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fp-accent)]">
            Model Laboratory
          </h3>
          <p className="mt-1 font-display text-sm font-semibold text-[var(--fp-text)] sm:text-base">
            Multi-model backtest · Accuracy · ROI · Yield · LogLoss · Brier · EV
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {[30, 90, 180].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-full border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide ${
                days === d
                  ? "border-[var(--fp-accent)]/50 bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                  : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
              }`}
            >
              {d}D
            </button>
          ))}
          <Button variant="primary" size="sm" loading={loading} onClick={() => void refresh()}>
            Run
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded-lg border border-[var(--fp-danger)]/30 bg-[var(--fp-danger)]/10 px-3 py-2 font-mono text-[11px] text-[var(--fp-danger)] sm:mx-5">
          {error}
        </div>
      ) : null}

      {selection ? (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-[var(--fp-accent)]/30 bg-[var(--fp-accent-muted)] px-3 py-2.5 sm:mx-5">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--fp-text-muted)]">
            Auto-promoted model
          </span>
          <span className="font-mono text-sm font-bold text-[var(--fp-accent)]">
            {selection.active?.id || selection.selected?.id || "E"} · {selection.active?.name || selection.selected?.name || "Everything enabled"}
          </span>
          {selection.active?.promotedAt ? (
            <span className="font-mono text-[9px] text-[var(--fp-text-muted)]">
              promoted {new Date(selection.active.promotedAt).toLocaleDateString()}
            </span>
          ) : (
            <span className="font-mono text-[9px] text-[var(--fp-text-muted)]">default (awaiting first cron)</span>
          )}
          <span className="ml-auto flex flex-wrap gap-2">
            {(selection.windows || []).map((w) => (
              <span key={w.key} className="font-mono text-[9px] text-[var(--fp-text-muted)]">
                {w.key}: <span className="text-[var(--fp-text)]">{w.winner?.id || "—"}</span>
              </span>
            ))}
          </span>
        </div>
      ) : null}

      <div className="px-2 py-3 sm:px-4">
        {lab ? (
          <div className="mb-2 flex flex-wrap items-center gap-3 px-1 font-mono text-[10px] text-[var(--fp-text-muted)]">
            <span>{lab.totalSettled} settled predictions</span>
            {lab.best ? (
              <span className="text-[var(--fp-success)]">
                Best ROI: {lab.best.name} ({lab.best.roi >= 0 ? "+" : ""}
                {lab.best.roi}%)
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-[var(--fp-border)] text-left font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--fp-text-muted)]">
                <th className="px-2.5 py-2">Model</th>
                <th className="px-2.5 py-2 text-right">n</th>
                <th className="px-2.5 py-2 text-right">Accuracy</th>
                <th className="px-2.5 py-2 text-right">ROI</th>
                <th className="px-2.5 py-2 text-right">Yield</th>
                <th className="px-2.5 py-2 text-right">LogLoss</th>
                <th className="px-2.5 py-2 text-right">Brier</th>
                <th className="px-2.5 py-2 text-right">EV</th>
              </tr>
            </thead>
            <tbody>
              {models.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center font-mono text-[11px] text-[var(--fp-text-muted)]">
                    {loading ? "Running models…" : "No settled data yet"}
                  </td>
                </tr>
              ) : (
                models.map((m) => (
                  <tr key={m.id} className="border-b border-[var(--fp-border)]/60 hover:bg-[var(--fp-bg-muted)]">
                    <td className="px-2.5 py-2">
                      <div className="font-mono text-[11px] font-semibold text-[var(--fp-text)]">
                        <span className="mr-1.5 text-[var(--fp-accent)]">{m.id}</span>
                        {m.name}
                      </div>
                    </td>
                    <Cell className="text-right text-[var(--fp-text-muted)]">{m.samples}</Cell>
                    <Cell className="text-right text-[var(--fp-text)]">{m.accuracy.toFixed(1)}%</Cell>
                    <Cell className={`text-right ${metricTone(m.roi, "roi")}`}>
                      {m.roi >= 0 ? "+" : ""}
                      {m.roi.toFixed(1)}%
                    </Cell>
                    <Cell className={`text-right ${metricTone(m.yield, "roi")}`}>
                      {m.yield >= 0 ? "+" : ""}
                      {m.yield.toFixed(1)}%
                    </Cell>
                    <Cell className="text-right text-[var(--fp-text-muted)]">{m.logLoss ?? "—"}</Cell>
                    <Cell className="text-right text-[var(--fp-text-muted)]">{m.brier ?? "—"}</Cell>
                    <Cell className={`text-right ${metricTone(m.expectedValue, "ev")}`}>
                      {m.expectedValue >= 0 ? "+" : ""}
                      {m.expectedValue.toFixed(1)}%
                    </Cell>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
