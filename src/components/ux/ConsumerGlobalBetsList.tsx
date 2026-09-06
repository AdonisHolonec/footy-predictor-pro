import { useCallback, useEffect, useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Badge from "../../design-system/Badge";
import Button from "../../design-system/Button";
import Card from "../../design-system/Card";
import EmptyState from "../../design-system/EmptyState";
import ErrorState from "../../design-system/ErrorState";
import Skeleton from "../../design-system/Skeleton";
import GlobalSpecialBetSelectionRow from "./GlobalSpecialBetSelectionRow";
import { fetchPublishedGlobalBets } from "../../services/globalSpecialBetService";
import type { GlobalSpecialBet } from "../../types/globalSpecialBet";
import { formatDateTime, formatOdds, statusTone, type FixtureLabel } from "../../utils/globalSpecialBetView";

/**
 * Tickets → Global Bets, for consumers. READ-ONLY by construction, not by
 * hiding controls.
 *
 * ── WHY A NEW COMPONENT AND NOT GlobalSpecialBetTicketList ───────────────────
 * That list looks like the obvious reuse and is not: it sources its data from
 * `useGlobalSpecialBetHistory({ kind })`, which calls the USER endpoint and
 * returns the caller's OWN tickets. It cannot render a GLOBAL ticket, because
 * the query behind it filters on `user_id` and a GLOBAL row has none.
 *
 * The pieces that ARE ownership-agnostic are reused wholesale:
 * `GlobalSpecialBetSelectionRow` for every leg, and the formatting helpers in
 * `utils/globalSpecialBetView`. Only the data source and the chrome are new.
 *
 * ── NAMING ───────────────────────────────────────────────────────────────────
 * "GlobalSpecialBet" in this codebase is the historical name of the USER
 * multi-leg ticket product. It is NOT `bet_type = 'GLOBAL'`. This component is
 * the only consumer surface that renders the latter, which is why it does not
 * carry that prefix.
 *
 * ── WHAT A CONSUMER CANNOT DO ────────────────────────────────────────────────
 * There is no generate, publish, edit or delete control here, and none is
 * suppressed conditionally — the component has no mutating call to make. The
 * service it uses exposes a single read with no owner or publication-state
 * parameter, so a draft or another user's ticket cannot be requested even by a
 * modified client. RLS (migration 068) is the backstop.
 *
 * Rendered identically on desktop and mobile: one column of cards, no viewport
 * branch and no breakpoint that hides content.
 */

type Props = {
  fixtureIndex?: Map<number, FixtureLabel>;
};

export default function ConsumerGlobalBetsList({ fixtureIndex }: Props) {
  const { t, locale } = useLocale();
  const [bets, setBets] = useState<GlobalSpecialBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setBets(await fetchPublishedGlobalBets());
    } catch {
      // The reason is never rendered: a server message can name a column or a
      // constraint, and a reader has no use for either.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3" data-testid="global-bets-loading">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (failed) {
    return (
      <ErrorState
        title={t("tickets.globalBetsTitle")}
        message={t("tickets.globalBetsError")}
        onRetry={() => void load()}
      />
    );
  }

  if (bets.length === 0) {
    // Says nothing about drafts: an unpublished ticket is not something a
    // consumer is waiting for, and mentioning one would leak that it exists.
    return <EmptyState title={t("tickets.globalBetsEmpty")} description={t("tickets.globalBetsEmptyDesc")} />;
  }

  return (
    <div className="space-y-3" data-testid="global-bets-list">
      {bets.map((bet) => {
        const expanded = openId === bet.id;
        const legs = bet.selections || [];
        return (
          <Card key={bet.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-sm font-semibold text-[var(--fp-text)]">
                    {t("tickets.legs", { n: bet.variant })}
                  </span>
                  <Badge tone={statusTone(bet.status)}>{bet.status}</Badge>
                  <Badge tone="neutral">{bet.bet_date}</Badge>
                </div>
                <div className="mt-1 text-xs text-[var(--fp-text-muted)]">
                  {t("tickets.oddsShort", { odds: formatOdds(bet.total_odds) ?? "—" })}
                  {bet.published_at ? ` · ${formatDateTime(bet.published_at, locale) ?? ""}` : ""}
                </div>
              </div>

              {/* The ONLY control on this surface. Nothing here can change a ticket. */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpenId(expanded ? null : bet.id)}
                aria-expanded={expanded}
                data-testid={`global-bet-toggle-${bet.id}`}
              >
                {expanded ? t("card.hideDetails") : t("card.showDetails")}
              </Button>
            </div>

            {expanded && (
              <div className="mt-3 space-y-2 border-t border-[var(--fp-border)] pt-3">
                {legs.length === 0 ? (
                  // A published ticket with no stored legs is malformed legacy
                  // data. It is shown as itself rather than hidden: a silently
                  // missing ticket is harder to explain than an empty one.
                  <p className="text-xs text-[var(--fp-text-muted)]" data-testid="global-bet-no-legs">
                    {t("tickets.globalBetsEmptyDesc")}
                  </p>
                ) : (
                  legs.map((selection) => (
                    <GlobalSpecialBetSelectionRow
                      key={selection.id ?? `${selection.fixture_id}-${selection.selection}`}
                      selection={selection}
                      fixtureIndex={fixtureIndex}
                    />
                  ))
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
