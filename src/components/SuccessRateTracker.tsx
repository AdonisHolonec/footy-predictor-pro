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
      <div className="pointer-events-none absolute inset-0 opacity-[0.35]">
        <div
          className="absolute inset-0 bg-[linear-gradient(rgba(12,48,44,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(12,48,44,0.05)_1px,transparent_1px)]"
          style={{ backgroundSize: "20px 20px" }}
        />
      </div>
      <div className="relative mb-3 flex flex-col gap-1 border-b border-signal-line/50 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-display text-base font-semibold tracking-tight text-signal-petrol sm:text-lg">Lab console</div>
          <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-signal-sage">Performance · ultimele 30 zile</div>
        </div>
        <div className="font-mono text-[10px] tabular-nums text-signal-inkMuted">settled {stats.settled}</div>
      </div>
      <div className="relative grid grid-cols-3 gap-2 sm:gap-4">
        <div className="min-w-0 rounded-xl border border-signal-sage/35 bg-gradient-to-br from-signal-mintSoft/60 to-white/50 px-2 py-2.5 shadow-inner sm:rounded-2xl sm:px-4 sm:py-3">
          <div className="truncate text-[7px] font-semibold uppercase tracking-wide text-signal-petrolMuted sm:text-[10px] sm:tracking-widest">Wins</div>
          <div className="mt-1 font-mono text-lg font-semibold tabular-nums leading-none text-signal-petrol sm:text-3xl">{animatedWins}</div>
        </div>
        <div className="min-w-0 rounded-xl border border-signal-rose/30 bg-gradient-to-br from-signal-rose/10 to-white/50 px-2 py-2.5 shadow-inner sm:rounded-2xl sm:px-4 sm:py-3">
          <div className="truncate text-[7px] font-semibold uppercase tracking-wide text-signal-rose sm:text-[10px] sm:tracking-widest">Losses</div>
          <div className="mt-1 font-mono text-lg font-semibold tabular-nums leading-none text-signal-rose sm:text-3xl">{animatedLosses}</div>
        </div>
        <div
          className={`min-w-0 rounded-xl border border-signal-petrol/25 bg-white/60 px-2 py-2.5 shadow-inner transition-all duration-500 sm:rounded-2xl sm:px-4 sm:py-3 ${
            isWinRatePulsing ? "ring-2 ring-signal-sage/30" : ""
          }`}
        >
          <div className="truncate text-[7px] font-semibold uppercase tracking-wide text-signal-inkMuted sm:text-[10px] sm:tracking-widest">Hit rate</div>
          <div className="mt-1 font-mono text-lg font-semibold tabular-nums leading-none text-signal-petrol sm:text-3xl">{animatedWinRate.toFixed(1)}%</div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full border border-signal-line/50 bg-signal-fog">
            <div
              className={`h-full rounded-full bg-gradient-to-r from-signal-petrol via-signal-sage to-signal-mint transition-all duration-700 motion-reduce:animate-none ${isWinRatePulsing ? "animate-pulse-soft" : ""}`}
              style={{ width: `${Math.max(0, Math.min(100, stats.winRate))}%` }}
            />
          </div>
        </div>
      </div>
      {pendingHistoryCount > 0 && (
        <div className="relative mt-3 space-y-1 rounded-xl border border-signal-amber/30 bg-amber-50/80 px-3 py-2 text-center text-[9px] font-medium leading-snug text-signal-amber sm:text-[10px]">
          <div className="font-semibold uppercase tracking-wide">În istoric: {pendingHistoryCount} meciuri fără rezultat validat (FT)</div>
          {displayedPredsCount > 0 && (
            <div className="normal-case text-signal-inkMuted">
              Din lista curentă ({displayedPredsCount} predicții): {pendingAmongDisplayedPreds} încă pending
              {pendingHistoryCount > pendingAmongDisplayedPreds
                ? ` · altele ${pendingHistoryCount - pendingAmongDisplayedPreds} din alte zile`
                : ""}
              .
            </div>
          )}
        </div>
      )}
      {isHistorySyncing && (
        <div className="relative mt-2 text-center font-mono text-[10px] font-semibold uppercase tracking-widest text-signal-sage">Sync…</div>
      )}
      {onBreakdownClick && (
        <div className="relative mt-2 text-center text-[9px] font-medium text-signal-inkMuted">Detalii pe ligă și utilizator în consolă</div>
      )}
    </>
  );

  const shellClass =
    "relative mt-4 w-full max-w-[820px] overflow-hidden rounded-3xl border border-signal-line/80 bg-gradient-to-br from-white/75 via-signal-mist to-signal-fog/90 px-3 py-4 shadow-atelierLg sm:px-6 sm:py-5";

  if (onBreakdownClick) {
    return (
      <button
        type="button"
        onClick={onBreakdownClick}
        className={`${shellClass} w-full cursor-pointer touch-manipulation text-left outline-none transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-atelierLg motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:ring-2 focus-visible:ring-signal-petrol/35 focus-visible:ring-offset-2 focus-visible:ring-offset-signal-mist active:translate-y-0`}
      >
        {inner}
      </button>
    );
  }

  return <div className={shellClass}>{inner}</div>;
}
