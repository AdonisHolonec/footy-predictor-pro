import { useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Badge from "../../design-system/Badge";
import Button from "../../design-system/Button";
import Card from "../../design-system/Card";
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
export default function GlobalSpecialBetTicketList({ kind, fixtureIndex }: Props) {
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
      <div
        role="alert"
        className="rounded-[var(--fp-radius)] border border-fp-danger/35 bg-fp-danger/10 px-4 py-3"
      >
        <p className="font-display text-sm font-semibold text-[var(--fp-danger)]">{t("gsb.historyErrorTitle")}</p>
        <p className="mt-1 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">
          {state.error.message || t(state.error.messageKey)}
        </p>
        {state.error.retryable && (
          <Button className="mt-3" variant="secondary" size="sm" onClick={retry}>
            {t("gsb.retry")}
          </Button>
        )}
      </div>
    );
  }

  if (state.bets.length === 0) {
    return (
      <Card>
        <p className="text-sm text-[var(--fp-text-muted)]">{t(EMPTY_KEY[kind])}</p>
      </Card>
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
                className={`flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--fp-accent)] ${
                  expanded ? "bg-[var(--fp-accent-muted)]" : "hover:bg-[var(--fp-bg-muted)]"
                }`}
              >
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">
                    {formatDay(bet.bet_date)} · {t(shape.key, shape.vars)}
                  </p>
                  {/* The numbers stay on the collapsed row: shape and price are
                      what the user scans a history for. For a system the product
                      of the odds is the ALL-legs combination, not the ticket's
                      price, so it is labelled as such and sits next to how many
                      combinations the ticket actually covers. */}
                  <p className="mt-0.5 font-mono text-sm tabular-nums text-[var(--fp-text)]">
                    {t("gsb.summarySelections")} {bet.selections.length} ·{" "}
                    {isSystem ? t("gsb.summaryAllLegsOdds", { n: bet.variant }) : t("gsb.summaryTotalOdds")}{" "}
                    <span className="font-bold">{totalOdds ?? "—"}</span>
                    {isSystem && shape.combinationCount
                      ? ` · ${t("gsb.summaryCombinations")} ${shape.combinationCount}`
                      : ""}
                  </p>
                  {/* The settled figure is a sentence, not a bare odd: "returned
                      0.80× · net −20%" is the answer to the question a history is
                      opened to ask, and a bare 0.80 next to "settled odds" is not. */}
                  <p className="mt-0.5 font-mono text-[11px] tabular-nums text-[var(--fp-text-muted)]">
                    {t(outcome.detailKey, outcome.vars)}
                  </p>
                  {outcome.warningKey ? (
                    <p className="mt-0.5 text-[11px] font-semibold text-[var(--fp-warning)]">
                      {t(outcome.warningKey)}
                    </p>
                  ) : null}
                  {/* The reading sits above the confidence digit on purpose:
                      "a picat pe o singură selecție" is what the user came to
                      find out, and it reads as a sentence, not as more data. */}
                  <p className="mt-1 text-[length:var(--fp-body)] text-[var(--fp-text)]">
                    {t(reading.key, reading.vars)}
                  </p>
                  {ticketChance ? (
                    <p
                      className="mt-0.5 font-mono text-[11px] tabular-nums text-[var(--fp-text-muted)]"
                      aria-label={t("gsb.ticketChanceAria", { value: ticketChance.replace("%", "") })}
                    >
                      {t("gsb.ticketChance")}: {ticketChance}
                    </p>
                  ) : (
                    <p className="mt-0.5 font-mono text-[11px] tabular-nums text-[var(--fp-text-muted)]">
                      {t("gsb.summaryAvgConfidence")} {confidence ?? "—"}
                    </p>
                  )}
                </div>
                <Badge tone={outcome.tone}>{t(outcome.labelKey)}</Badge>
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
