import { lazy, Suspense, useState, type ComponentProps } from "react";
import { AdminModelMetricsPanel } from "../admin/AdminModelMetricsPanel";
import { AdminPerformanceObservatory } from "../admin/AdminObservatory";
import AdminUsersPanel from "./AdminUsersPanel";
import SuccessRateTracker from "../SuccessRateTracker";
import StatisticsPanel, { type StatisticsPanelProps } from "./StatisticsPanel";
import AdminShell, { type AdminSection } from "../ux/AdminShell";
import CollapsiblePanel from "../../design-system/CollapsiblePanel";
import type { HistoryStats } from "../../types";
import type { UsageSnapshot } from "../../types/index";

const EnterpriseDashboard = lazy(() => import("../analytics/EnterpriseDashboard"));
const HealthDashboard = lazy(() => import("../monitoring/HealthDashboard"));
const DiagnosticsDashboard = lazy(() => import("../monitoring/DiagnosticsDashboard"));
const ModelLabPanel = lazy(() => import("../modelLab/ModelLabPanel"));
const BacktestAnalyticsPanel = lazy(() => import("../backtest/BacktestAnalyticsPanel"));
const BenchmarkPanel = lazy(() => import("../admin/BenchmarkPanel"));
const MetaDataHealthPanel = lazy(() => import("../admin/MetaDataHealthPanel"));

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

type AdminUsersPanelProps = ComponentProps<typeof AdminUsersPanel>;

type PerformancePanelProps = {
  tracker: TrackerProps;
  statistics: StatisticsPanelProps;
  usageCount: number;
  usageLimit: number;
  usagePct: number;
  usageSnapshot: UsageSnapshot | null;
  onLoadUsage: () => void;
  accessToken?: string | null;
} & Omit<AdminUsersPanelProps, "usageSnapshot" | "onLoadUsage">;

export type { TrackerProps };

function LabFallback({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-4 py-8 text-center font-mono text-[11px] text-[var(--fp-text-muted)]">
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
  onLoadUsage,
  accessToken,
  managedProfiles,
  isAdminWorking,
  busyUserIds,
  onRefreshProfiles,
  usageLoading,
  perfAdminSnapshot,
  perfAdminLoading,
  onLoadPerfAdmin,
  adminTierDraftByUser,
  setAdminTierDraftByUser,
  adminExpiryDraftByUser,
  setAdminExpiryDraftByUser,
  onRoleChange,
  onToggleBlock,
  onMonetizationSave
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
            {accessToken && (
              <CollapsiblePanel title="Model metrics" subtitle="Calibrare, sincronizare istoric, status pipeline ML">
                <AdminModelMetricsPanel accessToken={accessToken} days={45} />
              </CollapsiblePanel>
            )}
          </div>
        )}
        {section === "model-lab" && (
          <Suspense fallback={<LabFallback label="Model Laboratory" />}>
            <ModelLabPanel />
          </Suspense>
        )}
        {section === "backtesting" && (
          <Suspense fallback={<LabFallback label="Backtest Lab" />}>
            <BacktestAnalyticsPanel />
          </Suspense>
        )}
        {section === "benchmark" && (
          <Suspense fallback={<LabFallback label="Benchmark" />}>
            <BenchmarkPanel />
          </Suspense>
        )}
        {section === "meta-learning" && (
          <Suspense fallback={<LabFallback label="Meta Learning" />}>
            <MetaDataHealthPanel />
          </Suspense>
        )}
        {section === "health" && (
          <Suspense fallback={<LabFallback label="Health Dashboard" />}>
            <HealthDashboard />
          </Suspense>
        )}
        {section === "diagnostics" && (
          <Suspense fallback={<LabFallback label="Diagnostics" />}>
            <DiagnosticsDashboard />
          </Suspense>
        )}
        {section === "users" && (
          <AdminUsersPanel
            managedProfiles={managedProfiles}
            isAdminWorking={isAdminWorking}
            busyUserIds={busyUserIds}
            onRefreshProfiles={onRefreshProfiles}
            usageSnapshot={usageSnapshot}
            usageLoading={usageLoading}
            onLoadUsage={onLoadUsage}
            perfAdminSnapshot={perfAdminSnapshot}
            perfAdminLoading={perfAdminLoading}
            onLoadPerfAdmin={onLoadPerfAdmin}
            adminTierDraftByUser={adminTierDraftByUser}
            setAdminTierDraftByUser={setAdminTierDraftByUser}
            adminExpiryDraftByUser={adminExpiryDraftByUser}
            setAdminExpiryDraftByUser={setAdminExpiryDraftByUser}
            onRoleChange={onRoleChange}
            onToggleBlock={onToggleBlock}
            onMonetizationSave={onMonetizationSave}
          />
        )}
        {section === "workspace" && (
          <div className="rounded-2xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-5 text-sm text-[var(--fp-text-muted)]">
            Scroll down to the match workspace, or use the prediction list below.
          </div>
        )}
      </AdminShell>
    </AdminPerformanceObservatory>
  );
}

/** Re-export for ObservatoryBody ComponentProps typing convenience */
export type PerformancePanelTracker = ComponentProps<typeof PerformancePanel>["tracker"];
