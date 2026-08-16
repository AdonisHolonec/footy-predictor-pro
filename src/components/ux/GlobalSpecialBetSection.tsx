import { useMemo, type ReactNode } from "react";
import { useLocale } from "../../context/LocaleContext";
import Badge from "../../design-system/Badge";
import Button from "../../design-system/Button";
import Skeleton from "../../design-system/Skeleton";
import StatTile from "../../design-system/StatTile";
import GlobalSpecialBetSelectionRow from "./GlobalSpecialBetSelectionRow";
import { useGlobalSpecialBet } from "../../hooks/useGlobalSpecialBet";
import {
  describeTicketShape,
  formatDateTime,
  isUnderwaySelection,
  orderSelectionsByKickoff,
  readBetProgress,
  readGlobalSpecialBet,
  resolveSelectionLabel,
  statusLabelKey,
  statusTone,
  summarizeGlobalSpecialBet,
  type FixtureLabel
} from "../../utils/globalSpecialBetView";
import { GLOBAL_SPECIAL_BET_VARIANTS } from "../../types/globalSpecialBet";
import { SYSTEM_PRODUCT, comboProduct, type GlobalSpecialBetProduct } from "../../hooks/useGlobalSpecialBet";

/**
 * What the user can ask for: the three Combo sizes, then the Bilet Sistem.
 *
 * The System appears once, as a product — there is no 3/5, 4/5, 5/5 choice to
 * make. The public System IS 3/5: five selections of which at least three must
 * win, with the k fixed by the server. A row in the history may say "Sistem 3/5"
 * because that describes the ticket; the user never picks the 3.
 */
const PRODUCT_OPTIONS: GlobalSpecialBetProduct[] = [
  ...GLOBAL_SPECIAL_BET_VARIANTS.map((n) => comboProduct(n)),
  SYSTEM_PRODUCT
];

type Props = {
  /** Calendar day the bet is built from — the date the dashboard is showing. */
  betDate: string;
  /** The user's favourite leagues; the server rejects anything outside them. */
  favoriteLeagueIds: number[];
  /** fixture_id -> readable labels, resolved from rows the app already holds. */
  fixtureIndex?: Map<number, FixtureLabel>;
  /** Fails closed, matching the per-match Special Bet card's convention. */
  canUseGlobalSpecialBet?: boolean;
  onUpgradeRequired?: (feature: string, requiredTier: "ultra") => void;
};

/**
 * Global Special Bet — an accumulator the SERVER builds from selections across
 * the fixtures of the user's favourite leagues.
 *
 * Deliberately its own product, not a variation of the per-match
 * "Special Bet · Top signals": different card, different colour identity
 * (accent, where the per-match card is success-green), its own `gsb.*`
 * vocabulary, and no shared code with src/utils/specialBet.ts.
 *
 * The client chooses nothing but the variant. Ranking, pricing, confidence,
 * diversification and league spread all happen server-side; this component
 * renders the returned snapshot and never recomputes a field of it.
 */
export default function GlobalSpecialBetSection({
  betDate,
  favoriteLeagueIds,
  fixtureIndex,
  canUseGlobalSpecialBet = false,
  onUpgradeRequired
}: Props) {
  const { t, locale } = useLocale();
  const { product, setProduct, state, isGenerating, generate } = useGlobalSpecialBet({
    betDate,
    leagueIds: favoriteLeagueIds
  });

  const summary = useMemo(
    () => (state.phase === "ready" ? summarizeGlobalSpecialBet(state.bet) : null),
    [state]
  );

  // Read from the STORED bet, never from the button the user pressed: what the
  // server actually created is the only thing worth naming, and describeTicketShape
  // is the same helper the history uses so one ticket cannot read two ways.
  const shape = useMemo(
    () => (state.phase === "ready" ? describeTicketShape(state.bet) : null),
    [state]
  );
  const isSystem = state.phase === "ready" && state.bet.bet_kind === "system";

  const createdLabel = useMemo(
    () => (summary ? formatDateTime(summary.createdAt, locale) : null),
    [summary, locale]
  );

  /**
   * How the bet reads right now: what is settled, what is on, what is next.
   *
   * The clock is sampled here, once per state change, and no ticker refreshes
   * it. That is deliberate — every time this card shows is absolute ("21:45"),
   * so nothing counts down and nothing goes wrong by standing still. The single
   * value that ages is which legs are marked as under way, and it resolves on
   * the next fetch or the next visit.
   */
  const live = useMemo(() => {
    if (state.phase !== "ready") return null;
    const nowMs = Date.now();
    const progress = readBetProgress(state.bet, nowMs);
    const next = progress.next
      ? {
          label:
            resolveSelectionLabel(progress.next, fixtureIndex).title ??
            t("gsb.matchFallback", { id: progress.next.fixture_id }),
          time: formatDateTime(progress.next.kickoff_at, locale)
        }
      : null;
    return {
      nowMs,
      progress,
      next,
      reading: readGlobalSpecialBet(state.bet),
      selections: orderSelectionsByKickoff(state.bet.selections)
    };
  }, [state, fixtureIndex, locale, t]);

  const shell = (children: ReactNode) => (
    <section
      aria-labelledby="gsb-heading"
      className="rounded-[var(--fp-radius-lg)] border border-fp-accent/30 bg-[var(--fp-accent-muted)] p-4 shadow-fp-sm sm:p-5"
    >
      <header className="min-w-0">
        <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-[0.2em] text-[var(--fp-accent)]">
          {t("gsb.eyebrow")}
        </p>
        <h2
          id="gsb-heading"
          className="mt-1 font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]"
        >
          {t("gsb.subtitle")}
        </h2>
      </header>
      {children}
    </section>
  );

  // Access uses the same mechanism as the per-match Special Bet; no parallel
  // entitlement system, and no artificial paywall invented here.
  if (!canUseGlobalSpecialBet) {
    return shell(
      <>
        <p className="mt-3 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">{t("gsb.lockedDesc")}</p>
        <Button
          className="mt-4"
          variant="secondary"
          size="sm"
          onClick={() => onUpgradeRequired?.(t("gsb.lockedTitle"), "ultra")}
        >
          🔒 {t("gsb.unlock")}
        </Button>
      </>
    );
  }

  if (favoriteLeagueIds.length === 0) {
    return shell(
      <>
        <p className="mt-3 font-semibold text-[var(--fp-text)]">{t("gsb.noFavoritesTitle")}</p>
        <p className="mt-1 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">{t("gsb.noFavoritesDesc")}</p>
      </>
    );
  }

  return shell(
    <>
      <p className="mt-2 text-xs text-[var(--fp-text-muted)]">
        {t("gsb.basedOnLeagues", { n: favoriteLeagueIds.length })}
        {betDate ? ` · ${t("gsb.poolScope", { date: betDate })}` : ""}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={t("gsb.variantGroupLabel")}
          className="inline-flex flex-wrap gap-1 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-1"
        >
          {PRODUCT_OPTIONS.map((option) => {
            const active = product.kind === option.kind && product.variant === option.variant;
            return (
              <button
                key={`${option.kind}:${option.variant}`}
                type="button"
                aria-pressed={active}
                disabled={isGenerating}
                onClick={() => setProduct(option)}
                /* min-h-[var(--fp-touch)] keeps every option thumb-sized at 390px. */
                className={`min-h-[var(--fp-touch)] rounded-md px-3 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] disabled:opacity-50 ${
                  active
                    ? "bg-[var(--fp-accent)] text-white shadow-sm"
                    : "text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
                }`}
              >
                {option.kind === "system"
                  ? t("gsb.productSystem")
                  : t("gsb.variantOption", { n: option.variant })}
              </button>
            );
          })}
        </div>

        <Button
          size="sm"
          loading={isGenerating}
          /* Disabled while in flight: the visual half of the double-submit guard.
             The server owns idempotency, so a slipped second click is still safe. */
          disabled={isGenerating}
          onClick={() => void generate()}
        >
          {state.phase === "ready" ? t("gsb.regenerate") : t("gsb.generate")}
        </Button>
      </div>

      {/* What the selected product IS, before anything is generated. The System
          needs saying: "Bilet Sistem" alone does not mention five legs, and it
          certainly does not mention that three of them are enough. A Combo's
          option label already carries its own count. */}
      {product.kind === "system" && (
        <p className="mt-2 text-xs font-semibold text-[var(--fp-accent)]">{t("gsb.productSystemHint")}</p>
      )}

      {state.phase === "idle" && (
        <p className="mt-4 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">{t("gsb.intro")}</p>
      )}

      {state.phase === "generating" && (
        <div className="mt-4" role="status" aria-live="polite">
          <p className="text-[length:var(--fp-body)] font-semibold text-[var(--fp-text)]">{t("gsb.generating")}</p>
          <div className="mt-3 space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      )}

      {state.phase === "unavailable" && (
        <div className="mt-4 rounded-[var(--fp-radius)] border border-fp-warning/35 bg-fp-warning/10 px-4 py-3">
          <p className="font-display text-sm font-semibold text-[var(--fp-text)]">{t("gsb.unavailableTitle")}</p>
          <p className="mt-1 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">{t("gsb.unavailableDesc")}</p>
          {/* Shown only because the API supplies both numbers; never inferred. */}
          <p className="mt-1 font-mono text-xs tabular-nums text-[var(--fp-text-muted)]">
            {t("gsb.unavailableCount", {
              available: state.unavailable.availableCandidates,
              required: state.unavailable.required
            })}
          </p>
        </div>
      )}

      {state.phase === "error" && (
        <div
          role="alert"
          className="mt-4 rounded-[var(--fp-radius)] border border-fp-danger/35 bg-fp-danger/10 px-4 py-3"
        >
          <p className="font-display text-sm font-semibold text-[var(--fp-danger)]">{t(state.error.titleKey)}</p>
          {/* The server's own reason wins whenever it sent one. */}
          <p className="mt-1 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">
            {state.error.message || t(state.error.messageKey)}
          </p>
          {state.error.retryable && (
            <Button className="mt-3" variant="secondary" size="sm" onClick={() => void generate()}>
              {t("gsb.retry")}
            </Button>
          )}
        </div>
      )}

      {state.phase === "ready" && summary && live && shape && (
        <div className="mt-4">
          {/* WHAT WAS JUST CREATED, named before it is measured. A Combo 5 and a
              Bilet Sistem both hold five legs, so without this line the two
              confirmations are the same card with the same numbers. The same
              helper the history uses answers it, so one ticket reads identically
              wherever it appears — and for a System the combination count comes
              with it, because "Sistem 3/5" without "Combinații 10" states a
              threshold and hides what it costs to cover. */}
          <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">
            {t(shape.key, shape.vars)}
            {shape.combinationCount ? ` · ${t("gsb.summaryCombinations")} ${shape.combinationCount}` : ""}
          </p>
          {/* The sentence comes before the tiles: "3 din 5 au intrat · 2 încă în
              joc" is the answer, the tiles are the evidence. Same reading the
              history shows, so one bet reads identically in both places. */}
          <p className="mt-1 text-[length:var(--fp-body)] font-semibold text-[var(--fp-text)]">
            {t(live.reading.key, live.reading.vars)}
          </p>
          {live.next && live.next.time ? (
            <p className="mt-0.5 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">
              {t("gsb.nextLeg", { label: live.next.label, time: live.next.time })}
            </p>
          ) : live.progress.underway > 0 ? (
            <p className="mt-0.5 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">
              {/* No count here: the reading line above already says how many are
                  still in play, and a second number would just restate it. */}
              {t("gsb.allUnderway")}
            </p>
          ) : null}

          {/* Ticket chance is the headline metric (probability-first contract):
              accent tone moves here from total odds, keeping One Accent Rule —
              exactly one accent number in the grid. averageConfidence is
              demoted to a hint on its tile: the audit showed it read as the
              ticket's chance while being neither a probability nor a product.
              A legacy bet (pre-050) shows a dash — the number was never stored
              and is not recomputed. */}
          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2">
            <div
              role="group"
              aria-label={
                summary.ticketProbability
                  ? t("gsb.ticketChanceAria", { value: summary.ticketProbability.replace("%", "") })
                  : t("gsb.ticketChance")
              }
            >
              <StatTile
                label={t("gsb.ticketChance")}
                value={summary.ticketProbability ?? "—"}
                tone="accent"
                hint={
                  summary.averageConfidence
                    ? `${t("gsb.summaryAvgConfidence")}: ${summary.averageConfidence}`
                    : undefined
                }
              />
            </div>
            {/* For a System this number is the product of ALL FIVE odds — the
                price of the one all-legs combination, not what the ticket pays.
                Calling it "Cotă totală" here told the user their 3/5 returns
                24.42×, when ten combinations share the stake and five winners
                return 6.83×. The history has always labelled it correctly; this
                is the same branch, on the same helper. */}
            <StatTile
              label={
                isSystem ? t("gsb.summaryAllLegsOdds", { n: summary.variant }) : t("gsb.summaryTotalOdds")
              }
              value={summary.totalOdds ?? "—"}
              hint={
                summary.settledTotalOdds ? `${t("gsb.summarySettledOdds")}: ${summary.settledTotalOdds}` : undefined
              }
            />
            <StatTile label={t("gsb.summarySelections")} value={String(summary.selectionCount)} />
            <StatTile
              label={t("gsb.summaryStatus")}
              value={t(statusLabelKey(summary.status))}
              tone={statusTone(summary.status)}
              hint={createdLabel ? `${t("gsb.summaryCreated")}: ${createdLabel}` : undefined}
            />
          </div>
          {/* Visible but quiet, and only when a chance is actually shown: a
              disclaimer under a dash would explain a number that is not there. */}
          {summary.ticketProbability && (
            <p className="mt-1.5 text-[11px] text-[var(--fp-text-muted)]">{t("gsb.ticketChanceDisclaimer")}</p>
          )}

          <div className="mt-4 flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-[var(--fp-text)]">{t("gsb.selectionsTitle")}</h3>
            <Badge tone={statusTone(summary.status)}>{t(statusLabelKey(summary.status))}</Badge>
          </div>

          {/* Chronological, not by rank: while the bet runs the list is a
              timeline, and the leg being played now should not sit last. */}
          <ul className="mt-2 space-y-2">
            {live.selections.map((selection) => (
              <GlobalSpecialBetSelectionRow
                key={selection.id}
                selection={selection}
                fixtureIndex={fixtureIndex}
                underway={isUnderwaySelection(selection, live.nowMs)}
              />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
