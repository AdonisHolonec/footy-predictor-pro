import { useMemo } from "react";
import type { HistoryEntry } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import { computeLastNDaysAccuracy } from "../../utils/historyStats";

type Props = {
  history: HistoryEntry[];
  days?: number;
};

/**
 * The last N days as one compact bar per day — the trend under the dominant
 * hit rate on Performance (UX-E). Same `computeLastNDaysAccuracy` rows the
 * old 7-day table printed; a bar's height is that day's hit rate, its width
 * is the same for every day, and a day with nothing settled is an empty slot
 * with a dash rather than a 0% bar pretending to be a measurement.
 *
 * Decorative colour is never the only signal: each bar carries the day's
 * figure as text and the whole strip is a described list.
 */
export default function PerformanceTrend({ history, days = 7 }: Props) {
  const { t, locale } = useLocale();
  const rows = useMemo(() => computeLastNDaysAccuracy(history, days), [history, days]);
  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { weekday: "short" }),
    [locale]
  );
  if (!rows.some((r) => r.settled > 0)) return null;

  return (
    <div data-testid="performance-trend">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">
        {t("perf.trendTitle", { n: days })}
      </p>
      <ol className="mt-2 grid grid-cols-7 gap-1.5" aria-label={t("perf.trendTitle", { n: days })}>
        {rows.map((day) => {
          const rate = day.settled ? Math.round(day.winRate) : null;
          return (
            <li key={day.date} className="flex flex-col items-center gap-1 text-center">
              <span className="font-mono text-[10px] tabular-nums text-[var(--fp-text)]">{rate == null ? "—" : `${rate}%`}</span>
              <span className="flex h-10 w-full items-end overflow-hidden rounded-[var(--fp-radius-sm)] bg-[var(--fp-bg-muted)]" aria-hidden>
                {rate != null && (
                  <span
                    className={`block w-full rounded-[var(--fp-radius-sm)] ${rate >= 50 ? "bg-[var(--fp-accent)]" : "bg-[var(--fp-danger)]"}`}
                    style={{ height: `${Math.max(6, rate)}%` }}
                  />
                )}
              </span>
              <span className="text-[10px] capitalize text-[var(--fp-text-muted)]">{dayFormatter.format(new Date(`${day.date}T12:00:00`))}</span>
              <span className="sr-only">
                {day.settled ? `${day.wins}/${day.settled}` : t("perf.trendNone")}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
