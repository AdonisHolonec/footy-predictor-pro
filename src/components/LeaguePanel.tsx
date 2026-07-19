import { League } from "../types";

type LeaguePanelProps = {
  leaguesSorted: League[];
  selectedSet: Set<number>;
  selectedLeagueIds: number[];
  isLeaguesOpen: boolean;
  searchLeague: string;
  eliteLeagues: number[];
  setIsLeaguesOpen: (open: boolean) => void;
  setSearchLeague: (value: string) => void;
  setSelectedLeagueIds: (ids: number[]) => void;
  selectEliteLeagues: () => void;
  clearLeagueSelection: () => void;
};

export default function LeaguePanel({
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
  clearLeagueSelection
}: LeaguePanelProps) {
  return (
    <div className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-[var(--fp-shadow-sm)] lg:sticky lg:top-5">
      <div className="border-b border-[var(--fp-border)] px-3.5 py-3.5 sm:px-4">
        <button
          type="button"
          className="mx-[-0.25rem] flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-1 py-1 text-left transition-colors hover:bg-[var(--fp-bg-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
          onClick={() => setIsLeaguesOpen(!isLeaguesOpen)}
          aria-expanded={isLeaguesOpen}
          aria-controls="league-panel-content"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--fp-accent)]/30 bg-[var(--fp-accent-muted)] text-xs font-bold text-[var(--fp-accent)]">
              ║
            </div>
            <div>
              <h2 className="font-display text-base font-semibold tracking-tight text-[var(--fp-text)] sm:text-lg">
                Select leagues
              </h2>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fp-accent)]">
                Competitions · feed filter
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {selectedSet.size > 0 && !isLeaguesOpen && (
              <span className="rounded-full border border-[var(--fp-accent)]/30 bg-[var(--fp-accent-muted)] px-2.5 py-1 text-[10px] font-bold tabular-nums text-[var(--fp-accent)]">
                {selectedSet.size} on
              </span>
            )}
            <span className="rounded-full border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2.5 py-1 text-[10px] font-semibold tabular-nums text-[var(--fp-text-muted)]">
              {leaguesSorted.length}
            </span>
            <span className="text-[var(--fp-text-muted)]" aria-hidden>
              {isLeaguesOpen ? "▾" : "▸"}
            </span>
          </div>
        </button>
      </div>
      {isLeaguesOpen && (
        <div id="league-panel-content" className="p-3.5 sm:p-4">
          <p className="mb-3 text-sm font-medium text-[var(--fp-text-muted)]">Filter leagues for today’s prediction feed.</p>
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              title="Select all elite leagues"
              onClick={(e) => {
                e.stopPropagation();
                selectEliteLeagues();
              }}
              className="min-h-11 rounded-[var(--fp-radius-sm)] border border-[var(--fp-accent)]/35 bg-[var(--fp-accent-muted)] px-3 py-2.5 text-xs font-bold text-[var(--fp-accent)] transition hover:bg-[var(--fp-accent)]/15"
            >
              Elite · select all
            </button>
            <button
              type="button"
              title="Clear league selection"
              onClick={(e) => {
                e.stopPropagation();
                clearLeagueSelection();
              }}
              className="min-h-11 rounded-[var(--fp-radius-sm)] border border-[var(--fp-danger)]/30 bg-[var(--fp-danger)]/10 px-3 py-2.5 text-xs font-bold text-[var(--fp-danger)] transition hover:bg-[var(--fp-danger)]/15"
            >
              Clear
            </button>
          </div>
          <label className="sr-only" htmlFor="league-search">
            Search league
          </label>
          <input
            id="league-search"
            type="text"
            placeholder="Search league or country…"
            value={searchLeague}
            onChange={(e) => setSearchLeague(e.target.value)}
            className="mb-4 w-full rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg)] px-4 py-3 text-sm font-medium text-[var(--fp-text)] placeholder:text-[var(--fp-text-faint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] sm:py-2.5"
          />
          <div className="custom-scrollbar max-h-[45vh] space-y-2 overflow-y-auto pr-1 sm:max-h-[60vh] sm:pr-2 lg:max-h-[70vh]">
            {leaguesSorted.map((lg) => (
              <button
                key={lg.id}
                type="button"
                onClick={() => {
                  const s = new Set(selectedLeagueIds);
                  s.has(lg.id) ? s.delete(lg.id) : s.add(lg.id);
                  setSelectedLeagueIds(Array.from(s));
                }}
                className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--fp-radius-sm)] border p-3 text-left transition touch-manipulation sm:p-3 ${
                  selectedSet.has(lg.id)
                    ? "border-[var(--fp-accent)]/40 bg-[var(--fp-accent-muted)]"
                    : "border-[var(--fp-border)] bg-[var(--fp-bg-card)] hover:border-[var(--fp-accent)]/30 hover:bg-[var(--fp-bg-muted)]"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2 text-left">
                  {eliteLeagues.includes(Number(lg.id)) && (
                    <span className="shrink-0 text-[11px] text-[var(--fp-warning)]">◆</span>
                  )}
                  {lg.logo && <img src={lg.logo} className="h-5 w-5 rounded object-contain" alt="" />}
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold leading-tight text-[var(--fp-text)] sm:text-sm">
                      {lg.name}
                    </div>
                    <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">
                      {lg.country}
                    </div>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold tabular-nums ${
                    selectedSet.has(lg.id)
                      ? "bg-[var(--fp-accent)]/15 text-[var(--fp-accent)]"
                      : "bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]"
                  }`}
                >
                  {lg.matches}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
