import { useMemo, useState } from "react";
import type { HistoryEntry } from "../../types";
import EmptyState from "../../design-system/EmptyState";
import SegmentedControl from "../../design-system/SegmentedControl";
import Button from "../../design-system/Button";
import IconButton from "../../design-system/IconButton";
import { useLocale } from "../../context/LocaleContext";
import MatchList from "./MatchList";
import MatchListRow from "./MatchListRow";
import { historyStatsFromRows } from "../../utils/historyStats";
import { kickoffLocalDateKey, localCalendarDateKey } from "../../utils/appUtils";

/**
 * Results (UX-E) — "what happened to my predictions?"
 *
 * A record, read top to bottom in one rhythm:
 *
 *   1. DATE     — the primary interaction. Previous / next around a large day
 *                 label, "Today" to jump back. Stronger than anything below.
 *   2. SUMMARY  — one strip, ≤56px: settled · won · lost · rate, pending aside.
 *                 The existing `historyStatsFromRows`; never repeated on the page.
 *   3. FILTER   — one scrolling row, ≤48px, only the statuses settlement emits.
 *   4. LIST     — the day's rows in the UX-A grammar (MatchListRow), dominant.
 *   5. SECONDARY — ticket results live in Tickets; one quiet link down.
 *
 * Not here, on purpose: the performance tracker (Performance), KPI cards,
 * charts, the ticket history (Tickets), the inline ticket builder (Match
 * Detail), and the old silent 80-row cap — a day is a day.
 */

type OutcomeFilter = "all" | "win" | "loss" | "pending" | "push" | "half_win" | "half_loss";
/** The statuses the settlement model actually emits for a per-match pick (no "void" exists here). */
const OUTCOME_FILTERS: { id: OutcomeFilter; key: string }[] = [
  { id: "all", key: "dash.filterAll" },
  { id: "win", key: "history.win" },
  { id: "loss", key: "history.loss" },
  { id: "pending", key: "history.pendingBadge" },
  { id: "push", key: "history.outcomePush" },
  { id: "half_win", key: "history.outcomeHalfWin" },
  { id: "half_loss", key: "history.outcomeHalfLoss" }
];

type Props = {
  history: HistoryEntry[];
  /** Open full match analysis (MatchModal) — where the per-match ticket builder lives. */
  onOpenMatch?: (row: HistoryEntry) => void;
  /** Opens the Tickets destination, where accumulator results live. */
  onGoTickets?: () => void;
  /** Injected for tests; defaults to the local calendar day. */
  today?: string;
};

function shiftDay(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localCalendarDateKey(new Date(y, m - 1, d + delta));
}

/** Kick-off as a comparable instant; unparseable values sort last, deterministically. */
function kickoffMs(kickoff?: string | null): number {
  const ms = Date.parse(String(kickoff || ""));
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

function rowKey(row: HistoryEntry): string {
  return String(row.id ?? `${row.teams?.home}-${row.teams?.away}-${row.kickoff}`);
}

/** One fact of the summary strip: a figure with its quiet label underneath. */
function Figure({ value, label, tone = "text" }: { value: string; label: string; tone?: "text" | "success" | "danger" | "accent" }) {
  const toneClass = {
    text: "text-[var(--fp-text)]",
    success: "text-[var(--fp-success)]",
    danger: "text-[var(--fp-danger)]",
    accent: "text-[var(--fp-accent)]"
  }[tone];
  return (
    <div className="min-w-0">
      <p className={`font-display text-lg font-bold leading-none tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">{label}</p>
    </div>
  );
}

export default function HistorySection({ history, onOpenMatch, onGoTickets, today = localCalendarDateKey() }: Props) {
  const { t, locale } = useLocale();
  const [day, setDay] = useState(today);
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");

  /** Every day that has at least one row — bounds the navigation to real data. */
  const days = useMemo(() => {
    const set = new Set<string>();
    for (const row of history) set.add(kickoffLocalDateKey(row.kickoff));
    return [...set].sort();
  }, [history]);
  const earliest = days[0] ?? today;
  const canGoBack = day > earliest;
  const canGoForward = day < today;

  const dayRows = useMemo(
    () =>
      history
        .filter((row) => kickoffLocalDateKey(row.kickoff) === day)
        // Earliest kick-off first, top to bottom, on the normalised instant —
        // never on a formatted or localised string. Array.prototype.sort is
        // stable, so equal kick-offs keep their incoming order.
        .sort((a, b) => kickoffMs(a.kickoff) - kickoffMs(b.kickoff)),
    [history, day]
  );
  const summary = useMemo(() => historyStatsFromRows(dayRows), [dayRows]);
  const pendingCount = useMemo(() => dayRows.filter((row) => row.validation === "pending").length, [dayRows]);
  const rows = useMemo(
    () => (outcome === "all" ? dayRows : dayRows.filter((row) => String(row.validation || "") === outcome)),
    [dayRows, outcome]
  );

  const [weekday, dateLabel] = useMemo(() => {
    const [y, m, d] = day.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const tag = locale === "ro" ? "ro-RO" : "en-GB";
    return [
      new Intl.DateTimeFormat(tag, { weekday: "long" }).format(date),
      new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" }).format(date)
    ];
  }, [day, locale]);
  const relative =
    day === today ? t("history.dayToday") : day === shiftDay(today, -1) ? t("history.dayYesterday") : null;

  return (
    <section className="space-y-3" data-surface="results">
      <h1 className="sr-only">{t("nav.results")}</h1>

      {/* 1 · DATE — the primary interaction; stronger than every control below. */}
      <nav
        aria-label={t("history.dayNav")}
        className="flex items-center justify-between gap-2 rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-2 py-2 shadow-fp-sm"
        data-testid="results-day-nav"
      >
        <IconButton onClick={() => setDay(shiftDay(day, -1))} disabled={!canGoBack} aria-label={t("history.dayPrev")}>
          ‹
        </IconButton>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate font-display text-lg font-bold leading-tight text-[var(--fp-text)]" aria-current="date" data-testid="results-day-label">
            <span className="capitalize">{weekday}</span>, {dateLabel}
          </p>
          <p className="mt-0.5 flex items-center justify-center gap-2 text-xs text-[var(--fp-text-muted)]">
            {relative ? (
              <span className="font-semibold uppercase tracking-wide text-[var(--fp-accent)]">{relative}</span>
            ) : (
              <button
                type="button"
                onClick={() => setDay(today)}
                className="font-semibold uppercase tracking-wide text-[var(--fp-accent)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
                data-testid="results-day-today"
              >
                {t("history.dayToday")}
              </button>
            )}
          </p>
        </div>
        <IconButton onClick={() => setDay(shiftDay(day, 1))} disabled={!canGoForward} aria-label={t("history.dayNext")}>
          ›
        </IconButton>
      </nav>

      {/* 2 · SUMMARY — one strip, the tracker's own denominator, never repeated below. */}
      {summary.settled + pendingCount > 0 && (
        <div
          className="flex items-center gap-4 px-1 sm:gap-6"
          data-testid="results-summary"
          aria-label={t("history.daySummary", {
            settled: summary.settled,
            won: summary.wins,
            lost: summary.losses,
            rate: summary.settled ? summary.winRate.toFixed(0) : "—"
          })}
        >
          <Figure value={String(summary.settled)} label={t("history.sumSettled")} />
          <Figure value={String(summary.wins)} label={t("history.win")} tone="success" />
          <Figure value={String(summary.losses)} label={t("history.loss")} tone="danger" />
          <Figure value={summary.settled ? `${summary.winRate.toFixed(0)}%` : "—"} label={t("history.sumRate")} tone="accent" />
          {pendingCount > 0 && (
            <p className="ml-auto shrink-0 text-xs text-[var(--fp-text-muted)]" data-testid="results-pending">
              {t("history.dayPending", { n: pendingCount })}
            </p>
          )}
        </div>
      )}

      {/* 3 · FILTER — one row that scrolls, never wraps into a second row on a phone. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" data-testid="results-controls">
        <SegmentedControl
          mode="toggle"
          className="w-max"
          options={OUTCOME_FILTERS.map(({ id, key }) => ({
            value: id,
            label: t(key),
            title: t("dash.filterTitle", { label: t(key) })
          }))}
          value={outcome}
          onChange={(next) => setOutcome(next as OutcomeFilter)}
        />
      </div>

      {/* 4 · LIST — dominant. */}
      {!rows.length ? (
        <EmptyState
          title={dayRows.length ? t("history.emptyFilteredTitle") : t("history.emptyDayTitle")}
          description={dayRows.length ? t("history.emptyFilteredDesc") : t("history.emptyDayDesc")}
          actionLabel={outcome !== "all" ? t("dash.showAll") : canGoBack ? t("history.dayPrev") : undefined}
          onAction={outcome !== "all" ? () => setOutcome("all") : canGoBack ? () => setDay(shiftDay(day, -1)) : undefined}
        />
      ) : (
        <MatchList label={`${t("nav.results")} · ${weekday} ${dateLabel}`}>
          {rows.map((row) => (
            <MatchListRow
              key={rowKey(row)}
              row={row}
              marketValidations={row.cardMarketValidations ?? { recommended: row.validation }}
              onOpen={() => onOpenMatch?.(row)}
            />
          ))}
        </MatchList>
      )}

      {/* 5 · SECONDARY — accumulators are a different product; one link, after the record. */}
      {onGoTickets && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={onGoTickets} data-testid="results-tickets-link">
            {t("history.ticketResults")} ›
          </Button>
        </div>
      )}
    </section>
  );
}
