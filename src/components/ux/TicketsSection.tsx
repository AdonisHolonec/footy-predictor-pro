import { useLocale } from "../../context/LocaleContext";
import SectionHeader from "../../design-system/SectionHeader";
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
 * Tickets — the secondary value product, under one name (UX-B).
 *
 * The Global Special Bet builder and its history used to sit on Today's tail
 * and at the top of History respectively, where they competed with the
 * decision list and the results list. They are the same product, so they now
 * share one destination, reached from Today's entry card, from the desktop
 * rail, and (per-match) from Match Detail — never from the bottom bar.
 *
 * Composition only: both children are the existing components, untouched.
 * Entitlement semantics are unchanged (see UX-G for the gating question).
 */
export default function TicketsSection({
  betDate,
  favoriteLeagueIds,
  fixtureIndex,
  canUseGlobalSpecialBet = false,
  onUpgradeRequired
}: Props) {
  const { t } = useLocale();
  return (
    <section className="space-y-6">
      <header>
        <SectionHeader
          as="h1"
          size="page"
          eyebrow={t("nav.tickets")}
          title={t("nav.tickets")}
          description={t("tickets.sub")}
        />
      </header>
      <section aria-labelledby="tickets-build" data-testid="tickets-build" className="space-y-3">
        <SectionHeader as="h2" id="tickets-build" size="section" title={t("tickets.buildTitle")} description={t("tickets.buildSub")} />
        <GlobalSpecialBetSection
        betDate={betDate}
        favoriteLeagueIds={favoriteLeagueIds}
        fixtureIndex={fixtureIndex}
        canUseGlobalSpecialBet={canUseGlobalSpecialBet}
          onUpgradeRequired={onUpgradeRequired}
        />
      </section>
      <section aria-labelledby="tickets-history" data-testid="tickets-history" className="space-y-3">
        <SectionHeader as="h2" id="tickets-history" size="section" title={t("tickets.historyTitle")} description={t("tickets.historySub")} />
        <GlobalSpecialBetHistory fixtureIndex={fixtureIndex} canUseGlobalSpecialBet={canUseGlobalSpecialBet} />
      </section>
    </section>
  );
}
