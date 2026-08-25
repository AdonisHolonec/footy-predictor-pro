import type { ReactNode } from "react";
import CollapsiblePanel from "../../design-system/CollapsiblePanel";
import type { TranslateFn } from "../../i18n/types";

type Props = {
  tr: TranslateFn;
  /** Tier 1 — the one sentence the model would say first. Null → the panel says so, once. */
  summary: string | null;
  /** Tier 2 — up to three further factors, already phrased upstream. */
  factors: string[];
  /** Tier 3 — the existing deeper explanation panels, mounted collapsed. */
  children?: ReactNode;
};

/**
 * "Why this pick" — the ONE authoritative explanation surface in Match Detail.
 *
 * Three tiers, progressively disclosed:
 *   1. summary   — visible; one sentence
 *   2. factors   — collapsed; at most three lines
 *   3. deep      — collapsed; the existing explanation / confidence / factor
 *                  panels, unchanged, reached only by choice
 *
 * Nothing here is computed: every string comes from `match.explanation`, the
 * source the Decision block's rationale already used. The panel replaces the
 * five places that used to answer the same question at different depths.
 *
 * It is no longer a card of its own. It used to sit beside the recommendation as a
 * sibling block, which gave the reason the same visual weight as the decision it
 * explains; it now renders inside the Decision card, behind that card's disclosure.
 * Only the frame moved — the tiers, their order, their strings and their
 * collapsed-by-default state are exactly as they were, and the heading is gone only
 * because the button that opens this region already carries it as its label.
 */
export default function WhyThisPickPanel({ tr, summary, factors, children }: Props) {
  const shown = factors.slice(0, 3);
  return (
    <div data-slot="why-body">
      <p data-slot="why-summary" className="text-sm leading-snug text-[var(--fp-text)]">
        {summary ?? tr("detail.whyUnavailable")}
      </p>
      {shown.length > 0 && (
        <CollapsiblePanel compact title={tr("detail.whyFactors")} className="mt-3" lazy={false}>
          <ul data-slot="why-factors" className="list-disc space-y-1 pl-4 text-sm text-[var(--fp-text)]">
            {shown.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </CollapsiblePanel>
      )}
      {children && (
        <CollapsiblePanel compact title={tr("detail.whyDeep")} className="mt-2">
          <div className="space-y-3">{children}</div>
        </CollapsiblePanel>
      )}
    </div>
  );
}
