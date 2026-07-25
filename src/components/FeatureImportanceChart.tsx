import { useLocale } from "../context/LocaleContext";
import type { FeatureImportance } from "../types";

function barColor(index: number, total: number): string {
  const t = total <= 1 ? 0 : index / (total - 1);
  if (t < 0.25) return "bg-[var(--fp-success)]";
  if (t < 0.5) return "bg-[var(--fp-accent)]";
  if (t < 0.75) return "bg-teal-500";
  return "bg-[var(--fp-text-faint)]";
}

/**
 * Horizontal contribution chart for Feature Importance Engine.
 */
export default function FeatureImportanceChart({
  importance,
  compact = false,
  framed = true
}: {
  importance: FeatureImportance;
  compact?: boolean;
  /** When false, omit outer card chrome (for CollapsiblePanel). */
  framed?: boolean;
}) {
  const { t } = useLocale();
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
        <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[var(--fp-accent)]/75">
          {t("panels.keyFactors")}
        </div>
        {top.map((item, i) => (
          <div key={item.key} className="flex items-center gap-2 font-mono text-[9px]">
            <span className="w-16 shrink-0 truncate text-[var(--fp-text-muted)]">{item.label}</span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--fp-bg)]/60">
              <div
                className={`h-full rounded-full ${barColor(i, top.length)}`}
                style={{ width: `${Math.max(3, Math.min(100, item.contribution))}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right tabular-nums text-[var(--fp-text)]">{Math.round(item.contribution)}%</span>
          </div>
        ))}
      </div>
    );
  }

  const body = (
    <>
      {framed ? (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-[var(--fp-border)] pb-2">
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--fp-accent)]">{t("panels.keyFactors")}</h3>
            <p className="mt-0.5 text-xs font-medium text-[var(--fp-text-muted)]">{t("panels.keyFactorsSub")}</p>
          </div>
          <div className="text-xs font-semibold text-[var(--fp-text-muted)]">
            {importance.schemaVersion || "fi-v1"} · Σ {importance.total ?? 100}%
          </div>
        </div>
      ) : (
        <div className="mb-2 text-right text-[10px] font-semibold text-[var(--fp-text-muted)]">
          {importance.schemaVersion || "fi-v1"} · Σ {importance.total ?? 100}%
        </div>
      )}

      <div className="space-y-2.5">
        {items.map((item, i) => (
          <div key={item.key} className="grid grid-cols-[6.5rem_1fr_2.75rem] items-center gap-2 sm:grid-cols-[8.5rem_1fr_3rem]">
            <div className="truncate text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
              {item.label}
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-[var(--fp-bg-muted)]">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${barColor(i, items.length)}`}
                style={{ width: `${Math.max(2, Math.min(100, item.contribution))}%` }}
                title={`${item.label}: ${item.contribution}%`}
              />
            </div>
            <div className="text-right text-sm font-bold tabular-nums text-[var(--fp-text)]">
              {Number(item.contribution).toFixed(Number(item.contribution) < 10 ? 1 : 0)}%
            </div>
          </div>
        ))}
      </div>
    </>
  );

  if (!framed) return <div>{body}</div>;

  return (
    <section className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 shadow-[var(--fp-shadow-sm)]">
      {body}
    </section>
  );
}
