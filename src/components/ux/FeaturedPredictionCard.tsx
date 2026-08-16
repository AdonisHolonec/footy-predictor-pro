import { useState } from "react";
import type { PredictionRow } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import { ConfidenceAura } from "../SignalLab";
import PredictionContributionsChart from "../PredictionContributionsChart";
import { formatRecommendedPick } from "../../utils/formatRecommendation";
import MarketFamilyIcon from "../icons/MarketFamilyIcon";

type Props = {
  match: PredictionRow | null;
  onOpenAnalysis: () => void;
};

export default function FeaturedPredictionCard({ match, onOpenAnalysis }: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  if (!match) return null;

  const recommendedLabel = formatRecommendedPick(match.recommended?.pick, match.recommended?.family, t, match.recommended);
  const confPct =
    match.recommended?.confidence != null && Number.isFinite(Number(match.recommended.confidence))
      ? Math.round(Number(match.recommended.confidence))
      : 0;
  const hasExactConfidence = match.recommended?.confidence != null;
  const odd = Number(match.recommended?.odd);
  const hasOdd = Number.isFinite(odd) && odd > 1;
  const evLine =
    match.valueBet?.detected && match.valueBet.ev != null
      ? `+EV ${match.valueBet.ev.toFixed(1)}%`
      : hasOdd
        ? `${t("card.oddLabel", { odd: odd.toFixed(2) })}`
        : null;
  const kickoffTime = new Date(match.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-fp overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--fp-border)] px-4 py-2.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--fp-accent)]" />
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fp-accent)]">
          {t("dash.featuredKicker")}
        </span>
        <span className="ml-auto min-w-0 truncate text-[11px] font-semibold text-[var(--fp-text-muted)]">
          {match.league}
        </span>
      </div>

      {/* The hero's primary action is the analysis — the whole verdict area opens it,
          matching every other card's tap-to-open contract; the "why" toggle below stays
          a separate, secondary interaction. */}
      <button
        type="button"
        onClick={onOpenAnalysis}
        className="flex w-full items-center gap-4 px-4 pb-1 pt-4 text-left transition-colors hover:bg-fp-bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
      >
        <ConfidenceAura value={confPct} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[length:var(--fp-body)] font-bold leading-tight text-[var(--fp-text)]">
            {match.teams.home}
            <br />
            {match.teams.away}
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--fp-accent-muted)] px-2.5 py-1 text-xs font-extrabold text-[var(--fp-accent)]">
            <MarketFamilyIcon familyKey={recommendedLabel.familyKey} />
            {recommendedLabel.label}
          </div>
          <div className="mt-1.5 text-xs text-[var(--fp-text-muted)]">
            {kickoffTime}
            {evLine ? ` · ${evLine}` : ""}
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 flex min-h-[var(--fp-touch)] w-full items-center gap-2 border-t border-[var(--fp-border)] px-4 py-3 text-xs font-bold text-[var(--fp-text)] hover:bg-[var(--fp-bg-muted)]"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v3M18.4 5.6l-2.1 2.1M21 12h-3M12 21v-3M3 12h3M5.6 5.6l2.1 2.1" />
          <circle cx="12" cy="12" r="3.4" />
        </svg>
        {t("dash.featuredWhyConfident")}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="ml-auto transition-transform duration-[var(--fp-ease)]"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {match.predictionContributions ? (
            <PredictionContributionsChart data={match.predictionContributions} framed={false} />
          ) : (
            <p className="text-xs text-[var(--fp-text-muted)]">{t("dash.advancedEmpty")}</p>
          )}
          {!hasExactConfidence && (
            <p className="mt-2 text-[10px] text-[var(--fp-text-muted)]">
              {match.recommended?.confidenceCategory || ""}
            </p>
          )}
          <button
            type="button"
            onClick={onOpenAnalysis}
            className="mt-4 min-h-[var(--fp-touch)] w-full rounded-xl border border-[var(--fp-accent)] bg-transparent py-2.5 text-xs font-extrabold text-[var(--fp-accent)] hover:bg-[var(--fp-accent-muted)]"
          >
            {t("dash.featuredOpenAnalysis")}
          </button>
        </div>
      )}
    </div>
  );
}
