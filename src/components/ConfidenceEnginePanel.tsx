import { useLocale } from "../context/LocaleContext";
import CollapsiblePanel from "../design-system/CollapsiblePanel";
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
 * Sections start collapsed (title only) for progressive disclosure.
 */
export default function ConfidenceEnginePanel({
  engine,
  recommendationPick
}: {
  engine: ConfidenceEngineData;
  recommendationPick?: string | null;
}) {
  const { t } = useLocale();
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

  const scoreGrid = (
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
  );

  return (
    <div className="space-y-2">
      <CollapsiblePanel
        compact
        title={t("panels.confidence")}
        subtitle={
          recommendationPick
            ? `${t("panels.confidenceSub")} · ${t("panels.forRec", { pick: recommendationPick })}`
            : t("panels.confidenceSub")
        }
        badge={
          <span
            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${categoryTone(category)}`}
          >
            {category} · {overall}%
          </span>
        }
      >
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <p className="text-xs font-medium text-[var(--fp-text-muted)]">{t("panels.confidenceSub")}</p>
          <div className="text-right">
            <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">
              {t("panels.confidence")}
            </div>
            <div className={`font-display text-2xl font-bold tabular-nums ${overallToneClass(overall)}`}>{overall}%</div>
          </div>
        </div>
        {scoreGrid}
      </CollapsiblePanel>

      {(whyLines.length > 0 || engine.why) && (
        <CollapsiblePanel compact title={t("panels.whyRec", { category })}>
          <ul className="space-y-1.5 text-sm font-medium leading-relaxed text-[var(--fp-text)]">
            {(whyLines.length > 0 ? whyLines : [engine.why || ""]).filter(Boolean).map((line, i) => (
              <li key={`why-${i}`} className="flex gap-2">
                <span className="mt-0.5 text-[var(--fp-accent)]">▸</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </CollapsiblePanel>
      )}

      {dimLines.length > 0 && (
        <CollapsiblePanel compact title={t("panels.dimensionBreakdown")}>
          <ul className="space-y-1 text-xs font-medium leading-relaxed text-[var(--fp-text-muted)]">
            {dimLines.map((line, i) => (
              <li key={`${i}-${line.slice(0, 16)}`} className="flex gap-2">
                <span>•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </CollapsiblePanel>
      )}
    </div>
  );
}
