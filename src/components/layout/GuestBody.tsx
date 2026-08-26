import PredictionList from "../cards/PredictionList";
import LeagueSelector from "../panels/LeagueSelector";
import { FilterMode, SortBy } from "../../constants/appConstants";
import { League, PredictionRow } from "../../types";

type GuestBodyProps = {
  user: { email?: string | null; role?: string; tier?: string } | null;
  /** EFFECTIVE access tier (server), threaded to PredictionList for masking. */
  userTier?: string;
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
  preds: PredictionRow[];
  groupedDisplayedMatches: Array<{ dateKey: string; matches: PredictionRow[] }>;
  filterMode: FilterMode;
  setFilterMode: (mode: FilterMode) => void;
  sortBy: SortBy;
  setSortBy: (sort: SortBy) => void;
  pendingAmongDisplayedPreds: number;
  logoColors: Record<string, string>;
  hashColor: (seed: string) => string;
  onSelectMatch: (match: PredictionRow) => void;
};

export default function GuestBody(props: GuestBodyProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-12 lg:gap-6 xl:gap-7">
      <div className="space-y-3 lg:col-span-4 xl:col-span-3">
        <LeagueSelector
          user={props.user}
          leaguesSorted={props.leaguesSorted}
          selectedSet={props.selectedSet}
          selectedLeagueIds={props.selectedLeagueIds}
          isLeaguesOpen={props.isLeaguesOpen}
          searchLeague={props.searchLeague}
          eliteLeagues={props.eliteLeagues}
          setIsLeaguesOpen={props.setIsLeaguesOpen}
          setSearchLeague={props.setSearchLeague}
          setSelectedLeagueIds={props.setSelectedLeagueIds}
          selectEliteLeagues={props.selectEliteLeagues}
          clearLeagueSelection={props.clearLeagueSelection}
          onOpenAuth={props.onOpenAuth}
        />
      </div>
      <div className="lg:col-span-8 xl:col-span-9">
        <PredictionList
          variant="guest"
          user={props.user}
          userTier={props.userTier}
          preds={props.preds}
          groupedDisplayedMatches={props.groupedDisplayedMatches}
          filterMode={props.filterMode}
          setFilterMode={props.setFilterMode}
          sortBy={props.sortBy}
          setSortBy={props.setSortBy}
          pendingAmongDisplayedPreds={props.pendingAmongDisplayedPreds}
          logoColors={props.logoColors}
          hashColor={props.hashColor}
          onSelectMatch={props.onSelectMatch}
          onOpenAuth={props.onOpenAuth}
        />
      </div>
    </div>
  );
}
