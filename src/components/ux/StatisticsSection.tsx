import { lazy, Suspense, type ReactNode } from "react";
import type { HistoryEntry, PerformanceLeagueBreakdown } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import { StatTile } from "../../design-system";
import Skeleton from "../../design-system/Skeleton";
import CalibrationChart from "./CalibrationChart";
import HistoryTrustSection from "./HistoryTrustSection";

const TrackRecordSection = lazy(() => import("../TrackRecordSection"));

type Props = {
  trackerSlot?: ReactNode;
  winRate: number;
  settled: number;
  wins: number;
  losses: number;
  history?: HistoryEntry[];
  leagueBreakdown?: PerformanceLeagueBreakdown[];
};

export default function StatisticsSection({
  trackerSlot,
  winRate,
  settled,
  wins,
  losses,
  history = [],
  leagueBreakdown = []
}: Props) {
  const { t } = useLocale();
  return (
    <section className="space-y-4">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fp-accent)]">{t("stats.eyebrow")}</p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-[var(--fp-text)]">{t("stats.title")}</h1>
        <p className="mt-1.5 text-sm font-medium text-[var(--fp-text-muted)]">{t("stats.sub")}</p>
      </header>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2">
        <StatTile
          label={t("stats.successRate")}
          value={settled ? `${winRate.toFixed(1)}%` : "—"}
          tone={!settled ? "neutral" : winRate >= 50 ? "success" : "warning"}
        />
        <StatTile label={t("stats.wins")} value={String(wins)} tone="success" />
        <StatTile label={t("stats.losses")} value={String(losses)} tone="danger" />
        <StatTile label={t("stats.settled")} value={String(settled)} tone="neutral" />
      </div>

      {trackerSlot}

      <CalibrationChart history={history} />

      {/* The per-day / per-league / per-market tables used to sit on Home, where
          they answered a question Home does not ask. They belong beside the rest
          of the track record. */}
      <HistoryTrustSection history={history} leagueBreakdown={leagueBreakdown} />

      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <TrackRecordSection days={45} showLinkToFull compact={false} />
      </Suspense>
    </section>
  );
}
