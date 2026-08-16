import { useId, useState, type ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  /** When true, children mount only after first expand (lazy). */
  lazy?: boolean;
  /** Denser title row for match-detail stacks. */
  compact?: boolean;
  /** Optional badge next to the title (e.g. lock). */
  badge?: ReactNode;
  className?: string;
};

/** Progressive disclosure — compact header for secondary analysis. */
export default function CollapsiblePanel({
  title,
  subtitle,
  defaultOpen = false,
  children,
  lazy = true,
  compact = false,
  badge,
  className = ""
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(defaultOpen || !lazy);
  const panelId = useId();

  return (
    <section
      className={`overflow-hidden rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-fp-sm ${className}`}
    >
      <button
        type="button"
        className={`flex min-h-[var(--fp-touch)] w-full items-center justify-between gap-2 text-left transition-colors duration-[var(--fp-ease)] hover-fine:bg-[var(--fp-bg-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] ${
          compact ? "px-3 py-2" : "px-3 py-2.5"
        }`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((v) => !v);
          setMounted(true);
        }}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2
              className={
                compact
                  ? "text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fp-accent)]"
                  : "font-display text-base font-semibold text-[var(--fp-text)] sm:text-[length:var(--fp-section)]"
              }
            >
              {title}
            </h2>
            {badge}
          </div>
          {subtitle && (
            <p className={`mt-0.5 truncate text-[var(--fp-text-muted)] ${compact ? "text-[10px]" : "text-xs sm:text-sm"}`}>
              {subtitle}
            </p>
          )}
        </div>
        <span
          className={`shrink-0 text-[var(--fp-text-muted)] transition-transform duration-[var(--fp-ease)] ${
            compact ? "text-base" : "text-lg"
          } ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          ⌄
        </span>
      </button>
      <div
        id={panelId}
        className={`grid transition-[grid-template-rows] duration-[var(--fp-ease)] ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          {mounted && (
            <div className={`border-t border-[var(--fp-border)] ${compact ? "px-3 py-2.5" : "px-3 py-3 sm:px-4 sm:py-4"}`}>
              {children}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
