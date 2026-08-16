import { useMemo } from "react";
import type { HistoryEntry, HistoryStats } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import Card from "../../design-system/Card";
import Badge from "../../design-system/Badge";
import Button from "../../design-system/Button";
import { computeYesterdayAccuracy } from "../../utils/historyStats";

type Props = {
  history: HistoryEntry[];
  trackerStats: HistoryStats;
  onOpenMatch: (row: HistoryEntry) => void;
  onGoHistory: () => void;
  onGoStatistics: () => void;
};

const SPARK_BAR_COUNT = 12;
const RECENT_MATCH_COUNT = 3;

/**
 * Home's single trust block: the all-time rate, yesterday as its most recent
 * sample, the last settled results and a way into the full record.
 *
 * It used to be three stacked surfaces (four KPI tiles, a yesterday card and
 * this one), which is the statistics-for-statistics'-sake pattern PRODUCT_DNA
 * rules out — the numbers that carried an action moved onto the filter chips,
 * the rest merged in here.
 */
export default function RecentPerformanceCard({
  history,
  trackerStats,
  onOpenMatch,
  onGoHistory,
  onGoStatistics
}: Props) {
  const { t } = useLocale();

  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => String(b.kickoff || "").localeCompare(String(a.kickoff || ""))),
    [history]
  );
  const sparkBars = useMemo(
    () =>
      sortedHistory
        .filter((h) => h.validation === "win" || h.validation === "loss")
        .slice(0, SPARK_BAR_COUNT)
        .reverse(),
    [sortedHistory]
  );
  const recentMatches = sortedHistory.slice(0, RECENT_MATCH_COUNT);
  const yesterdayStats = useMemo(() => computeYesterdayAccuracy(history), [history]);

  // A track record of dashes builds no trust, and a first run should not open
  // onto empty widgets — with nothing tracked yet, the card does not belong.
  if (!history.length) return null;

  return (
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
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fp-text-muted)]">
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
        <div className="mt-4 flex h-8 items-end gap-1" role="img" aria-label={t("dash.sparklineLabel")}>
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

      {recentMatches.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--fp-border)]">
          {recentMatches.map((row, idx) => (
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
                  tone={
                    row.validation === "win" || row.validation === "half_win"
                      ? "success"
                      : row.validation === "loss" || row.validation === "half_loss"
                        ? "danger"
                        : row.validation === "push"
                          ? "neutral"
                          : "warning"
                  }
                >
                  {row.validation === "win"
                    ? t("history.win")
                    : row.validation === "loss"
                      ? t("history.loss")
                      : row.validation === "push"
                        ? t("history.outcomePush")
                        : row.validation === "half_win"
                          ? t("history.outcomeHalfWin")
                          : row.validation === "half_loss"
                            ? t("history.outcomeHalfLoss")
                            : t("history.pendingBadge")}
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
  );
}
