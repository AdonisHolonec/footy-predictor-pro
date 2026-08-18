import { lazy, Suspense, type ReactNode } from "react";
import type { HistoryEntry, PerformanceLeagueBreakdown } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import Skeleton from "../../design-system/Skeleton";
import SectionHeader from "../../design-system/SectionHeader";
import CalibrationChart from "./CalibrationChart";
import HistoryTrustSection from "./HistoryTrustSection";

const TrackRecordSection = lazy(() => import("../TrackRecordSection"));

type Props = {
  trackerSlot?: ReactNode;
  history?: HistoryEntry[];
  leagueBreakdown?: PerformanceLeagueBreakdown[];
};

export default function StatisticsSection({
  trackerSlot,
  history = [],
  leagueBreakdown = []
}: Props) {
  const { t } = useLocale();
  return (
    <section className="space-y-4">
      <header>
        <SectionHeader as="h1" size="page" eyebrow={t("stats.eyebrow")} title={t("stats.title")} description={t("stats.sub")} />
      </header>

      {/* The single canonical performance block. A StatTile row used to sit
          above it repeating hit rate, wins, losses and settled — every one of
          which the tracker already shows. */}
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
