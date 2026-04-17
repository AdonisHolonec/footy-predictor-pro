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
    <div className="bg-slate-900/40 border border-white/5 rounded-[1.5rem] sm:rounded-3xl p-4 sm:p-5 transition-all lg:sticky lg:top-6">
      <div className="flex justify-between items-center gap-3 cursor-pointer group" onClick={() => setIsLeaguesOpen(!isLeaguesOpen)}>
        <div className="flex items-center gap-3">
          <h2 className="font-bold text-lg sm:text-xl group-hover:text-emerald-400 transition-colors">Ligi</h2>
          <div className="bg-white/5 rounded-full p-1.5 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors text-xs shrink-0">{isLeaguesOpen ? "🔽" : "▶️"}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {selectedSet.size > 0 && !isLeaguesOpen && <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-1 rounded-full shadow-sm shadow-emerald-900/20">{selectedSet.size} selectate</span>}
          <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-1 rounded-full">{leaguesSorted.length} disp.</span>
        </div>
      </div>
      {isLeaguesOpen && (
        <div className="mt-5 transition-all">
          <div className="flex flex-col sm:flex-row lg:flex-row gap-2 mb-4">
            <button
              onClick={(e) => {
                e.stopPropagation();
                selectEliteLeagues();
              }}
              className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-4 py-3 sm:py-2.5 text-xs font-bold text-slate-200 hover:border-emerald-500/40 hover:text-emerald-400 transition-colors touch-manipulation"
            >
              Select all elite leagues
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearLeagueSelection();
              }}
              className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-4 py-3 sm:py-2.5 text-xs font-bold text-slate-300 hover:border-red-500/40 hover:text-red-400 transition-colors touch-manipulation"
            >
              Clear selection
            </button>
          </div>
          <input
            type="text"
            placeholder="Caută campionatul..."
            value={searchLeague}
            onChange={(e) => setSearchLeague(e.target.value)}
            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 sm:py-2.5 mb-4 text-sm outline-none focus:border-emerald-500/50 transition-colors touch-manipulation"
          />
          <div className="space-y-2 overflow-y-auto max-h-[45vh] sm:max-h-[60vh] lg:max-h-[70vh] pr-1 sm:pr-2 custom-scrollbar">
            {leaguesSorted.map((lg) => (
              <button
                key={lg.id}
                onClick={() => {
                  const s = new Set(selectedLeagueIds);
                  s.has(lg.id) ? s.delete(lg.id) : s.add(lg.id);
                  setSelectedLeagueIds(Array.from(s));
                }}
                className={`w-full flex justify-between items-center gap-3 p-3.5 sm:p-3 rounded-xl border transition-all text-left touch-manipulation ${selectedSet.has(lg.id) ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400" : "bg-slate-950/40 border-white/5 hover:border-white/10"}`}
              >
                <div className="text-left flex items-center gap-2 min-w-0">
                  {eliteLeagues.includes(Number(lg.id)) && <span className="text-[12px] shrink-0">👑</span>}
                  {lg.logo && <img src={lg.logo} className="w-5 h-5 object-contain rounded" alt="" />}
                  <div>
                    <div className={`text-[13px] sm:text-sm font-bold tracking-tight leading-tight ${eliteLeagues.includes(Number(lg.id)) && !selectedSet.has(lg.id) ? "text-yellow-100" : ""}`}>{lg.name}</div>
                    <div className="text-[9px] opacity-50 uppercase tracking-tighter mt-0.5">{lg.country}</div>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-lg shrink-0 ${selectedSet.has(lg.id) ? "bg-emerald-500/20" : "bg-white/5 text-slate-500"}`}>{lg.matches}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
