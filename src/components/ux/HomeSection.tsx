import { useMemo } from "react";
import type { CardMarketValidations, HistoryEntry, HistoryStats, PerformanceLeagueBreakdown, PredictionRow } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import type { UpgradeTier } from "../../design-system/UpgradePrompt";
import Card from "../../design-system/Card";
import Badge from "../../design-system/Badge";
import Button from "../../design-system/Button";
import EmptyState from "../../design-system/EmptyState";
import StatTile from "../../design-system/StatTile";
import FeaturedPredictionCard from "./FeaturedPredictionCard";
import PredictionFocusCard from "./PredictionFocusCard";
import HistoryTrustSection from "./HistoryTrustSection";
import { computeYesterdayAccuracy } from "../../utils/historyStats";

type AccessTier = UpgradeTier | "free" | string;

type Props = {
  matches: PredictionRow[];
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

const HIGH_CONFIDENCE_THRESHOLD = 70;

function confOf(m: PredictionRow) {
  const c = Number(m.recommended?.confidence);
  return Number.isFinite(c) ? c : 0;
}

function evOf(m: PredictionRow) {
  const e = Number(m.valueBet?.ev ?? m.valueEngine?.expectedValue);
  return Number.isFinite(e) ? e : 0;
}

function isValueRow(m: PredictionRow) {
  return Boolean(m.valueBet?.detected) || evOf(m) > 0;
}

export default function HomeSection({
  matches,
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

  const valueCount = matches.filter(isValueRow).length;
  const avgConf = matches.length ? matches.reduce((s, m) => s + confOf(m), 0) / matches.length : 0;
  const topPicks = useMemo(() => {
    const eligible = matches.filter((m) => confOf(m) >= HIGH_CONFIDENCE_THRESHOLD || isValueRow(m));
    const pool = eligible.length ? eligible : matches;
    return [...pool].sort((a, b) => confOf(b) - confOf(a) || evOf(b) - evOf(a)).slice(0, 3);
  }, [matches]);

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

  const chips: { id: string; label: string; active: boolean; onClick: () => void }[] = [
    { id: "all", label: t("dash.filterAll"), active: !valueOnly && !highConfActive, onClick: () => {
      if (valueOnly) onToggleValue();
      if (highConfActive) onToggleHighConf();
    } },
    { id: "value", label: t("dash.filterValue"), active: valueOnly, onClick: onToggleValue },
    { id: "highConf", label: t("dash.filterHighConf"), active: highConfActive, onClick: onToggleHighConf },
    { id: "live", label: t("dash.filterLive"), active: false, onClick: onGoLive }
  ];

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--fp-text)] sm:text-[length:var(--fp-hero)]">
          {t("dash.goodMorning")}
        </h1>
        <p className="mt-0.5 text-xs text-[var(--fp-text-muted)] sm:text-sm">
          {todayLabel} · {t("dash.matchesAnalyzedToday", { n: matches.length })}
        </p>
      </header>

      <Card className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--fp-text-muted)]">
            {t("dash.yesterdayAccuracyTitle")}
          </p>
          <p className="mt-1 font-display text-xl font-semibold tabular-nums text-[var(--fp-text)]">
            {yesterdayStats.settled ? `${yesterdayStats.winRate.toFixed(0)}%` : "—"}
          </p>
        </div>
        <Badge tone={!yesterdayStats.settled ? "neutral" : yesterdayStats.winRate >= 50 ? "success" : "danger"}>
          {yesterdayStats.settled
            ? `${yesterdayStats.wins}W – ${yesterdayStats.losses}L`
            : t("dash.yesterdayAccuracyNoData")}
        </Badge>
      </Card>

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
          </button>
        ))}
      </div>

      {analysisMatch && (
        <FeaturedPredictionCard match={analysisMatch} onOpenAnalysis={() => onOpenMatch(analysisMatch)} />
      )}

      <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
        <StatTile label={t("dash.kpiToday")} value={String(matches.length)} tone="neutral" />
        <StatTile label={t("dash.kpiAvgConfidence")} value={avgConf ? `${Math.round(avgConf)}%` : "—"} tone="neutral" />
        <StatTile label={t("dash.kpiValue")} value={String(valueCount)} tone={valueCount > 0 ? "success" : "neutral"} />
        <StatTile label={t("dash.kpiLive")} value={String(liveCount)} tone={liveCount > 0 ? "danger" : "neutral"} />
      </div>

      {!matches.length ? (
        <EmptyState
          title={t("dash.emptyPredsTitle")}
          description={t("dash.emptyPredsDesc")}
          actionLabel={t("shell.predict")}
          onAction={onPredict}
        />
      ) : (
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
