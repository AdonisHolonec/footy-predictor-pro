import { useMemo, type ReactNode } from "react";
import { useLocale } from "../../context/LocaleContext";
import Badge from "../../design-system/Badge";
import Button from "../../design-system/Button";
import Skeleton from "../../design-system/Skeleton";
import StatTile from "../../design-system/StatTile";
import GlobalSpecialBetSelectionRow from "./GlobalSpecialBetSelectionRow";
import { useGlobalSpecialBet } from "../../hooks/useGlobalSpecialBet";
import {
  statusLabelKey,
  statusTone,
  summarizeGlobalSpecialBet,
  type FixtureLabel
} from "../../utils/globalSpecialBetView";
import { GLOBAL_SPECIAL_BET_VARIANTS, type GlobalSpecialBetVariant } from "../../types/globalSpecialBet";

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
  const { variant, setVariant, state, isGenerating, generate } = useGlobalSpecialBet({
    betDate,
    leagueIds: favoriteLeagueIds
  });

  const summary = useMemo(
    () => (state.phase === "ready" ? summarizeGlobalSpecialBet(state.bet) : null),
    [state]
  );

  const createdLabel = useMemo(() => {
    if (!summary) return null;
    const ms = Date.parse(summary.createdAt);
    if (!Number.isFinite(ms)) return null;
    return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(ms));
  }, [summary, locale]);

  const shell = (children: ReactNode) => (
    <section
      aria-labelledby="gsb-heading"
      className="rounded-[var(--fp-radius-lg)] border border-[var(--fp-accent)]/30 bg-[var(--fp-accent-muted)] p-4 shadow-[var(--fp-shadow-sm)] sm:p-5"
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
        {betDate ? ` · ${t("gsb.forDate", { date: betDate })}` : ""}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={t("gsb.variantGroupLabel")}
          className="inline-flex flex-wrap gap-1 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-1"
        >
          {GLOBAL_SPECIAL_BET_VARIANTS.map((option) => {
            const active = variant === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                disabled={isGenerating}
                onClick={() => setVariant(option as GlobalSpecialBetVariant)}
                /* min-h-[var(--fp-touch)] keeps every option thumb-sized at 390px. */
                className={`min-h-[var(--fp-touch)] rounded-md px-3 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] disabled:opacity-50 ${
                  active
                    ? "bg-[var(--fp-accent)] text-white shadow-sm"
                    : "text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
                }`}
              >
                {t("gsb.variantOption", { n: option })}
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
        <div className="mt-4 rounded-[var(--fp-radius)] border border-[var(--fp-warning)]/35 bg-[var(--fp-warning)]/10 px-4 py-3">
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
          className="mt-4 rounded-[var(--fp-radius)] border border-[var(--fp-danger)]/35 bg-[var(--fp-danger)]/10 px-4 py-3"
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

      {state.phase === "ready" && summary && (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2">
            <StatTile label={t("gsb.summarySelections")} value={String(summary.selectionCount)} />
            <StatTile
              label={t("gsb.summaryTotalOdds")}
              value={summary.totalOdds ?? "—"}
              tone="accent"
              hint={
                summary.settledTotalOdds ? `${t("gsb.summarySettledOdds")}: ${summary.settledTotalOdds}` : undefined
              }
            />
            <StatTile label={t("gsb.summaryAvgConfidence")} value={summary.averageConfidence ?? "—"} />
            <StatTile
              label={t("gsb.summaryStatus")}
              value={t(statusLabelKey(summary.status))}
              tone={statusTone(summary.status)}
              hint={createdLabel ? `${t("gsb.summaryCreated")}: ${createdLabel}` : undefined}
            />
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-[var(--fp-text)]">{t("gsb.selectionsTitle")}</h3>
            <Badge tone={statusTone(summary.status)}>{t(statusLabelKey(summary.status))}</Badge>
          </div>

          <ul className="mt-2 space-y-2">
            {state.bet.selections.map((selection) => (
              <GlobalSpecialBetSelectionRow
                key={selection.id}
                selection={selection}
                fixtureIndex={fixtureIndex}
              />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
