import { HistoryStats } from "../types";

type SuccessRateTrackerProps = {
  stats: HistoryStats;
  animatedWins: number;
  animatedLosses: number;
  animatedWinRate: number;
  isWinRatePulsing: boolean;
  isHistorySyncing: boolean;
  pendingHistoryCount: number;
};

export default function SuccessRateTracker({
  stats,
  animatedWins,
  animatedLosses,
  animatedWinRate,
  isWinRatePulsing,
  isHistorySyncing,
  pendingHistoryCount
}: SuccessRateTrackerProps) {
  return (
    <div className="relative mt-4 w-full max-w-[760px] rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-slate-900/90 via-slate-900/80 to-slate-950/90 px-2 sm:px-4 py-3 shadow-[0_0_40px_rgba(16,185,129,0.08)] overflow-hidden">
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(34,211,238,0.22),transparent_40%),radial-gradient(circle_at_85%_20%,rgba(16,185,129,0.18),transparent_38%),linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:auto,auto,22px_22px,22px_22px]" />
      </div>
      <div className="relative text-center mb-2">
        <div className="text-[8px] sm:text-[11px] uppercase tracking-[0.1em] sm:tracking-[0.2em] text-slate-300 font-black leading-tight px-1">
          <span className="sm:hidden">Performance Counter</span>
          <span className="hidden sm:inline">Football Predictions - Performance Counter</span>
        </div>
        <div className="text-[9px] sm:text-[10px] text-slate-500 font-semibold mt-1">Ultimele 30 de zile</div>
      </div>
      <div className="relative grid grid-cols-3 gap-1.5 sm:gap-3">
        <div className="min-w-0 rounded-lg sm:rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-1.5 sm:px-3 py-2 shadow-[0_0_20px_rgba(16,185,129,0.18)]">
          <div className="truncate text-[7px] sm:text-[10px] uppercase tracking-wide sm:tracking-widest text-emerald-200/90 font-black">Wins ✅</div>
          <div className="mt-1 text-lg sm:text-2xl font-black text-emerald-300 leading-none">{animatedWins}</div>
          <div className="mt-1 truncate text-[7px] sm:text-[10px] uppercase tracking-wide sm:tracking-widest text-emerald-300/70 font-black">Total</div>
        </div>
        <div className="min-w-0 rounded-lg sm:rounded-xl border border-rose-400/40 bg-rose-500/10 px-1.5 sm:px-3 py-2 shadow-[0_0_20px_rgba(244,63,94,0.16)]">
          <div className="truncate text-[7px] sm:text-[10px] uppercase tracking-wide sm:tracking-widest text-rose-200/90 font-black">Losses ❌</div>
          <div className="mt-1 text-lg sm:text-2xl font-black text-rose-300 leading-none">{animatedLosses}</div>
          <div className="mt-1 truncate text-[7px] sm:text-[10px] uppercase tracking-wide sm:tracking-widest text-rose-300/70 font-black">Total</div>
        </div>
        <div className={`min-w-0 rounded-lg sm:rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-1.5 sm:px-3 py-2 shadow-[0_0_20px_rgba(34,211,238,0.18)] transition-all duration-500 ${isWinRatePulsing ? "scale-[1.02] shadow-[0_0_26px_rgba(34,211,238,0.35)]" : ""}`}>
          <div className="truncate text-[7px] sm:text-[10px] uppercase tracking-wide sm:tracking-widest text-cyan-200/90 font-black">Rate 🎯</div>
          <div className="mt-1 text-lg sm:text-2xl font-black text-cyan-200 leading-none">{animatedWinRate.toFixed(1)}%</div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-slate-800/80 overflow-hidden">
            <div
              className={`h-full rounded-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-emerald-500 transition-all duration-700 ${isWinRatePulsing ? "animate-pulse" : ""}`}
              style={{ width: `${Math.max(0, Math.min(100, stats.winRate))}%` }}
            />
          </div>
        </div>
      </div>
      {pendingHistoryCount > 0 && (
        <div className="relative mt-2 text-center text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-amber-300/90">
          {pendingHistoryCount} predicții așteaptă validarea finală
        </div>
      )}
      {isHistorySyncing && <div className="relative mt-2 text-center text-[10px] font-black uppercase tracking-widest text-blue-400">Sync...</div>}
    </div>
  );
}
