import LeaguePanel from "../LeaguePanel";
import { League } from "../../types";

type LeagueSelectorProps = {
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
};

export default function LeagueSelector({
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
  onOpenAuth
}: LeagueSelectorProps) {
  if (user) {
    return (
      <LeaguePanel
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
      />
    );
  }

  return (
    <div className="rounded-3xl border border-[var(--fp-border)] bg-fp-bg-card/45 p-5 shadow-fp-sm backdrop-blur-sm">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--fp-accent)]">Personalizare blocată</h3>
      <p className="mt-2 text-xs leading-relaxed text-[var(--fp-text-muted)]">
        Selecția ligilor și predicțiile personalizate sunt disponibile după autentificare.
      </p>
      <button
        type="button"
        onClick={onOpenAuth}
        className="mt-4 w-full rounded-xl bg-[var(--fp-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--fp-accent-hover)]"
      >
        Login / Signup
      </button>
    </div>
  );
}
