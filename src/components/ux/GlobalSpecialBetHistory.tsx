import { useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Badge from "../../design-system/Badge";
import Button from "../../design-system/Button";
import Card from "../../design-system/Card";
import Skeleton from "../../design-system/Skeleton";
import GlobalSpecialBetSelectionRow from "./GlobalSpecialBetSelectionRow";
import { useGlobalSpecialBetHistory } from "../../hooks/useGlobalSpecialBetHistory";
import {
  formatConfidencePercent,
  formatOdds,
  formatProbabilityPercent,
  isDecidingSelection,
  readGlobalSpecialBet,
  statusLabelKey,
  statusTone,
  type FixtureLabel
} from "../../utils/globalSpecialBetView";

type Props = {
  fixtureIndex?: Map<number, FixtureLabel>;
  /** Fails closed, like the per-match Special Bet card. */
  canUseGlobalSpecialBet?: boolean;
};

/**
 * Stored Global Special Bets, newest first.
 *
 * A separate history from the per-match Special Bet list it sits above: this one
 * is a list of accumulators, that one is a list of matches. Every value shown is
 * the stored snapshot — nothing is re-graded or re-priced on the client, and a
 * NULL settled odd renders as a dash rather than a zero.
 */
export default function GlobalSpecialBetHistory({ fixtureIndex, canUseGlobalSpecialBet = false }: Props) {
  const { t, locale } = useLocale();
  const { state, loadMore, retry } = useGlobalSpecialBetHistory({ enabled: canUseGlobalSpecialBet });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!canUseGlobalSpecialBet) return null;

  const formatDay = (value: string) => {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return value;
    return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(new Date(ms));
  };

  return (
    <section className="space-y-3">
      <header>
        <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-[0.2em] text-[var(--fp-accent)]">
          {t("gsb.eyebrow")}
        </p>
        <h2 className="mt-1 font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]">
          {t("gsb.historyTitle")}
        </h2>
        <p className="mt-1 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">{t("gsb.historySub")}</p>
      </header>

      {state.phase === "loading" && (
        <div role="status" aria-live="polite" className="space-y-2">
          <p className="sr-only">{t("gsb.historyLoading")}</p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {state.phase === "error" && (
        <div
          role="alert"
          className="rounded-[var(--fp-radius)] border border-[var(--fp-danger)]/35 bg-[var(--fp-danger)]/10 px-4 py-3"
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
      )}

      {state.phase === "ready" && state.bets.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--fp-text-muted)]">{t("gsb.historyEmpty")}</p>
        </Card>
      )}

      {state.phase === "ready" && state.bets.length > 0 && (
        <>
          <div className="overflow-hidden rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)]">
            {state.bets.map((bet, idx) => {
              const expanded = expandedId === bet.id;
              const isLast = idx === state.bets.length - 1;
              const totalOdds = formatOdds(bet.total_odds);
              const settledOdds = formatOdds(bet.settled_total_odds);
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
                        {formatDay(bet.bet_date)} · {t("gsb.variantOption", { n: bet.variant })}
                      </p>
                      {/* The numbers stay on the collapsed row: status and price are
                          what the user scans a history for. */}
                      <p className="mt-0.5 font-mono text-sm tabular-nums text-[var(--fp-text)]">
                        {t("gsb.summarySelections")} {bet.selections.length} · {t("gsb.summaryTotalOdds")}{" "}
                        <span className="font-bold">{totalOdds ?? "—"}</span>
                        {settledOdds ? ` · ${t("gsb.summarySettledOdds")} ${settledOdds}` : ""}
                      </p>
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
                    <Badge tone={statusTone(bet.status)}>{t(statusLabelKey(bet.status))}</Badge>
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
      )}
    </section>
  );
}
