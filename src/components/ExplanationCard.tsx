import { useLocale } from "../context/LocaleContext";
import type { PredictionExplanation, PredictionReason } from "../types";

function polarityClass(polarity?: PredictionReason["polarity"]): string {
  switch (polarity) {
    case "positive":
    case "support":
      return "text-[var(--fp-success)] border-[var(--fp-success)]/25 bg-[var(--fp-success)]/8";
    case "negative":
      return "text-[var(--fp-danger)] border-[var(--fp-danger)]/25 bg-[var(--fp-danger)]/8";
    default:
      return "text-[var(--fp-text)] border-white/10 bg-[var(--fp-bg-elevated)]/20";
  }
}

function isFormReason(code: string): boolean {
  return code === "home_form" || code === "away_form";
}

/**
 * Explainable prediction card — only renders reasons produced from real data.
 */
export default function ExplanationCard({
  explanation,
  compact = false,
  framed = true
}: {
  explanation: PredictionExplanation;
  compact?: boolean;
  framed?: boolean;
}) {
  const { t } = useLocale();
  const pick = explanation.pick || "—";
  const confidence = explanation.confidence;
  const reasons = Array.isArray(explanation.reasons) ? explanation.reasons : [];
  const reasoning =
    reasons.length > 0
      ? reasons
      : (explanation.reasoning || []).map((label) => ({
          code: "legacy",
          label,
          polarity: "neutral" as const,
          source: "legacy"
        }));

  if (!pick && reasoning.length === 0) return null;

  const formReasons = reasoning.filter((r) => isFormReason(r.code));
  const otherReasons = reasoning.filter((r) => !isFormReason(r.code));

  if (compact) {
    const top = otherReasons.slice(0, 3);
    if (top.length === 0 && formReasons.length === 0) return null;
    return (
      <div className="mt-2 space-y-1 border-t border-white/[0.06] pt-2">
        <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[var(--fp-accent)]/75">{t("panels.reasoning")}</div>
        <ul className="space-y-0.5 font-mono text-[9px] leading-snug text-[var(--fp-text-muted)]">
          {top.map((r) => (
            <li key={`${r.code}-${r.label}`} className="truncate" title={r.label}>
              <span className="text-[var(--fp-accent)]">·</span> {r.label}
            </li>
          ))}
          {formReasons.map((r) => (
            <li key={`${r.code}-${r.label}`} className="truncate tracking-wide text-[var(--fp-text)]" title={r.label}>
              <span className="text-[var(--fp-accent)]">·</span> {r.label}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const body = (
    <>
      <div className={`mb-4 flex flex-wrap items-end justify-between gap-3 ${framed ? "border-b border-white/5 pb-3" : ""}`}>
        {framed ? (
          <div>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fp-accent)]/80">
              {t("panels.predictionExplanation")}
            </h3>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">
              {t("panels.explanationSub")}
            </p>
          </div>
        ) : (
          <div />
        )}
        <div className="text-right">
          <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">{t("card.prediction")}</div>
          <div className="font-display text-2xl font-bold text-[var(--fp-text)]">{pick}</div>
          {confidence != null && Number.isFinite(confidence) ? (
            <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--fp-accent)]">
              {t("panels.confidence")} {Math.round(confidence)}%
            </div>
          ) : null}
        </div>
      </div>

      <div className="mb-3 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--fp-accent)]/80">{t("panels.reasoning")}</div>
      {otherReasons.length === 0 && formReasons.length === 0 ? (
        <p className="font-mono text-[11px] text-[var(--fp-text-muted)]">{t("panels.explanationEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {otherReasons.map((r) => (
            <li
              key={`${r.code}-${r.label}`}
              className={`rounded-xl border px-3 py-2 font-mono text-[11px] leading-snug ${polarityClass(r.polarity)}`}
            >
              {r.label}
            </li>
          ))}
        </ul>
      )}

      {(explanation.formHome || explanation.formAway || formReasons.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(explanation.formHome || formReasons.find((r) => r.code === "home_form")) && (
            <div className="rounded-xl border border-white/10 bg-[var(--fp-bg-elevated)]/20 px-3 py-2">
              <div className="font-mono text-[8px] uppercase tracking-wider text-[var(--fp-text-muted)]">{t("panels.homeForm")}</div>
              <div className="mt-1 font-mono text-sm font-semibold tracking-[0.12em] text-[var(--fp-text)]">
                {explanation.formHome || formReasons.find((r) => r.code === "home_form")?.label.replace(/^Home Form\s+/i, "")}
              </div>
            </div>
          )}
          {(explanation.formAway || formReasons.find((r) => r.code === "away_form")) && (
            <div className="rounded-xl border border-white/10 bg-[var(--fp-bg-elevated)]/20 px-3 py-2">
              <div className="font-mono text-[8px] uppercase tracking-wider text-[var(--fp-text-muted)]">{t("panels.awayForm")}</div>
              <div className="mt-1 font-mono text-sm font-semibold tracking-[0.12em] text-[var(--fp-text)]">
                {explanation.formAway || formReasons.find((r) => r.code === "away_form")?.label.replace(/^Away Form\s+/i, "")}
              </div>
            </div>
          )}
        </div>
      )}

      {explanation.expectedGoals != null && Number.isFinite(explanation.expectedGoals) && (
        <div className="mt-3 font-mono text-[10px] text-[var(--fp-text-muted)]">
          Σ λ = <span className="text-[var(--fp-text)]">{explanation.expectedGoals.toFixed(2)}</span> {t("panels.expectedGoals")}
        </div>
      )}
    </>
  );

  if (!framed) return <div>{body}</div>;

  return <section className="rounded-2xl border border-white/5 bg-[var(--fp-bg)]/30 p-5">{body}</section>;
}
