import { useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import SectionHeader from "../../design-system/SectionHeader";
import Button from "../../design-system/Button";
import GlobalSpecialBetSection from "./GlobalSpecialBetSection";
import GlobalSpecialBetHistory from "./GlobalSpecialBetHistory";
import type { FixtureLabel } from "../../utils/globalSpecialBetView";

type Props = {
  betDate: string;
  favoriteLeagueIds: number[];
  fixtureIndex?: Map<number, FixtureLabel>;
  canUseGlobalSpecialBet?: boolean;
  onUpgradeRequired?: (feature: string, requiredTier: "ultra") => void;
};

/**
 * Tickets (UX-E) — the secondary product, with its own identity.
 *
 *   TICKETS
 *   [Build ticket]            ← the one primary action; the builder is CLOSED
 *                               until asked for, so the surface opens on what
 *                               the user already has, not on a form.
 *   Build ticket (panel)      ← the existing builder, embedded (no competing
 *                               heading), shown only after the CTA.
 *   Ticket history            ← the existing history, embedded, newest first,
 *                               one scan line per ticket; its empty state points
 *                               back at the CTA.
 *
 * ≥1280: builder left, history right — the builder's state lives in its own
 * hook and the history in its own, so the two columns never share state.
 * Composition only: entitlement, pricing and settlement are untouched.
 */
export default function TicketsSection({
  betDate,
  favoriteLeagueIds,
  fixtureIndex,
  canUseGlobalSpecialBet = false,
  onUpgradeRequired
}: Props) {
  const { t } = useLocale();
  const [builderOpen, setBuilderOpen] = useState(false);
  const openBuilder = () => setBuilderOpen(true);

  return (
    <section className="space-y-4" data-surface="tickets">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeader as="h1" size="page" eyebrow={t("nav.tickets")} title={t("nav.tickets")} description={t("tickets.sub")} />
        <Button
          onClick={openBuilder}
          aria-expanded={builderOpen}
          aria-controls="tickets-build"
          data-testid="tickets-build-cta"
        >
          {t("tickets.buildCta")}
        </Button>
      </header>

      <div className={builderOpen ? "grid gap-4 xl:grid-cols-2 xl:items-start" : "grid gap-4"}>
        {builderOpen && (
          <section aria-labelledby="tickets-build" data-testid="tickets-build" className="space-y-3">
            <SectionHeader as="h2" id="tickets-build" size="section" title={t("tickets.buildTitle")} description={t("tickets.buildSub")} />
            <GlobalSpecialBetSection
              betDate={betDate}
              favoriteLeagueIds={favoriteLeagueIds}
              fixtureIndex={fixtureIndex}
              canUseGlobalSpecialBet={canUseGlobalSpecialBet}
              onUpgradeRequired={onUpgradeRequired}
              embedded
            />
          </section>
        )}

        <section aria-labelledby="tickets-history" data-testid="tickets-history" className="space-y-3">
          <SectionHeader as="h2" id="tickets-history" size="section" title={t("tickets.historyTitle")} description={t("tickets.historySub")} />
          <GlobalSpecialBetHistory
            fixtureIndex={fixtureIndex}
            canUseGlobalSpecialBet={canUseGlobalSpecialBet}
            embedded
            onBuild={openBuilder}
          />
          {!canUseGlobalSpecialBet && (
            <p className="text-sm text-[var(--fp-text-muted)]" data-testid="tickets-locked">
              {t("gsb.lockedDesc")}
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
