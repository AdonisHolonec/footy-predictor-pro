import { useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Badge from "../../design-system/Badge";
import Banner from "../../design-system/Banner";
import Button from "../../design-system/Button";
import EmptyState from "../../design-system/EmptyState";
import Skeleton from "../../design-system/Skeleton";
import GlobalSpecialBetSelectionRow from "./GlobalSpecialBetSelectionRow";
import { useGlobalSpecialBetHistory } from "../../hooks/useGlobalSpecialBetHistory";
import type { GlobalSpecialBetKind } from "../../types/globalSpecialBet";
import {
  describeTicketOutcome,
  describeTicketShape,
  formatConfidencePercent,
  formatOdds,
  formatProbabilityPercent,
  isDecidingSelection,
  readGlobalSpecialBet,
  type FixtureLabel
} from "../../utils/globalSpecialBetView";

type Props = {
  /** Which product this list shows. Sent to the server; never used to filter a received page. */
  kind: GlobalSpecialBetKind;
  fixtureIndex?: Map<number, FixtureLabel>;
  /** Empty-state CTA (UX-E): opens the builder. */
  onBuild?: () => void;
};

/** Empty copy is per product: "no combos yet" and "no systems yet" are different facts. */
const EMPTY_KEY: Record<GlobalSpecialBetKind, string> = {
  combo: "gsb.ticketsEmptyCombo",
  system: "gsb.ticketsEmptySystem"
};

/**
 * One product's stored tickets, newest first.
 *
 * The list a tab owns. `kind` goes to the API as a query parameter, so what
 * arrives is already only this product — the array is never filtered after the
 * fact. That matters for more than tidiness: `hasMore` is inferred from a page
 * being full, so filtering a mixed page client-side would leave the Load-more
 * button describing a set that is no longer on screen.
 *
 * Every value shown is the stored snapshot. Nothing is re-graded, re-priced or
 * recomputed here: `describeTicketShape` owns the combination count and
 * `describeTicketOutcome` owns the return and the net figure, exactly as they
 * did before this list was split out of the section around it.
 */
export default function GlobalSpecialBetTicketList({ kind, fixtureIndex, onBuild }: Props) {
  const { t, locale } = useLocale();
  const { state, loadMore, retry } = useGlobalSpecialBetHistory({ kind });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const formatDay = (value: string) => {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return value;
    return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(new Date(ms));
  };

  if (state.phase === "loading") {
    return (
      <div role="status" aria-live="polite" className="space-y-2">
        <p className="sr-only">{t("gsb.historyLoading")}</p>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <Banner tone="danger" live="alert" className="!px-4 !py-3">
        <p className="font-display text-sm font-semibold text-[var(--fp-danger)]">{t("gsb.historyErrorTitle")}</p>
        <p className="mt-1 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">
          {state.error.message || t(state.error.messageKey)}
        </p>
        {state.error.retryable && (
          <Button className="mt-3" variant="secondary" size="sm" onClick={retry}>
            {t("gsb.retry")}
          </Button>
        )}
      </Banner>
    );
  }

  if (state.bets.length === 0) {
    return (
      <EmptyState
        title={t(EMPTY_KEY[kind])}
        description={t("tickets.emptyDesc")}
        actionLabel={onBuild ? t("tickets.emptyCta") : undefined}
        onAction={onBuild}
      />
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)]">
        {state.bets.map((bet, idx) => {
          const expanded = expandedId === bet.id;
          const isLast = idx === state.bets.length - 1;
          const shape = describeTicketShape(bet);
          const isSystem = bet.bet_kind === "system";
          const totalOdds = formatOdds(bet.total_odds);
          // What actually came back, and whether it beat the stake. One helper
          // answers it for both products, so a System that won under its stake
          // cannot be reported the way a Combo win is.
          const outcome = describeTicketOutcome(bet);
          const confidence = formatConfidencePercent(bet.average_confidence);
          // The STORED ticket chance (migration 050) — never recomputed
          // from the legs. Null on legacy rows, which keep the old
          // confidence line instead of a dash that explains nothing.
          const ticketChance = formatProbabilityPercent(bet.ticket_probability);
          const reading = readGlobalSpecialBet(bet);
          return (
            <div key={bet.id} className={!isLast || expanded ? "border-b border-[var(--fp-border)]" : ""}>
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : bet.id)}
                aria-expanded={expanded}
                aria-label={expanded ? t("gsb.collapse") : t("gsb.expand")}
                className={`flex min-h-[var(--fp-touch)] w-full items-start gap-3 px-3 py-2 text-left sm:px-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--fp-accent)] ${
                  expanded ? "bg-[var(--fp-accent-muted)]" : "hover:bg-[var(--fp-bg-muted)]"
                }`}
              >
                {/* UX-E: a compact row — line 1 scans (status · shape · odds · date),
                    line 2 answers (what happened · what came back · chance). The legs
                    are the only thing behind the disclosure. */}
                <span className="shrink-0"><Badge tone={outcome.tone}>{t(outcome.labelKey)}</Badge></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--fp-text)]" data-slot="ticket-shape">
                      {t(shape.key, shape.vars)} · {t("tickets.legs", { n: bet.selections.length })}
                      {isSystem && shape.combinationCount ? ` · ${t("gsb.summaryCombinations")} ${shape.combinationCount}` : ""}
                    </span>
                    <span className="shrink-0 font-mono text-sm tabular-nums text-[var(--fp-text)]" data-slot="ticket-odds">
                      <span className="text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">
                        {isSystem ? t("gsb.summaryAllLegsOdds", { n: bet.variant }) : t("gsb.summaryTotalOdds")}
                      </span>{" "}
                      <span className="font-bold">{totalOdds ?? "—"}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--fp-text-muted)]" data-slot="ticket-date">{formatDay(bet.bet_date)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-[var(--fp-text-muted)]" data-slot="ticket-reading">
                    <span className="font-semibold text-[var(--fp-text)]">{t(reading.key, reading.vars)}</span>
                    {" · "}
                    <span className="font-mono tabular-nums">{t(outcome.detailKey, outcome.vars)}</span>
                    {outcome.warningKey ? <span className="font-semibold text-[var(--fp-warning)]"> · {t(outcome.warningKey)}</span> : null}
                    {" · "}
                    {ticketChance ? (
                      <span className="font-mono tabular-nums" aria-label={t("gsb.ticketChanceAria", { value: ticketChance.replace("%", "") })}>
                        {t("gsb.ticketChance")}: {ticketChance}
                      </span>
                    ) : (
                      <span className="font-mono tabular-nums">{t("gsb.summaryAvgConfidence")} {confidence ?? "—"}</span>
                    )}
                  </span>
                </span>
                <span aria-hidden className={`shrink-0 text-[var(--fp-text-faint)] transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
              </button>

              {expanded && (
                <div className="border-t border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-4 py-3">
                  <ul className="space-y-2">
                    {bet.selections.map((selection) => (
                      <GlobalSpecialBetSelectionRow
                        key={selection.id}
                        selection={selection}
                        fixtureIndex={fixtureIndex}
                        deciding={isDecidingSelection(bet.status, selection)}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {state.hasMore && (
        <Button variant="secondary" size="sm" onClick={loadMore}>
          {t("gsb.historyLoadMore")}
        </Button>
      )}
    </>
  );
}
