import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  /** Toggle state; rendered as aria-pressed — a FilterChip is a filter, not a tab. */
  selected?: boolean;
};

/**
 * Filter chip (PR 4) — the pill that five panels had byte-identically
 * copy-pasted (backtest, health, model-lab, analytics, admin observatory).
 * One source now: mono uppercase micro-label, accent wash when selected,
 * aria-pressed toggle semantics, theme focus ring. The two DIVERGENT chip
 * families (DatePicker's removable day chips, DateRangeChips' solid+ring
 * variant) carry their own semantics and stay separate on purpose.
 *
 * The visual is deliberately the audited one — px-3 py-1 mono 10px — so
 * migration is pixel-faithful. It sits below the 44px touch floor exactly as
 * every call site already did; raising these dense filter rows is a deliberate
 * later decision, not a silent one here.
 */
export default function FilterChip({ children, selected, className = "", type, ...rest }: Props) {
  return (
    <button
      type={type ?? "button"}
      aria-pressed={selected}
      className={`rounded-full border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide transition duration-[var(--fp-ease)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? "border-fp-accent/50 bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
          : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
