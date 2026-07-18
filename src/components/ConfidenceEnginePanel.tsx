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
      return "border-signal-sage/40 bg-signal-sage/15 text-signal-sage";
    case "High":
      return "border-signal-petrol/40 bg-signal-petrol/12 text-signal-petrol";
    case "Medium":
      return "border-white/15 bg-signal-mist/20 text-signal-ink";
    case "Low":
      return "border-signal-amberSoft/40 bg-signal-amberSoft/10 text-signal-amberSoft";
    case "Very Low":
      return "border-signal-rose/40 bg-signal-rose/10 text-signal-rose";
    default:
      return "border-white/10 bg-signal-void/30 text-signal-inkMuted";
  }
}

function overallToneClass(overall: number): string {
  if (overall >= 80) return "text-signal-sage";
  if (overall >= 65) return "text-signal-petrol";
  if (overall >= 50) return "text-signal-ink";
  if (overall >= 35) return "text-signal-amberSoft";
  return "text-signal-rose";
}

function scoreToneClass(score: number, available: boolean): string {
  if (!available) return "text-signal-inkMuted/70";
  if (score >= 66) return "text-signal-sage";
  if (score <= 34) return "text-signal-rose";
  return "text-signal-petrol";
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
    <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/5 pb-3">
        <div>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">Confidence Engine</h3>
          <p className="mt-1 max-w-md font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
            Independent context reliability · does not change the prediction
          </p>
          {recommendationPick ? (
            <p className="mt-2 font-mono text-[10px] text-signal-ink/80">
              For recommendation <span className="font-semibold text-signal-ink">{recommendationPick}</span>
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <div
            className={`inline-flex items-center rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide ${categoryTone(category)}`}
          >
            {category}
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">Confidence</div>
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
              className={`rounded-xl border p-2.5 transition ${
                isAvailable ? "border-white/10 bg-signal-mist/25" : "border-white/5 bg-signal-void/25 opacity-55"
              }`}
              title={isAvailable ? undefined : "Insufficient data (neutral 50, dimmed)"}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="truncate font-mono text-[8px] font-semibold uppercase tracking-wide text-signal-inkMuted">
                  {label}
                </div>
                <div className={`font-mono text-sm font-bold tabular-nums ${scoreToneClass(score, isAvailable)}`}>
                  {isAvailable ? score : "—"}
                </div>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-signal-void/60">
                <div
                  className={`h-full rounded-full ${isAvailable ? "bg-signal-petrol/70" : "bg-signal-inkMuted/30"}`}
                  style={{ width: isAvailable ? barWidth(score) : "50%" }}
                />
              </div>
              {!isAvailable && (
                <div className="mt-0.5 font-mono text-[7.5px] uppercase tracking-wide text-signal-inkMuted/70">n/a</div>
              )}
            </div>
          );
        })}
      </div>

      {(whyLines.length > 0 || engine.why) && (
        <div className="mt-4 rounded-xl border border-signal-petrol/20 bg-signal-petrol/5 p-3">
          <div className="font-mono text-[9px] uppercase tracking-wider text-signal-petrol/90">
            Why this recommendation got {category}
          </div>
          <ul className="mt-2 space-y-1.5 font-mono text-[10px] leading-relaxed text-signal-ink/85">
            {(whyLines.length > 0 ? whyLines : [engine.why || ""]).filter(Boolean).map((line, i) => (
              <li key={`why-${i}`} className="flex gap-2">
                <span className="mt-0.5 text-signal-petrol">▸</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {dimLines.length > 0 && (
        <details className="group mt-3 border-t border-white/5 pt-3" open>
          <summary className="cursor-pointer list-none font-mono text-[9px] uppercase tracking-wider text-signal-petrol/80 outline-none marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5">
              Dimension breakdown
              <span className="text-signal-inkMuted transition group-open:rotate-90">›</span>
            </span>
          </summary>
          <ul className="mt-2 space-y-1 font-mono text-[10px] leading-relaxed text-signal-inkMuted">
            {dimLines.map((line, i) => (
              <li key={`${i}-${line.slice(0, 16)}`} className="flex gap-2">
                <span className="text-signal-stone/70">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
