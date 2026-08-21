import { useMemo, useState } from "react";
import type { HistoryEntry } from "../../types";
import EmptyState from "../../design-system/EmptyState";
import SectionHeader from "../../design-system/SectionHeader";
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
 *   1. the selected day, with previous / next / today navigation
 *   2. a one-line outcome summary for that day (the existing
 *      `historyStatsFromRows` — the same denominator the tracker uses)
 *   3. the day's rows, in the list grammar (MatchListRow), newest first
 *   4. a compact entry to ticket results (Tickets owns ticket history)
 *
 * Not here, on purpose: the performance tracker (Performance), the ticket
 * history (Tickets), the inline per-match ticket builder (Match Detail), and
 * the old silent 80-row cap — a day is a day.
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

function rowKey(row: HistoryEntry): string {
  return String(row.id ?? `${row.teams?.home}-${row.teams?.away}-${row.kickoff}`);
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
        .sort((a, b) => String(b.kickoff || "").localeCompare(String(a.kickoff || ""))),
    [history, day]
  );
  const summary = useMemo(() => historyStatsFromRows(dayRows), [dayRows]);
  const pendingCount = useMemo(() => dayRows.filter((row) => row.validation === "pending").length, [dayRows]);
  const rows = useMemo(
    () => (outcome === "all" ? dayRows : dayRows.filter((row) => String(row.validation || "") === outcome)),
    [dayRows, outcome]
  );

  const dayLabel = useMemo(() => {
    const [y, m, d] = day.split("-").map(Number);
    return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-US", {
      weekday: "long",
      day: "numeric",
      month: "long"
    }).format(new Date(y, m - 1, d));
  }, [day, locale]);
  const relative =
    day === today ? t("history.dayToday") : day === shiftDay(today, -1) ? t("history.dayYesterday") : null;

  return (
    <section className="space-y-4">
      <header>
        <SectionHeader as="h1" size="page" eyebrow={t("nav.results")} title={t("nav.results")} description={t("history.sub")} />
      </header>

      {/* 1 · the day */}
      <nav aria-label={t("history.dayNav")} className="flex items-center gap-2" data-testid="results-day-nav">
        <IconButton size="sm" onClick={() => setDay(shiftDay(day, -1))} disabled={!canGoBack} aria-label={t("history.dayPrev")}>
          ‹
        </IconButton>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--fp-text)]" aria-current="date" data-testid="results-day-label">
            {dayLabel}
            {relative && <span className="ml-1.5 font-normal text-[var(--fp-text-muted)]">· {relative}</span>}
          </p>
        </div>
        <IconButton size="sm" onClick={() => setDay(shiftDay(day, 1))} disabled={!canGoForward} aria-label={t("history.dayNext")}>
          ›
        </IconButton>
        {day !== today && (
          <Button size="sm" variant="ghost" onClick={() => setDay(today)}>
            {t("history.dayToday")}
          </Button>
        )}
      </nav>

      {/* 2 · the summary — one line, the tracker's own denominator, never repeated below */}
      {summary.settled + pendingCount > 0 && (
        <p className="font-mono text-xs text-[var(--fp-text-muted)]" data-testid="results-summary">
          {t("history.daySummary", {
            settled: summary.settled,
            won: summary.wins,
            lost: summary.losses,
            rate: summary.settled ? summary.winRate.toFixed(0) : "—"
          })}
          {pendingCount > 0 && <span> · {t("history.dayPending", { n: pendingCount })}</span>}
        </p>
      )}

      {/* filters + the ticket entry */}
      <div className="flex flex-wrap items-center gap-2" data-testid="results-controls">
        <SegmentedControl
          mode="toggle"
          options={OUTCOME_FILTERS.map(({ id, key }) => ({
            value: id,
            label: t(key),
            title: t("dash.filterTitle", { label: t(key) })
          }))}
          value={outcome}
          onChange={(next) => setOutcome(next as OutcomeFilter)}
        />
        {onGoTickets && (
          <Button size="sm" variant="ghost" onClick={onGoTickets} className="ml-auto" data-testid="results-tickets-link">
            {t("history.ticketResults")} ›
          </Button>
        )}
      </div>

      {/* 3 · the rows */}
      {!rows.length ? (
        <EmptyState
          title={dayRows.length ? t("history.emptyFilteredTitle") : t("history.emptyDayTitle")}
          description={dayRows.length ? t("history.emptyFilteredDesc") : t("history.emptyDayDesc")}
          actionLabel={outcome !== "all" ? t("dash.showAll") : canGoBack ? t("history.dayPrev") : undefined}
          onAction={outcome !== "all" ? () => setOutcome("all") : canGoBack ? () => setDay(shiftDay(day, -1)) : undefined}
        />
      ) : (
        <MatchList label={`${t("nav.results")} · ${dayLabel}`}>
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
    </section>
  );
}
