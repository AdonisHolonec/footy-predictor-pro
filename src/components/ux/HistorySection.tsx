import { useMemo, useState } from "react";
import type { HistoryEntry } from "../../types";
import EmptyState from "../../design-system/EmptyState";
import SectionHeader from "../../design-system/SectionHeader";
import StatusBadge from "../../design-system/StatusBadge";
import SegmentedControl from "../../design-system/SegmentedControl";
import Button from "../../design-system/Button";
import { useLocale } from "../../context/LocaleContext";
import HistorySpecialBetCard from "./HistorySpecialBetCard";
import { formatRecommendedPick } from "../../utils/formatRecommendation";

type OutcomeFilter = "all" | "won" | "lost" | "pending";
const OUTCOME_GROUPS: Record<Exclude<OutcomeFilter, "all">, string[]> = {
  won: ["win", "half_win"],
  lost: ["loss", "half_loss"],
  pending: ["pending"]
};

type Props = {
  history: HistoryEntry[];
  /** Open full match analysis (MatchModal). */
  onOpenMatch?: (row: HistoryEntry) => void;
  /** Special Bet is Ultra-only; fails closed (locked) when omitted. */
  canShowSpecialBet?: boolean;
  onUpgradeRequired?: (feature: string, requiredTier: "ultra") => void;
  /** Opens the Tickets destination, where accumulator results live now. */
  onGoTickets?: () => void;
};

function toneFor(v?: string): "success" | "danger" | "warning" | "neutral" {
  if (v === "win" || v === "half_win") return "success";
  if (v === "loss" || v === "half_loss") return "danger";
  if (v === "pending") return "warning";
  // push (stake returned) and anything unknown read as neutral.
  return "neutral";
}

function rowKey(row: HistoryEntry): string {
  return String(row.id ?? `${row.teams?.home}-${row.teams?.away}-${row.kickoff}`);
}

export default function HistorySection({
  history,
  onOpenMatch,
  canShowSpecialBet = false,
  onUpgradeRequired,
  onGoTickets
}: Props) {
  const { t, locale } = useLocale();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Outcome filter — session-local, like the Matches segment. */
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");

  const rows = useMemo(() => {
    const sorted = [...history].sort((a, b) => String(b.kickoff || "").localeCompare(String(a.kickoff || "")));
    if (outcome === "all") return sorted;
    return sorted.filter((row) => OUTCOME_GROUPS[outcome].includes(String(row.validation || "")));
  }, [history, outcome]);

  // Day groups: a header per calendar day, in the viewer's zone, newest first.
  const dayOf = (row: HistoryEntry) => {
    const d = new Date(String(row.kickoff || ""));
    return Number.isFinite(d.getTime())
      ? new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-US", { weekday: "long", day: "numeric", month: "long" }).format(d)
      : "—";
  };

  const labelFor = (v?: string) => {
    if (v === "win") return t("history.win");
    if (v === "loss") return t("history.loss");
    if (v === "pending") return t("history.pendingBadge");
    if (v === "push") return t("history.outcomePush");
    if (v === "half_win") return t("history.outcomeHalfWin");
    if (v === "half_loss") return t("history.outcomeHalfLoss");
    return String(v || "—").toUpperCase();
  };

  return (
    <section className="space-y-6">
      <header>
        <SectionHeader as="h1" size="page" eyebrow={t("nav.results")} title={t("nav.results")} description={t("history.sub")} />
      </header>

      {/* Results answers "what happened?" — the performance numbers live on
          Performance, accumulator results on Tickets. Here: an outcome filter
          and day-grouped rows. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="results-controls">
        <SegmentedControl
          mode="toggle"
          options={(
            [
              ["all", "dash.filterAll"],
              ["won", "history.win"],
              ["lost", "history.loss"],
              ["pending", "history.pendingBadge"]
            ] as const
          ).map(([id, key]) => ({ value: id, label: t(key), title: t("dash.filterTitle", { label: t(key) }) }))}
          value={outcome}
          onChange={(next) => setOutcome(next as OutcomeFilter)}
        />
        {onGoTickets && (
          <Button size="sm" variant="ghost" onClick={onGoTickets} className="ml-auto">
            {t("nav.tickets")} ›
          </Button>
        )}
      </div>

      {!rows.length ? (
        <EmptyState
          title={t("history.emptyTitle")}
          description={t("history.empty")}
          actionLabel={outcome !== "all" ? t("dash.showAll") : undefined}
          onAction={outcome !== "all" ? () => setOutcome("all") : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)]">
          {rows.slice(0, 80).map((row, idx, visibleRows) => {
            const id = rowKey(row);
            const active = selectedId === id;
            const isLast = idx === visibleRows.length - 1;
            const day = dayOf(row);
            const newDay = idx === 0 || dayOf(visibleRows[idx - 1]) !== day;
            return (
              <div key={id} className={!isLast || active ? "border-b border-[var(--fp-border)]" : ""}>
                {newDay && (
                  <h2
                    data-testid="results-day"
                    className="border-b border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]"
                  >
                    {day}
                  </h2>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedId(active ? null : id)}
                  aria-pressed={active}
                  className={`flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--fp-accent)] ${
                    active ? "bg-fp-success/5" : "hover:bg-[var(--fp-bg-muted)]"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {row.logos?.home || row.logos?.away ? (
                      <div className="flex shrink-0 items-center -space-x-1.5">
                        {row.logos?.home ? (
                          <img
                            src={row.logos.home}
                            alt=""
                            className="h-6 w-6 rounded-full bg-[var(--fp-bg-muted)] object-contain"
                          />
                        ) : null}
                        {row.logos?.away ? (
                          <img
                            src={row.logos.away}
                            alt=""
                            className="h-6 w-6 rounded-full bg-[var(--fp-bg-muted)] object-contain"
                          />
                        ) : null}
                      </div>
                    ) : null}
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] text-[var(--fp-text-muted)]">
                        {row.league || "—"} ·{" "}
                        {row.kickoff ? String(row.kickoff).slice(0, 16).replace("T", " ") : "—"}
                      </p>
                      <p className="mt-0.5 truncate font-semibold">
                        {row.teams?.home || "?"} {t("common.vs")} {row.teams?.away || "?"}
                      </p>
                      <p className="mt-0.5 text-sm text-[var(--fp-text-muted)]">
                        {t("history.topPick")}{" "}
                        <span className="text-[var(--fp-text)]">
                          {formatRecommendedPick(row.recommended?.pick, row.recommended?.family, t, row.recommended).label}
                        </span>
                        {row.score?.home != null && row.score?.away != null
                          ? ` · ${t("history.score", { home: row.score.home, away: row.score.away })}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <StatusBadge
                    status={row.validation}
                    tone={toneFor(row.validation)}
                    label={labelFor(row.validation)}
                  />
                </button>

                {active ? (
                  <div className="border-t border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-4 py-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">
                        {t("history.selectedMatch")}
                      </p>
                      <button
                        type="button"
                        onClick={() => setSelectedId(null)}
                        className="text-xs font-semibold text-[var(--fp-accent)] hover:underline"
                      >
                        {t("history.clearSelection")}
                      </button>
                    </div>
                    <HistorySpecialBetCard
                      row={row}
                      onOpenDetails={onOpenMatch}
                      canShowSpecialBet={canShowSpecialBet}
                      onUpgradeRequired={onUpgradeRequired}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
