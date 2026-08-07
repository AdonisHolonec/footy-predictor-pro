/**
 * ProbBar - moved verbatim from MatchModal.tsx (Sprint 7). No closure captures.
 */

const pct = (n: number) => Math.round(n || 0);

export const ProbBar = ({ label, val, color }: { label: string; val: number; color: string }) => (
  <div className="mb-4">
    <div className="mb-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">
      <span>{label}</span>
      <span className="font-mono tabular-nums" style={{ color }}>
        {pct(val)}%
      </span>
    </div>
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--fp-bg-muted)] ring-1 ring-[var(--fp-border)]">
      <div style={{ width: `${val}%`, backgroundColor: color }} className="h-full rounded-full" />
    </div>
  </div>
);
