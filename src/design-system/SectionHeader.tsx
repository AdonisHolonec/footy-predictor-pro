import type { ReactNode } from "react";

type HeadingLevel = "h1" | "h2" | "h3";

type Props = {
  /** Mono uppercase micro-label above the title (the app's canonical eyebrow). */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned metadata (dates, counts). */
  meta?: ReactNode;
  /** Right-aligned action (a Button/IconButton) — rendered after meta. */
  action?: ReactNode;
  /** Semantic level is the CALLER's decision; visual size follows `size`. */
  as?: HeadingLevel;
  /** page = view titles (hero scale); section = card/section titles. */
  size?: "page" | "section";
  id?: string;
  className?: string;
};

const titleClass: Record<"page" | "section", string> = {
  page: "font-display text-xl font-bold text-[var(--fp-text)] sm:text-[length:var(--fp-hero)]",
  section: "font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]"
};

/**
 * Section header (PR 4) — renders a plain div: the landmark/<header> element
 * stays with the caller, which already owns it at every migrated site.
 *
 * Origin note (PR 4) — one shape for the ~14 hand-rolled eyebrow/title/sub
 * stacks the audit found. Geometry comes from PR 3 (badge-size eyebrow,
 * 0.14em tracking); colour from the tokens; the heading LEVEL stays with the
 * caller so document outlines don't change in a styling migration.
 */
export default function SectionHeader({
  eyebrow,
  title,
  description,
  meta,
  action,
  as: Heading = "h2",
  size = "section",
  id,
  className = ""
}: Props) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {eyebrow != null && (
            <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-[0.14em] text-[var(--fp-accent)]">
              {eyebrow}
            </p>
          )}
          <Heading id={id} className={`${eyebrow != null ? "mt-1 " : ""}${titleClass[size]}`}>
            {title}
          </Heading>
        </div>
        {(meta != null || action != null) && (
          <div className="flex shrink-0 items-center gap-2">
            {meta != null && <span className="text-xs text-[var(--fp-text-muted)]">{meta}</span>}
            {action}
          </div>
        )}
      </div>
      {description != null && (
        <p className="mt-1 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">{description}</p>
      )}
    </div>
  );
}
