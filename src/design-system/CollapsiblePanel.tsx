import { useId, useState, type ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  /** When true, children mount only after first expand (lazy). */
  lazy?: boolean;
};

/** Progressive disclosure — collapsed by default for secondary analysis. */
export default function CollapsiblePanel({
  title,
  subtitle,
  defaultOpen = false,
  children,
  lazy = true
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(defaultOpen || !lazy);
  const panelId = useId();

  return (
    <section className="overflow-hidden rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-[var(--fp-shadow-sm)]">
      <button
        type="button"
        className="flex w-full min-h-[var(--fp-touch)] items-center justify-between gap-3 px-5 py-4 text-left transition-colors duration-[var(--fp-ease)] hover:bg-[var(--fp-bg-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((v) => !v);
          setMounted(true);
        }}
      >
        <div>
          <h2 className="font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-[var(--fp-text-muted)]">{subtitle}</p>}
        </div>
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--fp-border)] text-[var(--fp-text-muted)] transition-transform duration-[var(--fp-ease)] ${
            open ? "rotate-180" : ""
          }`}
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
            <div className="border-t border-[var(--fp-border)] px-5 py-5">{children}</div>
          )}
        </div>
      </div>
    </section>
  );
}
