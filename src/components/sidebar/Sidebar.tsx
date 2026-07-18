import type { ReactNode } from "react";
import { AdminFilterDeck, AdminIconRail, type KickoffScope } from "../admin/AdminObservatory";
import { FilterMode } from "../../constants/appConstants";
import LeagueSelector from "../panels/LeagueSelector";
import { League } from "../../types";

type SidebarProps = {
  user: unknown;
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
  /** Main column + insight column content. */
  children: ReactNode;
};

export default function Sidebar({
  user,
  leaguesSorted,
  selectedSet,
  selectedLeagueIds,
  isLeaguesOpen,
  searchLeague,
  eliteLeagues,
  setIsLeaguesOpen,
  setSearchLeague,
  setSelectedLeagueIds,
  selectEliteLeagues,
  clearLeagueSelection,
  onOpenAuth,
  kickoffScope,
  setKickoffScope,
  filterMode,
  setFilterMode,
  minXgSpread,
  setMinXgSpread,
  children
}: SidebarProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 lg:flex-row lg:items-stretch lg:gap-5">
      <AdminIconRail />
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-12 xl:gap-6">
        <div className="space-y-3 lg:col-span-3">
          {user ? (
            <>
              <LeagueSelector
                user={user}
                leaguesSorted={leaguesSorted}
                selectedSet={selectedSet}
                selectedLeagueIds={selectedLeagueIds}
                isLeaguesOpen={isLeaguesOpen}
                searchLeague={searchLeague}
                eliteLeagues={eliteLeagues}
                setIsLeaguesOpen={setIsLeaguesOpen}
                setSearchLeague={setSearchLeague}
                setSelectedLeagueIds={setSelectedLeagueIds}
                selectEliteLeagues={selectEliteLeagues}
                clearLeagueSelection={clearLeagueSelection}
                onOpenAuth={onOpenAuth}
              />
              <AdminFilterDeck
                kickoffScope={kickoffScope}
                setKickoffScope={setKickoffScope}
                filterMode={filterMode}
                setFilterMode={setFilterMode}
                minXgSpread={minXgSpread}
                setMinXgSpread={setMinXgSpread}
              />
            </>
          ) : (
            <LeagueSelector
              user={user}
              leaguesSorted={leaguesSorted}
              selectedSet={selectedSet}
              selectedLeagueIds={selectedLeagueIds}
              isLeaguesOpen={isLeaguesOpen}
              searchLeague={searchLeague}
              eliteLeagues={eliteLeagues}
              setIsLeaguesOpen={setIsLeaguesOpen}
              setSearchLeague={setSearchLeague}
              setSelectedLeagueIds={setSelectedLeagueIds}
              selectEliteLeagues={selectEliteLeagues}
              clearLeagueSelection={clearLeagueSelection}
              onOpenAuth={onOpenAuth}
            />
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
