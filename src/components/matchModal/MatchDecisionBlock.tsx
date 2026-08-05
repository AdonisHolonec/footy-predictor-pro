import type { ReactNode } from "react";
import { useLocale } from "../../context/LocaleContext";
import { ConfidenceAura } from "../SignalLab";
import MarketFamilyIcon from "../icons/MarketFamilyIcon";
import type { MarketFamilyKey } from "../../utils/formatRecommendation";

/**
 * Decision Layer — the single block that answers "what is the bet, how sure are
 * we, is it worth it, why, and can I trust it" before any navigation.
 *
 * Presentation only: every value is passed in already computed by PredictorV3 /
 * the Recommendation, Value and Confidence engines. This component performs no
 * prediction math — it only chooses labels and tones for values it is given.
 */

/**
 * Future Prediction Benchmark payload (served by `api/backtest?view=benchmark-*`).
 * Optional by design: the consensus row renders only when this is supplied, so
 * the block degrades to its current shape while the feature stays disabled.
 */
export type BenchmarkConsensus = {
  ourPick: string | null;
  apiPick: string | null;
  agree: boolean | null;
};

type MatchDecisionBlockProps = {
  pickLabel: string;
  familyKey: MarketFamilyKey;
  odd: number | null;
  /** Exact confidence percent, or null when the access tier hides it. */
  confidencePct: number | null;
  /** Coarse band shown instead of the exact percent, when available. */
  confidenceCategory: string | null;
  /** Expected value percent for the recommended pick (already computed). */
  evPct: number | null;
  /** Model data-quality score in the 0..1 range. */
  dataQuality: number;
  /** One-sentence, plain-language reason — no formulas. */
  rationale: string | null;
  benchmark?: BenchmarkConsensus | null;
};

function Metric({
  label,
  value,
  tone = "text-[var(--fp-text)]",
  title
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  title?: string;
}) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-[8px] font-bold uppercase tracking-[0.16em] text-[var(--fp-text-muted)]">{label}</div>
      <div className={`mt-0.5 truncate font-mono text-[11px] font-bold tabular-nums sm:text-sm ${tone}`}>{value}</div>
    </div>
  );
}

export default function MatchDecisionBlock({
  pickLabel,
  familyKey,
  odd,
  confidencePct,
  confidenceCategory,
  evPct,
  dataQuality,
  rationale,
  benchmark = null
}: MatchDecisionBlockProps) {
  const { t: tr } = useLocale();

  const hasExactConfidence = confidencePct != null && Number.isFinite(confidencePct);
  const confidenceValue = hasExactConfidence
    ? `${Math.round(confidencePct)}%`
    : confidenceCategory || tr("match.locked");

  const hasEv = evPct != null && Number.isFinite(evPct);
  const evTone = !hasEv
    ? "text-[var(--fp-text-muted)]"
    : evPct > 0
      ? "text-[var(--fp-success)]"
      : evPct < 0
        ? "text-[var(--fp-danger)]"
        : "text-[var(--fp-text-muted)]";
  const evValue = hasEv ? `${evPct > 0 ? "+" : ""}${evPct.toFixed(1)}%` : tr("common.na");
  const evVerdict = !hasEv
    ? tr("match.decisionEvUnknown")
    : evPct > 0
      ? tr("match.decisionEvPositive")
      : evPct < 0
        ? tr("match.decisionEvNegative")
        : tr("match.decisionEvNeutral");

  const dqPct = Math.round(Math.max(0, Math.min(1, dataQuality)) * 100);
  const dqTone =
    dqPct >= 70
      ? "text-[var(--fp-success)]"
      : dqPct >= 50
        ? "text-[var(--fp-warning)]"
        : "text-[var(--fp-danger)]";
  const dqVerdict = dqPct >= 70 ? tr("match.dqHigh") : dqPct >= 50 ? tr("match.dqMedium") : tr("match.dqLow");

  return (
    <section
      className="mx-auto mt-3 w-full max-w-2xl rounded-[var(--fp-radius)] border border-[var(--fp-accent)]/25 bg-[var(--fp-bg-muted)] p-3 shadow-[var(--fp-shadow-sm)] sm:p-4"
      aria-label={tr("match.decisionTitle")}
    >
      <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--fp-accent)]">
        {tr("match.decisionTitle")}
      </div>

      {/* Row 1 — the bet itself: confidence ring, pick + family, price. */}
      <div className="flex items-center gap-3">
        <div className="shrink-0">
          {hasExactConfidence ? (
            <ConfidenceAura value={confidencePct} size="compact" />
          ) : (
            <div className="rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-2.5 py-1.5 text-center">
              <div className="text-[8px] font-bold uppercase tracking-[0.16em] text-[var(--fp-text-muted)]">
                {tr("match.confidence")}
              </div>
              <div className="mt-0.5 text-[11px] font-bold text-[var(--fp-accent)]">{confidenceValue}</div>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[8px] font-bold uppercase tracking-[0.18em] text-[var(--fp-accent)]/70">
            {tr("match.pick")}
          </div>
          <div className="flex items-center gap-1.5 break-words font-display text-lg font-bold leading-tight text-[var(--fp-accent)] sm:text-2xl">
            <MarketFamilyIcon familyKey={familyKey} className="shrink-0" />
            <span className="line-clamp-2">{pickLabel}</span>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-[8px] font-bold uppercase tracking-[0.16em] text-[var(--fp-text-muted)]">
            {tr("match.odd")}
          </div>
          <div className="font-mono text-base font-bold tabular-nums text-[var(--fp-success)] sm:text-xl">
            {odd != null && Number.isFinite(odd) ? odd.toFixed(2) : tr("common.na")}
          </div>
        </div>
      </div>

      {/* Row 2 — the trust signals that decide accept vs reject. */}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[var(--fp-border)] pt-2.5">
        <Metric label={tr("match.confidence")} value={confidenceValue} />
        <Metric
          label={tr("match.decisionEv")}
          value={
            <span className="inline-flex items-baseline gap-1">
              {evValue}
              <span className="text-[8px] font-semibold uppercase tracking-wide opacity-80">{evVerdict}</span>
            </span>
          }
          tone={evTone}
          title={tr("match.decisionEvHint")}
        />
        <Metric
          label={tr("match.decisionDataQuality")}
          value={
            <span className="inline-flex items-baseline gap-1">
              {dqPct}%
              <span className="text-[8px] font-semibold uppercase tracking-wide opacity-80">{dqVerdict}</span>
            </span>
          }
          tone={dqTone}
          title={tr("match.decisionDataQualityHint")}
        />
      </div>

      {/* Row 3 — consensus. Rendered only when benchmark data exists. */}
      {benchmark ? (
        <div className="mt-2.5 border-t border-[var(--fp-border)] pt-2.5">
          <div className="text-[8px] font-bold uppercase tracking-[0.16em] text-[var(--fp-text-muted)]">
            {tr("match.decisionConsensus")}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tabular-nums sm:text-[11px]">
            <span className="text-[var(--fp-text)]">
              <span className="text-[var(--fp-text-muted)]">Footy Predictor · </span>
              {benchmark.ourPick || tr("common.na")}
            </span>
            <span className="text-[var(--fp-text)]">
              <span className="text-[var(--fp-text-muted)]">API-Football · </span>
              {benchmark.apiPick || tr("common.na")}
            </span>
            {benchmark.agree != null ? (
              <span
                className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                  benchmark.agree
                    ? "border-[var(--fp-success)]/40 bg-[var(--fp-success)]/10 text-[var(--fp-success)]"
                    : "border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10 text-[var(--fp-warning)]"
                }`}
              >
                {benchmark.agree ? tr("match.consensusAgree") : tr("match.consensusDiffer")}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Row 4 — one-sentence rationale, plain language, no formulas. */}
      {rationale ? (
        <p className="mt-2.5 border-t border-[var(--fp-border)] pt-2.5 text-[11px] leading-relaxed text-[var(--fp-text-muted)]">
          <span className="font-bold uppercase tracking-wide text-[var(--fp-accent)]/80">
            {tr("match.decisionWhy")} ·{" "}
          </span>
          {rationale}
        </p>
      ) : null}
    </section>
  );
}
