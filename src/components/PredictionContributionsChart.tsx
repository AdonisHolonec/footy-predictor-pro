import type { PredictionContributions } from "../types";

/**
 * Signed per-module contribution chart (diverging bars).
 * Positive contributions push toward the recommended pick; negative pull away.
 */
export default function PredictionContributionsChart({
  data,
  compact = false
}: {
  data: PredictionContributions;
  compact?: boolean;
}) {
  const items = Array.isArray(data?.items)
    ? [...data.items].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    : [];
  if (items.length === 0) return null;

  const maxAbs = items.reduce((m, i) => Math.max(m, Math.abs(i.contribution)), 0) || 1;
  const fmt = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(n <= -10 || n >= 10 ? 0 : 1)}%`;

  const shown = compact ? items.slice(0, 5) : items;

  return (
    <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-white/5 pb-3">
        <div>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">
            Why This Prediction
          </h3>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
            Signed impact on pick {data.pick ? `· ${data.pick}` : ""} · {data.schemaVersion || "contrib-v1"}
          </p>
        </div>
        {data.confidence != null ? (
          <div className="flex flex-col items-end">
            <span className="font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">Confidence</span>
            <span className="font-mono text-lg font-bold tabular-nums text-signal-mint">
              {Math.round(data.confidence)}%
            </span>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        {shown.map((item) => {
          const width = Math.max(2, (Math.abs(item.contribution) / maxAbs) * 50);
          const positive = item.contribution > 0;
          const negative = item.contribution < 0;
          return (
            <div
              key={item.key}
              className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 sm:grid-cols-[8.5rem_1fr_3.25rem]"
            >
              <div className="truncate font-mono text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">
                {item.label}
              </div>
              {/* Diverging track: center line, negative grows left, positive grows right */}
              <div className="relative h-2.5 rounded-full bg-signal-void/70">
                <div className="absolute left-1/2 top-0 h-full w-px bg-white/15" />
                {positive ? (
                  <div
                    className="absolute left-1/2 top-0 h-full rounded-r-full bg-signal-mint/70"
                    style={{ width: `${width}%` }}
                    title={`${item.label}: ${fmt(item.contribution)}`}
                  />
                ) : null}
                {negative ? (
                  <div
                    className="absolute top-0 h-full rounded-l-full bg-rose-400/70"
                    style={{ right: "50%", width: `${width}%` }}
                    title={`${item.label}: ${fmt(item.contribution)}`}
                  />
                ) : null}
              </div>
              <div
                className={`text-right font-mono text-xs font-bold tabular-nums ${
                  positive ? "text-signal-mint" : negative ? "text-rose-300" : "text-signal-inkMuted"
                }`}
              >
                {fmt(item.contribution)}
              </div>
            </div>
          );
        })}
      </div>

      {data.net != null ? (
        <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
          <span>Net lean</span>
          <span className={data.net >= 0 ? "text-signal-mint" : "text-rose-300"}>{fmt(data.net)}</span>
        </div>
      ) : null}
    </section>
  );
}
