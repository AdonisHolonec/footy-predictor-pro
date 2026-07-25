type CallsCounterProps = {
  usageCount: number;
  usageLimit: number;
  usagePct: number;
};

export default function CallsCounter({ usageCount, usageLimit, usagePct }: CallsCounterProps) {
  return (
    <div className="lab-card flex w-full max-w-[220px] flex-col items-start px-3 py-2 lg:min-w-[220px] lg:items-end">
      <div className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fp-text-muted)]">
        API ·{" "}
        <span className={`font-mono tabular-nums ${usagePct > 80 ? "text-[var(--fp-danger)]" : "text-[var(--fp-success)]"}`}>
          {usageCount} / {usageLimit}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--fp-bg)]/70">
        <div
          style={{ width: `${usagePct}%` }}
          className={`h-full rounded-full transition-[width] duration-500 ${
            usagePct > 80 ? "bg-[var(--fp-danger)]" : "bg-gradient-to-r from-[var(--fp-accent)] to-[var(--fp-success)]"
          }`}
        />
      </div>
    </div>
  );
}
