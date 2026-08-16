import type { ReactNode } from "react";

type Tone = "neutral" | "accent" | "success" | "danger" | "warning";

const toneClass: Record<Tone, string> = {
  neutral: "border-[var(--fp-border)] text-[var(--fp-text-muted)] hover:bg-[var(--fp-bg-muted)]",
  accent: "border-fp-accent/30 bg-[var(--fp-accent-muted)] text-[var(--fp-accent)] hover:border-fp-accent/50 hover:bg-fp-accent/20",
  success: "border-fp-success/30 bg-fp-success/10 text-[var(--fp-success)] hover:border-fp-success/50 hover:bg-fp-success/20",
  danger: "border-fp-danger/30 bg-fp-danger/10 text-[var(--fp-danger)] hover:border-fp-danger/50 hover:bg-fp-danger/20",
  warning: "border-fp-warning/30 bg-fp-warning/10 text-[var(--fp-warning)] hover:border-fp-warning/50 hover:bg-fp-warning/20"
};

export default function Badge({
  children,
  tone = "neutral",
  className = ""
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[length:var(--fp-badge)] font-semibold uppercase tracking-wider transition-[border-color,background-color] duration-[var(--fp-ease)] ${toneClass[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
