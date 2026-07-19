import { PredictionRow } from "../types";

type ConfidenceEngineData = NonNullable<PredictionRow["confidenceEngine"]>;

const DIMENSION_LABELS: Array<{ key: keyof NonNullable<ConfidenceEngineData["scores"]>; label: string }> = [
  { key: "attack", label: "Attack" },
  { key: "defense", label: "Defense" },
  { key: "form", label: "Form" },
  { key: "recentMatches", label: "Recent Matches" },
  { key: "standings", label: "Standings" },
  { key: "referee", label: "Referee" },
  { key: "injuries", label: "Injuries" },
  { key: "lineups", label: "Lineups" },
  { key: "restDays", label: "Rest Days" },
  { key: "homeAdvantage", label: "Home Advantage" },
  { key: "oddsConsensus", label: "Odds Consensus" },
  { key: "h2h", label: "H2H" }
];

function categoryTone(category?: string): string {
  switch (category) {
    case "Very High":
      return "border-[var(--fp-success)]/40 bg-[var(--fp-success)]/15 text-[var(--fp-success)]";
    case "High":
      return "border-[var(--fp-accent)]/40 bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]";
    case "Medium":
      return "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text)]";
    case "Low":
      return "border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10 text-[var(--fp-warning)]";
    case "Very Low":
      return "border-[var(--fp-danger)]/40 bg-[var(--fp-danger)]/10 text-[var(--fp-danger)]";
    default:
      return "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]";
  }
}

function overallToneClass(overall: number): string {
  if (overall >= 80) return "text-[var(--fp-success)]";
  if (overall >= 65) return "text-[var(--fp-accent)]";
  if (overall >= 50) return "text-[var(--fp-text)]";
  if (overall >= 35) return "text-[var(--fp-warning)]";
  return "text-[var(--fp-danger)]";
}

function scoreToneClass(score: number, available: boolean): string {
  if (!available) return "text-[var(--fp-text-faint)]";
  if (score >= 66) return "text-[var(--fp-success)]";
  if (score <= 34) return "text-[var(--fp-danger)]";
  return "text-[var(--fp-accent)]";
}

function barWidth(score: number): string {
  return `${Math.max(4, Math.min(100, score))}%`;
}

/**
 * Independent Confidence Engine UI — context reliability breakdown.
 * Never replaces recommended.confidence (model pick probability).
 */
export default function ConfidenceEnginePanel({
  engine,
  recommendationPick
}: {
  engine: ConfidenceEngineData;
  recommendationPick?: string | null;
}) {
  const overall = Math.round(engine.confidence ?? engine.overall ?? 0);
  const category = engine.category || "Medium";
  const available = engine.available || {};
  const whyLines =
    Array.isArray(engine.recommendationWhy) && engine.recommendationWhy.length > 0
      ? engine.recommendationWhy
      : Array.isArray(engine.explanation)
        ? engine.explanation.filter((l) => /Recommendation|context confidence|Strongest|Weak|coverage/i.test(l))
        : [];
  const dimLines = Array.isArray(engine.explanation)
    ? engine.explanation.filter((l) => !whyLines.includes(l))
    : [];

  return (
    <section className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 shadow-[var(--fp-shadow-sm)] sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--fp-border)] pb-3">
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--fp-accent)]">Confidence</h3>
          <p className="mt-1 max-w-md text-xs font-medium text-[var(--fp-text-muted)]">
            Independent context reliability · does not change the prediction
          </p>
          {recommendationPick ? (
            <p className="mt-2 text-sm font-medium text-[var(--fp-text)]">
              For recommendation <span className="font-bold">{recommendationPick}</span>
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <div
            className={`inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${categoryTone(category)}`}
          >
            {category}
          </div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">Confidence</div>
          <div className={`font-display text-3xl font-bold tabular-nums ${overallToneClass(overall)}`}>{overall}%</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {DIMENSION_LABELS.map(({ key, label }) => {
          const score = Math.round(Number(engine.scores?.[key]) || 0);
          const isAvailable = available[key] !== false;
          return (
            <div
              key={key}
              className={`rounded-[var(--fp-radius-sm)] border p-2.5 transition ${
                isAvailable
                  ? "border-[var(--fp-border)] bg-[var(--fp-bg-muted)]"
                  : "border-[var(--fp-border)] bg-[var(--fp-bg)] opacity-60"
              }`}
              title={isAvailable ? undefined : "Insufficient data (neutral 50, dimmed)"}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="truncate text-[8px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
                  {label}
                </div>
                <div className={`text-sm font-bold tabular-nums ${scoreToneClass(score, isAvailable)}`}>
                  {isAvailable ? score : "—"}
                </div>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--fp-bg-card)]">
                <div
                  className={`h-full rounded-full ${isAvailable ? "bg-[var(--fp-accent)]" : "bg-[var(--fp-text-faint)]"}`}
                  style={{ width: isAvailable ? barWidth(score) : "50%" }}
                />
              </div>
              {!isAvailable && (
                <div className="mt-0.5 text-[7.5px] font-bold uppercase tracking-wide text-[var(--fp-text-faint)]">n/a</div>
              )}
            </div>
          );
        })}
      </div>

      {(whyLines.length > 0 || engine.why) && (
        <div className="mt-4 rounded-[var(--fp-radius-sm)] border border-[var(--fp-accent)]/25 bg-[var(--fp-accent-muted)] p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--fp-accent)]">
            Why this recommendation got {category}
          </div>
          <ul className="mt-2 space-y-1.5 text-sm font-medium leading-relaxed text-[var(--fp-text)]">
            {(whyLines.length > 0 ? whyLines : [engine.why || ""]).filter(Boolean).map((line, i) => (
              <li key={`why-${i}`} className="flex gap-2">
                <span className="mt-0.5 text-[var(--fp-accent)]">▸</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {dimLines.length > 0 && (
        <details className="group mt-3 border-t border-[var(--fp-border)] pt-3" open>
          <summary className="cursor-pointer list-none text-[9px] font-bold uppercase tracking-wider text-[var(--fp-accent)] outline-none marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5">
              Dimension breakdown
              <span className="text-[var(--fp-text-muted)] transition group-open:rotate-90">›</span>
            </span>
          </summary>
          <ul className="mt-2 space-y-1 text-xs font-medium leading-relaxed text-[var(--fp-text-muted)]">
            {dimLines.map((line, i) => (
              <li key={`${i}-${line.slice(0, 16)}`} className="flex gap-2">
                <span>•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
