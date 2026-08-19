import { useLocale } from "../context/LocaleContext";
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
  const { t } = useLocale();
  const inner = (
    <>
      <div className="mb-3 flex flex-col gap-0.5 border-b border-[var(--fp-border)] pb-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--fp-accent)]">{t("tracker.performance")}</p>
          <h3 className="font-display text-base font-semibold text-[var(--fp-text)] sm:text-lg">{t("tracker.successRate")}</h3>
        </div>
        <p className="text-sm font-medium tabular-nums text-[var(--fp-text-muted)]">{t("tracker.settledN", { n: stats.settled })}</p>
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
                  className="rounded-full border border-fp-danger/30 bg-fp-danger/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--fp-danger)]"
                >
                  {d.day} · L{d.losses}/{d.settled}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
        <div className="rounded-[var(--fp-radius-sm)] border border-fp-success/35 bg-fp-success/10 px-2 py-3 sm:px-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-success)] sm:text-[10px]">{t("tracker.wins")}</p>
          <p className="mt-1 font-display text-xl font-bold tabular-nums text-[var(--fp-text)] sm:text-2xl">{animatedWins}</p>
        </div>
        <div className="rounded-[var(--fp-radius-sm)] border border-fp-danger/35 bg-fp-danger/10 px-2 py-3 sm:px-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-danger)] sm:text-[10px]">{t("tracker.losses")}</p>
          <p className="mt-1 font-display text-xl font-bold tabular-nums text-[var(--fp-text)] sm:text-2xl">{animatedLosses}</p>
        </div>
        <div
          className={`rounded-[var(--fp-radius-sm)] border border-fp-accent/35 bg-[var(--fp-accent-muted)] px-2 py-3 sm:px-3 ${
            isWinRatePulsing ? "ring-2 ring-fp-accent/30" : ""
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-accent)] sm:text-[10px]">{t("tracker.hitRate")}</p>
          {/*
            A rate needs a denominator. `historyStatsFromRows` falls back to
            `winRate: 0` when nothing has settled, which is a placeholder, not a
            measurement — printed as "0.0%" it claims the user lost everything
            they ever ran. The counts either side stay: with no settled results
            you really do have zero wins and zero losses, and a count of nothing
            IS zero. Only the ratio is undefined.

            `stats.settled > 0` is the same test the history tables use, so a
            genuine 0 wins / 3 losses still reads 0.0% here as it does there.
          */}
          <p className="mt-1 font-display text-xl font-bold tabular-nums text-[var(--fp-text)] sm:text-2xl">
            {stats.settled > 0 ? `${animatedWinRate.toFixed(1)}%` : "—"}
          </p>
          {stats.settled > 0 && (
            /* An empty track is a filled bar's way of saying "0%", so it goes
               with the number rather than sitting there at scaleX(0). */
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--fp-bg-card)]">
              <div
                className="h-full w-full origin-left rounded-full bg-[var(--fp-accent)] transition-transform duration-700"
                style={{ transform: `scaleX(${Math.max(0, Math.min(100, stats.winRate)) / 100})` }}
              />
            </div>
          )}
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
        <div className="mt-4 rounded-[var(--fp-radius-sm)] border border-fp-warning/30 bg-fp-warning/10 px-3 py-2 text-center text-xs font-medium text-[var(--fp-text)]">
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
        <p className="mt-2 text-center text-xs font-bold uppercase tracking-wider text-[var(--fp-accent)]">{t("tracker.sync")}</p>
      )}
      {onBreakdownClick && (
        <p className="mt-2 text-center text-xs font-semibold text-[var(--fp-accent)]">{t("tracker.openConsole")}</p>
      )}
    </>
  );

  const shellClass =
    "relative mt-2 w-full max-w-[880px] overflow-hidden rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-3 py-3 shadow-fp-sm sm:px-4 sm:py-4";

  if (onBreakdownClick) {
    return (
      <button
        type="button"
        title={t("tracker.openConsole")}
        onClick={onBreakdownClick}
        className={`${shellClass} cursor-pointer text-left transition-[box-shadow,transform] duration-[var(--fp-ease)] hover:-translate-y-0.5 hover:shadow-fp focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]`}
      >
        {inner}
      </button>
    );
  }

  return <div className={shellClass}>{inner}</div>;
}
