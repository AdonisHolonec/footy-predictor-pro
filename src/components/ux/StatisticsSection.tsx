import { lazy, Suspense, type ReactNode } from "react";
import type { HistoryEntry, PerformanceLeagueBreakdown } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import Skeleton from "../../design-system/Skeleton";
import SectionHeader from "../../design-system/SectionHeader";
import CollapsiblePanel from "../../design-system/CollapsiblePanel";
import Button from "../../design-system/Button";
import CalibrationChart from "./CalibrationChart";
import HistoryTrustSection from "./HistoryTrustSection";
import PerformanceTrend from "./PerformanceTrend";

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

/**
 * Performance (UX-E) — "can I trust the quality of my results and the model?"
 *
 * Two zones that must never read as one:
 *
 *   A. YOUR RESULTS — this account. One dominant figure (the tracker, hero
 *      variant: the authoritative hit rate), its W / L / settled line, the
 *      7-day trend. Solid card, accent identity.
 *   B. MODEL TRACK RECORD — every account, the public backtest. Muted,
 *      dashed-border panel with a "public" eyebrow, its own window and sample
 *      size, rendered by the existing TrackRecordSection.
 *
 * Below both: the interpretation layers, collapsed — ROI + league + market
 * breakdown, and calibration. Existing metrics only; nothing is invented and
 * no percentage appears twice on the page.
 *
 * ≥1280: A left, B right; the breakdowns span both columns underneath.
 */
export default function StatisticsSection({
  trackerSlot,
  history = [],
  leagueBreakdown = [],
  onStartPredicting,
  onViewResults
}: Props) {
  const { t } = useLocale();
  return (
    <section className="space-y-4" data-surface="performance">
      <header>
        <SectionHeader as="h1" size="page" eyebrow={t("nav.performance")} title={t("nav.performance")} description={t("stats.sub")} />
      </header>

      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        {/* A · YOUR RESULTS */}
        <section
          aria-labelledby="perf-yours"
          className="rounded-[var(--fp-radius-lg)] border border-fp-accent/30 bg-[var(--fp-bg-card)] p-4 shadow-fp-sm sm:p-5"
          data-testid="performance-yours"
          data-zone="yours"
        >
          <SectionHeader as="h2" id="perf-yours" size="section" eyebrow={t("perf.yoursEyebrow")} title={t("perf.yoursTitle")} description={t("perf.yoursSub")} />
          <div className="mt-4">{trackerSlot}</div>
          <div className="mt-5">
            <PerformanceTrend history={history} />
          </div>
          {onViewResults && (
            <div className="mt-4">
              <Button size="sm" variant="ghost" onClick={onViewResults} data-testid="performance-view-results">
                {t("perf.viewResults")} ›
              </Button>
            </div>
          )}
        </section>

        {/* B · MODEL TRACK RECORD — another population, another surface. */}
        <section
          aria-labelledby="perf-model"
          className="rounded-[var(--fp-radius-lg)] border border-dashed border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-4 sm:p-5"
          data-testid="performance-model"
          data-zone="model"
        >
          <SectionHeader as="h2" id="perf-model" size="section" eyebrow={t("perf.modelEyebrow")} title={t("perf.modelTitle")} description={t("perf.modelSub")} />
          <Suspense fallback={<Skeleton className="mt-4 h-48 w-full" />}>
            <TrackRecordSection days={45} showLinkToFull compact embedded />
          </Suspense>
        </section>
      </div>

      {/* Interpretation on top of interpretation — one disclosure each, so the
          first viewport is the two figures that matter. */}
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start" data-testid="performance-breakdowns">
        <CollapsiblePanel compact title={t("perf.breakdownTitle")} subtitle={t("perf.breakdownSub")}>
          <HistoryTrustSection
            history={history}
            leagueBreakdown={leagueBreakdown}
            onStartPredicting={onStartPredicting}
            embedded
          />
        </CollapsiblePanel>
        <CollapsiblePanel compact title={t("perf.reliabilityTitle")} subtitle={t("perf.reliabilitySub")}>
          <CalibrationChart history={history} embedded />
        </CollapsiblePanel>
      </div>
    </section>
  );
}
