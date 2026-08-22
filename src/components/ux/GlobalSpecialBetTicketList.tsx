import { useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Badge from "../../design-system/Badge";
import Banner from "../../design-system/Banner";
import StatusIcon, { normalizeStatus, statusA11yKey } from "../icons/StatusIcon";
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

  const intlLocale = locale === "ro" ? "ro-RO" : "en-GB";
  const formatDay = (value: string) => {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return value;
    return new Intl.DateTimeFormat(intlLocale, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(ms));
  };
  /** "18 aug · 16:08" — when the ticket was built; falls back to the bet date. */
  const formatBuiltAt = (bet: { created_at?: string | null; bet_date: string }) => {
    const ms = Date.parse(String(bet.created_at || ""));
    if (!Number.isFinite(ms)) return formatDay(bet.bet_date);
    const d = new Date(ms);
    const day = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" }).format(d);
    const time = new Intl.DateTimeFormat(intlLocale, { hour: "2-digit", minute: "2-digit" }).format(d);
    return `${day} · ${time}`;
  };
  /** Short, stable ticket number from the stored id — the first block of the UUID. */
  const ticketNumber = (id: string) => String(id).split("-")[0].slice(0, 8).toUpperCase();

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
              {(() => {
                const statusLabel = t(outcome.labelKey);
                const statusKind = normalizeStatus(bet.status);
                const legsLabel = t("tickets.legs", { n: bet.selections.length });
                const oddsLabel = t("tickets.oddsShort", { odds: totalOdds ?? "—" });
                const numberLabel = t("tickets.ticketNumber", { id: ticketNumber(bet.id) });
                const builtAt = formatBuiltAt(bet);
                /* The whole row in one name, the status exactly once: the icon is
                   decorative inside a button that already names it. */
                const accessibleName = [numberLabel, statusLabel, isSystem ? `${t(shape.key, shape.vars)}, ${legsLabel}` : t(shape.key, shape.vars), oddsLabel, builtAt].join(", ");
                return (
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : bet.id)}
                    aria-expanded={expanded}
                    aria-label={accessibleName}
                    data-slot="ticket-row"
                    className={`block min-h-[var(--fp-touch)] w-full px-3 py-2.5 text-left sm:px-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--fp-accent)] ${
                      expanded ? "bg-[var(--fp-accent-muted)]" : "hover:bg-[var(--fp-bg-muted)]"
                    }`}
                  >
                    {/* The compact row is an OVERVIEW: exactly two lines.
                        Line 1 — ticket number · built at | status (fixed `auto` track, never wraps).
                        Line 2 — selections · combined odds, on line 1's left edge.
                        Everything else (shape, reading, return, chance, legs) lives behind the disclosure. */}
                    <span className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3" data-slot="ticket-line-1">
                      <span className="min-w-0 truncate text-sm text-[var(--fp-text)]" data-slot="ticket-meta">
                        <span className="font-semibold" data-slot="ticket-number">{numberLabel}</span>
                        <span className="text-[var(--fp-text-muted)]"> · </span>
                        <span className="font-mono text-xs tabular-nums text-[var(--fp-text-muted)]" data-slot="ticket-date">{builtAt}</span>
                      </span>
                      {/* Status, the same way MatchListRow / StatusBadge do it: the icon
                          alone below `sm`, icon + text from `sm` up. The text is switched
                          off with display:none, so nothing is announced twice; the row's
                          aria-label already names the status, and `title` keeps it on
                          hover for the icon-only widths. An unmodelled status (no icon)
                          keeps its text at every width rather than vanishing. */}
                      <span
                        className="flex shrink-0 items-center justify-self-end whitespace-nowrap"
                        data-slot="ticket-status"
                        title={statusLabel}
                      >
                        <Badge tone={outcome.tone} className="whitespace-nowrap">
                          {statusKind ? (
                            <span aria-hidden="true" className="inline-flex">
                              <StatusIcon kind={statusKind} label={t(statusA11yKey(statusKind))} />
                            </span>
                          ) : null}
                          <span className={statusKind ? "hidden sm:inline" : ""} data-slot="ticket-status-text">
                            {statusLabel}
                          </span>
                        </Badge>
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-xs tabular-nums text-[var(--fp-text-muted)]" data-slot="ticket-line-2">
                      {/* The product shape is part of the ticket's identity (Combo vs
                          Sistem 3/5), so it stays in the overview; combinations do not.
                          A Combo's shape string already carries the leg count, so the
                          count is stated once: "Combo · 3 selecții" / "Sistem 3/5 · 5 selecții". */}
                      {isSystem ? (
                        <>
                          <span data-slot="ticket-shape-short">{t(shape.key, shape.vars)}</span>
                          <span> · </span>
                          <span data-slot="ticket-legs">{legsLabel}</span>
                        </>
                      ) : (
                        <span data-slot="ticket-legs">{t(shape.key, shape.vars)}</span>
                      )}
                      <span> · </span>
                      <span data-slot="ticket-odds" className="font-semibold text-[var(--fp-text)]">{oddsLabel}</span>
                    </span>
                  </button>
                );
              })()}

              {expanded && (
                <div className="border-t border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-4 py-3" data-slot="ticket-detail">
                  {/* Everything the compact row no longer shows — unchanged content,
                      moved behind the disclosure: shape & combinations, the date the
                      ticket was placed for, the reading, the return and the chance. */}
                  <div className="mb-2 space-y-1 text-[11px] text-[var(--fp-text-muted)]">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-[var(--fp-text)]" data-slot="ticket-shape">
                        {t(shape.key, shape.vars)} · {t("tickets.legs", { n: bet.selections.length })}
                        {isSystem && shape.combinationCount ? ` · ${t("gsb.summaryCombinations")} ${shape.combinationCount}` : ""}
                      </span>
                      <span className="font-mono tabular-nums" data-slot="ticket-total-odds">
                        {isSystem ? t("gsb.summaryAllLegsOdds", { n: bet.variant }) : t("gsb.summaryTotalOdds")} <span className="font-bold text-[var(--fp-text)]">{totalOdds ?? "—"}</span>
                      </span>
                      <span className="font-mono tabular-nums" data-slot="ticket-bet-date">{formatDay(bet.bet_date)}</span>
                    </div>
                    <div data-slot="ticket-reading">
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
                    </div>
                  </div>
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
