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
    <div className="rounded-3xl border border-white/[0.08] bg-signal-panel/40 shadow-atelier backdrop-blur-xl transition-all lg:sticky lg:top-6">
      <div className="border-b border-white/5 bg-gradient-to-r from-signal-void/80 to-transparent px-4 py-4 sm:px-5">
        <div
          className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-1 py-1 -mx-1 transition-colors duration-150 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/50"
          onClick={() => setIsLeaguesOpen(!isLeaguesOpen)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setIsLeaguesOpen(!isLeaguesOpen);
            }
          }}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-signal-petrol/20 bg-signal-void/80 font-mono text-xs font-semibold text-signal-petrol shadow-inner">
              ║
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold tracking-tight text-signal-ink sm:text-xl">Control rail</h2>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-signal-petrol/70">Competiții · filtru feed</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {selectedSet.size > 0 && !isLeaguesOpen && (
              <span className="rounded-full border border-signal-petrol/30 bg-signal-petrol/10 px-2.5 py-1 font-mono text-[10px] tabular-nums text-signal-petrol">
                {selectedSet.size} on
              </span>
            )}
            <span className="rounded-full border border-white/10 bg-signal-void/60 px-2.5 py-1 font-mono text-[10px] tabular-nums text-signal-inkMuted">
              {leaguesSorted.length}
            </span>
            <span className="text-signal-stone" aria-hidden>
              {isLeaguesOpen ? "▾" : "▸"}
            </span>
          </div>
        </div>
      </div>
      {isLeaguesOpen && (
        <div className="p-4 sm:p-5">
          <p className="mb-4 rounded-xl border border-white/5 bg-signal-void/40 px-3 py-2.5 text-[11px] leading-relaxed text-signal-inkMuted">
            Selectezi campionatele pentru semnalul modelului. Feed multi-țară (RO, EN, DE, ES, IT, FR…).
          </p>
          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                selectEliteLeagues();
              }}
              className="rounded-xl border border-signal-petrol/25 bg-signal-petrol/10 px-4 py-3 text-xs font-semibold text-signal-petrol transition hover:bg-signal-petrol/20 sm:py-2.5"
            >
              Elite · select all
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearLeagueSelection();
              }}
              className="rounded-xl border border-signal-rose/25 bg-signal-rose/5 px-4 py-3 text-xs font-semibold text-signal-rose/90 transition hover:bg-signal-rose/10 sm:py-2.5"
            >
              Clear rail
            </button>
          </div>
          <label className="sr-only" htmlFor="league-search">
            Caută campionatul
          </label>
          <input
            id="league-search"
            type="text"
            placeholder="Caută ligă sau țară…"
            value={searchLeague}
            onChange={(e) => setSearchLeague(e.target.value)}
            className="glass-input mb-4 w-full rounded-xl px-4 py-3 text-sm shadow-inner sm:py-2.5"
          />
          <div className="custom-scrollbar max-h-[45vh] space-y-2 overflow-y-auto pr-1 sm:max-h-[60vh] lg:max-h-[70vh] sm:pr-2">
            {leaguesSorted.map((lg) => (
              <button
                key={lg.id}
                type="button"
                onClick={() => {
                  const s = new Set(selectedLeagueIds);
                  s.has(lg.id) ? s.delete(lg.id) : s.add(lg.id);
                  setSelectedLeagueIds(Array.from(s));
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition touch-manipulation sm:p-3 ${
                  selectedSet.has(lg.id)
                    ? "border-signal-petrol/40 bg-signal-petrol/10 shadow-[0_0_20px_rgba(56,189,248,0.08)]"
                    : "border-white/5 bg-signal-void/30 hover:border-signal-petrol/20 hover:bg-signal-void/50"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2 text-left">
                  {eliteLeagues.includes(Number(lg.id)) && <span className="shrink-0 text-[11px] text-signal-amber">◆</span>}
                  {lg.logo && <img src={lg.logo} className="h-5 w-5 rounded object-contain opacity-90" alt="" />}
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold leading-tight tracking-tight text-signal-silver sm:text-sm">
                      {lg.name}
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wide text-signal-inkMuted">{lg.country}</div>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-lg px-2 py-1 font-mono text-[10px] tabular-nums ${
                    selectedSet.has(lg.id) ? "bg-signal-petrol/20 text-signal-petrol" : "bg-signal-void text-signal-inkMuted"
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
