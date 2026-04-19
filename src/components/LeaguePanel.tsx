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
    <div className="rounded-3xl border border-white/70 bg-white/50 shadow-atelier backdrop-blur-md transition-all lg:sticky lg:top-6">
      <div className="border-b border-signal-line/60 bg-gradient-to-r from-white/60 to-signal-fog/40 px-4 py-4 sm:px-5">
        <div
          className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-1 py-1 -mx-1 transition-[background-color] duration-150 ease-out hover:bg-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/40 active:bg-white/30 motion-reduce:active:scale-100"
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
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-signal-line/80 bg-white/70 font-mono text-xs font-semibold text-signal-petrol shadow-inner">
              ⌗
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold tracking-tight text-signal-petrol sm:text-xl">Control panel</h2>
              <p className="text-[10px] font-medium text-signal-inkMuted">Ligi · filtru campionat</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {selectedSet.size > 0 && !isLeaguesOpen && (
              <span className="rounded-full border border-signal-sage/35 bg-signal-mintSoft/50 px-2.5 py-1 text-[10px] font-semibold text-signal-petrol">
                {selectedSet.size} active
              </span>
            )}
            <span className="rounded-full border border-signal-line bg-white/60 px-2.5 py-1 font-mono text-[10px] tabular-nums text-signal-inkMuted">
              {leaguesSorted.length}
            </span>
            <span className="text-sm text-signal-stone" aria-hidden>
              {isLeaguesOpen ? "▾" : "▸"}
            </span>
          </div>
        </div>
      </div>
      {isLeaguesOpen && (
        <div className="p-4 sm:p-5">
          <p className="mb-4 rounded-xl border border-signal-line/60 bg-signal-fog/50 px-3 py-2.5 text-[11px] leading-relaxed text-signal-inkMuted">
            Selectezi campionatele pentru semnal. Disponibile: RO, EN, DE, ES, IT, FR și altele din feed.
          </p>
          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                selectEliteLeagues();
              }}
              className="rounded-xl border border-signal-petrol/20 bg-signal-petrol/5 px-4 py-3 text-xs font-semibold text-signal-petrol shadow-sm transition hover:border-signal-sage/40 hover:bg-signal-mintSoft/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/40 sm:py-2.5"
            >
              Toate ligile elite
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearLeagueSelection();
              }}
              className="rounded-xl border border-signal-rose/25 bg-signal-rose/5 px-4 py-3 text-xs font-semibold text-signal-rose shadow-sm transition hover:bg-signal-rose/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-rose/40 sm:py-2.5"
            >
              Golește selecția
            </button>
          </div>
          <label className="sr-only" htmlFor="league-search">
            Caută campionatul
          </label>
          <input
            id="league-search"
            type="text"
            placeholder="Caută după nume sau țară…"
            value={searchLeague}
            onChange={(e) => setSearchLeague(e.target.value)}
            className="mb-4 w-full rounded-xl border border-signal-line/80 bg-white/70 px-4 py-3 text-sm text-signal-petrol shadow-inner outline-none transition placeholder:text-signal-stone focus:border-signal-sage/50 focus:ring-2 focus:ring-signal-sage/20 sm:py-2.5"
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
                    ? "border-signal-sage/45 bg-signal-mintSoft/45 text-signal-petrol shadow-inner"
                    : "border-signal-line/50 bg-white/40 hover:border-signal-sage/25 hover:bg-white/70"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2 text-left">
                  {eliteLeagues.includes(Number(lg.id)) && <span className="shrink-0 text-[11px] text-signal-amber">◆</span>}
                  {lg.logo && <img src={lg.logo} className="h-5 w-5 rounded object-contain" alt="" />}
                  <div className="min-w-0">
                    <div
                      className={`truncate text-[13px] font-semibold leading-tight tracking-tight sm:text-sm ${
                        eliteLeagues.includes(Number(lg.id)) && !selectedSet.has(lg.id) ? "text-signal-petrol" : ""
                      }`}
                    >
                      {lg.name}
                    </div>
                    <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-signal-inkMuted">{lg.country}</div>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-lg px-2 py-1 font-mono text-[10px] tabular-nums ${
                    selectedSet.has(lg.id) ? "bg-signal-petrol/10 text-signal-petrol" : "bg-signal-fog text-signal-inkMuted"
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
