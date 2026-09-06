import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TicketsSection from "./TicketsSection";
import { LocaleProvider } from "../../context/LocaleContext";
import { ro } from "../../i18n/ro";

/**
 * Tickets → Global Bets (consumer, read-only).
 *
 * What matters is not that a list renders — it is that the surface gives a
 * consumer NO way to change a Global ticket, and that Global Bets is reachable
 * on every viewport rather than being a desktop-only affordance.
 *
 * The mobile requirement is asserted STRUCTURALLY: the switcher must carry no
 * responsive class that could hide it. A test that merely rendered at a narrow
 * width would pass even if `hidden lg:block` crept in, because jsdom does not
 * apply media queries.
 *
 * Labels come from the CATALOGUE rather than hardcoded English: the app's
 * default locale is Romanian, and pinning the key is the stronger assertion.
 */

const leaf = (dict: unknown, group: string, key: string): string => {
  const branch = (dict as Record<string, unknown>)[group] as Record<string, unknown>;
  return String(branch[key]);
};

const GLOBAL_TAB = leaf(ro, "tickets", "globalBetsTab");
const MY_BETS_TAB = leaf(ro, "tickets", "myBetsTab");
const GLOBAL_EMPTY = leaf(ro, "tickets", "globalBetsEmpty");
const GLOBAL_ERROR = leaf(ro, "tickets", "globalBetsError");
const BUILD_CTA = leaf(ro, "tickets", "buildCta");

const fetchPublishedGlobalBets = vi.fn();

vi.mock("../../services/globalSpecialBetService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/globalSpecialBetService")>();
  return {
    ...actual,
    fetchPublishedGlobalBets: (...a: unknown[]) => fetchPublishedGlobalBets(...a),
    // The My Bets history also reaches this module; an empty list keeps that tab
    // quiet so these assertions are about Global Bets alone.
    fetchGlobalSpecialBets: async () => []
  };
});

const selection = (o: Record<string, unknown> = {}) => ({
  id: "s-1",
  special_bet_id: "g1",
  fixture_id: 901,
  league_id: 39,
  fixture_label: "Arsenal – Chelsea",
  league_name: "Premier League",
  kickoff_at: "2026-09-05T18:00:00.000Z",
  market: "ou",
  selection: "Over 2.5",
  side: "over",
  line: 2.5,
  odds: 1.85,
  confidence: 80,
  probability: 0.72,
  status: "pending",
  ...o
});

const globalBet = (o: Record<string, unknown> = {}) => ({
  id: "g1",
  bet_date: "2026-09-05",
  variant: 3,
  bet_kind: "combo",
  status: "pending",
  bet_type: "GLOBAL",
  published_at: "2026-09-05T17:27:27.000Z",
  created_at: "2026-09-05T17:27:10.000Z",
  total_odds: 2.422,
  selections: [selection(), selection({ id: "s-2", fixture_id: 902, fixture_label: "Leeds – Everton" })],
  ...o
});

const renderTickets = (props = {}) =>
  render(
    <LocaleProvider>
      <TicketsSection betDate="2026-09-05" favoriteLeagueIds={[39]} canUseGlobalSpecialBet {...props} />
    </LocaleProvider>
  );

const openGlobal = () => fireEvent.click(screen.getByRole("tab", { name: GLOBAL_TAB }));

beforeEach(() => {
  fetchPublishedGlobalBets.mockReset();
  fetchPublishedGlobalBets.mockResolvedValue([]);
});

afterEach(cleanup);

describe("the Tickets hierarchy", () => {
  it("offers both Global Bets and My Bets", () => {
    renderTickets();
    expect(screen.getByRole("tab", { name: GLOBAL_TAB })).toBeTruthy();
    expect(screen.getByRole("tab", { name: MY_BETS_TAB })).toBeTruthy();
  });

  it("opens on My Bets so existing users are not displaced", () => {
    renderTickets();
    expect(screen.getByTestId("tickets-history")).toBeTruthy();
    expect(screen.queryByTestId("tickets-global")).toBeNull();
  });

  it("is reachable on EVERY viewport — the switcher carries no responsive class", () => {
    const { container } = renderTickets();
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();

    const markup = (tablist as HTMLElement).outerHTML;
    for (const responsive of ["lg:hidden", "md:hidden", "sm:hidden", "hidden lg:", "hidden md:"]) {
      expect(markup.includes(responsive)).toBe(false);
    }
  });

  it("keeps Support → My Tickets out of the betting surface", () => {
    renderTickets();
    expect(screen.queryByText(/My Tickets/i)).toBeNull();
  });
});

describe("Global Bets is read-only", () => {
  it("offers no Build control when Global Bets is showing", async () => {
    renderTickets();
    expect(screen.getByTestId("tickets-build-cta")).toBeTruthy();

    openGlobal();
    await waitFor(() => expect(screen.getByTestId("tickets-global")).toBeTruthy());
    // Absent, not disabled: a consumer can never generate a Global ticket, and
    // an inert button would imply otherwise.
    expect(screen.queryByTestId("tickets-build-cta")).toBeNull();
    expect(screen.queryByText(BUILD_CTA)).toBeNull();
  });

  it("exposes no publish, edit or delete control", async () => {
    fetchPublishedGlobalBets.mockResolvedValue([globalBet()]);
    renderTickets();
    openGlobal();

    const panel = await screen.findByTestId("tickets-global");
    for (const forbidden of [/publi/i, /edit/i, /delete|șterge|sterge/i, /generate|generează/i]) {
      expect(within(panel).queryByRole("button", { name: forbidden })).toBeNull();
    }
  });
});

describe("Global Bets states", () => {
  it("shows a loading placeholder first", async () => {
    let resolve: (v: unknown) => void = () => {};
    fetchPublishedGlobalBets.mockReturnValue(new Promise((r) => (resolve = r)));
    renderTickets();
    openGlobal();

    expect(await screen.findByTestId("global-bets-loading")).toBeTruthy();
    resolve([]);
  });

  it("shows an empty state that never mentions drafts", async () => {
    renderTickets();
    openGlobal();

    expect(await screen.findByText(GLOBAL_EMPTY)).toBeTruthy();
    // Naming a draft would leak that unpublished tickets exist.
    expect(screen.queryByText(/draft|ciornă|ciorna/i)).toBeNull();
  });

  it("shows an error state with a retry, and no server prose", async () => {
    fetchPublishedGlobalBets.mockRejectedValueOnce(new Error('column "secret_column" does not exist'));
    renderTickets();
    openGlobal();

    expect(await screen.findByText(GLOBAL_ERROR)).toBeTruthy();
    expect(screen.queryByText(/secret_column/)).toBeNull();

    fetchPublishedGlobalBets.mockResolvedValueOnce([globalBet()]);
    fireEvent.click(screen.getByRole("button", { name: /Reîncearcă|Retry/i }));
    expect(await screen.findByTestId("global-bets-list")).toBeTruthy();
  });

  it("renders a published ticket with its date", async () => {
    fetchPublishedGlobalBets.mockResolvedValue([globalBet()]);
    renderTickets();
    openGlobal();

    const list = await screen.findByTestId("global-bets-list");
    expect(within(list).getByText("2026-09-05")).toBeTruthy();
  });

  it("opens the stored legs on demand and exposes no candidate internals", async () => {
    fetchPublishedGlobalBets.mockResolvedValue([globalBet()]);
    renderTickets();
    openGlobal();

    fireEvent.click(await screen.findByTestId("global-bet-toggle-g1"));
    expect(await screen.findByText(/Arsenal/)).toBeTruthy();
    expect(screen.getByText(/Leeds/)).toBeTruthy();
    expect(screen.queryByText(/raw_payload|ticket_candidates|valueEngine/)).toBeNull();
  });

  it("renders a legacy ticket with no stored legs rather than hiding it", async () => {
    fetchPublishedGlobalBets.mockResolvedValue([globalBet({ selections: [] })]);
    renderTickets();
    openGlobal();

    fireEvent.click(await screen.findByTestId("global-bet-toggle-g1"));
    expect(await screen.findByTestId("global-bet-no-legs")).toBeTruthy();
  });
});

describe("My Bets is unaffected", () => {
  it("returns to a working My Bets after visiting Global Bets", async () => {
    renderTickets();
    openGlobal();
    await screen.findByTestId("tickets-global");

    fireEvent.click(screen.getByRole("tab", { name: MY_BETS_TAB }));
    expect(screen.getByTestId("tickets-history")).toBeTruthy();
    expect(screen.getByTestId("tickets-build-cta")).toBeTruthy();
    expect(screen.queryByTestId("tickets-global")).toBeNull();
  });
});
