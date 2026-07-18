import type { FeatureImportance } from "../types";

function barColor(index: number, total: number): string {
  const t = total <= 1 ? 0 : index / (total - 1);
  if (t < 0.25) return "bg-signal-sage/80";
  if (t < 0.5) return "bg-signal-petrol/75";
  if (t < 0.75) return "bg-signal-mint/60";
  return "bg-signal-inkMuted/50";
}

/**
 * Horizontal contribution chart for Feature Importance Engine.
 */
export default function FeatureImportanceChart({
  importance,
  compact = false
}: {
  importance: FeatureImportance;
  compact?: boolean;
}) {
  const items = Array.isArray(importance.items)
    ? [...importance.items].sort((a, b) => b.contribution - a.contribution)
    : Object.entries(importance.contributions || {}).map(([key, contribution]) => ({
        key,
        label: key,
        contribution: Number(contribution) || 0
      }));

  if (items.length === 0) return null;

  if (compact) {
    const top = items.slice(0, 4);
    return (
      <div className="mt-2 space-y-1 border-t border-white/[0.06] pt-2">
        <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-signal-petrol/75">
          Key Factors
        </div>
        {top.map((item, i) => (
          <div key={item.key} className="flex items-center gap-2 font-mono text-[9px]">
            <span className="w-16 shrink-0 truncate text-signal-inkMuted">{item.label}</span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-signal-void/60">
              <div
                className={`h-full rounded-full ${barColor(i, top.length)}`}
                style={{ width: `${Math.max(3, Math.min(100, item.contribution))}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right tabular-nums text-signal-ink">{Math.round(item.contribution)}%</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-white/5 pb-3">
        <div>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">
            Key Factors
          </h3>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
            Contribution to this prediction · stored for ML
          </p>
        </div>
        <div className="font-mono text-[9px] text-signal-inkMuted">
          {importance.schemaVersion || "fi-v1"} · Σ {importance.total ?? 100}%
        </div>
      </div>

      <div className="space-y-2.5">
        {items.map((item, i) => (
          <div key={item.key} className="grid grid-cols-[7rem_1fr_2.75rem] items-center gap-2 sm:grid-cols-[8.5rem_1fr_3rem]">
            <div className="truncate font-mono text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">
              {item.label}
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-signal-void/70">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${barColor(i, items.length)}`}
                style={{ width: `${Math.max(2, Math.min(100, item.contribution))}%` }}
                title={`${item.label}: ${item.contribution}%`}
              />
            </div>
            <div className="text-right font-mono text-sm font-bold tabular-nums text-signal-ink">
              {Number(item.contribution).toFixed(Number(item.contribution) < 10 ? 1 : 0)}%
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
