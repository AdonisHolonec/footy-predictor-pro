import React, { useEffect, useMemo, useRef, useState } from "react";
import LeaguePanel from "./components/LeaguePanel";
import MatchCard from "./components/MatchCard";
import MatchModal from "./components/MatchModal";
import SuccessRateTracker from "./components/SuccessRateTracker";
import { BacktestKpi, DayResponse, HistoryEntry, HistoryStats, League, PredictionRow, RiskAlert } from "./types";
import { ELITE_LEAGUES, FilterMode, SortBy } from "./constants/appConstants";
import {
  dominantColorFromImage,
  hashColor,
  inferSeason,
  isoToday,
  normalizeSelectedDates,
  useLocalStorageState
} from "./utils/appUtils";

// --- APP COMPONENT ---
export default function App() {
  const [date, setDate] = useLocalStorageState<string>("footy.date", isoToday());
  const [selectedDates, setSelectedDates] = useLocalStorageState<string[]>("footy.selectedDates", [isoToday()]);
  const [selectedLeagueIds, setSelectedLeagueIds] = useLocalStorageState<number[]>("footy.selectedLeagueIds", []);
  const [day, setDay] = useState<DayResponse | null>(null);
  const [preds, setPreds] = useLocalStorageState<PredictionRow[]>("footy.lastPreds", []);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyStats, setHistoryStats] = useState<HistoryStats>({ wins: 0, losses: 0, settled: 0, winRate: 0 });
  const [status, setStatus] = useState<string>("");
  const [kpi, setKpi] = useState<BacktestKpi | null>(null);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [riskAlerts, setRiskAlerts] = useState<RiskAlert[]>([]);
  const [alertsSeverity, setAlertsSeverity] = useState<"none" | "medium" | "high">("none");
  const [isHistorySyncing, setIsHistorySyncing] = useState(false);
  const [isWinRatePulsing, setIsWinRatePulsing] = useState(false);
  const [animatedWins, setAnimatedWins] = useState(0);
  const [animatedLosses, setAnimatedLosses] = useState(0);
  const [animatedWinRate, setAnimatedWinRate] = useState(0);
  const [logoColors, setLogoColors] = useLocalStorageState<Record<string, string>>("footy.logoColors", {});
  const [searchLeague, setSearchLeague] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("ALL");
  const [sortBy, setSortBy] = useState<SortBy>("TIME");
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

  const trackerStats = useMemo(() => {
    return historyStats;
  }, [historyStats]);
  const pendingHistoryCount = useMemo(
    () => history.filter((item) => item.validation === "pending").length,
    [history]
  );
  const prevWinRateRef = useRef<number>(trackerStats.winRate);

  const groupedDisplayedMatches = useMemo(() => {
    const groups = new Map<string, PredictionRow[]>();
    for (const match of displayedMatches) {
      const key = match.kickoff?.slice(0, 10) || "Fără dată";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(match);
    }
    return Array.from(groups.entries()).map(([dateKey, matches]) => ({
      dateKey,
      matches
    }));
  }, [displayedMatches]);

  async function fetchDays(dates: string[]) {
    const effectiveDates = normalizeSelectedDates(dates.length ? dates : [date]);
    setStatus("Încarc ligile...");
    try {
      const responses = await Promise.all(
        effectiveDates.map(async (d) => {
          const r = await fetch(`/api/fixtures/day?date=${d}`);
          const j = await r.json();
          if (!j.ok) throw new Error(j.error || "Eroare API");
          return j as DayResponse;
        })
      );

      const leaguesMap = new Map<number, League>();
      for (const resp of responses) {
        for (const lg of resp.leagues || []) {
          const existing = leaguesMap.get(lg.id);
          if (existing) {
            existing.matches += lg.matches;
            if (!existing.logo && lg.logo) existing.logo = lg.logo;
          } else {
            leaguesMap.set(lg.id, { ...lg });
          }
        }
      }

      const aggregated: DayResponse = {
        ok: true,
        date: effectiveDates.join(", "),
        totalFixtures: responses.reduce((sum, resp) => sum + (resp.totalFixtures || 0), 0),
        leagues: Array.from(leaguesMap.values()),
        usage: responses[responses.length - 1]?.usage || { date: isoToday(), count: 0, limit: 100 }
      };

      setDay(aggregated);
      setStatus(aggregated.totalFixtures ? `OK: ${aggregated.totalFixtures} meciuri pentru ${effectiveDates.length} zi(le).` : "Lipsă meciuri.");
    } catch (e: any) { setStatus(`Eroare: ${e.message}`); }
  }

  async function warm() {
    if (!selectedLeagueIds.length) return setStatus("Selectează o ligă.");
    setStatus("Se procesează datele (Warm)...");
    try {
      const dates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
      const results = [];
      for (const currentDate of dates) {
        const qs = new URLSearchParams({ date: currentDate, leagueIds: selectedLeagueIds.join(","), season: String(inferSeason(currentDate)) });
        const r = await fetch(`/api/warm?${qs}`);
        const j = await r.json();
        results.push({ date: currentDate, ok: !!j.ok });
      }
      const okCount = results.filter(r => r.ok).length;
      setStatus(okCount === results.length ? `Date pregătite cu succes pentru ${results.length} zi(le).` : `Warm finalizat parțial (${okCount}/${results.length}).`);
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
      const dates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
      const batches: PredictionRow[] = [];
      for (const currentDate of dates) {
        const qs = new URLSearchParams({ date: currentDate, leagueIds: selectedLeagueIds.join(","), season: String(inferSeason(currentDate)), limit: "50" });
        const r = await fetch(`/api/predict?${qs}`);
        const j = await r.json();
        if (Array.isArray(j)) batches.push(...j);
      }
      const deduped = Array.from(new Map(batches.map((row) => [row.id, row])).values());
      setPreds(deduped);
      await fetch("/api/history/sync?days=30", { method: "POST" }).catch(() => null);
      await loadHistory(30);
      await loadKpi(45);
      await loadAlerts(7);
      setStatus(`Gata! ${deduped.length} predicții generate pentru ${dates.length} zi(le).`);
      void prefetchColors(deduped);
      if (window.innerWidth < 1024) setIsLeaguesOpen(false);
    } catch (e: any) { setStatus(`Error: ${e.message}`); }
  }

  async function loadHistory(days = 30) {
    try {
      const res = await fetch(`/api/history?days=${days}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Nu am putut încărca istoricul.");
      setHistory(Array.isArray(json.items) ? json.items : []);
      setHistoryStats(json.stats || { wins: 0, losses: 0, settled: 0, winRate: 0 });
    } catch (error: any) {
      setHistory([]);
      setHistoryStats({ wins: 0, losses: 0, settled: 0, winRate: 0 });
      setStatus((prev) => prev || `Istoric indisponibil: ${error?.message || "eroare necunoscută"}`);
    }
  }

  async function syncHistory(days = 30) {
    setIsHistorySyncing(true);
    try {
      await fetch(`/api/history/sync?days=${days}`, { method: "POST" });
      await loadHistory(days);
    } catch {
      // silent: indicator is enough
    } finally {
      setIsHistorySyncing(false);
    }
  }

  async function loadKpi(days = 45) {
    setKpiLoading(true);
    try {
      const res = await fetch(`/api/backtest/kpi?days=${days}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Nu am putut încărca KPI.");
      setKpi(json.latest || null);
    } catch {
      setKpi(null);
    } finally {
      setKpiLoading(false);
    }
  }

  async function loadAlerts(days = 7) {
    try {
      const res = await fetch(`/api/alerts?days=${days}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Nu am putut încărca alertele.");
      setRiskAlerts(Array.isArray(json.alerts) ? json.alerts : []);
      setAlertsSeverity(json.severity === "high" || json.severity === "medium" ? json.severity : "none");
    } catch {
      setRiskAlerts([]);
      setAlertsSeverity("none");
    }
  }

  useEffect(() => {
    const normalized = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
    if (normalized.length === 0) return;
    if (normalized.join("|") !== (selectedDates || []).join("|")) {
      setSelectedDates(normalized);
      return;
    }
    if (normalized[0] !== date) setDate(normalized[0]);
    void fetchDays(normalized);
  }, [date, selectedDates]);
  useEffect(() => {
    void loadHistory(30);
    void syncHistory(30);
    void loadKpi(45);
    void loadAlerts(7);
  }, []);
  useEffect(() => {
    const prev = prevWinRateRef.current;
    if (Math.abs(prev - trackerStats.winRate) > 0.01) {
      setIsWinRatePulsing(true);
      const tm = setTimeout(() => setIsWinRatePulsing(false), 900);
      prevWinRateRef.current = trackerStats.winRate;
      return () => clearTimeout(tm);
    }
    prevWinRateRef.current = trackerStats.winRate;
  }, [trackerStats.winRate]);
  useEffect(() => {
    const durationMs = window.innerWidth < 768 ? 450 : 650;
    const start = performance.now();
    const fromWins = animatedWins;
    const fromLosses = animatedLosses;
    const fromRate = animatedWinRate;
    const toWins = trackerStats.wins;
    const toLosses = trackerStats.losses;
    const toRate = trackerStats.winRate;

    let raf = 0;
    const step = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedWins(Math.round(fromWins + (toWins - fromWins) * eased));
      setAnimatedLosses(Math.round(fromLosses + (toLosses - fromLosses) * eased));
      setAnimatedWinRate(fromRate + (toRate - fromRate) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [trackerStats.wins, trackerStats.losses, trackerStats.winRate]);

  const selectedSet = new Set(selectedLeagueIds);
  const usageCount = day?.usage?.count || 0;
  const usageLimit = day?.usage?.limit || 100;
  const usagePct = (usageCount / usageLimit) * 100;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500/30 relative">
      <div className="mx-auto max-w-[1600px] px-4 py-8 lg:px-6">
        {/* HEADER */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between mb-8">
          <div className="min-w-0">
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tight text-white">Footy Predictor 💎</h1>
              <div className="text-sm text-slate-400 mt-1 font-medium italic">Advanced AI & xG Value Betting</div>
              <SuccessRateTracker
                stats={trackerStats}
                animatedWins={animatedWins}
                animatedLosses={animatedLosses}
                animatedWinRate={animatedWinRate}
                isWinRatePulsing={isWinRatePulsing}
                isHistorySyncing={isHistorySyncing}
                pendingHistoryCount={pendingHistoryCount}
              />
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-[760px]">
                <div className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2">
                  <div className="text-[9px] uppercase font-black tracking-wider text-slate-400">KPI ROI</div>
                  <div className={`text-sm font-black ${((kpi?.roi || 0) >= 0) ? "text-emerald-300" : "text-rose-300"}`}>
                    {kpiLoading ? "..." : `${(kpi?.roi || 0).toFixed(2)}%`}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2">
                  <div className="text-[9px] uppercase font-black tracking-wider text-slate-400">KPI Hit Rate</div>
                  <div className="text-sm font-black text-cyan-200">
                    {kpiLoading ? "..." : `${(kpi?.hitRate || 0).toFixed(2)}%`}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2">
                  <div className="text-[9px] uppercase font-black tracking-wider text-slate-400">KPI Drawdown</div>
                  <div className="text-sm font-black text-amber-200">
                    {kpiLoading ? "..." : `${(kpi?.drawdown || 0).toFixed(2)}u`}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2">
                  <div className="text-[9px] uppercase font-black tracking-wider text-slate-400">KPI Settled</div>
                  <div className="text-sm font-black text-slate-200">
                    {kpiLoading ? "..." : `${kpi?.settled || 0}`}
                  </div>
                </div>
              </div>
              <div className={`mt-2 max-w-[760px] rounded-xl border px-3 py-2 ${
                alertsSeverity === "high"
                  ? "border-rose-500/40 bg-rose-500/10"
                  : alertsSeverity === "medium"
                  ? "border-amber-400/40 bg-amber-500/10"
                  : "border-emerald-500/30 bg-emerald-500/10"
              }`}>
                <div className="text-[9px] uppercase tracking-widest font-black text-slate-300">Auto Alerting</div>
                <div className="mt-1 text-xs font-semibold text-slate-100">
                  {riskAlerts.length
                    ? riskAlerts.map((a) => a.message).join(" • ")
                    : "No active risk alerts"}
                </div>
              </div>
          </div>
          <div className="flex flex-col lg:flex-row lg:items-end gap-3 lg:gap-4">
            <div className="flex flex-col items-start lg:items-end w-full max-w-[200px] lg:min-w-[220px]">
              <div className="text-[10px] text-slate-400 uppercase font-black mb-1">
                API Calls: <span className={usagePct > 80 ? "text-red-400" : "text-emerald-400"}>{usageCount} / {usageLimit}</span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div style={{ width: `${usagePct}%` }} className={`h-full ${usagePct > 80 ? "bg-red-500" : "bg-emerald-500"}`} />
              </div>
            </div>
            <div className="flex flex-col items-stretch gap-2 lg:gap-3">
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap lg:flex-nowrap items-center gap-2 lg:gap-3">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    const next = e.target.value;
                    setDate(next);
                    setSelectedDates((prev) => {
                      const filtered = prev.filter((d) => d !== date);
                      return normalizeSelectedDates([next, ...filtered]);
                    });
                  }}
                  className="col-span-2 sm:col-span-1 w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
                <button
                  onClick={() => {
                    setSelectedDates((prev) => {
                      const normalized = normalizeSelectedDates(prev.length ? prev : [date]);
                      if (normalized.length >= 3) {
                        setStatus("Poți selecta maximum 3 zile.");
                        return normalized;
                      }
                      const base = normalized[normalized.length - 1] || isoToday();
                      const nextDate = new Date(base);
                      nextDate.setDate(nextDate.getDate() + 1);
                      return normalizeSelectedDates([...normalized, nextDate.toISOString().slice(0, 10)]);
                    });
                  }}
                  className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-slate-800 transition-all"
                >
                  + Zi
                </button>
                <button onClick={warm} className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-slate-800 transition-all">Warm</button>
                <button onClick={predict} className="col-span-2 sm:col-span-1 w-full sm:w-auto bg-emerald-600 rounded-xl px-6 py-2.5 text-sm font-bold hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-600/20">Predict</button>
              </div>
              <div className="flex flex-wrap gap-2 justify-start lg:justify-end">
                {normalizeSelectedDates(selectedDates.length ? selectedDates : [date]).map((d) => (
                  <button
                    key={d}
                    onClick={() => {
                      setSelectedDates((prev) => {
                        const next = prev.filter((item) => item !== d);
                        const normalized = normalizeSelectedDates(next.length ? next : [date]);
                        setDate(normalized[0] || isoToday());
                        return normalized;
                      });
                    }}
                    className={`px-3 py-1.5 rounded-full text-[10px] font-black border ${
                      d === date ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : "bg-slate-900 border-white/10 text-slate-300"
                    }`}
                    title="Elimină ziua"
                  >
                    {d} {normalizeSelectedDates(selectedDates.length ? selectedDates : [date]).length > 1 ? "✕" : ""}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {status && <div className="mb-6 p-3 bg-slate-900/40 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 font-mono">{"> "} {status}</div>}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 xl:gap-10">
          {/* LIGI */}
          <div className="lg:col-span-4 xl:col-span-3 space-y-4">
            <LeaguePanel
              leaguesSorted={leaguesSorted}
              selectedSet={selectedSet}
              selectedLeagueIds={selectedLeagueIds}
              isLeaguesOpen={isLeaguesOpen}
              searchLeague={searchLeague}
              eliteLeagues={ELITE_LEAGUES}
              setIsLeaguesOpen={setIsLeaguesOpen}
              setSearchLeague={setSearchLeague}
              setSelectedLeagueIds={setSelectedLeagueIds}
              selectEliteLeagues={selectEliteLeagues}
              clearLeagueSelection={clearLeagueSelection}
            />
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
              <div className="space-y-8">
                {groupedDisplayedMatches.map((group) => (
                  <section key={group.dateKey} className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="text-[11px] uppercase tracking-[0.25em] text-emerald-400 font-black">
                        {group.dateKey === "Fără dată"
                          ? group.dateKey
                          : new Date(group.dateKey).toLocaleDateString([], {
                              weekday: "short",
                              day: "2-digit",
                              month: "2-digit"
                            })}
                      </div>
                      <div className="h-px flex-1 bg-gradient-to-r from-emerald-500/30 to-transparent" />
                      <div className="text-[10px] text-slate-500 font-black">{group.matches.length} meciuri</div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-5">
                      {group.matches.map(m => <MatchCard key={m.id} row={m} logoColors={logoColors} hashColor={hashColor} onClick={() => setSelectedMatch(m)} />)}
                    </div>
                  </section>
                ))}
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
      {selectedMatch && <MatchModal match={selectedMatch} logoColors={logoColors} hashColor={hashColor} onClose={() => setSelectedMatch(null)} />}
    </div>
  );
}