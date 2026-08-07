import type { HealthDashboardBundle } from "../../types";
import { buildHealthInsights, type HealthInsight, type InsightTone } from "../../utils/healthInsights";
import { Card } from "../../design-system";

/**
 * The interpretation layer of the Health dashboard (S4).
 *
 * The tile grid below this one answers "what are the numbers". This answers "what should
 * you do about them", which is the only question an operator actually opens the page with.
 * All judgement lives in ../../utils/healthInsights — this file decides nothing, it only
 * renders.
 */

/**
 * Tone is never carried by colour alone: each card states its standing in words too, so
 * the reading survives a monochrome screen or a colour-blind reader.
 */
const TONE_LABEL: Record<InsightTone, string> = {
  bad: "Needs attention",
  watch: "Worth watching",
  good: "Healthy",
  unknown: "No data"
};

const TONE_ACCENT: Record<InsightTone, string> = {
  bad: "var(--fp-danger)",
  watch: "var(--fp-warning)",
  good: "var(--fp-success)",
  unknown: "var(--fp-text-muted)"
};

function InsightCard({ insight }: { insight: HealthInsight }) {
  const accent = TONE_ACCENT[insight.tone];

  return (
    <Card padding="md" className="flex flex-col gap-3 border-l-2" style={{ borderLeftColor: accent }}>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--fp-text-muted)]">
          {insight.title}
        </h4>
        <span
          className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: accent }}
        >
          {insight.statusLabel ?? TONE_LABEL[insight.tone]}
        </span>
      </div>

      <span
        className="font-display text-2xl font-semibold leading-none tracking-tight sm:text-3xl"
        style={{ color: accent }}
      >
        {insight.headline}
      </span>

      <p className="text-sm leading-relaxed text-[var(--fp-text)]">{insight.verdict}</p>

      {insight.figures.length > 0 ? (
        <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[var(--fp-border)] pt-3">
          {insight.figures.map((figure) => (
            <div key={figure.label} className="flex items-baseline justify-between gap-2">
              <dt className="font-mono text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">
                {figure.label}
              </dt>
              <dd className="font-mono text-[11px] font-semibold text-[var(--fp-text)]">{figure.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </Card>
  );
}

export default function HealthInsightGrid({ bundle }: { bundle: HealthDashboardBundle | null }) {
  const insights = buildHealthInsights(bundle);
  if (insights.length === 0) return null;

  return (
    <section className="border-b border-[var(--fp-border)] px-4 py-4 sm:px-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--fp-accent)]">
          Reading
        </h4>
        <span className="font-mono text-[9px] text-[var(--fp-text-muted)]">
          Ordered by what needs attention first
        </span>
      </div>
      {/* items-start, not the default stretch: a card with no figures yet would otherwise be
          pulled to its neighbour's height and open a large void under one sentence. */}
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
        {insights.map((insight) => (
          <InsightCard key={insight.id} insight={insight} />
        ))}
      </div>
    </section>
  );
}
