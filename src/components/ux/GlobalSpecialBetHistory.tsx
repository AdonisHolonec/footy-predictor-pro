import { useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import GlobalSpecialBetTicketList from "./GlobalSpecialBetTicketList";
import { GLOBAL_SPECIAL_BET_KINDS, type GlobalSpecialBetKind } from "../../types/globalSpecialBet";
import type { FixtureLabel } from "../../utils/globalSpecialBetView";

type Props = {
  fixtureIndex?: Map<number, FixtureLabel>;
  /** Fails closed, like the per-match Special Bet card. */
  canUseGlobalSpecialBet?: boolean;
};

/** The two products the API can filter on. Sourced from the type, never re-listed. */
const TAB_LABEL_KEY: Record<GlobalSpecialBetKind, string> = {
  combo: "gsb.ticketsTabCombo",
  system: "gsb.ticketsTabSystem"
};

/**
 * Bilete — the user's stored Global Special Bets, one tab per product.
 *
 * A separate section from the per-match history it sits above: that one is a
 * list of matches, this one is a list of tickets.
 *
 * WHY TWO TABS AND NOT FOUR. Because there are two products. The public System
 * is Sistem 3/5 and only that: five selections of which at least three must win,
 * with the k fixed by the server. 4/5 and 5/5 are not tickets anyone can buy —
 * they are what a 3/5 ticket DOES when four or five of its legs land, and that
 * is already told through the one ticket's winning combinations.
 *
 * A tab per k would therefore invent products the product does not sell. Rows
 * stored at another k — reachable only through a direct backend call — still
 * render honestly here, each naming its own shape and combination count, because
 * this list describes stored tickets rather than offering choices. It also could
 * not be paginated: the API filters on `bet_kind` alone, and `hasMore` means
 * *this page came back full*, which a page full of systems can be while holding
 * no 4/5 at all.
 *
 * Each tab owns its own request. The list is keyed by kind, so switching tabs
 * mounts a fresh hook with its own loading, error, empty, page and hasMore —
 * never one list re-filtered, and never one product's rows under the other's
 * heading. The cost is a refetch on switch; a cache here would be a second
 * source of truth for data the server already paginates, so there isn't one.
 */
export default function GlobalSpecialBetHistory({ fixtureIndex, canUseGlobalSpecialBet = false }: Props) {
  const { t } = useLocale();
  const [kind, setKind] = useState<GlobalSpecialBetKind>("combo");

  if (!canUseGlobalSpecialBet) return null;

  return (
    <section className="space-y-3">
      <header>
        <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-[0.14em] text-[var(--fp-accent)]">
          {t("gsb.eyebrow")}
        </p>
        <h2 className="mt-1 font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]">
          {t("gsb.ticketsTitle")}
        </h2>
        <p className="mt-1 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">{t("gsb.ticketsSub")}</p>
      </header>

      {/* The same segmented pattern the match analysis uses: a real tablist, and
          it scrolls rather than wraps so the labels never stack on a phone. */}
      <div className="flex gap-0.5 overflow-x-auto pb-0.5" role="tablist" aria-label={t("gsb.ticketsTablist")}>
        {GLOBAL_SPECIAL_BET_KINDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={kind === id}
            onClick={() => setKind(id)}
            className={`h-9 shrink-0 rounded-md px-3 py-1 text-[10px] font-bold uppercase tracking-wide focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
              kind === id
                ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                : "text-[var(--fp-text-muted)] hover:bg-[var(--fp-bg-muted)] hover:text-[var(--fp-text)]"
            }`}
          >
            {t(TAB_LABEL_KEY[id])}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="space-y-3">
        {/* Keyed by kind: a tab switch is a new list, not a re-filtered one. */}
        <GlobalSpecialBetTicketList key={kind} kind={kind} fixtureIndex={fixtureIndex} />
      </div>
    </section>
  );
}
