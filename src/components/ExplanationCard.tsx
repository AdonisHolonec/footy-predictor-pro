import type { PredictionExplanation, PredictionReason } from "../types";

function polarityClass(polarity?: PredictionReason["polarity"]): string {
  switch (polarity) {
    case "positive":
    case "support":
      return "text-signal-sage border-signal-sage/25 bg-signal-sage/8";
    case "negative":
      return "text-signal-rose border-signal-rose/25 bg-signal-rose/8";
    default:
      return "text-signal-ink border-white/10 bg-signal-mist/20";
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
        <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-signal-petrol/75">Reasoning</div>
        <ul className="space-y-0.5 font-mono text-[9px] leading-snug text-signal-inkMuted">
          {top.map((r) => (
            <li key={`${r.code}-${r.label}`} className="truncate" title={r.label}>
              <span className="text-signal-petrol">·</span> {r.label}
            </li>
          ))}
          {formReasons.map((r) => (
            <li key={`${r.code}-${r.label}`} className="truncate tracking-wide text-signal-ink" title={r.label}>
              <span className="text-signal-petrol">·</span> {r.label}
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
            <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">Prediction Explanation</h3>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
              From real match data · no generic copy
            </p>
          </div>
        ) : (
          <div />
        )}
        <div className="text-right">
          <div className="font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">Prediction</div>
          <div className="font-display text-2xl font-bold text-signal-ink">{pick}</div>
          {confidence != null && Number.isFinite(confidence) ? (
            <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-signal-petrol">
              Confidence {Math.round(confidence)}%
            </div>
          ) : null}
        </div>
      </div>

      <div className="mb-3 font-mono text-[9px] uppercase tracking-[0.16em] text-signal-petrol/80">Reasoning</div>
      {otherReasons.length === 0 && formReasons.length === 0 ? (
        <p className="font-mono text-[11px] text-signal-inkMuted">Insufficient structured signals for this pick.</p>
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
            <div className="rounded-xl border border-white/10 bg-signal-mist/20 px-3 py-2">
              <div className="font-mono text-[8px] uppercase tracking-wider text-signal-inkMuted">Home Form</div>
              <div className="mt-1 font-mono text-sm font-semibold tracking-[0.12em] text-signal-ink">
                {explanation.formHome || formReasons.find((r) => r.code === "home_form")?.label.replace(/^Home Form\s+/i, "")}
              </div>
            </div>
          )}
          {(explanation.formAway || formReasons.find((r) => r.code === "away_form")) && (
            <div className="rounded-xl border border-white/10 bg-signal-mist/20 px-3 py-2">
              <div className="font-mono text-[8px] uppercase tracking-wider text-signal-inkMuted">Away Form</div>
              <div className="mt-1 font-mono text-sm font-semibold tracking-[0.12em] text-signal-ink">
                {explanation.formAway || formReasons.find((r) => r.code === "away_form")?.label.replace(/^Away Form\s+/i, "")}
              </div>
            </div>
          )}
        </div>
      )}

      {explanation.expectedGoals != null && Number.isFinite(explanation.expectedGoals) && (
        <div className="mt-3 font-mono text-[10px] text-signal-inkMuted">
          Σ λ = <span className="text-signal-ink">{explanation.expectedGoals.toFixed(2)}</span> expected goals
        </div>
      )}
    </>
  );

  if (!framed) return <div>{body}</div>;

  return <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-5">{body}</section>;
}
