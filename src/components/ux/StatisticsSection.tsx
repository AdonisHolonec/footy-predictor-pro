import { lazy, Suspense, type ReactNode } from "react";
import type { HistoryEntry, PerformanceLeagueBreakdown } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import Skeleton from "../../design-system/Skeleton";
import SectionHeader from "../../design-system/SectionHeader";
import CollapsiblePanel from "../../design-system/CollapsiblePanel";
import Button from "../../design-system/Button";
import CalibrationChart from "./CalibrationChart";
import HistoryTrustSection from "./HistoryTrustSection";

const TrackRecordSection = lazy(() => import("../TrackRecordSection"));

type Props = {
  trackerSlot?: ReactNode;
  history?: HistoryEntry[];
  leagueBreakdown?: PerformanceLeagueBreakdown[];
  /** Next step for an account with no settled results yet. */
  onStartPredicting?: () => void;
  /** Results = records; Performance = interpretation. One-directional link down. */
  onViewResults?: () => void;
};

export default function StatisticsSection({
  trackerSlot,
  history = [],
  leagueBreakdown = [],
  onStartPredicting,
  onViewResults
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
        {onViewResults && (
          <Button size="sm" variant="ghost" onClick={onViewResults} data-testid="performance-view-results">
            {t("perf.viewResults")} ›
          </Button>
        )}

        {/* Mobile-first: the breakdowns and calibration are interpretation on top of
            interpretation — one disclosure each, so the first viewport is the tracker. */}
        <CollapsiblePanel compact title={t("perf.breakdownTitle")} subtitle={t("perf.breakdownSub")}>
          <HistoryTrustSection
            history={history}
            leagueBreakdown={leagueBreakdown}
            onStartPredicting={onStartPredicting}
          />
        </CollapsiblePanel>
        <CollapsiblePanel compact title={t("perf.reliabilityTitle")} subtitle={t("perf.reliabilitySub")}>
          <CalibrationChart history={history} />
        </CollapsiblePanel>

      {/* The per-day / per-league / per-market tables used to sit on Home, where
          they answered a question Home does not ask. They belong beside the rest
          of the track record. */}
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
