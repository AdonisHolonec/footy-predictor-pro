import { useMemo } from "react";
import type { CardMarketValidations, HistoryEntry, HistoryStats, PerformanceLeagueBreakdown, PredictionRow } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import type { UpgradeTier } from "../../design-system/UpgradePrompt";
import Card from "../../design-system/Card";
import Badge from "../../design-system/Badge";
import Button from "../../design-system/Button";
import EmptyState from "../../design-system/EmptyState";
import FeaturedPredictionCard from "./FeaturedPredictionCard";
import PredictionFocusCard from "./PredictionFocusCard";
import HistoryTrustSection from "./HistoryTrustSection";
import { computeYesterdayAccuracy } from "../../utils/historyStats";
import { getGreeting } from "../../utils/greeting";
import { isFixtureInPlay } from "../../utils/appUtils";
import { confidenceOf, expectedValueOf, isHighConfidenceRow, isValueRow } from "../../utils/predictionSignals";
import { CHAMPIONS_LEAGUE_ID, EUROPA_LEAGUE_ID } from "../../constants/appConstants";

type AccessTier = UpgradeTier | "free" | string;

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
  leagueBreakdown: PerformanceLeagueBreakdown[];
};

export default function HomeSection({
  matches,
  counts,
  analysisMatch,
  liveCount,
  accessTier,
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
  leagueBreakdown
}: Props) {
  const { t, locale } = useLocale();

  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => String(b.kickoff || "").localeCompare(String(a.kickoff || ""))),
    [history]
  );
  const sparkBars = useMemo(
    () =>
      sortedHistory
        .filter((h) => h.validation === "win" || h.validation === "loss")
        .slice(0, 12)
        .reverse(),
    [sortedHistory]
  );
  const recentThree = sortedHistory.slice(0, 3);

  const liveMatches = useMemo(() => matches.filter((m) => isFixtureInPlay(m.status)), [matches]);
  const topPicks = useMemo(() => {
    // In-play rows own the "Live now" section at the top of the page — Top picks
    // stays the upcoming, still-actionable shortlist (no duplicate cards).
    const upcoming = matches.filter((m) => !isFixtureInPlay(m.status));
    const eligible = upcoming.filter((m) => isHighConfidenceRow(m) || isValueRow(m));
    const pool = eligible.length ? eligible : upcoming;
    return [...pool]
      .sort((a, b) => confidenceOf(b) - confidenceOf(a) || expectedValueOf(b) - expectedValueOf(a))
      .slice(0, 3);
  }, [matches]);

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

  const yesterdayStats = useMemo(() => computeYesterdayAccuracy(history), [history]);
  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-US", {
        weekday: "long",
        day: "numeric",
        month: "long"
      }).format(new Date()),
    [locale]
  );

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
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {liveMatches.slice(0, 3).map((row) => (
                  <PredictionFocusCard
                    key={row.id}
                    row={row}
                    accessTier={accessTier}
                    marketValidations={marketValidationsByFixtureId.get(Number(row.id)) ?? row.cardMarketValidations ?? null}
                    watched={isWatched(Number(row.id))}
                    onToggleWatch={() => onToggleWatch(Number(row.id))}
                    onOpen={() => onOpenMatch(row)}
                    onUpgradeRequired={onUpgradeRequired}
                  />
                ))}
              </div>
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
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {topPicks.map((row) => (
                  <PredictionFocusCard
                    key={row.id}
                    row={row}
                    accessTier={accessTier}
                    marketValidations={marketValidationsByFixtureId.get(Number(row.id)) ?? row.cardMarketValidations ?? null}
                    watched={isWatched(Number(row.id))}
                    onToggleWatch={() => onToggleWatch(Number(row.id))}
                    onOpen={() => onOpenMatch(row)}
                    onUpgradeRequired={onUpgradeRequired}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* One trust block instead of three. The KPI tiles moved onto the filter
          chips, and yesterday's result belongs next to the all-time rate it is a
          sample of — two adjacent cards both answering "how are we doing?" was
          the statistics-for-statistics'-sake pattern PRODUCT_DNA rules out. */}
      <Card>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]">
            {t("dash.performanceTitle")}
          </h2>
          <Badge tone={trackerStats.settled && trackerStats.winRate >= 50 ? "success" : "neutral"}>
            {trackerStats.settled ? `${trackerStats.winRate.toFixed(0)}%` : "—"}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-[var(--fp-text-muted)]">{t("dash.performanceSub")}</p>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--fp-text-muted)]">
            {t("dash.yesterdayAccuracyTitle")}
          </span>
          {yesterdayStats.settled ? (
            <>
              <span className="font-display text-lg font-semibold tabular-nums text-[var(--fp-text)]">
                {yesterdayStats.winRate.toFixed(0)}%
              </span>
              <Badge tone={yesterdayStats.winRate >= 50 ? "success" : "danger"}>
                {`${yesterdayStats.wins}W – ${yesterdayStats.losses}L`}
              </Badge>
            </>
          ) : (
            <span className="text-xs text-[var(--fp-text-muted)]">{t("dash.yesterdayAccuracyNoData")}</span>
          )}
        </div>

        {sparkBars.length > 0 && (
          <div
            className="mt-4 flex h-8 items-end gap-1"
            role="img"
            aria-label={t("dash.sparklineLabel")}
          >
            {sparkBars.map((h, idx) => (
              <span
                key={`${h.id ?? idx}-${idx}`}
                className={`w-full rounded-sm ${
                  h.validation === "win" ? "h-full bg-[var(--fp-success)]" : "h-2.5 bg-[var(--fp-danger)]"
                }`}
              />
            ))}
          </div>
        )}

        {recentThree.length > 0 && (
          <ul className="mt-4 divide-y divide-[var(--fp-border)]">
            {recentThree.map((row, idx) => (
              <li key={row.id ?? idx}>
                <button
                  type="button"
                  onClick={() => onOpenMatch(row)}
                  className="flex w-full min-h-[var(--fp-touch)] items-center justify-between gap-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
                >
                  <span className="min-w-0 truncate font-semibold">
                    {row.teams?.home || "?"} {t("common.vs")} {row.teams?.away || "?"}
                  </span>
                  <Badge
                    tone={row.validation === "win" ? "success" : row.validation === "loss" ? "danger" : "warning"}
                  >
                    {row.validation === "win" ? t("history.win") : row.validation === "loss" ? t("history.loss") : t("history.pendingBadge")}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onGoHistory}>
            {t("nav.history")}
          </Button>
          <Button variant="ghost" size="sm" onClick={onGoStatistics}>
            {t("nav.statistics")}
          </Button>
        </div>
      </Card>

      <HistoryTrustSection history={history} leagueBreakdown={leagueBreakdown} />
    </section>
  );
}
