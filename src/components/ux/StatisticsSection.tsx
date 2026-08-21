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
  /** Next step for an account with no settled results yet. */
  onStartPredicting?: () => void;
};

export default function StatisticsSection({
  trackerSlot,
  history = [],
  leagueBreakdown = [],
  onStartPredicting
}: Props) {
  const { t } = useLocale();
  return (
    <section className="space-y-4">
      <header>
        <SectionHeader as="h1" size="page" eyebrow={t("nav.performance")} title={t("nav.performance")} description={t("stats.sub")} />
      </header>

      {/* A · YOUR RESULTS — the signed-in account’s own settled picks. One
          tracker renders the hit rate; nothing below repeats it. */}
      <section aria-labelledby="perf-yours" className="space-y-4" data-testid="performance-yours">
        <SectionHeader as="h2" id="perf-yours" size="section" eyebrow={t("perf.yoursEyebrow")} title={t("perf.yoursTitle")} description={t("perf.yoursSub")} />
        {trackerSlot}

        <CalibrationChart history={history} />

      {/* The per-day / per-league / per-market tables used to sit on Home, where
          they answered a question Home does not ask. They belong beside the rest
          of the track record. */}
        <HistoryTrustSection
          history={history}
          leagueBreakdown={leagueBreakdown}
          onStartPredicting={onStartPredicting}
        />
      </section>

      {/* B · MODEL TRACK RECORD — the public, all-accounts snapshot. Its own
          population and window, named as such so the two never read as one. */}
      <section aria-labelledby="perf-model" className="space-y-4" data-testid="performance-model">
        <SectionHeader as="h2" id="perf-model" size="section" eyebrow={t("perf.modelEyebrow")} title={t("perf.modelTitle")} description={t("perf.modelSub")} />
        <Suspense fallback={<Skeleton className="h-48 w-full" />}>
          <TrackRecordSection days={45} showLinkToFull compact={false} />
        </Suspense>
      </section>
    </section>
  );
}
