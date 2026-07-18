import { useCallback, useEffect, useState } from "react";
import type { ModelLabBundle, ModelLabResult } from "../../types";
import { loadModelLab } from "../../services/backtestService";

function metricTone(value: number, kind: "roi" | "ev"): string {
  if (kind === "roi" || kind === "ev") {
    if (value > 0) return "text-emerald-300";
    if (value < 0) return "text-rose-300";
  }
  return "text-signal-silver";
}

function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2.5 py-2 font-mono text-[11px] tabular-nums ${className}`}>{children}</td>;
}

export default function ModelLabPanel() {
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lab, setLab] = useState<ModelLabBundle | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLab(await loadModelLab(days));
    } catch (err) {
      setLab(null);
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
    <section className="lab-card mt-4 overflow-hidden sm:mt-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.06] px-3.5 py-3 sm:px-5">
        <div>
          <h3 className="lab-section-eyebrow">Model Laboratory</h3>
          <p className="mt-1 font-display text-sm font-semibold text-signal-ink sm:text-base">
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
            {loading ? "…" : "Run"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-200 sm:mx-5">
          {error}
        </div>
      ) : null}

      <div className="px-2 py-3 sm:px-4">
        {lab ? (
          <div className="mb-2 flex flex-wrap items-center gap-3 px-1 font-mono text-[10px] text-signal-inkMuted">
            <span>{lab.totalSettled} settled predictions</span>
            {lab.best ? (
              <span className="text-signal-mint">
                Best ROI: {lab.best.name} ({lab.best.roi >= 0 ? "+" : ""}
                {lab.best.roi}%)
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] text-left font-mono text-[9px] uppercase tracking-[0.14em] text-signal-inkMuted">
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
                  <td colSpan={8} className="px-3 py-6 text-center font-mono text-[11px] text-signal-inkMuted">
                    {loading ? "Running models…" : "No settled data yet"}
                  </td>
                </tr>
              ) : (
                models.map((m) => (
                  <tr key={m.id} className="border-b border-white/[0.04] hover:bg-signal-mist/[0.06]">
                    <td className="px-2.5 py-2">
                      <div className="font-mono text-[11px] font-semibold text-signal-silver">
                        <span className="mr-1.5 text-signal-petrol">{m.id}</span>
                        {m.name}
                      </div>
                    </td>
                    <Cell className="text-right text-signal-inkMuted">{m.samples}</Cell>
                    <Cell className="text-right text-signal-silver">{m.accuracy.toFixed(1)}%</Cell>
                    <Cell className={`text-right ${metricTone(m.roi, "roi")}`}>
                      {m.roi >= 0 ? "+" : ""}
                      {m.roi.toFixed(1)}%
                    </Cell>
                    <Cell className={`text-right ${metricTone(m.yield, "roi")}`}>
                      {m.yield >= 0 ? "+" : ""}
                      {m.yield.toFixed(1)}%
                    </Cell>
                    <Cell className="text-right text-signal-inkMuted">{m.logLoss ?? "—"}</Cell>
                    <Cell className="text-right text-signal-inkMuted">{m.brier ?? "—"}</Cell>
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
    </section>
  );
}
