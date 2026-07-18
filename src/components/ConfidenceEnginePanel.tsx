import { PredictionRow } from "../types";

type ConfidenceEngineData = NonNullable<PredictionRow["confidenceEngine"]>;

const DIMENSION_LABELS: Array<{ key: keyof ConfidenceEngineData["scores"]; label: string }> = [
  { key: "attack", label: "Attack" },
  { key: "defense", label: "Defense" },
  { key: "form", label: "Form" },
  { key: "standings", label: "Standings" },
  { key: "h2h", label: "H2H" },
  { key: "restDays", label: "Rest Days" },
  { key: "referee", label: "Referee" },
  { key: "injuries", label: "Injuries" },
  { key: "oddsConsensus", label: "Odds Consensus" },
  { key: "teamStatistics", label: "Team Statistics" }
];

function overallToneClass(overall: number): string {
  if (overall >= 70) return "text-signal-sage";
  if (overall >= 50) return "text-signal-petrol";
  return "text-signal-amberSoft";
}

function scoreToneClass(score: number, available: boolean): string {
  if (!available) return "text-signal-inkMuted/70";
  if (score >= 66) return "text-signal-sage";
  if (score <= 34) return "text-signal-rose";
  return "text-signal-petrol";
}

/**
 * Displays the independent Confidence Engine block attached to a prediction row.
 *
 * This is purely explanatory context — it never reflects or replaces the model's
 * `recommended.confidence` (pick probability). Dimensions with no usable data are dimmed and
 * marked "n/a" rather than showing a fake precise number.
 */
export default function ConfidenceEnginePanel({ engine }: { engine: ConfidenceEngineData }) {
  const overall = Math.round(engine.overall ?? 0);
  const available = engine.available || {};

  return (
    <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
        <div>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">Confidence Engine</h3>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
            context reliability · independent din pick probability
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">Overall Confidence</div>
          <div className={`font-display text-3xl font-bold tabular-nums ${overallToneClass(overall)}`}>{overall}%</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {DIMENSION_LABELS.map(({ key, label }) => {
          const score = Math.round(Number(engine.scores?.[key]) || 0);
          const isAvailable = available[key] !== false;
          return (
            <div
              key={key}
              className={`rounded-xl border p-2.5 text-center transition ${
                isAvailable ? "border-white/10 bg-signal-mist/25" : "border-white/5 bg-signal-void/25 opacity-55"
              }`}
              title={isAvailable ? undefined : "Fără date suficiente pentru această dimensiune (scor neutru)"}
            >
              <div className="truncate font-mono text-[8px] font-semibold uppercase tracking-wide text-signal-inkMuted">
                {label}
              </div>
              <div className={`mt-1 font-mono text-lg font-bold tabular-nums ${scoreToneClass(score, isAvailable)}`}>
                {isAvailable ? `${score}` : "—"}
              </div>
              {!isAvailable && <div className="mt-0.5 font-mono text-[7.5px] uppercase tracking-wide text-signal-inkMuted/70">n/a</div>}
            </div>
          );
        })}
      </div>

      {Array.isArray(engine.explanation) && engine.explanation.length > 0 && (
        <details className="group mt-4 border-t border-white/5 pt-3">
          <summary className="cursor-pointer list-none font-mono text-[9px] uppercase tracking-wider text-signal-petrol/80 outline-none marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5">
              De ce acest scor?
              <span className="text-signal-inkMuted transition group-open:rotate-90">›</span>
            </span>
          </summary>
          <ul className="mt-2 list-inside list-disc space-y-1 font-mono text-[10px] leading-relaxed text-signal-inkMuted">
            {engine.explanation.map((line, i) => (
              <li key={`${i}-${line.slice(0, 12)}`}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
