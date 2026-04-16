import React, { useEffect, useMemo, useState } from "react";

// --- TIPURI DATE (Restaurate și Extinse) ---
type Usage = { date: string; count: number; limit: number };
type League = { id: number; name: string; country: string; matches: number; logo?: string };
type Odds = { home: number; draw: number; away: number; bookmaker?: string };
type ValueBet = { detected: boolean; type: string; ev?: number; kelly?: number };
type Probs = {
  p1: number; pX: number; p2: number;
  pGG: number; pO25: number; pU35: number; pO15: number;
};
type PredictionRow = {
  id: number;
  leagueId: number;
  league: string;
  teams: { home: string; away: string };
  logos?: { league?: string; home?: string; away?: string };
  kickoff: string;
  status: string;
  referee?: string;
  lambdas?: { home: number; away: number };
  luckStats?: { hG: number; hXG: number; aG: number; aXG: number };
  probs: Probs;
  odds?: Odds;
  valueBet?: ValueBet;
  predictions: { oneXtwo: string; gg: string; over25: string; cards?: string; correctScore: string };
  recommended: { pick: string; confidence: number };
};
type DayResponse = {
  ok: boolean;
  date: string;
  totalFixtures: number;
  leagues: League[];
  usage: Usage;
};

// --- UTILS (Codul tău original intact) ---
function isoToday(): string { return new Date().toISOString().split('T')[0]; }
function inferSeason(dateISO: string): number {
  const [y, m] = dateISO.split("-").map(Number);
  if (!y || !m) return new Date().getFullYear() - 1;
  return (m >= 7) ? y : (y - 1);
}
function useLocalStorageState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { } }, [key, v]);
  return [v, setV] as const;
}
function hashColor(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const r = (h >>> 16) & 255; const g = (h >>> 8) & 255; const b = h & 255;
  return `rgb(${Math.floor(80 + (r / 255) * 150)}, ${Math.floor(80 + (g / 255) * 150)}, ${Math.floor(80 + (b / 255) * 150)})`;
}
async function dominantColorFromImage(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas"); const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 200) continue;
          r += data[i]; g += data[i+1]; b += data[i+2]; n++;
        }
        if (n < 10) return resolve(null);
        resolve(`rgb(${Math.round(r/n)}, ${Math.round(g/n)}, ${Math.round(b/n)})`);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null); img.src = url;
  });
}

const ELITE_LEAGUES = [2, 3, 39, 140, 135, 78, 61, 283];

// --- COMPONENTE NOI (xG & Luck Factor) ---

function XGPerformanceBar({ xg }: { xg: any }) {
  if (!xg) return null;
  const homeXG = Number(xg.homeXG);
  const awayXG = Number(xg.awayXG);
  const safeHomeXG = Number.isFinite(homeXG) ? homeXG : 0;
  const safeAwayXG = Number.isFinite(awayXG) ? awayXG : 0;
  const hW = Math.min((safeHomeXG / 4) * 100, 100);
  const aW = Math.min((safeAwayXG / 4) * 100, 100);
  return (
    <div className="mt-4 px-3 py-3 bg-black/40 rounded-2xl border border-white/5 shadow-inner">
      <div className="flex justify-between items-center mb-2 px-1">
        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest text-center w-full opacity-70">xG Intensity Gauge</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex-1 flex flex-col items-end">
          <span className="text-[11px] font-mono font-bold text-emerald-400 mb-1">{safeHomeXG.toFixed(2)}</span>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all duration-1000 ease-out" style={{ width: `${hW}%` }} />
          </div>
        </div>
        <div className="text-[8px] font-black text-slate-700 italic">VS</div>
        <div className="flex-1 flex flex-col items-start">
          <span className="text-[11px] font-mono font-bold text-blue-400 mb-1">{safeAwayXG.toFixed(2)}</span>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-1000 ease-out" style={{ width: `${aW}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LuckBadge({ goals, xg }: { goals?: number, xg?: number }) {
  if (goals === undefined || xg === undefined) return null;
  if (!isFinite(goals) || !isFinite(xg)) return null;
  const diff = goals - xg;
  return (
    <div className={`text-[8px] font-black uppercase px-2 py-0.5 rounded border ${diff > 0 ? 'bg-orange-500/10 border-orange-500/30 text-orange-400' : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'}`}>
      {diff > 0 ? '⚠️ Lucky Form' : '💎 Value Trend'}
    </div>
  );
}

// --- APP COMPONENT ---
export default function App() {
  const [date, setDate] = useLocalStorageState<string>("footy.date", isoToday());
  const [selectedLeagueIds, setSelectedLeagueIds] = useLocalStorageState<number[]>("footy.selectedLeagueIds", []);
  const [day, setDay] = useState<DayResponse | null>(null);
  const [preds, setPreds] = useLocalStorageState<PredictionRow[]>("footy.lastPreds", []);
  const [status, setStatus] = useState<string>("");
  const [logoColors, setLogoColors] = useLocalStorageState<Record<string, string>>("footy.logoColors", {});
  const [searchLeague, setSearchLeague] = useState("");
  const [filterMode, setFilterMode] = useState<"ALL" | "VALUE" | "SAFE">("ALL");
  const [sortBy, setSortBy] = useState<"TIME" | "CONFIDENCE" | "VALUE">("TIME");
  const [selectedMatch, setSelectedMatch] = useState<PredictionRow | null>(null);
  const [isLeaguesOpen, setIsLeaguesOpen] = useState(window.innerWidth >= 1024);

  const leaguesSorted = useMemo(() => {
    const leagues = day?.leagues ?? [];
    const filtered = leagues.filter(l => l.name.toLowerCase().includes(searchLeague.toLowerCase()) || l.country.toLowerCase().includes(searchLeague.toLowerCase()));
    const elite = filtered.filter(l => ELITE_LEAGUES.includes(Number(l.id)));
    const rest = filtered.filter(l => !ELITE_LEAGUES.includes(Number(l.id))).sort((a, b) => b.matches - a.matches);
    return [...elite, ...rest];
  }, [day, searchLeague]);

  const displayedMatches = useMemo(() => {
    let list = [...preds];
    if (filterMode === "VALUE") list = list.filter(m => m.valueBet?.detected);
    if (filterMode === "SAFE") list = list.filter(m => m.recommended.confidence >= 70);
    list.sort((a, b) => {
      if (sortBy === "TIME") return new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime();
      if (sortBy === "CONFIDENCE") return b.recommended.confidence - a.recommended.confidence;
      if (sortBy === "VALUE") return (b.valueBet?.ev || 0) - (a.valueBet?.ev || 0);
      return 0;
    });
    return list;
  }, [preds, filterMode, sortBy]);

  async function fetchDay(d: string) {
    setStatus("Încarc ligile...");
    try {
      const r = await fetch(`/api/fixtures/day?date=${d}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Eroare API");
      setDay(j);
      setStatus(j.totalFixtures ? `OK: ${j.totalFixtures} meciuri.` : "Lipsă meciuri.");
    } catch (e: any) { setStatus(`Eroare: ${e.message}`); }
  }

  async function warm() {
    if (!selectedLeagueIds.length) return setStatus("Selectează o ligă.");
    setStatus("Se procesează datele (Warm)...");
    try {
      const qs = new URLSearchParams({ date, leagueIds: selectedLeagueIds.join(","), season: String(inferSeason(date)) });
      const r = await fetch(`/api/warm?${qs}`);
      const j = await r.json();
      setStatus(j.ok ? "Date pregătite cu succes." : "Eroare la procesare.");
    } catch (e: any) { setStatus(`Error: ${e.message}`); }
  }

  async function prefetchColors(rows: PredictionRow[]) {
    const next = { ...logoColors };
    let changed = false;
    for (const row of rows) {
      for (const logo of [row.logos?.home, row.logos?.away]) {
        if (logo && !next[logo]) {
          const c = await dominantColorFromImage(logo);
          next[logo] = c || hashColor(logo);
          changed = true;
        }
      }
    }
    if (changed) setLogoColors(next);
  }

  function selectEliteLeagues() {
    const eliteIds = (day?.leagues ?? [])
      .filter(lg => ELITE_LEAGUES.includes(Number(lg.id)))
      .map(lg => Number(lg.id));
    setSelectedLeagueIds(eliteIds);
    setStatus(eliteIds.length ? `Selectate ${eliteIds.length} ligi elite.` : "Nu există ligi elite disponibile.");
  }

  function clearLeagueSelection() {
    setSelectedLeagueIds([]);
    setStatus("Selecția ligilor a fost resetată.");
  }

  async function predict() {
    if (!selectedLeagueIds.length) return setStatus("Selectează o ligă.");
    setStatus("Generez predicțiile Premium...");
    try {
      const qs = new URLSearchParams({ date, leagueIds: selectedLeagueIds.join(","), season: String(inferSeason(date)), limit: "50" });
      const r = await fetch(`/api/predict?${qs}`);
      const j = await r.json();
      setPreds(j);
      setStatus(`Gata! ${j.length} predicții generate.`);
      void prefetchColors(j);
      if (window.innerWidth < 1024) setIsLeaguesOpen(false);
    } catch (e: any) { setStatus(`Error: ${e.message}`); }
  }

  useEffect(() => { fetchDay(date); }, [date]);

  const selectedSet = new Set(selectedLeagueIds);
  const usageCount = day?.usage?.count || 0;
  const usageLimit = day?.usage?.limit || 100;
  const usagePct = (usageCount / usageLimit) * 100;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500/30 relative">
      <div className="mx-auto max-w-[1600px] px-4 py-8 lg:px-6">
        {/* HEADER */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white grid place-items-center font-black text-2xl shadow-xl shadow-emerald-500/20">FP</div>
            <div>
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tight text-white">Footy Predictor 💎</h1>
              <div className="text-sm text-slate-400 mt-1 font-medium italic">Advanced AI & xG Value Betting</div>
            </div>
          </div>
          <div className="flex flex-col lg:flex-row lg:items-end gap-3 lg:gap-4">
            <div className="flex flex-col items-end w-full max-w-[200px] lg:min-w-[220px]">
              <div className="text-[10px] text-slate-400 uppercase font-black mb-1">
                API Calls: <span className={usagePct > 80 ? "text-red-400" : "text-emerald-400"}>{usageCount} / {usageLimit}</span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div style={{ width: `${usagePct}%` }} className={`h-full ${usagePct > 80 ? "bg-red-500" : "bg-emerald-500"}`} />
              </div>
            </div>
            <div className="flex flex-wrap lg:flex-nowrap items-center gap-2 lg:gap-3">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/50" />
              <button onClick={warm} className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-slate-800 transition-all">Warm</button>
              <button onClick={predict} className="bg-emerald-600 rounded-xl px-6 py-2.5 text-sm font-bold hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-600/20">Predict</button>
            </div>
          </div>
        </div>

        {status && <div className="mb-6 p-3 bg-slate-900/40 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 font-mono">{"> "} {status}</div>}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 xl:gap-10">
          {/* LIGI */}
          <div className="lg:col-span-4 xl:col-span-3 space-y-4">
            <div className="bg-slate-900/40 border border-white/5 rounded-[1.5rem] sm:rounded-3xl p-4 sm:p-5 transition-all lg:sticky lg:top-6">
              <div className="flex justify-between items-center gap-3 cursor-pointer group" onClick={() => setIsLeaguesOpen(!isLeaguesOpen)}>
                <div className="flex items-center gap-3">
                  <h2 className="font-bold text-lg sm:text-xl group-hover:text-emerald-400 transition-colors">Ligi</h2>
                  <div className="bg-white/5 rounded-full p-1.5 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors text-xs shrink-0">{isLeaguesOpen ? '🔽' : '▶️'}</div>
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
                  <input type="text" placeholder="Caută campionatul..." value={searchLeague} onChange={e => setSearchLeague(e.target.value)} className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 sm:py-2.5 mb-4 text-sm outline-none focus:border-emerald-500/50 transition-colors touch-manipulation"/>
                  <div className="space-y-2 overflow-y-auto max-h-[45vh] sm:max-h-[60vh] lg:max-h-[70vh] pr-1 sm:pr-2 custom-scrollbar">
                    {leaguesSorted.map(lg => (
                      <button key={lg.id} onClick={() => {
                          const s = new Set(selectedLeagueIds);
                          s.has(lg.id) ? s.delete(lg.id) : s.add(lg.id);
                          setSelectedLeagueIds(Array.from(s));
                        }} className={`w-full flex justify-between items-center gap-3 p-3.5 sm:p-3 rounded-xl border transition-all text-left touch-manipulation ${selectedSet.has(lg.id) ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-950/40 border-white/5 hover:border-white/10'}`}>
                        <div className="text-left flex items-center gap-2 min-w-0">
                          {ELITE_LEAGUES.includes(Number(lg.id)) && <span className="text-[12px] shrink-0">👑</span>}
                          {lg.logo && <img src={lg.logo} className="w-5 h-5 object-contain rounded" alt="" />}
                          <div>
                            <div className={`text-[13px] sm:text-sm font-bold tracking-tight leading-tight ${ELITE_LEAGUES.includes(Number(lg.id)) && !selectedSet.has(lg.id) ? 'text-yellow-100' : ''}`}>{lg.name}</div>
                            <div className="text-[9px] opacity-50 uppercase tracking-tighter mt-0.5">{lg.country}</div>
                          </div>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-lg shrink-0 ${selectedSet.has(lg.id) ? 'bg-emerald-500/20' : 'bg-white/5 text-slate-500'}`}>{lg.matches}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* MECIURI */}
          <div className="lg:col-span-8 xl:col-span-9">
            {preds.length > 0 && (
              <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3 sm:gap-4 mb-6 bg-slate-900/40 p-3 lg:p-4 rounded-2xl border border-white/5">
                <div className="flex gap-2 overflow-x-auto xl:overflow-visible pb-2 xl:pb-0 border-b xl:border-b-0 xl:border-r border-white/5 xl:pr-4 custom-scrollbar snap-x snap-mandatory">
                  <button onClick={() => setFilterMode("ALL")} className={`px-4 py-2.5 sm:py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap touch-manipulation snap-start ${filterMode === "ALL" ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800"}`}>Toate ({preds.length})</button>
                  <button onClick={() => setFilterMode("VALUE")} className={`px-4 py-2.5 sm:py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap touch-manipulation snap-start ${filterMode === "VALUE" ? "bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/50" : "text-slate-400 hover:bg-slate-800"}`}>💎 Value Bets</button>
                  <button onClick={() => setFilterMode("SAFE")} className={`px-4 py-2.5 sm:py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap touch-manipulation snap-start ${filterMode === "SAFE" ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50" : "text-slate-400 hover:bg-slate-800"}`}>🔥 +70% Siguranță</button>
                </div>
                <div className="flex gap-2 overflow-x-auto xl:overflow-visible items-center custom-scrollbar snap-x snap-mandatory">
                  <span className="text-[9px] text-slate-500 uppercase font-black px-1 shrink-0">Ordonează:</span>
                  <button onClick={() => setSortBy("TIME")} className={`px-3 py-2 sm:py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-manipulation snap-start ${sortBy === "TIME" ? "bg-blue-500/20 text-blue-400" : "bg-slate-800/50 text-slate-400 hover:bg-slate-700"}`}>⏰ Ora</button>
                  <button onClick={() => setSortBy("CONFIDENCE")} className={`px-3 py-2 sm:py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-manipulation snap-start ${sortBy === "CONFIDENCE" ? "bg-blue-500/20 text-blue-400" : "bg-slate-800/50 text-slate-400 hover:bg-slate-700"}`}>📈 Siguranță</button>
                  <button onClick={() => setSortBy("VALUE")} className={`px-3 py-2 sm:py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap touch-manipulation snap-start ${sortBy === "VALUE" ? "bg-blue-500/20 text-blue-400" : "bg-slate-800/50 text-slate-400 hover:bg-slate-700"}`}>💰 Profit (EV)</button>
                </div>
              </div>
            )}
            {!preds.length ? (
              <div className="h-[400px] border-2 border-dashed border-white/5 rounded-[2rem] grid place-items-center text-slate-600 text-center"><p className="italic font-medium">Selectează ligile dorite, apoi apasă Predict.</p></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-5">
                {displayedMatches.map(m => <MatchCard key={m.id} row={m} logoColors={logoColors} onClick={() => setSelectedMatch(m)} />)}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="fixed bottom-0 inset-x-0 z-40 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent lg:hidden pointer-events-none">
        <div className="mx-auto max-w-7xl pointer-events-auto">
          <button
            onClick={predict}
            className="w-full bg-emerald-600 rounded-2xl px-6 py-3.5 text-sm font-bold hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!selectedLeagueIds.length}
          >
            Predict {selectedLeagueIds.length ? `(${selectedLeagueIds.length} ligi)` : ""}
          </button>
        </div>
      </div>
      {selectedMatch && <MatchModal match={selectedMatch} logoColors={logoColors} onClose={() => setSelectedMatch(null)} />}
    </div>
  );
}

// --- CARDUL MECIULUI ACTUALIZAT (DESIGN COMPLET RESTAURAT) ---
function MatchCard({ row, logoColors, onClick }: { row: PredictionRow, logoColors: Record<string, string>, onClick: () => void }) {
  const [xgData, setXgData] = useState<any>(() => {
    if (!row.luckStats) return null;
    return { homeXG: row.luckStats.hXG, awayXG: row.luckStats.aXG };
  });
  useEffect(() => {
    fetch(`/api/get-xg?fixtureId=${row.id}`).then(res => res.json()).then(data => { if(!data.error) setXgData(data); });
  }, [row.id]);

  const homeColor = logoColors[row.logos?.home || ''] || hashColor(row.teams.home);
  const awayColor = logoColors[row.logos?.away || ''] || hashColor(row.teams.away);
  const pct = (n: number) => Math.round(n || 0);
  const isLive = ["1H", "2H", "HT", "ET", "P", "LIVE"].includes(row.status);
  const confPct = pct(row.recommended?.confidence);
  const confColor = confPct >= 75 ? '#10b981' : confPct >= 60 ? '#f59e0b' : '#ef4444';
  const showFire = row.recommended?.confidence >= 70;

  return (
    <div onClick={onClick} className="relative flex flex-col bg-slate-900/30 border border-white/5 rounded-[1.5rem] sm:rounded-[2rem] p-4 sm:p-5 hover:border-emerald-500/50 hover:bg-slate-800/40 cursor-pointer transition-all duration-300 transform hover:-translate-y-1 hover:shadow-2xl">
      
      {/* 1. ANTET (Ora + Arbitru + Gauge Confidență) */}
      <div className="flex justify-between items-start gap-3 mb-3 sm:mb-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
             <span className="text-[8px] sm:text-[9px] bg-white/5 text-slate-300 px-2 py-1 rounded-md uppercase font-black tracking-widest">{row.league}</span>
             {isLive && (
               <span className="flex items-center gap-1 text-[8px] sm:text-[9px] text-red-500 font-bold bg-red-500/10 px-2 py-1 rounded-md border border-red-500/20">
                 <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span> LIVE
               </span>
             )}
          </div>
          <div className="text-[8px] sm:text-[9px] text-slate-500 flex flex-wrap items-center gap-1 font-medium tracking-tight">
            ⏱️ {new Date(row.kickoff).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            <span className="opacity-50 mx-1">|</span> ⚖️ {row.referee || "-"}
          </div>
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right">
            <div className="text-[8px] text-slate-500 uppercase font-black tracking-wide">{showFire ? '🔥 ' : ''}Top Pick</div>
            <div className="text-xs sm:text-sm font-black text-emerald-400">{row.recommended.pick}</div>
          </div>
          <div className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-slate-800/50 shadow-inner" style={{ background: `conic-gradient(${confColor} ${confPct}%, rgba(255,255,255,0.05) 0)` }}>
            <div className="w-7 h-7 sm:w-8 sm:h-8 bg-slate-900 rounded-full flex flex-col items-center justify-center text-[7px] sm:text-[8px] font-black text-white shadow-md leading-none">
              {showFire && <span className="text-[8px] sm:text-[9px] -mb-0.5">🔥</span>}
              <span>{confPct}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. VALUE BET BANNER */}
      {row.valueBet?.detected && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-2.5 mb-3 sm:mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-[9px] sm:text-[10px] text-yellow-400 font-black uppercase tracking-wider">
          <div className="flex items-center gap-2">
            <span>💎 Value: {row.valueBet.type}</span>
            {row.odds?.bookmaker && <span className="text-yellow-200/80">· {row.odds.bookmaker}</span>}
          </div>
          <div className="bg-black/20 px-2 py-1 rounded-lg border border-yellow-500/10">
            EV: +{row.valueBet.ev}% | Stake: {row.valueBet.kelly}%
          </div>
        </div>
      )}

      {/* 3. ECHIPE (Drop Shadow + VS) */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="w-1/3 text-center flex flex-col items-center gap-2">
          <img src={row.logos?.home} className="w-9 h-9 sm:w-10 sm:h-10 object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,0.4)]" alt=""/>
          <div className="text-[10px] sm:text-[11px] font-bold text-slate-200 line-clamp-2 leading-tight tracking-tight">{row.teams.home}</div>
        </div>
        <div className="text-slate-600 font-black italic text-[9px] sm:text-[10px] bg-slate-800/40 px-2 py-1 rounded-md border border-white/5">VS</div>
        <div className="w-1/3 text-center flex flex-col items-center gap-2">
          <img src={row.logos?.away} className="w-9 h-9 sm:w-10 sm:h-10 object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,0.4)]" alt=""/>
          <div className="text-[10px] sm:text-[11px] font-bold text-slate-200 line-clamp-2 leading-tight tracking-tight">{row.teams.away}</div>
        </div>
      </div>

      {/* 4. xG PERFORMANCE & LUCK BADGES */}
      <XGPerformanceBar xg={xgData} />
      
      {row.luckStats && (
        <div className="flex flex-wrap justify-between mt-2 px-1 gap-2">
          <LuckBadge goals={row.luckStats.hG} xg={xgData?.homeXG ?? row.luckStats.hXG} />
          <LuckBadge goals={row.luckStats.aG} xg={xgData?.awayXG ?? row.luckStats.aXG} />
        </div>
      )}

      {/* 5. BARA PROBABILITĂȚI 1X2 CU CULORILE ECHIPELOR ȘI COTE REALE */}
      <div className="space-y-1.5 mb-3 sm:mb-4 mt-4 sm:mt-5">
        <div className="h-1.5 w-full bg-slate-800/50 rounded-full overflow-hidden flex">
          <div style={{ width: `${row.probs.p1}%`, backgroundColor: homeColor }} className="transition-all duration-1000 shadow-[inset_-2px_0_4px_rgba(0,0,0,0.3)]" />
          <div style={{ width: `${row.probs.pX}%` }} className="bg-slate-600 transition-all duration-1000" />
          <div style={{ width: `${row.probs.p2}%`, backgroundColor: awayColor }} className="transition-all duration-1000 shadow-[inset_2px_0_4px_rgba(0,0,0,0.3)]" />
        </div>
        <div className="flex justify-between text-[7px] sm:text-[8px] font-black text-slate-400 uppercase px-1 gap-2">
           <span className={`${row.valueBet?.type === '1' ? 'text-yellow-400' : ''}`}>{pct(row.probs.p1)}% · {row.odds?.home || '-'}</span>
           <span className="opacity-50">{pct(row.probs.pX)}% · {row.odds?.draw || '-'}</span>
           <span className={`${row.valueBet?.type === '2' ? 'text-yellow-400' : ''}`}>{row.odds?.away || '-'} · {pct(row.probs.p2)}%</span>
        </div>
      </div>

      {/* Cartonașe estimare sintetică (predicții) */}
      <div className="mt-2 flex flex-wrap gap-2">
        <span className="text-[8px] font-black uppercase px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-200">{row.predictions?.oneXtwo}</span>
        <span className="text-[8px] font-black uppercase px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-200">{row.predictions?.gg}</span>
        <span className="text-[8px] font-black uppercase px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-200">{row.predictions?.over25}</span>
      </div>

      {/* 6. SUBSOL - SCOR ESTIMAT POISSON */}
      <div className="mt-auto bg-slate-900/50 p-2.5 rounded-xl border border-white/5 flex flex-col items-center">
        <div className="text-[8px] text-slate-500 uppercase font-black mb-0.5 tracking-wider opacity-60">Scor Estimat Poisson</div>
        <div className="text-xs sm:text-sm font-black text-white tracking-widest">{row.predictions?.correctScore || "-"}</div>
      </div>
    </div>
  );
}

// --- MODAL DETALIAT (Cod original extins cu xG) ---
function MatchModal({ match, logoColors, onClose }: { match: PredictionRow, logoColors: Record<string, string>, onClose: () => void }) {
  const homeColor = logoColors[match.logos?.home || ''] || hashColor(match.teams.home);
  const awayColor = logoColors[match.logos?.away || ''] || hashColor(match.teams.away);
  const pct = (n: number) => Math.round(n || 0);

  const [xgData, setXgData] = useState<any>(() => {
    if (!match.luckStats) return null;
    return { homeXG: match.luckStats.hXG, awayXG: match.luckStats.aXG };
  });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/get-xg?fixtureId=${match.id}`)
      .then(res => res.json())
      .then(data => { if (!cancelled && !data?.error) setXgData(data); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [match.id]);

  const ProbBar = ({ label, val, color }: { label: string, val: number, color: string }) => (
    <div className="mb-3">
      <div className="flex justify-between text-[10px] font-black uppercase mb-1">
        <span className="text-slate-400">{label}</span>
        <span style={{ color }}>{pct(val)}%</span>
      </div>
      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
        <div style={{ width: `${val}%`, backgroundColor: color }} className="h-full shadow-[0_0_8px_rgba(255,255,255,0.1)]" />
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-md" onClick={onClose}>
      <div className="bg-slate-950 border border-white/10 rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-lg lg:max-w-5xl max-h-[90vh] overflow-y-auto shadow-2xl relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="sticky top-3 ml-auto mr-3 mt-3 z-10 w-11 h-11 sm:w-10 sm:h-10 bg-slate-900/90 hover:bg-white/10 rounded-full flex items-center justify-center text-slate-300 transition-colors border border-white/10 backdrop-blur touch-manipulation shadow-lg">✕</button>
        
        <div className="px-5 pb-6 pt-2 sm:p-8 bg-gradient-to-b from-slate-900/80 to-slate-950 border-b border-white/5 text-center">
          <div className="text-[10px] text-emerald-500 font-black uppercase tracking-widest mb-6 italic opacity-80">⚽ Analiză Avansată Poisson & xG</div>
          <div className="flex flex-row flex-wrap lg:flex-nowrap justify-between items-center gap-4 lg:gap-8 px-1 sm:px-2">
            <div className="w-auto lg:w-1/4 flex flex-col items-center gap-3">
              <img src={match.logos?.home} className="w-14 h-14 sm:w-16 sm:h-16 object-contain drop-shadow-2xl" alt="" />
              <div className="text-sm font-bold leading-tight">{match.teams.home}</div>
            </div>
            <div className="flex-1 min-w-[160px] lg:w-2/4">
              <div className="text-[10px] text-slate-500 uppercase font-black mb-1">{match.league}</div>
              <div className="text-4xl font-black text-white tracking-tighter mb-2">{match.predictions.correctScore}</div>
              <div className="text-[10px] text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-full uppercase font-bold inline-block border border-emerald-500/20">Pick: {match.recommended.pick}</div>
              <div className="text-[10px] text-slate-600 font-black mt-2 opacity-80">
                ⏱️ {new Date(match.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{" "}
                <span className="opacity-50 mx-1">|</span> ⚖️ {match.referee || "-"}
              </div>
            </div>
            <div className="w-auto lg:w-1/4 flex flex-col items-center gap-3">
              <img src={match.logos?.away} className="w-14 h-14 sm:w-16 sm:h-16 object-contain drop-shadow-2xl" alt="" />
              <div className="text-sm font-bold leading-tight">{match.teams.away}</div>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-8 space-y-6 sm:space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6">
            {/* xG + Luck Factor */}
            <div className="bg-slate-900/40 p-5 rounded-3xl border border-white/5 text-center shadow-inner">
              <div className="text-[10px] text-slate-500 uppercase font-black mb-3 opacity-60 tracking-widest">xG & Luck Factor</div>
              <div className="flex justify-center">{xgData ? <XGPerformanceBar xg={xgData} /> : null}</div>
              {match.luckStats && (
                <div className="flex flex-wrap justify-center lg:justify-between mt-2 px-1 gap-2">
                  <LuckBadge goals={match.luckStats.hG} xg={xgData?.homeXG ?? match.luckStats.hXG} />
                  <LuckBadge goals={match.luckStats.aG} xg={xgData?.awayXG ?? match.luckStats.aXG} />
                </div>
              )}
              {!match.luckStats && <div className="text-[10px] text-slate-500 opacity-70">Luck Factor: indisponibil</div>}
            </div>

            {/* Cote reale + Value Bet */}
            <div className="bg-slate-900/40 p-5 rounded-3xl border border-white/5 shadow-inner">
              <div className="text-[10px] text-slate-500 uppercase font-black mb-4 opacity-60 tracking-widest">Cote Reale & Value Bet</div>
              <div className="grid grid-cols-3 gap-2 lg:gap-3 text-center">
                <div className="rounded-2xl border border-white/5 bg-black/20 p-2.5 lg:p-3">
                  <div className="text-[10px] text-slate-500 uppercase font-black">1 (Gazde)</div>
                  <div className="text-xl lg:text-2xl font-black mt-1" style={{ color: homeColor }}>{match.odds?.home ?? "-"}</div>
                </div>
                <div className="rounded-2xl border border-white/5 bg-black/20 p-2.5 lg:p-3">
                  <div className="text-[10px] text-slate-500 uppercase font-black">X (Egal)</div>
                  <div className="text-xl lg:text-2xl font-black mt-1">{match.odds?.draw ?? "-"}</div>
                </div>
                <div className="rounded-2xl border border-white/5 bg-black/20 p-2.5 lg:p-3">
                  <div className="text-[10px] text-slate-500 uppercase font-black">2 (Oaspeți)</div>
                  <div className="text-xl lg:text-2xl font-black mt-1" style={{ color: awayColor }}>{match.odds?.away ?? "-"}</div>
                </div>
              </div>

              {match.valueBet?.detected && (
                <div className="mt-4 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4">
                  <div className="text-[10px] text-yellow-400 uppercase font-black tracking-widest">💎 Value Bet</div>
                  {match.odds?.bookmaker && <div className="mt-1 text-[10px] text-yellow-200/80 font-black">Operator: {match.odds.bookmaker}</div>}
                  <div className="mt-2 flex flex-col gap-1 lg:flex-row lg:justify-between text-[12px] font-black">
                    <span className="text-yellow-200">Tip: {match.valueBet.type}</span>
                    <span className="text-yellow-200">EV: +{match.valueBet.ev ?? 0}%</span>
                    <span className="text-yellow-200">Stake: {match.valueBet.kelly ?? 0}%</span>
                  </div>
                </div>
              )}
              {!match.valueBet?.detected && (
                <div className="mt-4 text-[10px] text-slate-500 opacity-70 font-black uppercase tracking-widest">
                  Value Bet: nu detectat
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6">
            {match.lambdas && (
              <div className="bg-slate-900/40 p-5 rounded-3xl border border-white/5 text-center shadow-inner">
                <div className="text-[10px] text-slate-500 uppercase font-black mb-3 opacity-60">Momentum Ofensiv Ajustat (λ)</div>
                <div className="flex justify-between items-center gap-4">
                  <div className="text-right w-1/2 text-2xl font-black" style={{ color: homeColor }}>{match.lambdas.home}</div>
                  <div className="text-slate-600 font-black text-xs opacity-50">VS</div>
                  <div className="text-left w-1/2 text-2xl font-black" style={{ color: awayColor }}>{match.lambdas.away}</div>
                </div>
              </div>
            )}

            {/* Predicții (piețe) */}
            <div className="bg-slate-900/40 p-5 rounded-3xl border border-white/5 shadow-inner">
              <div className="text-[10px] text-slate-500 uppercase font-black mb-4 opacity-60 tracking-widest">Piețe & Scor</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/5 bg-black/20 p-3 text-center">
                  <div className="text-[10px] text-slate-500 uppercase font-black">1X2</div>
                  <div className="text-sm font-black mt-1">{match.predictions.oneXtwo}</div>
                </div>
                <div className="rounded-2xl border border-white/5 bg-black/20 p-3 text-center">
                  <div className="text-[10px] text-slate-500 uppercase font-black">GG</div>
                  <div className="text-sm font-black mt-1">{match.predictions.gg}</div>
                </div>
                <div className="rounded-2xl border border-white/5 bg-black/20 p-3 text-center">
                  <div className="text-[10px] text-slate-500 uppercase font-black">Over 2.5</div>
                  <div className="text-sm font-black mt-1">{match.predictions.over25}</div>
                </div>
                <div className="rounded-2xl border border-white/5 bg-black/20 p-3 text-center">
                  <div className="text-[10px] text-slate-500 uppercase font-black">Correct Score</div>
                  <div className="text-sm font-black mt-1">{match.predictions.correctScore}</div>
                </div>
                {match.predictions.cards && (
                  <div className="rounded-2xl border border-white/5 bg-black/20 p-3 text-center col-span-2">
                    <div className="text-[10px] text-slate-500 uppercase font-black">Cards</div>
                    <div className="text-sm font-black mt-1">{match.predictions.cards}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-10">
            <div className="space-y-4">
              <div className="text-[10px] text-slate-500 uppercase font-black border-b border-white/5 pb-2 tracking-widest opacity-60">Rezultat Final</div>
              <ProbBar label="Victorie Gazde" val={match.probs.p1} color={homeColor} />
              <ProbBar label="Egalitate (X)" val={match.probs.pX} color="#475569" />
              <ProbBar label="Victorie Oaspeți" val={match.probs.p2} color={awayColor} />
            </div>
            <div className="space-y-4">
              <div className="text-[10px] text-slate-500 uppercase font-black border-b border-white/5 pb-2 tracking-widest opacity-60">Piața Goluri</div>
              <ProbBar label="Peste 2.5" val={match.probs.pO25} color="#10b981" />
              <ProbBar label="Sub 3.5" val={match.probs.pU35} color="#3b82f6" />
              <ProbBar label="Ambele (GG)" val={match.probs.pGG} color="#f59e0b" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}