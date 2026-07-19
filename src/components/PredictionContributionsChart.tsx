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
    <section className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 shadow-[var(--fp-shadow-sm)] sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-[var(--fp-border)] pb-3">
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--fp-accent)]">Why This Prediction</h3>
          <p className="mt-1 text-xs font-medium text-[var(--fp-text-muted)]">
            Signed impact on pick {data.pick ? `· ${data.pick}` : ""} · {data.schemaVersion || "contrib-v1"}
          </p>
        </div>
        {data.confidence != null ? (
          <div className="flex flex-col items-end">
            <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">Confidence</span>
            <span className="text-lg font-bold tabular-nums text-[var(--fp-success)]">{Math.round(data.confidence)}%</span>
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
              className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-2 sm:grid-cols-[8.5rem_1fr_3.25rem]"
            >
              <div className="truncate text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
                {item.label}
              </div>
              <div className="relative h-2.5 rounded-full bg-[var(--fp-bg-muted)]">
                <div className="absolute left-1/2 top-0 h-full w-px bg-[var(--fp-border-strong)]" />
                {positive ? (
                  <div
                    className="absolute left-1/2 top-0 h-full rounded-r-full bg-[var(--fp-success)]"
                    style={{ width: `${width}%` }}
                    title={`${item.label}: ${fmt(item.contribution)}`}
                  />
                ) : null}
                {negative ? (
                  <div
                    className="absolute top-0 h-full rounded-l-full bg-[var(--fp-danger)]"
                    style={{ right: "50%", width: `${width}%` }}
                    title={`${item.label}: ${fmt(item.contribution)}`}
                  />
                ) : null}
              </div>
              <div
                className={`text-right text-xs font-bold tabular-nums ${
                  positive ? "text-[var(--fp-success)]" : negative ? "text-[var(--fp-danger)]" : "text-[var(--fp-text-muted)]"
                }`}
              >
                {fmt(item.contribution)}
              </div>
            </div>
          );
        })}
      </div>

      {data.net != null ? (
        <div className="mt-3 flex items-center justify-between border-t border-[var(--fp-border)] pt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">
          <span>Net lean</span>
          <span className={data.net >= 0 ? "text-[var(--fp-success)]" : "text-[var(--fp-danger)]"}>{fmt(data.net)}</span>
        </div>
      ) : null}
    </section>
  );
}
