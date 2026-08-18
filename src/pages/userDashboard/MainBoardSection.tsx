import { lazy, Suspense, type ReactNode } from "react";
import type { AppNavView } from "../../components/ux/appNav";
import FeatureImportanceChart from "../../components/FeatureImportanceChart";
import PredictionContributionsChart from "../../components/PredictionContributionsChart";
import PredictionFocusCard from "../../components/ux/PredictionFocusCard";
import HistorySection from "../../components/ux/HistorySection";
import StatisticsSection from "../../components/ux/StatisticsSection";
import Button from "../../design-system/Button";
import CollapsiblePanel from "../../design-system/CollapsiblePanel";
import EmptyState from "../../design-system/EmptyState";
import { StatTile } from "../../design-system";
import type { UpgradeTier } from "../../design-system/UpgradePrompt";
import { useLocale } from "../../context/LocaleContext";
import type { useUiPrefs, MatchesSubFilterPref } from "../../hooks/useUiPrefs";
import type { HistoryEntry, HistoryStats, PredictionRow } from "../../types";
import { hashColor } from "../../utils/appUtils";
import { formatRecommendedPick } from "../../utils/formatRecommendation";

const MonteCarloPanel = lazy(() => import("../../components/MonteCarloPanel"));
const ConfidenceEnginePanel = lazy(() => import("../../components/ConfidenceEnginePanel"));
const PredictionLaboratoryPanel = lazy(() => import("../../components/PredictionLaboratory"));
const TrackRecordSection = lazy(() =>
  import("../../components/TrackRecordSection").then((m) => ({ default: m.default }))
);

type UpdateFilters = ReturnType<typeof useUiPrefs>["updateFilters"];

/**
 * Panoul principal de predicții (filtre, KPI-uri, carduri, panourile
 * colapsabile de analiză/istoric/laborator/insights), mutat verbatim din
 * blocul `isMainBoard` al UserDashboard.
 */
export default function MainBoardSection({
  visiblePreds,
  matchesFilter,
  valueOnly,
  updateFilters,
  handleNav,
  setNavView,
  trackerStats,
  simpleRoi,
  userTier,
  marketValidationsByFixtureId,
  isWatched,
  toggleWatchlist,
  openMatch,
  onUpgradeRequired,
  warmAndPredict,
  analysisMatch,
  history,
  trackerSlot,
  canShowSpecialBet,
  continueMatch
}: {
  visiblePreds: PredictionRow[];
  matchesFilter: MatchesSubFilterPref;
  valueOnly: boolean;
  updateFilters: UpdateFilters;
  handleNav: (view: AppNavView) => void;
  setNavView: (view: AppNavView) => void;
  trackerStats: HistoryStats;
  simpleRoi: number | null;
  userTier: string;
  marketValidationsByFixtureId: Map<number, NonNullable<HistoryEntry["cardMarketValidations"]>>;
  isWatched: (fixtureId: number) => boolean;
  toggleWatchlist: (fixtureId: number) => void;
  openMatch: (match: PredictionRow) => void;
  onUpgradeRequired: (feature: string, requiredTier: UpgradeTier) => void;
  warmAndPredict: () => Promise<void>;
  analysisMatch: PredictionRow | null;
  history: HistoryEntry[];
  trackerSlot: ReactNode;
  canShowSpecialBet: boolean;
  continueMatch: PredictionRow | null;
}) {
  const { t } = useLocale();
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--fp-text)] sm:text-[length:var(--fp-hero)]">
            {t("dash.predictions")}
          </h1>
          <p className="mt-0.5 text-xs text-[var(--fp-text-muted)] sm:text-sm">{t("dash.predictionsSub")}</p>
        </div>
        <div className="inline-flex flex-wrap items-center gap-1 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-0.5">
          {(
            [
              ["all", "dash.filterAll"],
              ["live", "dash.filterLive"],
              ["favorites", "dash.filterFavorites"]
            ] as const
          ).map(([id, key]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (id === "live") handleNav("live");
                else {
                  setNavView("matches");
                  updateFilters({ matchesFilter: id });
                }
              }}
              title={t("dash.filterTitle", { label: t(key) })}
              className={`h-9 rounded-md px-2.5 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                id === "live" ? "hidden lg:inline-flex" : ""
              } ${
                (id === "live" ? matchesFilter === "live" : matchesFilter === id)
                  ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                  : "text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
              }`}
              aria-pressed={id === "live" ? matchesFilter === "live" : matchesFilter === id}
            >
              {t(key)}
            </button>
          ))}
          <label className="flex h-9 items-center gap-1.5 border-l border-[var(--fp-border)] px-2.5 text-xs font-bold text-[var(--fp-text-muted)]">
            {t("dash.filterValue")}
            <input
              type="checkbox"
              checked={valueOnly}
              onChange={(e) => updateFilters({ valueOnly: e.target.checked })}
              className="accent-[var(--fp-accent)]"
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
        <StatTile label={t("dash.kpiToday")} value={String(visiblePreds.length)} tone="neutral" />
        <StatTile
          label={t("dash.kpiAccuracy")}
          value={trackerStats.settled ? `${trackerStats.winRate.toFixed(0)}%` : "—"}
          tone={!trackerStats.settled ? "neutral" : trackerStats.winRate >= 50 ? "success" : "warning"}
        />
        <StatTile
          label={t("dash.kpiRoi")}
          value={simpleRoi != null ? `${simpleRoi >= 0 ? "+" : ""}${simpleRoi.toFixed(1)}%` : "—"}
          tone={simpleRoi == null ? "neutral" : simpleRoi >= 0 ? "success" : "danger"}
        />
        <StatTile
          label={t("dash.kpiWinRate")}
          value={trackerStats.settled ? `${trackerStats.winRate.toFixed(0)}%` : "—"}
          tone={!trackerStats.settled ? "neutral" : trackerStats.winRate >= 50 ? "success" : "warning"}
        />
      </div>

      {!visiblePreds.length ? (
        <EmptyState
          title={matchesFilter === "favorites" ? t("dash.emptyFavoritesTitle") : t("dash.emptyPredsTitle")}
          description={
            matchesFilter === "favorites" ? t("dash.emptyFavoritesDesc") : t("dash.emptyPredsDesc")
          }
          actionLabel={matchesFilter === "favorites" ? t("dash.showAll") : t("shell.predict")}
          onAction={
            matchesFilter === "favorites"
              ? () => updateFilters({ matchesFilter: "all" })
              : () => void warmAndPredict()
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visiblePreds.map((row) => (
            <PredictionFocusCard
              key={row.id}
              row={row}
              accessTier={userTier}
              marketValidations={
                marketValidationsByFixtureId.get(Number(row.id)) ?? row.cardMarketValidations ?? null
              }
              watched={isWatched(Number(row.id))}
              onToggleWatch={() => toggleWatchlist(Number(row.id))}
              onOpen={() => openMatch(row)}
              onUpgradeRequired={onUpgradeRequired}
            />
          ))}
        </div>
      )}

      <CollapsiblePanel title={t("dash.advancedTitle")} subtitle={t("dash.advancedSub")}>
        {!analysisMatch ? (
          <p className="text-sm text-[var(--fp-text-muted)]">{t("dash.advancedEmpty")}</p>
        ) : (
          <Suspense fallback={<p className="text-sm text-[var(--fp-text-muted)]">{t("dash.advancedLoading")}</p>}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--fp-text)]">
                  {analysisMatch.teams.home} {t("common.vs")} {analysisMatch.teams.away}
                </p>
                <Button size="sm" variant="secondary" onClick={() => openMatch(analysisMatch)}>
                  {t("dash.openFocus")}
                </Button>
              </div>
              <MonteCarloPanel
                match={analysisMatch}
                homeColor={hashColor(analysisMatch.teams.home)}
                awayColor={hashColor(analysisMatch.teams.away)}
              />
              {analysisMatch.featureImportance && (
                <FeatureImportanceChart importance={analysisMatch.featureImportance} />
              )}
              {analysisMatch.confidenceEngine && (
                <ConfidenceEnginePanel
                  engine={analysisMatch.confidenceEngine}
                  recommendationPick={
                    analysisMatch.recommended?.pick
                      ? formatRecommendedPick(analysisMatch.recommended.pick, analysisMatch.recommended.family, t, analysisMatch.recommended)
                          .label
                      : null
                  }
                />
              )}
              {analysisMatch.predictionContributions && (
                <PredictionContributionsChart data={analysisMatch.predictionContributions} />
              )}
            </div>
          </Suspense>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel title={t("dash.historyTitle")} subtitle={t("dash.historySub")}>
        <HistorySection
          history={history}
          trackerSlot={trackerSlot}
          onOpenMatch={openMatch}
          canShowSpecialBet={canShowSpecialBet}
          onUpgradeRequired={onUpgradeRequired}
        />
      </CollapsiblePanel>

      <CollapsiblePanel title={t("dash.labTitle")} subtitle={t("dash.labSub")}>
        {!analysisMatch ? (
          <p className="text-sm text-[var(--fp-text-muted)]">{t("dash.labEmpty")}</p>
        ) : (
          <Suspense fallback={<p className="text-sm text-[var(--fp-text-muted)]">{t("dash.labLoading")}</p>}>
            <PredictionLaboratoryPanel match={analysisMatch} />
          </Suspense>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel title={t("dash.insightsTitle")} subtitle={t("dash.insightsSub")}>
        <Suspense fallback={<p className="text-sm text-[var(--fp-text-muted)]">{t("dash.insightsLoading")}</p>}>
          <StatisticsSection
            trackerSlot={trackerSlot}
          />
          <div className="mt-6">
            <TrackRecordSection />
          </div>
        </Suspense>
      </CollapsiblePanel>

      {continueMatch && (
        <button
          type="button"
          onClick={() => openMatch(continueMatch)}
          className="flex w-full min-h-[var(--fp-touch)] items-center justify-between rounded-[var(--fp-radius)] border border-fp-accent/25 bg-[var(--fp-accent-muted)] px-4 py-3 text-left"
        >
          <span>
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--fp-accent)]">Continue</span>
            <br />
            <span className="font-semibold">
              {continueMatch.teams.home} vs {continueMatch.teams.away}
            </span>
          </span>
          <span className="text-[var(--fp-accent)]">Open →</span>
        </button>
      )}
    </div>
  );
}
