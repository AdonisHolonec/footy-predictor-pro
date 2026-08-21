import { useMemo } from "react";
import type { CardMarketValidations, HistoryEntry, HistoryStats, PredictionRow } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import type { UpgradeTier } from "../../design-system/UpgradePrompt";
import Button from "../../design-system/Button";
import EmptyState from "../../design-system/EmptyState";
import FeaturedPredictionCard from "./FeaturedPredictionCard";
import GlobalSpecialBetSection from "./GlobalSpecialBetSection";
import MatchList from "./MatchList";
import MatchListRow from "./MatchListRow";
import RecentPerformanceCard from "./RecentPerformanceCard";
import type { FixtureLabel } from "../../utils/globalSpecialBetView";
import { getGreeting } from "../../utils/greeting";
import { isFixtureInPlay } from "../../utils/appUtils";
import { confidenceOf, expectedValueOf, isHighConfidenceRow, isValueRow } from "../../utils/predictionSignals";
import { CHAMPIONS_LEAGUE_ID, EUROPA_LEAGUE_ID } from "../../constants/appConstants";

type AccessTier = UpgradeTier | "free" | string;

/** Home is list-first: enough rows to scan, few enough to stay above the secondary modules. */
const HOME_LIST_ROWS = 8;

/** Sizes of the sets the filter chips select, taken before any chip is applied. */
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
  onGoLive: () => void;
  onGoHistory: () => void;
  onGoStatistics: () => void;
  onPredict: () => void;
  valueOnly: boolean;
  onToggleValue: () => void;
  highConfActive: boolean;
  onToggleHighConf: () => void;
  trackerStats: HistoryStats;
  history: HistoryEntry[];
  /** Calendar day the Global Special Bet is built from — the dashboard's active date. */
  betDate: string;
  /** ISO `YYYY-MM-DD` the feed is browsed for — drives the header date line. */
  selectedDate: string;
  /** The user's favourite leagues; the only scope /api/special-bets accepts. */
  favoriteLeagueIds: number[];
  /** fixture_id -> readable labels, so a snapshot that stores ids can still name its matches. */
  gsbFixtureIndex?: Map<number, FixtureLabel>;
  /** Fails closed, matching the per-match Special Bet convention. */
  canUseGlobalSpecialBet?: boolean;
};

export default function HomeSection({
  matches,
  counts,
  analysisMatch,
  liveCount,
  marketValidationsByFixtureId,
  isWatched,
  onToggleWatch,
  onOpenMatch,
  onUpgradeRequired,
  onGoMatches,
  onGoLive,
  onGoHistory,
  onGoStatistics,
  onPredict,
  valueOnly,
  onToggleValue,
  highConfActive,
  onToggleHighConf,
  trackerStats,
  history,
  betDate,
  selectedDate,
  favoriteLeagueIds,
  gsbFixtureIndex,
  canUseGlobalSpecialBet = false
}: Props) {
  const { t, locale } = useLocale();

  const liveMatches = useMemo(() => matches.filter((m) => isFixtureInPlay(m.status)), [matches]);
  const topPicks = useMemo(() => {
    // In-play rows own the "Live now" section at the top of the page — Top picks
    // stays the upcoming, still-actionable shortlist (no duplicate cards).
    // The Featured card above already shows `analysisMatch` — the top-confidence
    // upcoming row, i.e. exactly the row that would sort first here. Drop it so one
    // fixture never renders twice on the same screen. The slice still yields up to
    // three *other* picks and never invents placeholders when fewer exist.
    const featuredId = analysisMatch?.id ?? null;
    const upcoming = matches.filter((m) => !isFixtureInPlay(m.status) && m.id !== featuredId);
    const eligible = upcoming.filter((m) => isHighConfidenceRow(m) || isValueRow(m));
    const pool = eligible.length ? eligible : upcoming;
    return [...pool]
      .sort((a, b) => confidenceOf(b) - confidenceOf(a) || expectedValueOf(b) - expectedValueOf(a))
      .slice(0, HOME_LIST_ROWS);
  }, [matches, analysisMatch]);

  const hasLiveChampionsLeague = useMemo(
    () => matches.some((m) => m.leagueId === CHAMPIONS_LEAGUE_ID && isFixtureInPlay(m.status)),
    [matches]
  );
  const hasLiveEuropaLeague = useMemo(
    () => matches.some((m) => m.leagueId === EUROPA_LEAGUE_ID && isFixtureInPlay(m.status)),
    [matches]
  );

  const greeting = useMemo(
    () =>
      getGreeting({
        locale,
        hasLiveMatches: liveCount > 0,
        liveCount,
        hasLiveChampionsLeague,
        hasLiveEuropaLeague
      }),
    [locale, liveCount, hasLiveChampionsLeague, hasLiveEuropaLeague]
  );

  // The browsed date, not the wall clock: the list below follows `selectedDate`,
  // so the line above it must too. Parsed at local midnight so a "YYYY-MM-DD"
  // key never shifts a day across time zones.
  const todayLabel = useMemo(() => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    const when = y && m && d ? new Date(y, m - 1, d) : new Date(selectedDate);
    return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-US", {
      weekday: "long",
      day: "numeric",
      month: "long"
    }).format(when);
  }, [locale, selectedDate]);

  // Each chip carries the size of the set it selects, so the numbers the page used
  // to show as standalone KPI tiles now sit on the control that acts on them.
  // The live chip navigates away instead of filtering, so it stays countless —
  // the "Live now" section header already states how many are in play.
  const chips: { id: string; label: string; count?: number; active: boolean; onClick: () => void }[] = [
    { id: "all", label: t("dash.filterAll"), count: counts.total, active: !valueOnly && !highConfActive, onClick: () => {
      if (valueOnly) onToggleValue();
      if (highConfActive) onToggleHighConf();
    } },
    { id: "value", label: t("dash.filterValue"), count: counts.value, active: valueOnly, onClick: onToggleValue },
    {
      id: "highConf",
      label: t("dash.filterHighConf"),
      count: counts.highConfidence,
      active: highConfActive,
      onClick: onToggleHighConf
    },
    { id: "live", label: t("dash.filterLive"), active: false, onClick: onGoLive }
  ];

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--fp-text)] sm:text-[length:var(--fp-hero)]">
          {greeting.text}
        </h1>
        <p className="mt-0.5 text-xs text-[var(--fp-text-muted)] sm:text-sm">
          {/* How many were analysed is a fact about the day, not about the active
              filter — read it from the unfiltered set so it agrees with the chips. */}
          {todayLabel} · {t("dash.matchesAnalyzedToday", { n: counts.total })}
        </p>
      </header>

      {!matches.length ? (
        <EmptyState
          title={t("dash.emptyPredsTitle")}
          description={t("dash.emptyPredsDesc")}
          actionLabel={t("shell.predict")}
          onAction={onPredict}
        />
      ) : (
        <>
          {liveMatches.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]">
                  <span
                    aria-hidden
                    className="h-2 w-2 animate-pulse rounded-full bg-[var(--fp-danger)] motion-reduce:animate-none"
                  />
                  {t("dash.homeLiveTitle")}
                </h2>
                <Button variant="ghost" size="sm" onClick={onGoLive}>
                  {t("dash.showAll")} · {liveMatches.length}
                </Button>
              </div>
              <MatchList label={t("dash.homeLiveTitle")}>
                {liveMatches.slice(0, 3).map((row) => (
                  <MatchListRow
                    key={row.id}
                    row={row}
                    marketValidations={marketValidationsByFixtureId.get(Number(row.id)) ?? row.cardMarketValidations ?? null}
                    watched={isWatched(Number(row.id))}
                    onToggleWatch={() => onToggleWatch(Number(row.id))}
                    onOpen={() => onOpenMatch(row)}
                  />
                ))}
              </MatchList>
            </div>
          )}

          {analysisMatch && (
            <FeaturedPredictionCard match={analysisMatch} onOpenAnalysis={() => onOpenMatch(analysisMatch)} />
          )}

          <div className="inline-flex flex-wrap items-center gap-1 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-0.5">
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={chip.onClick}
                title={t("dash.filterTitle", { label: chip.label })}
                aria-pressed={chip.active}
                className={`h-9 rounded-md px-2.5 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                  chip.active
                    ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                    : "text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
                }`}
              >
                {chip.label}
                {chip.count != null && (
                  <span
                    className={`ml-1.5 tabular-nums font-extrabold ${
                      chip.active ? "text-[var(--fp-accent)]" : "text-[var(--fp-text)]"
                    }`}
                  >
                    {chip.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {topPicks.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]">
                  {t("dash.topPicksTitle")}
                </h2>
                <Button variant="ghost" size="sm" onClick={onGoMatches}>
                  {t("dash.showAll")}
                </Button>
              </div>
              <MatchList label={t("dash.topPicksTitle")}>
                {topPicks.map((row) => (
                  <MatchListRow
                    key={row.id}
                    row={row}
                    marketValidations={marketValidationsByFixtureId.get(Number(row.id)) ?? row.cardMarketValidations ?? null}
                    watched={isWatched(Number(row.id))}
                    onToggleWatch={() => onToggleWatch(Number(row.id))}
                    onOpen={() => onOpenMatch(row)}
                  />
                ))}
              </MatchList>
            </div>
          )}
        </>
      )}

      {/* Its own product, not a variation of the per-match Special Bet: an
          accumulator across fixtures, so it sits outside the match list and is
          driven entirely by the server rather than by the local prediction cache. */}
      <GlobalSpecialBetSection
        betDate={betDate}
        favoriteLeagueIds={favoriteLeagueIds}
        fixtureIndex={gsbFixtureIndex}
        canUseGlobalSpecialBet={canUseGlobalSpecialBet}
        onUpgradeRequired={(feature) => onUpgradeRequired(feature, "ultra")}
      />

      <RecentPerformanceCard
        history={history}
        trackerStats={trackerStats}
        onOpenMatch={onOpenMatch}
        onGoHistory={onGoHistory}
        onGoStatistics={onGoStatistics}
      />
    </section>
  );
}
