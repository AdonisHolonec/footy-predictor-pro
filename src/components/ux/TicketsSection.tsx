import { useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import SectionHeader from "../../design-system/SectionHeader";
import Button from "../../design-system/Button";
import GlobalSpecialBetSection from "./GlobalSpecialBetSection";
import GlobalSpecialBetHistory from "./GlobalSpecialBetHistory";
import ConsumerGlobalBetsList from "./ConsumerGlobalBetsList";
import SegmentedControl from "../../design-system/SegmentedControl";
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
/** The two products under Tickets. Not a filter — a panel switcher. */
type TicketsTab = "my-bets" | "global-bets";

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
  /*
    My Bets stays the default so the surface opens on what an existing user
    already had. Global Bets is one tap away on EVERY viewport — the switcher is
    plain markup with no breakpoint, so mobile reaches it through the same CTA
    entry that already leads here.
  */
  const [tab, setTab] = useState<TicketsTab>("my-bets");
  const showingGlobal = tab === "global-bets";

  return (
    <section className="space-y-4" data-surface="tickets" data-testid="my-bets">
      <header className="flex flex-wrap items-end justify-between gap-3">
        {/*
          Betting -> Tickets -> My Bets. "Tickets" is the grouping the eyebrow
          carries; "My Bets" is the screen. They were the same word before, which
          left the user's own betting surface without a name of its own.

          NOT "My Tickets" — that belongs to Support and means something else
          entirely (a support conversation). The two must stay distinguishable in
          copy as well as in code.
        */}
        <SectionHeader
          as="h1"
          size="page"
          eyebrow={t("nav.tickets")}
          title={showingGlobal ? t("tickets.globalBetsTitle") : t("tickets.myBetsTitle")}
          description={showingGlobal ? t("tickets.globalBetsSub") : t("tickets.myBetsSub")}
        />
        {/* Build belongs to My Bets alone. On Global Bets there is no control
            at all rather than a disabled one, because a consumer can never
            generate a Global ticket and an inert button would imply otherwise. */}
        {!showingGlobal && (
          <Button
            onClick={openBuilder}
            aria-expanded={builderOpen}
            aria-controls="tickets-build"
            data-testid="tickets-build-cta"
          >
            {t("tickets.buildCta")}
          </Button>
        )}
      </header>

      {/* Panel switcher, not a filter — the options swap what is shown. Plain
          markup with NO breakpoint, so Global Bets is reachable on every
          viewport through the same Tickets entry mobile already uses. */}
      <SegmentedControl
        options={[
          { value: "my-bets", label: t("tickets.myBetsTab") },
          { value: "global-bets", label: t("tickets.globalBetsTab") }
        ] as { value: TicketsTab; label: string }[]}
        value={tab}
        // Narrowed at the boundary: the control's generic widens to `string`
        // under this project's non-strict compiler, so the cast lives here
        // rather than being spread through the options literal.
        onChange={(value) => setTab(value as TicketsTab)}
        // "tabs", not "toggle": these options SWAP the panel rather than filter
        // a list, so the control must announce tablist/tab semantics.
        mode="tabs"
        aria-label={t("nav.tickets")}
      />

      {showingGlobal ? (
        <section aria-labelledby="tickets-global" data-testid="tickets-global" className="space-y-3">
          <ConsumerGlobalBetsList fixtureIndex={fixtureIndex} />
        </section>
      ) : (
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
      )}
    </section>
  );
}
