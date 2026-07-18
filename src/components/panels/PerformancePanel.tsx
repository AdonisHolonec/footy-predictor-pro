import { lazy, Suspense, type ComponentProps } from "react";
import { AdminPerformanceObservatory } from "../admin/AdminObservatory";
import SuccessRateTracker from "../SuccessRateTracker";
import StatisticsPanel, { type StatisticsPanelProps } from "./StatisticsPanel";
import type { HistoryStats } from "../../types";
import type { UsageSnapshot } from "../../types/index";

const EnterpriseDashboard = lazy(() => import("../analytics/EnterpriseDashboard"));
const BacktestAnalyticsPanel = lazy(() => import("../backtest/BacktestAnalyticsPanel"));

type TrackerProps = {
  stats: HistoryStats;
  animatedWins: number;
  animatedLosses: number;
  animatedWinRate: number;
  isWinRatePulsing: boolean;
  isHistorySyncing: boolean;
  pendingHistoryCount: number;
  displayedPredsCount: number;
  pendingAmongDisplayedPreds: number;
  excludedWorstLossDaysCount: number;
  onExcludedWorstLossDaysCountChange: (value: number) => void;
  excludedLossDays: Array<{ day: string; losses: number; settled: number }>;
  onBreakdownClick: () => void;
};

type PerformancePanelProps = {
  tracker: TrackerProps;
  statistics: StatisticsPanelProps;
  usageCount: number;
  usageLimit: number;
  usagePct: number;
  usageSnapshot?: UsageSnapshot | null;
  onLoadUsage?: () => void;
};

export type { TrackerProps };

export default function PerformancePanel({
  tracker,
  statistics,
  usageCount,
  usageLimit,
  usagePct,
  usageSnapshot,
  onLoadUsage
}: PerformancePanelProps) {
  return (
    <AdminPerformanceObservatory>
      <SuccessRateTracker
        stats={tracker.stats}
        animatedWins={tracker.animatedWins}
        animatedLosses={tracker.animatedLosses}
        animatedWinRate={tracker.animatedWinRate}
        isWinRatePulsing={tracker.isWinRatePulsing}
        isHistorySyncing={tracker.isHistorySyncing}
        pendingHistoryCount={tracker.pendingHistoryCount}
        displayedPredsCount={tracker.displayedPredsCount}
        pendingAmongDisplayedPreds={tracker.pendingAmongDisplayedPreds}
        excludedWorstLossDaysCount={tracker.excludedWorstLossDaysCount}
        onExcludedWorstLossDaysCountChange={tracker.onExcludedWorstLossDaysCountChange}
        excludedLossDays={tracker.excludedLossDays}
        onBreakdownClick={tracker.onBreakdownClick}
      />
      <StatisticsPanel {...statistics} alertsCollapsible kpiMaxWidthClass="max-w-full" />
      <Suspense
        fallback={
          <div className="mt-5 rounded-2xl border border-white/[0.07] bg-signal-void/40 px-4 py-8 text-center font-mono text-[11px] text-signal-inkMuted">
            Loading Enterprise Dashboard…
          </div>
        }
      >
        <EnterpriseDashboard
          usageCount={usageCount}
          usageLimit={usageLimit}
          usagePct={usagePct}
          usageSnapshot={usageSnapshot}
          onLoadUsage={onLoadUsage}
        />
      </Suspense>
      <Suspense
        fallback={
          <div className="mt-5 rounded-2xl border border-white/[0.07] bg-signal-void/40 px-4 py-6 text-center font-mono text-[11px] text-signal-inkMuted">
            Loading Backtest Lab…
          </div>
        }
      >
        <BacktestAnalyticsPanel />
      </Suspense>
    </AdminPerformanceObservatory>
  );
}

/** Re-export for ObservatoryBody ComponentProps typing convenience */
export type PerformancePanelTracker = ComponentProps<typeof PerformancePanel>["tracker"];
