import type { ReactNode } from "react";

export type AdminSection =
  | "dashboard"
  | "model-lab"
  | "backtesting"
  | "benchmark"
  | "meta-learning"
  | "health"
  | "diagnostics"
  | "inbox"
  | "users"
  | "referrals"
  | "global-bets"
  | "workspace";

/**
 * Grouped rather than flat, because the list has outgrown a single column of
 * eleven equal-weight buttons and Global Bets is the first entry that is a
 * PRODUCT surface rather than an instrument: an admin generating a ticket is
 * doing a different job from one reading Model Lab.
 *
 * The group heading is a label, not a control — there is no collapsing and no
 * second level of selection. Sections stay a flat union, so `section === id`
 * comparisons and every existing caller are untouched; only the rendering
 * groups them. A nested selection model would have been a new navigation
 * paradigm for one new entry.
 */
const GROUPS: { heading: string | null; items: { id: AdminSection; label: string }[] }[] = [
  {
    heading: null,
    items: [{ id: "dashboard", label: "Dashboard" }]
  },
  {
    heading: "Betting",
    items: [{ id: "global-bets", label: "Global Bets" }]
  },
  {
    heading: "Modelling",
    items: [
      { id: "model-lab", label: "Model Lab" },
      { id: "backtesting", label: "Backtesting" },
      { id: "benchmark", label: "Benchmark" },
      { id: "meta-learning", label: "Meta Learning" }
    ]
  },
  {
    heading: "Operations",
    items: [
      { id: "health", label: "Health" },
      { id: "diagnostics", label: "Diagnostics" }
    ]
  },
  {
    heading: "People",
    items: [
      { id: "inbox", label: "Inbox" },
      { id: "users", label: "Users" },
      { id: "referrals", label: "Referrals" }
    ]
  },
  {
    heading: null,
    items: [{ id: "workspace", label: "← Workspace" }]
  }
];

type Props = {
  section: AdminSection;
  onSection: (s: AdminSection) => void;
  children: ReactNode;
};

export default function AdminShell({ section, onSection, children }: Props) {
  return (
    <div className="flex min-h-[70vh] flex-col gap-4 lg:flex-row">
      <aside className="w-full shrink-0 rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 lg:w-56">
        <div className="mb-3 px-2 font-display text-sm font-semibold text-[var(--fp-text)]">Admin</div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Admin">
          {GROUPS.map((group, index) => (
            <div
              key={group.heading ?? `group-${index}`}
              className="flex shrink-0 gap-1 lg:flex-col"
              role="group"
              aria-label={group.heading ?? undefined}
            >
              {/* Hidden on narrow screens: the sidebar becomes a horizontal
                  scroller there, where a heading would read as a dead button. */}
              {group.heading && (
                <div className="hidden px-3 pb-1 pt-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--fp-text-muted)] lg:block">
                  {group.heading}
                </div>
              )}
              {group.items.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSection(s.id)}
                  aria-current={section === s.id ? "page" : undefined}
                  className={`shrink-0 rounded-lg px-3 py-2 text-left text-xs font-semibold ${
                    section === s.id
                      ? "bg-fp-accent/15 text-[var(--fp-accent)]"
                      : "text-[var(--fp-text-muted)] hover:bg-[var(--fp-bg-muted)]"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
