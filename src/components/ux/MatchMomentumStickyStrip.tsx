import { useLocale } from "../../context/LocaleContext";

type Props = {
  minute: number | null;
  status: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  homeMomentum: number;
  awayMomentum: number;
  confidenceLabel: string;
  /** Scrolls the modal back to the full Signal card — the strip's own "jump to context" affordance. */
  onJumpToTop?: () => void;
};

/**
 * A minimal, always-visible echo of match state — pinned near the top of the modal's own
 * scroll container (a direct sibling of the close button, so it survives scrolling through
 * every DETAIL_TABS section, not just Overview). Deliberately thin: no story, no chips —
 * those live in the full Signal card above; this is only the "is anything still true" glance.
 */
export default function MatchMomentumStickyStrip({
  minute,
  status,
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  homeMomentum,
  awayMomentum,
  confidenceLabel,
  onJumpToTop
}: Props) {
  const { t } = useLocale();
  const minuteLabel = status === "HT" ? "HT" : status === "FT" ? "FT" : minute != null ? `${minute}'` : "—";
  const scoreLabel = `${homeScore ?? "–"}-${awayScore ?? "–"}`;
  const summaryLabel = `${t("card.momentum")}: ${homeTeam} ${scoreLabel} ${awayTeam}, ${minuteLabel}`;

  return (
    <button
      type="button"
      onClick={onJumpToTop}
      aria-label={summaryLabel}
      className="sticky top-14 z-10 mx-4 flex items-center gap-2.5 rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-3 py-2 text-left shadow-fp transition-colors duration-150 hover:border-fp-accent/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] sm:mx-6"
    >
      <span className="shrink-0 font-mono text-[10px] font-bold tabular-nums text-[var(--fp-text-muted)]">{minuteLabel}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-bold tabular-nums text-[var(--fp-text)]">
        {homeTeam} {scoreLabel} {awayTeam}
      </span>
      <span className="relative hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--fp-border)] sm:block">
        <span className="absolute inset-y-0 left-0 bg-[var(--fp-accent)]" style={{ width: `${homeMomentum}%` }} />
        <span className="absolute inset-y-0 right-0 bg-[var(--fp-danger)]" style={{ width: `${awayMomentum}%` }} />
      </span>
      <span className="shrink-0 rounded-full border border-fp-accent/30 bg-fp-accent/10 px-2 py-0.5 font-mono text-[10px] font-bold text-[var(--fp-accent)]">
        {confidenceLabel}
      </span>
    </button>
  );
}
