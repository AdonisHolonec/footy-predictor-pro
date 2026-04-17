import { useEffect, useState } from "react";
import LuckBadge from "./LuckBadge";
import XGPerformanceBar from "./XGPerformanceBar";
import { MatchScore, PredictionRow, XGData } from "../types";

type MatchModalProps = {
  match: PredictionRow;
  logoColors: Record<string, string>;
  onClose: () => void;
  hashColor: (seed: string) => string;
};

function isFinalStatus(status?: string) {
  return ["FT", "AET", "PEN"].includes(status || "");
}

function evaluateTopPick(pick: string, score?: MatchScore): boolean | null {
  if (!pick || !score) return null;
  if (score.home === null || score.away === null) return null;
  const home = score.home;
  const away = score.away;
  const total = home + away;
  const normalized = pick.trim().toLowerCase();

  if (normalized === "1") return home > away;
  if (normalized === "2") return away > home;
  if (normalized === "x") return home === away;
  if (normalized === "gg") return home > 0 && away > 0;
  if (normalized === "ngg") return home === 0 || away === 0;

  const overMatch = normalized.match(/peste\s*(\d+(?:[.,]\d+)?)/);
  if (overMatch) return total > Number(overMatch[1].replace(",", "."));
  const underMatch = normalized.match(/sub\s*(\d+(?:[.,]\d+)?)/);
  if (underMatch) return total < Number(underMatch[1].replace(",", "."));
  return null;
}

function finalScoreBadgeClass(result: boolean | null) {
  if (result === true) return "text-emerald-300 bg-emerald-500/10 border-emerald-500/20";
  if (result === false) return "text-rose-300 bg-rose-500/10 border-rose-500/20";
  return "text-slate-300 bg-white/5 border-white/10";
}

function finalScoreLabel(result: boolean | null) {
  if (result === true) return "WIN";
  if (result === false) return "LOSS";
  return "FINAL";
}

export default function MatchModal({ match, logoColors, onClose, hashColor }: MatchModalProps) {
  const homeColor = logoColors[match.logos?.home || ""] || hashColor(match.teams.home);
  const awayColor = logoColors[match.logos?.away || ""] || hashColor(match.teams.away);
  const pct = (n: number) => Math.round(n || 0);
  const hasFinalScore = isFinalStatus(match.status) && match.score?.home !== null && match.score?.away !== null && match.score?.home !== undefined && match.score?.away !== undefined;
  const finalPickResult = hasFinalScore ? evaluateTopPick(match.recommended.pick, match.score) : null;
  const kickoffDate = new Date(match.kickoff);

  const [xgData, setXgData] = useState<XGData | null>(() => {
    if (!match.luckStats) return null;
    return { homeXG: match.luckStats.hXG, awayXG: match.luckStats.aXG };
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/get-xg?fixtureId=${match.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && !data?.error) setXgData(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [match.id]);

  const ProbBar = ({ label, val, color }: { label: string; val: number; color: string }) => (
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
      <div className="bg-slate-950 border border-white/10 rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-lg lg:max-w-5xl max-h-[90vh] overflow-y-auto shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="sticky top-3 ml-auto mr-3 mt-3 z-10 w-11 h-11 sm:w-10 sm:h-10 bg-slate-900/90 hover:bg-white/10 rounded-full flex items-center justify-center text-slate-300 transition-colors border border-white/10 backdrop-blur touch-manipulation shadow-lg">✕</button>

        <div className="px-5 pb-6 pt-2 sm:p-8 bg-gradient-to-b from-slate-900/80 to-slate-950 border-b border-white/5 text-center">
          <div className="text-[10px] text-emerald-500 font-black uppercase tracking-widest mb-6 italic opacity-80">⚽ Analiză Avansată Poisson & xG</div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 lg:gap-8 px-1 sm:px-2">
            <div className="justify-self-start flex flex-col items-center gap-3">
              <img src={match.logos?.home} className="w-14 h-14 sm:w-16 sm:h-16 object-contain drop-shadow-2xl" alt="" />
              <div className="text-sm font-bold leading-tight">{match.teams.home}</div>
            </div>
            <div className="min-w-[160px] text-center">
              <div className="text-[10px] text-slate-500 uppercase font-black mb-1">{match.league}</div>
              <div className="text-4xl font-black text-white tracking-tighter mb-2">
                {hasFinalScore ? `${match.score?.home}-${match.score?.away}` : "-"}
              </div>
              <div className="text-[10px] text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-full uppercase font-bold inline-block border border-emerald-500/20">Pick: {match.recommended.pick}</div>
              {hasFinalScore && (
                <div className={`mt-2 text-[10px] px-3 py-1.5 rounded-full uppercase font-bold inline-block border ${finalScoreBadgeClass(finalPickResult)}`}>
                  {finalScoreLabel(finalPickResult)} · {match.score?.home}-{match.score?.away}
                </div>
              )}
              <div className="text-[10px] text-slate-600 font-black mt-2 opacity-80">
                📅 {kickoffDate.toLocaleDateString([], { day: "2-digit", month: "2-digit" })} <span className="opacity-50 mx-1">|</span>
                ⏱️ {new Date(match.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} <span className="opacity-50 mx-1">|</span> ⚖️ {match.referee || "-"}
              </div>
            </div>
            <div className="justify-self-end flex flex-col items-center gap-3">
              <img src={match.logos?.away} className="w-14 h-14 sm:w-16 sm:h-16 object-contain drop-shadow-2xl" alt="" />
              <div className="text-sm font-bold leading-tight">{match.teams.away}</div>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-8 space-y-6 sm:space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6">
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
                  <div className="text-sm font-black mt-1">{hasFinalScore ? `${match.score?.home}-${match.score?.away}` : "-"}</div>
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
