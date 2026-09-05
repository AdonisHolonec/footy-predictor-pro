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

type NavItem = { id: AdminSection; label: string };

/**
 * Grouped rather than flat, because the list has outgrown a single column of
 * eleven equal-weight buttons and Global Bets is the first entry that is a
 * PRODUCT surface rather than an instrument: an admin generating a ticket is
 * doing a different job from one reading Model Lab.
 *
 * HEADINGS ARE LABELS, NOT CONTROLS, at both levels. There is no collapsing and
 * nothing to select: "Betting" and "Tickets" are captions over a list of
 * buttons. That is what keeps the nesting free — sections stay a FLAT union, so
 * `section === id`, every existing caller and every consumer of AdminSection are
 * untouched, and only the rendering is hierarchical.
 *
 * In particular "Tickets" has no id, no route, no state and no panel. Giving it
 * one would mean inventing a dashboard whose only purpose was to justify a level
 * of navigation, and a screen that exists to be passed through is worse than no
 * screen.
 */
type NavGroup = {
  heading: string | null;
  /** Entries directly under the group heading. */
  items?: NavItem[];
  /** One further caption level. Deliberately not recursive: two is the depth the
   *  product has, and a general tree would invite a third nobody asked for. */
  subgroups?: { heading: string; items: NavItem[] }[];
};

const GROUPS: NavGroup[] = [
  {
    heading: null,
    items: [{ id: "dashboard", label: "Dashboard" }]
  },
  {
    heading: "Betting",
    subgroups: [{ heading: "Tickets", items: [{ id: "global-bets", label: "Global Bets" }] }]
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

/**
 * Captions are hidden on narrow screens at BOTH levels: the sidebar becomes a
 * horizontal scroller there, where a non-interactive label sitting among buttons
 * reads as a dead button.
 *
 * The two levels are distinguished by INDENTATION AND CASE, not by size. 10px is
 * the design system's floor (geometry.guard: "no UI text below 10px"), so a
 * smaller sub-caption is not available — and shrinking or fading a label that is
 * already muted would have traded a real accessibility property for a purely
 * decorative one.
 */
const HEADING_BASE = "hidden font-mono font-semibold tracking-wider text-[10px] text-[var(--fp-text-muted)] lg:block";

export default function AdminShell({ section, onSection, children }: Props) {
  const renderItem = (s: NavItem) => (
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
  );

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
              {group.heading && (
                <div className={`${HEADING_BASE} px-3 pb-1 pt-3 uppercase`}>{group.heading}</div>
              )}
              {(group.items || []).map(renderItem)}

              {(group.subgroups || []).map((subgroup) => (
                <div
                  key={subgroup.heading}
                  className="flex shrink-0 gap-1 lg:flex-col"
                  role="group"
                  aria-label={subgroup.heading}
                >
                  {/* Indented and sentence-case against the parent's uppercase —
                      the two signals separating the levels, since neither is
                      clickable and neither may shrink below the 10px floor. */}
                  <div className={`${HEADING_BASE} px-3 pb-1 pt-1 lg:pl-5`}>{subgroup.heading}</div>
                  <div className="flex shrink-0 gap-1 lg:flex-col lg:pl-2">{subgroup.items.map(renderItem)}</div>
                </div>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
