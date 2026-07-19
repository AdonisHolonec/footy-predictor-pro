import { HistoryStats } from "../types";

export type ModelHealthSummary = {
  brier: number | null;
  logLoss: number | null;
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
  modelHealth?: ModelHealthSummary | null;
  excludedWorstLossDaysCount?: number;
  onExcludedWorstLossDaysCountChange?: (count: number) => void;
  excludedLossDays?: ExcludedLossDay[];
};

function healthToneClass(value: number | null, good: number, warn: number) {
  if (value == null || !Number.isFinite(value)) return "text-[var(--fp-text-muted)]";
  if (value <= good) return "text-[var(--fp-success)]";
  if (value <= warn) return "text-[var(--fp-warning)]";
  return "text-[var(--fp-danger)]";
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
      <div className="mb-4 flex flex-col gap-1 border-b border-[var(--fp-border)] pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--fp-accent)]">Performance</p>
          <h3 className="font-display text-lg font-semibold text-[var(--fp-text)] sm:text-xl">Success Rate</h3>
        </div>
        <p className="text-sm font-medium tabular-nums text-[var(--fp-text-muted)]">n = {stats.settled} settled</p>
      </div>

      {(onExcludedWorstLossDaysCountChange || excludedWorstLossDaysCount > 0) && (
        <div className="mb-4 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">Window optimizer</p>
            {onExcludedWorstLossDaysCountChange && (
              <div className="inline-flex rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-0.5">
                {[0, 1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    title={`Exclude worst ${n} day(s)`}
                    onClick={() => onExcludedWorstLossDaysCountChange(n)}
                    className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
                      excludedWorstLossDaysCount === n
                        ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                        : "text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
                    }`}
                  >
                    -{n} day
                  </button>
                ))}
              </div>
            )}
          </div>
          {excludedWorstLossDaysCount > 0 && (
            <p className="mt-1.5 text-xs text-[var(--fp-text-muted)]">
              Excluded from counter: {excludedWorstLossDaysCount} worst loss day(s).
            </p>
          )}
          {excludedLossDays.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {excludedLossDays.slice(0, 3).map((d) => (
                <span
                  key={d.day}
                  className="rounded-full border border-[var(--fp-danger)]/30 bg-[var(--fp-danger)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--fp-danger)]"
                >
                  {d.day} · L{d.losses}/{d.settled}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-success)]/35 bg-[var(--fp-success)]/10 px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-success)]">Wins</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-[var(--fp-text)]">{animatedWins}</p>
        </div>
        <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-danger)]/35 bg-[var(--fp-danger)]/10 px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-danger)]">Losses</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-[var(--fp-text)]">{animatedLosses}</p>
        </div>
        <div
          className={`rounded-[var(--fp-radius-sm)] border border-[var(--fp-accent)]/35 bg-[var(--fp-accent-muted)] px-3 py-3 ${
            isWinRatePulsing ? "ring-2 ring-[var(--fp-accent)]/30" : ""
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-accent)]">Hit rate</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-[var(--fp-text)]">
            {animatedWinRate.toFixed(1)}%
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--fp-bg-card)]">
            <div
              className="h-full rounded-full bg-[var(--fp-accent)] transition-all duration-700"
              style={{ width: `${Math.max(0, Math.min(100, stats.winRate))}%` }}
            />
          </div>
        </div>
      </div>

      {modelHealth && (modelHealth.brier != null || modelHealth.logLoss != null || modelHealth.ece != null) && (
        <div className="mt-4 grid grid-cols-3 gap-2 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2 py-2 text-xs">
          <div className="flex flex-col items-center">
            <span className="font-semibold uppercase text-[var(--fp-text-muted)]">Brier</span>
            <span className={`mt-0.5 font-bold tabular-nums ${healthToneClass(modelHealth.brier, 0.185, 0.205)}`}>
              {modelHealth.brier != null ? modelHealth.brier.toFixed(3) : "—"}
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-semibold uppercase text-[var(--fp-text-muted)]">LogLoss</span>
            <span className={`mt-0.5 font-bold tabular-nums ${healthToneClass(modelHealth.logLoss, 0.98, 1.05)}`}>
              {modelHealth.logLoss != null ? modelHealth.logLoss.toFixed(3) : "—"}
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-semibold uppercase text-[var(--fp-text-muted)]">ECE</span>
            <span className={`mt-0.5 font-bold tabular-nums ${healthToneClass(modelHealth.ece, 3, 6)}`}>
              {modelHealth.ece != null ? `${modelHealth.ece.toFixed(1)}%` : "—"}
            </span>
          </div>
        </div>
      )}

      {pendingHistoryCount > 0 && (
        <div className="mt-4 rounded-[var(--fp-radius-sm)] border border-[var(--fp-warning)]/30 bg-[var(--fp-warning)]/10 px-3 py-2 text-center text-xs font-medium text-[var(--fp-text)]">
          {pendingHistoryCount} matches without FT result
          {displayedPredsCount > 0 && (
            <span className="mt-0.5 block text-[var(--fp-text-muted)]">
              In current list: {pendingAmongDisplayedPreds}
              {pendingHistoryCount > pendingAmongDisplayedPreds
                ? ` · +${pendingHistoryCount - pendingAmongDisplayedPreds} other days`
                : ""}
            </span>
          )}
        </div>
      )}
      {isHistorySyncing && (
        <p className="mt-2 text-center text-xs font-bold uppercase tracking-wider text-[var(--fp-accent)]">Sync…</p>
      )}
      {onBreakdownClick && (
        <p className="mt-3 text-center text-xs font-semibold text-[var(--fp-accent)]">Open detailed console · click</p>
      )}
    </>
  );

  const shellClass =
    "relative mt-2 w-full max-w-[880px] overflow-hidden rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-4 py-4 shadow-[var(--fp-shadow-sm)] sm:px-6 sm:py-5";

  if (onBreakdownClick) {
    return (
      <button
        type="button"
        title="Open detailed performance console"
        onClick={onBreakdownClick}
        className={`${shellClass} cursor-pointer text-left transition-[box-shadow,transform] duration-[var(--fp-ease)] hover:-translate-y-0.5 hover:shadow-[var(--fp-shadow)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]`}
      >
        {inner}
      </button>
    );
  }

  return <div className={shellClass}>{inner}</div>;
}
