import { useMemo } from "react";
import type { CardMarketValidations, HistoryStats, PredictionRow } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import { predictSurfaceProps, type PredictAction } from "./predictState";
import type { UpgradeTier } from "../../design-system/UpgradePrompt";
import Button from "../../design-system/Button";
import EmptyState from "../../design-system/EmptyState";
import FeaturedPredictionCard from "./FeaturedPredictionCard";
import MatchList from "./MatchList";
import MatchListRow from "./MatchListRow";
import { NavIcon } from "./navIcons";
import { isFixtureInPlay } from "../../utils/appUtils";
import { confidenceOf, expectedValueOf, isHighConfidenceRow, isValueRow } from "../../utils/predictionSignals";

type AccessTier = UpgradeTier | "free" | string;

/** Today is list-first: enough rows to scan, few enough to stay above the entry cards. */
const HOME_LIST_ROWS = 8;
/** The live ticker shows this many in-play rows; the rest are one tap away in Matches › Live. */
const HOME_LIVE_ROWS = 3;

/** Sizes of the sets the Matches filters select — still computed upstream, reported on the Matches entry. */
export type HomeCounts = {
  total: number;
  value: number;
  highConfidence: number;
};

type Props = {
  matches: PredictionRow[];
  counts: HomeCounts;
  analysisMatch: PredictionRow | null;
  liveCount: number;
  accessTier: AccessTier;
  marketValidationsByFixtureId: Map<number, CardMarketValidations>;
  isWatched: (fixtureId: number) => boolean;
  onToggleWatch: (fixtureId: number) => void;
  onOpenMatch: (row: PredictionRow) => void;
  onUpgradeRequired: (feature: string, requiredTier: UpgradeTier) => void;
  onGoMatches: () => void;
  /** Opens Matches on its Live segment — a filter, not a destination. */
  onGoLive: () => void;
  onGoHistory: () => void;
  onGoStatistics: () => void;
  onGoTickets: () => void;
  /** The shared Predict contract. Never call onPredict directly — use action.onActivate. */
  predictAction?: PredictAction;
  trackerStats: HistoryStats;
  /** ISO `YYYY-MM-DD` the feed is browsed for — drives the context line. */
  selectedDate: string;
};

/**
 * Today (UX-B) answers one question: "what should I look at first today?"
 *
 *   1. context line — the browsed date and how many fixtures were analysed
 *   2. Featured — the strongest recommendation
 *   3. Live now — a compact ticker of in-play rows, only when something is live
 *   4. Top picks — the remaining list, never repeating the featured fixture
 *   5. entry cards — Matches · Results · Performance · Tickets, small and last
 *
 * Gone from this surface on purpose: the randomised greeting H1, the filter
 * chips that wrote persistent preferences shared with Matches, the full
 * performance card and the full ticket product. Each now has one home.
 */
export default function HomeSection({
  matches,
  counts,
  analysisMatch,
  liveCount,
  marketValidationsByFixtureId,
  isWatched,
  onToggleWatch,
  onOpenMatch,
  onGoMatches,
  onGoLive,
  onGoHistory,
  onGoStatistics,
  onGoTickets,
  predictAction,
  trackerStats,
  selectedDate
}: Props) {
  const { t, locale } = useLocale();

  const liveMatches = useMemo(() => matches.filter((m) => isFixtureInPlay(m.status)), [matches]);
  const topPicks = useMemo(() => {
    // The Featured card already shows `analysisMatch` — the top-confidence
    // upcoming row, i.e. exactly the row that would sort first here. Drop it so
    // one fixture never renders twice on the same screen; in-play rows belong to
    // the ticker above. No placeholders when fewer rows exist.
    const featuredId = analysisMatch?.id ?? null;
    const upcoming = matches.filter((m) => !isFixtureInPlay(m.status) && m.id !== featuredId);
    const eligible = upcoming.filter((m) => isHighConfidenceRow(m) || isValueRow(m));
    const pool = eligible.length ? eligible : upcoming;
    return [...pool]
      .sort((a, b) => confidenceOf(b) - confidenceOf(a) || expectedValueOf(b) - expectedValueOf(a))
      .slice(0, HOME_LIST_ROWS);
  }, [matches, analysisMatch]);

  // The browsed date, not the wall clock: the list below follows `selectedDate`,
  // so the line above it must too. Parsed at local midnight so a "YYYY-MM-DD"
  // key never shifts a day across time zones.
  const dateLabel = useMemo(() => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    const when = y && m && d ? new Date(y, m - 1, d) : new Date(selectedDate);
    return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-US", {
      weekday: "long",
      day: "numeric",
      month: "long"
    }).format(when);
  }, [locale, selectedDate]);

  const hasResults = trackerStats.settled > 0;

  const renderRow = (row: PredictionRow) => (
    <MatchListRow
      key={row.id}
      row={row}
      marketValidations={marketValidationsByFixtureId.get(Number(row.id)) ?? row.cardMarketValidations ?? null}
      watched={isWatched(Number(row.id))}
      onToggleWatch={() => onToggleWatch(Number(row.id))}
      onOpen={() => onOpenMatch(row)}
    />
  );

  const entryCard =
    "flex min-h-11 items-center gap-2 rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-3 py-2 text-left text-sm font-semibold text-[var(--fp-text)] transition-colors hover-fine:border-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]";

  return (
    <section className="space-y-5">
      {/* 1 · context line — not a heading; the page title is the destination itself. */}
      <p className="text-xs text-[var(--fp-text-muted)] sm:text-sm" data-testid="today-context">
        <span className="font-semibold text-[var(--fp-text)]">{dateLabel}</span>
        <span aria-hidden> · </span>
        {t("dash.matchesAnalyzedToday", { n: counts.total })}
      </p>

      {!matches.length ? (
        <EmptyState
          title={t("dash.emptyPredsTitle")}
          /* Never instruct an action the system will refuse: when Predict is
             unavailable the description states why instead. */
          description={predictAction?.reason ?? t("dash.emptyPredsDesc")}
          actionLabel={t("shell.predict")}
          onAction={predictAction?.onActivate}
          /*
            The state arrives WHOLE, through the surface. This used to pass
            `actionDisabled` alongside it, which set the native attribute and
            took the button out of the tab order — silencing the very reason the
            surface was carrying. One model: aria-disabled, focusable, and the
            description above says the same thing in visible words.
          */
          actionProps={predictAction ? predictSurfaceProps(predictAction) : undefined}
        />
      ) : (
        <>
          {/* 2 · the strongest recommendation */}
          {analysisMatch && (
            <FeaturedPredictionCard match={analysisMatch} onOpenAnalysis={() => onOpenMatch(analysisMatch)} />
          )}

          {/* 3 · live ticker — compact rows, only while something is in play */}
          {liveMatches.length > 0 && (
            <div className="space-y-2" data-testid="today-live">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]">
                  <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--fp-live)] motion-safe:animate-pulse" />
                  {t("dash.homeLiveTitle")}
                </h2>
                <Button variant="ghost" size="sm" onClick={onGoLive}>
                  {t("dash.showAll")} · {liveCount}
                </Button>
              </div>
              <MatchList label={t("dash.homeLiveTitle")}>{liveMatches.slice(0, HOME_LIVE_ROWS).map(renderRow)}</MatchList>
            </div>
          )}

          {/* 4 · the remaining list */}
          {topPicks.length > 0 && (
            <div className="space-y-2" data-testid="today-picks">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]">
                  {t("dash.topPicksTitle")}
                </h2>
                <Button variant="ghost" size="sm" onClick={onGoMatches}>
                  {t("dash.showAll")} · {counts.total}
                </Button>
              </div>
              <MatchList label={t("dash.topPicksTitle")}>{topPicks.map(renderRow)}</MatchList>
            </div>
          )}
        </>
      )}

      {/* 5 · entry cards — secondary, small, last. Each opens the one place that
          owns the thing; nothing here renders the thing itself. */}
      <nav aria-label={t("nav.secondary")} className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="today-entries">
        <button type="button" onClick={onGoMatches} className={entryCard}>
          <NavIcon id="matches" />
          <span className="min-w-0 truncate">{t("nav.matches")}</span>
          <span className="ml-auto font-mono text-xs text-[var(--fp-text-muted)]">{counts.total}</span>
        </button>
        <button type="button" onClick={onGoHistory} className={entryCard}>
          <NavIcon id="history" />
          <span className="min-w-0 truncate">{t("nav.results")}</span>
        </button>
        <button type="button" onClick={onGoStatistics} className={entryCard}>
          <NavIcon id="statistics" />
          <span className="min-w-0 truncate">{t("nav.performance")}</span>
          {hasResults && (
            <span className="ml-auto font-mono text-xs text-[var(--fp-text-muted)]" title={t("history.successRate")}>
              {trackerStats.winRate.toFixed(0)}%
            </span>
          )}
        </button>
        <button type="button" onClick={onGoTickets} className={entryCard}>
          <NavIcon id="tickets" />
          <span className="min-w-0 truncate">{t("nav.tickets")}</span>
        </button>
      </nav>
    </section>
  );
}
