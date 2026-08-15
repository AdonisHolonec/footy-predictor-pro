import type { ComponentProps } from "react";
import { AdminInsightColumn, type KickoffScope } from "../admin/AdminObservatory";
import PredictionList from "../cards/PredictionList";
import PerformancePanel from "../panels/PerformancePanel";
import type { StatisticsPanelProps } from "../panels/StatisticsPanel";
import Sidebar from "../sidebar/Sidebar";
import { FilterMode, SortBy } from "../../constants/appConstants";
import { League, PredictionRow } from "../../types";

type TrackerProps = ComponentProps<typeof PerformancePanel>["tracker"];
type AdminUsersProps = Omit<
  ComponentProps<typeof PerformancePanel>,
  "tracker" | "statistics" | "usageCount" | "usageLimit" | "usagePct" | "usageSnapshot" | "onLoadUsage" | "accessToken"
>;

type ObservatoryBodyProps = {
  trackerProps: TrackerProps;
  statisticsProps: StatisticsPanelProps;
  usageCount: number;
  usageLimit: number;
  usagePct: number;
  usageSnapshot: import("../../types/index").UsageSnapshot | null;
  onLoadUsage: () => void;
  accessToken?: string | null;
  isAdmin: boolean;
  user: { email?: string | null; role?: string; tier?: string } | null;
  leaguesSorted: League[];
  selectedSet: Set<number>;
  selectedLeagueIds: number[];
  isLeaguesOpen: boolean;
  searchLeague: string;
  eliteLeagues: number[];
  setIsLeaguesOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setSearchLeague: (value: string) => void;
  setSelectedLeagueIds: (value: number[] | ((prev: number[]) => number[])) => void;
  selectEliteLeagues: () => void;
  clearLeagueSelection: () => void;
  onOpenAuth: () => void;
  kickoffScope: KickoffScope;
  setKickoffScope: (scope: KickoffScope) => void;
  filterMode: FilterMode;
  setFilterMode: (mode: FilterMode) => void;
  minXgSpread: number;
  setMinXgSpread: (value: number) => void;
  preds: PredictionRow[];
  groupedDisplayedMatches: Array<{ dateKey: string; matches: PredictionRow[] }>;
  sortBy: SortBy;
  setSortBy: (sort: SortBy) => void;
  pendingAmongDisplayedPreds: number;
  logoColors: Record<string, string>;
  hashColor: (seed: string) => string;
  onSelectMatch: (match: PredictionRow) => void;
  /** Opens the prediction report dialog. Absent = no report button. */
  onReportMatch?: (row: PredictionRow) => void;
  insightSample: PredictionRow | null;
} & AdminUsersProps;

export default function ObservatoryBody({
  trackerProps,
  statisticsProps,
  usageCount,
  usageLimit,
  usagePct,
  usageSnapshot,
  onLoadUsage,
  accessToken,
  insightSample,
  onOpenAuth,
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
  onMonetizationSave,
  ...rest
}: ObservatoryBodyProps) {
  return (
    <>
      <PerformancePanel
        tracker={trackerProps}
        statistics={statisticsProps}
        usageCount={usageCount}
        usageLimit={usageLimit}
        usagePct={usagePct}
        usageSnapshot={usageSnapshot}
        onLoadUsage={onLoadUsage}
        accessToken={accessToken}
        managedProfiles={managedProfiles}
        isAdminWorking={isAdminWorking}
        busyUserIds={busyUserIds}
        onRefreshProfiles={onRefreshProfiles}
        usageLoading={usageLoading}
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
      <Sidebar
        user={rest.user}
        leaguesSorted={rest.leaguesSorted}
        selectedSet={rest.selectedSet}
        selectedLeagueIds={rest.selectedLeagueIds}
        isLeaguesOpen={rest.isLeaguesOpen}
        searchLeague={rest.searchLeague}
        eliteLeagues={rest.eliteLeagues}
        setIsLeaguesOpen={rest.setIsLeaguesOpen}
        setSearchLeague={rest.setSearchLeague}
        setSelectedLeagueIds={rest.setSelectedLeagueIds}
        selectEliteLeagues={rest.selectEliteLeagues}
        clearLeagueSelection={rest.clearLeagueSelection}
        onOpenAuth={onOpenAuth}
        kickoffScope={rest.kickoffScope}
        setKickoffScope={rest.setKickoffScope}
        filterMode={rest.filterMode}
        setFilterMode={rest.setFilterMode}
        minXgSpread={rest.minXgSpread}
        setMinXgSpread={rest.setMinXgSpread}
      >
        <div className="min-w-0 lg:col-span-6">
          <PredictionList
            variant="observatory"
            showDossierLabel
            user={rest.user}
            preds={rest.preds}
            groupedDisplayedMatches={rest.groupedDisplayedMatches}
            filterMode={rest.filterMode}
            setFilterMode={rest.setFilterMode}
            sortBy={rest.sortBy}
            setSortBy={rest.setSortBy}
            pendingAmongDisplayedPreds={rest.pendingAmongDisplayedPreds}
            logoColors={rest.logoColors}
            hashColor={rest.hashColor}
            onSelectMatch={rest.onSelectMatch}
            onReportMatch={rest.onReportMatch}
            onOpenAuth={onOpenAuth}
          />
        </div>
        <div className="lg:col-span-3">
          <AdminInsightColumn sample={insightSample} />
        </div>
      </Sidebar>
    </>
  );
}
