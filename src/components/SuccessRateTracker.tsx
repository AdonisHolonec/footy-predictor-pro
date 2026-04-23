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
      <div className="pointer-events-none absolute inset-0 opacity-[0.22]">
        <div
          className="absolute inset-0 bg-[linear-gradient(rgba(56,189,248,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,0.05)_1px,transparent_1px)]"
          style={{ backgroundSize: "28px 28px" }}
        />
      </div>
      <div className="pointer-events-none absolute -right-12 top-0 h-40 w-40 rounded-full bg-signal-petrol/8 blur-3xl" />
      <div className="relative mb-5 flex flex-col gap-2 border-b border-white/[0.06] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-signal-petrol/75">Performance</div>
          <div className="font-display text-xl font-semibold tracking-tight text-signal-ink sm:text-2xl">Performance Counter Pro</div>
        </div>
        <div className="font-mono text-[10px] tabular-nums text-signal-inkMuted">n = {stats.settled} settled</div>
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
      <div className="relative grid grid-cols-3 gap-2 sm:gap-4">
        <div className="min-w-0 rounded-2xl border border-signal-sage/22 bg-signal-sage/5 px-2 py-3 shadow-inner sm:px-4">
          <div className="truncate text-[8px] font-semibold uppercase tracking-wide text-signal-sage sm:text-[10px]">Wins</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums leading-none text-signal-sage sm:text-3xl">{animatedWins}</div>
        </div>
        <div className="min-w-0 rounded-2xl border border-signal-rose/22 bg-signal-rose/5 px-2 py-3 shadow-inner sm:px-4">
          <div className="truncate text-[8px] font-semibold uppercase tracking-wide text-signal-rose sm:text-[10px]">Losses</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums leading-none text-signal-rose sm:text-3xl">{animatedLosses}</div>
        </div>
        <div
          className={`min-w-0 rounded-2xl border border-signal-petrol/28 bg-signal-void/45 px-2 py-3 shadow-inner transition-all duration-500 sm:px-4 ${
            isWinRatePulsing ? "shadow-frost ring-1 ring-signal-petrol/18" : ""
          }`}
        >
          <div className="truncate text-[8px] font-semibold uppercase tracking-wide text-signal-petrol/80 sm:text-[10px]">Hit rate</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums leading-none text-signal-petrol sm:text-3xl">{animatedWinRate.toFixed(1)}%</div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-signal-mist ring-1 ring-white/5">
            <div
              className={`h-full rounded-full bg-gradient-to-r from-signal-petrol via-signal-sage to-signal-mint transition-all duration-700 motion-reduce:animate-none ${isWinRatePulsing ? "animate-pulse-soft" : ""}`}
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
    "relative mt-2 w-full max-w-[880px] overflow-hidden rounded-3xl border border-white/[0.07] bg-gradient-to-br from-signal-panel/88 via-signal-mist/94 to-signal-void/90 px-4 py-5 shadow-atelier backdrop-blur-xl sm:px-8 sm:py-6";

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
