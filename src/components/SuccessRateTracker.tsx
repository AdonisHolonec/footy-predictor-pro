import { HistoryStats } from "../types";

export type ModelHealthSummary = {
  /** Brier 1X2 (0..1, lower=better). */
  brier: number | null;
  /** Log-loss 1X2 (lower=better). */
  logLoss: number | null;
  /** Expected Calibration Error în puncte procentuale (lower=better). */
  ece: number | null;
};

type ExcludedLossDay = {
  day: string;
  losses: number;
  settled: number;
};

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
  /** Sănătatea modelului pe ultimele N zile (opţional — apare doar dacă admin/debug). */
  modelHealth?: ModelHealthSummary | null;
  excludedWorstLossDaysCount?: number;
  onExcludedWorstLossDaysCountChange?: (count: number) => void;
  excludedLossDays?: ExcludedLossDay[];
};

function healthToneClass(value: number | null, good: number, warn: number, higherIsBetter = false) {
  if (value == null || !Number.isFinite(value)) return "text-signal-inkMuted";
  const v = value;
  if (higherIsBetter) {
    if (v >= good) return "text-signal-sage";
    if (v >= warn) return "text-signal-amber";
    return "text-signal-rose";
  }
  if (v <= good) return "text-signal-sage";
  if (v <= warn) return "text-signal-amber";
  return "text-signal-rose";
}

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
  onBreakdownClick,
  modelHealth = null,
  excludedWorstLossDaysCount = 0,
  onExcludedWorstLossDaysCountChange,
  excludedLossDays = []
}: SuccessRateTrackerProps) {
  const inner = (
    <>
      <div className="relative mb-4 flex flex-col gap-1.5 border-b border-white/[0.06] pb-3.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="lab-section-eyebrow">Performance</div>
          <div className="font-display text-lg font-semibold tracking-tight text-signal-ink sm:text-xl">Success Rate</div>
        </div>
        <div className="font-sans text-[11px] tabular-nums text-signal-inkMuted">n = {stats.settled} settled</div>
      </div>
      {(onExcludedWorstLossDaysCountChange || excludedWorstLossDaysCount > 0) && (
        <div className="relative mb-4 rounded-xl border border-white/[0.08] bg-signal-void/35 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-signal-inkMuted">Window optimizer</div>
            {onExcludedWorstLossDaysCountChange && (
              <div className="inline-flex rounded-lg border border-white/[0.1] bg-signal-panel/60 p-0.5">
                {[0, 1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onExcludedWorstLossDaysCountChange(n)}
                    className={`rounded-md px-2 py-1 font-mono text-[9px] font-semibold transition-colors ${
                      excludedWorstLossDaysCount === n ? "bg-signal-petrol/30 text-signal-ink" : "text-signal-inkMuted hover:text-signal-ink"
                    }`}
                  >
                    -{n} zi
                  </button>
                ))}
              </div>
            )}
          </div>
          {excludedWorstLossDaysCount > 0 && (
            <div className="mt-1.5 text-[10px] text-signal-inkMuted">
              Excluse din counter: <span className="font-mono text-signal-ink">{excludedWorstLossDaysCount}</span> zile cu cele mai multe pierderi.
            </div>
          )}
          {excludedLossDays.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {excludedLossDays.slice(0, 3).map((d) => (
                <span key={d.day} className="rounded-full border border-signal-rose/30 bg-signal-rose/10 px-2 py-0.5 font-mono text-[9px] text-signal-rose">
                  {d.day} · L{d.losses}/{d.settled}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="relative grid grid-cols-3 gap-2 sm:gap-3">
        <div className="lab-stat min-w-0 border-signal-sage/25 bg-signal-sage/[0.07] px-2 py-2.5 sm:px-3.5 sm:py-3">
          <div className="lab-stat-label truncate text-signal-sage">Wins</div>
          <div className="lab-stat-value text-signal-sage">{animatedWins}</div>
        </div>
        <div className="lab-stat min-w-0 border-signal-rose/25 bg-signal-rose/[0.07] px-2 py-2.5 sm:px-3.5 sm:py-3">
          <div className="lab-stat-label truncate text-signal-rose">Losses</div>
          <div className="lab-stat-value text-signal-rose">{animatedLosses}</div>
        </div>
        <div
          className={`lab-stat min-w-0 border-signal-petrol/30 bg-signal-void/50 px-2 py-2.5 transition-shadow duration-500 sm:px-3.5 sm:py-3 ${
            isWinRatePulsing ? "shadow-frost ring-1 ring-signal-petrol/20" : ""
          }`}
        >
          <div className="lab-stat-label truncate text-signal-petrol/90">Hit rate</div>
          <div className="lab-stat-value text-signal-petrol">{animatedWinRate.toFixed(1)}%</div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-signal-mist/80">
            <div
              className={`h-full rounded-full bg-gradient-to-r from-signal-petrol to-signal-sage transition-all duration-700 motion-reduce:animate-none ${isWinRatePulsing ? "animate-pulse-soft" : ""}`}
              style={{ width: `${Math.max(0, Math.min(100, stats.winRate))}%` }}
            />
          </div>
        </div>
      </div>
      {modelHealth && (modelHealth.brier != null || modelHealth.logLoss != null || modelHealth.ece != null) && (
        <div className="relative mt-4 grid grid-cols-3 gap-2 rounded-xl border border-white/[0.06] bg-signal-void/40 px-2 py-2 font-mono text-[9px] text-signal-inkMuted sm:text-[10px]">
          <div className="flex flex-col items-center">
            <span className="text-[8px] uppercase tracking-wider">Brier 1X2</span>
            <span className={`mt-0.5 font-semibold tabular-nums ${healthToneClass(modelHealth.brier, 0.185, 0.205)}`}>
              {modelHealth.brier != null ? modelHealth.brier.toFixed(3) : "—"}
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[8px] uppercase tracking-wider">LogLoss</span>
            <span className={`mt-0.5 font-semibold tabular-nums ${healthToneClass(modelHealth.logLoss, 0.98, 1.05)}`}>
              {modelHealth.logLoss != null ? modelHealth.logLoss.toFixed(3) : "—"}
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[8px] uppercase tracking-wider">ECE</span>
            <span className={`mt-0.5 font-semibold tabular-nums ${healthToneClass(modelHealth.ece, 3, 6)}`}>
              {modelHealth.ece != null ? `${modelHealth.ece.toFixed(1)}%` : "—"}
            </span>
          </div>
        </div>
      )}
      {pendingHistoryCount > 0 && (
        <div className="relative mt-4 rounded-xl border border-signal-amber/22 bg-signal-amber/5 px-3 py-2 text-center text-[9px] font-medium leading-snug text-signal-amber sm:text-[10px]">
          {pendingHistoryCount} meciuri fără rezultat FT în istoric
          {displayedPredsCount > 0 && (
            <span className="block text-signal-inkMuted">
              În lista curentă: {pendingAmongDisplayedPreds}
              {pendingHistoryCount > pendingAmongDisplayedPreds ? ` · +${pendingHistoryCount - pendingAmongDisplayedPreds} alte zile` : ""}
            </span>
          )}
        </div>
      )}
      {isHistorySyncing && (
        <div className="relative mt-2 text-center font-mono text-[10px] font-semibold uppercase tracking-widest text-signal-petrol">Sync…</div>
      )}
      {onBreakdownClick && (
        <div className="relative mt-3 text-center font-mono text-[9px] text-signal-inkMuted">Consolă detaliată · click</div>
      )}
    </>
  );

  const shellClass =
    "lab-card relative mt-2 w-full max-w-[880px] overflow-hidden px-3.5 py-4 sm:px-6 sm:py-5";

  if (onBreakdownClick) {
    return (
      <button
        type="button"
        onClick={onBreakdownClick}
        className={`${shellClass} w-full cursor-pointer touch-manipulation text-left outline-none hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 focus-visible:ring-2 focus-visible:ring-signal-petrol/40 focus-visible:ring-offset-2 focus-visible:ring-offset-signal-mist`}
      >
        {inner}
      </button>
    );
  }

  return <div className={shellClass}>{inner}</div>;
}
