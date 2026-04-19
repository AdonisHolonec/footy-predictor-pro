import { HistoryStats } from "../types";

type SuccessRateTrackerProps = {
  stats: HistoryStats;
  animatedWins: number;
  animatedLosses: number;
  animatedWinRate: number;
  isWinRatePulsing: boolean;
  isHistorySyncing: boolean;
  pendingHistoryCount: number;
  displayedPredsCount?: number;
  pendingAmongDisplayedPreds?: number;
  onBreakdownClick?: () => void;
};

export default function SuccessRateTracker({
  stats,
  animatedWins,
  animatedLosses,
  animatedWinRate,
  isWinRatePulsing,
  isHistorySyncing,
  pendingHistoryCount,
  displayedPredsCount = 0,
  pendingAmongDisplayedPreds = 0,
  onBreakdownClick
}: SuccessRateTrackerProps) {
  const inner = (
    <>
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div
          className="absolute inset-0 bg-[linear-gradient(rgba(56,189,248,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,0.06)_1px,transparent_1px)]"
          style={{ backgroundSize: "24px 24px" }}
        />
      </div>
      <div className="pointer-events-none absolute -right-16 top-0 h-48 w-48 rounded-full bg-signal-petrol/10 blur-3xl" />
      <div className="relative mb-4 flex flex-col gap-2 border-b border-white/5 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-signal-petrol/80">Performance observatory</div>
          <div className="font-display text-xl font-semibold tracking-tight text-signal-ink sm:text-2xl">Calibration stream</div>
          <div className="mt-1 text-[10px] text-signal-inkMuted">Fereastră · ultimele 30 zile kickoff</div>
        </div>
        <div className="font-mono text-[10px] tabular-nums text-signal-silver">settled {stats.settled}</div>
      </div>
      <div className="relative grid grid-cols-3 gap-2 sm:gap-4">
        <div className="min-w-0 rounded-2xl border border-signal-sage/25 bg-signal-sage/5 px-2 py-3 shadow-inner sm:px-4">
          <div className="truncate text-[7px] font-semibold uppercase tracking-wide text-signal-sage sm:text-[10px]">Wins</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums leading-none text-signal-sage sm:text-3xl">{animatedWins}</div>
        </div>
        <div className="min-w-0 rounded-2xl border border-signal-rose/25 bg-signal-rose/5 px-2 py-3 shadow-inner sm:px-4">
          <div className="truncate text-[7px] font-semibold uppercase tracking-wide text-signal-rose sm:text-[10px]">Losses</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums leading-none text-signal-rose sm:text-3xl">{animatedLosses}</div>
        </div>
        <div
          className={`min-w-0 rounded-2xl border border-signal-petrol/30 bg-signal-void/50 px-2 py-3 shadow-inner transition-all duration-500 sm:px-4 ${
            isWinRatePulsing ? "shadow-frost ring-1 ring-signal-petrol/20" : ""
          }`}
        >
          <div className="truncate text-[7px] font-semibold uppercase tracking-wide text-signal-petrol/80 sm:text-[10px]">Hit rate</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums leading-none text-signal-petrol sm:text-3xl">{animatedWinRate.toFixed(1)}%</div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-signal-mist ring-1 ring-white/5">
            <div
              className={`h-full rounded-full bg-gradient-to-r from-signal-petrol via-signal-sage to-signal-mint transition-all duration-700 motion-reduce:animate-none ${isWinRatePulsing ? "animate-pulse-soft" : ""}`}
              style={{ width: `${Math.max(0, Math.min(100, stats.winRate))}%` }}
            />
          </div>
        </div>
      </div>
      {pendingHistoryCount > 0 && (
        <div className="relative mt-4 space-y-1 rounded-xl border border-signal-amber/25 bg-signal-amber/5 px-3 py-2 text-center text-[9px] font-medium leading-snug text-signal-amber sm:text-[10px]">
          <div className="font-semibold uppercase tracking-wide">În istoric: {pendingHistoryCount} fără FT validat</div>
          {displayedPredsCount > 0 && (
            <div className="normal-case text-signal-inkMuted">
              Din lista curentă ({displayedPredsCount}): {pendingAmongDisplayedPreds} pending
              {pendingHistoryCount > pendingAmongDisplayedPreds ? ` · +${pendingHistoryCount - pendingAmongDisplayedPreds} alte zile` : ""}
              .
            </div>
          )}
        </div>
      )}
      {isHistorySyncing && (
        <div className="relative mt-2 text-center font-mono text-[10px] font-semibold uppercase tracking-widest text-signal-petrol">Sync…</div>
      )}
      {onBreakdownClick && (
        <div className="relative mt-3 text-center font-mono text-[9px] text-signal-inkMuted">Deschide consola detaliată →</div>
      )}
    </>
  );

  const shellClass =
    "relative mt-4 w-full max-w-[880px] overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-signal-panel/90 via-signal-mist/95 to-signal-void/90 px-4 py-5 shadow-frost backdrop-blur-xl sm:px-8 sm:py-6";

  if (onBreakdownClick) {
    return (
      <button
        type="button"
        onClick={onBreakdownClick}
        className={`${shellClass} w-full cursor-pointer touch-manipulation text-left outline-none transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-frost motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:ring-2 focus-visible:ring-signal-petrol/40 focus-visible:ring-offset-2 focus-visible:ring-offset-signal-mist`}
      >
        {inner}
      </button>
    );
  }

  return <div className={shellClass}>{inner}</div>;
}
