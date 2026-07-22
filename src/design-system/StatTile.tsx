type Tone = "neutral" | "accent" | "success" | "danger" | "warning";

const toneClass: Record<Tone, string> = {
  neutral: "text-[var(--fp-text)]",
  accent: "text-[var(--fp-accent)]",
  success: "text-[var(--fp-success)]",
  danger: "text-[var(--fp-danger)]",
  warning: "text-[var(--fp-warning)]"
};

export default function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  loading = false,
  className = ""
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-3 py-3 shadow-[var(--fp-shadow-sm)] ${className}`}
    >
      <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fp-text-muted)]">
        {label}
      </div>
      <div className={`mt-1 font-display text-xl font-semibold tabular-nums tracking-tight sm:text-2xl ${toneClass[tone]}`}>
        {loading ? "…" : value}
      </div>
      {hint ? <div className="mt-1 text-[10px] text-[var(--fp-text-muted)]/85">{hint}</div> : null}
    </div>
  );
}
