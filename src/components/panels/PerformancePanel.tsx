import { lazy, Suspense, useState, type ComponentProps } from "react";
import { AdminPerformanceObservatory } from "../admin/AdminObservatory";
import SuccessRateTracker from "../SuccessRateTracker";
import StatisticsPanel, { type StatisticsPanelProps } from "./StatisticsPanel";
import AdminShell, { type AdminSection } from "../ux/AdminShell";
import type { HistoryStats } from "../../types";
import type { UsageSnapshot } from "../../types/index";

const EnterpriseDashboard = lazy(() => import("../analytics/EnterpriseDashboard"));
const HealthDashboard = lazy(() => import("../monitoring/HealthDashboard"));
const ModelLabPanel = lazy(() => import("../modelLab/ModelLabPanel"));
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

function LabFallback({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-signal-void/40 px-4 py-8 text-center font-mono text-[11px] text-signal-inkMuted">
      Loading {label}…
    </div>
  );
}

export default function PerformancePanel({
  tracker,
  statistics,
  usageCount,
  usageLimit,
  usagePct,
  usageSnapshot,
  onLoadUsage
}: PerformancePanelProps) {
  const [section, setSection] = useState<AdminSection>("dashboard");

  const trackerBlock = (
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
  );

  return (
    <AdminPerformanceObservatory>
      <AdminShell section={section} onSection={setSection}>
        {section === "dashboard" && (
          <div className="space-y-5">
            {trackerBlock}
            <StatisticsPanel {...statistics} alertsCollapsible kpiMaxWidthClass="max-w-full" />
            <Suspense fallback={<LabFallback label="Enterprise Dashboard" />}>
              <EnterpriseDashboard
                usageCount={usageCount}
                usageLimit={usageLimit}
                usagePct={usagePct}
                usageSnapshot={usageSnapshot}
                onLoadUsage={onLoadUsage}
              />
            </Suspense>
          </div>
        )}
        {(section === "engine" || section === "models" || section === "calibration" || section === "feature-importance") && (
          <Suspense fallback={<LabFallback label="Model Laboratory" />}>
            <ModelLabPanel />
          </Suspense>
        )}
        {section === "backtesting" && (
          <Suspense fallback={<LabFallback label="Backtest Lab" />}>
            <BacktestAnalyticsPanel />
          </Suspense>
        )}
        {(section === "monitoring" || section === "api-usage" || section === "logs" || section === "cache") && (
          <Suspense fallback={<LabFallback label="Health Dashboard" />}>
            <HealthDashboard />
          </Suspense>
        )}
        {(section === "users" || section === "subscriptions" || section === "security" || section === "settings") && (
          <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
            <h2 className="font-display text-lg font-semibold text-[var(--text)]">
              {section === "users"
                ? "Users"
                : section === "subscriptions"
                  ? "Subscriptions"
                  : section === "security"
                    ? "Security"
                    : "Settings"}
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              Manage from the Admin Users panel above the observatory, or via Supabase / billing when configured.
            </p>
            {trackerBlock}
          </div>
        )}
        {section === "workspace" && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 text-sm text-[var(--text-muted)]">
            Scroll down to the match workspace, or use the prediction list below.
          </div>
        )}
      </AdminShell>
    </AdminPerformanceObservatory>
  );
}

/** Re-export for ObservatoryBody ComponentProps typing convenience */
export type PerformancePanelTracker = ComponentProps<typeof PerformancePanel>["tracker"];
