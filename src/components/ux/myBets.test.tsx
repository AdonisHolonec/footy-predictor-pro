import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TicketsSection from "./TicketsSection";
import AdminShell from "./AdminShell";
import { LocaleProvider } from "../../context/LocaleContext";
import { ro } from "../../i18n/ro";
import { en } from "../../i18n/en";

/*
  Asserted against the CATALOGUE, not against hardcoded English. The app's
  default locale is Romanian, so a literal "My Bets" would fail while the copy
  was in fact correct — and pinning the key is the stronger assertion anyway:
  it proves the surface reads tickets.myBetsTitle rather than that one
  translation happens to say a particular thing.
*/
/** `Dict` is recursive (string | Dict), so a leaf read needs one narrowing step. */
const leaf = (dict: unknown, group: string, key: string): string => {
  const branch = (dict as Record<string, unknown>)[group] as Record<string, unknown>;
  return String(branch[key]);
};

const TICKETS = leaf(ro, "nav", "tickets");
const MY_BETS = leaf(ro, "tickets", "myBetsTitle");
const MY_BETS_EN = leaf(en, "tickets", "myBetsTitle");

/**
 * Betting → Tickets → My Bets.
 *
 * The user's own betting surface had no name of its own: the page was titled
 * "Tickets", the same word as the group containing it. This asserts the levels
 * and — with equal weight — the two things that must NOT be conflated:
 *
 *   Betting → Tickets → My Bets      the user's own bets (this surface)
 *   Betting → Tickets → Global Bets  admin-generated, a different shell
 *   Support → My Tickets             a support conversation, unrelated
 *
 * "My Tickets" and "My Bets" are one word apart and mean entirely different
 * things, so the separation is pinned rather than left to reviewer memory.
 */

const renderMyBets = (props = {}) =>
  render(
    <LocaleProvider>
      <TicketsSection betDate="2026-09-05" favoriteLeagueIds={[39]} canUseGlobalSpecialBet {...props} />
    </LocaleProvider>
  );

afterEach(cleanup);

describe("My Bets identity", () => {
  it("names the screen My Bets under a Tickets eyebrow", () => {
    renderMyBets();
    const surface = screen.getByTestId("my-bets");

    // The heading is the screen's own name, not the group's.
    expect(within(surface).getByRole("heading", { level: 1 }).textContent).toContain(MY_BETS);
    // The group is still present as the eyebrow above it.
    expect(within(surface).getByText(TICKETS)).toBeTruthy();
    // And both catalogues carry the key, so neither locale falls back.
    expect(MY_BETS).toBeTruthy();
    expect(MY_BETS_EN).toBe("My Bets");
  });

  it("is NOT called My Tickets — that name belongs to Support", () => {
    renderMyBets();
    // The Support surface is a different feature with a confusingly close name.
    expect(screen.queryByText(/My Tickets/i)).toBeNull();
  });

  it("does not present Global Bets: that is a separate, admin-only surface", () => {
    renderMyBets();
    const surface = screen.getByTestId("my-bets");
    expect(within(surface).queryByText(/Global Bets/i)).toBeNull();
  });

  it("keeps the builder closed until asked for, and the user's bets visible", () => {
    renderMyBets();
    const surface = screen.getByTestId("my-bets");

    // The surface opens on what the user already has, not on a form.
    expect(within(surface).queryByTestId("tickets-build")).toBeNull();
    expect(within(surface).getByTestId("tickets-build-cta")).toBeTruthy();
    expect(within(surface).getByTestId("tickets-history")).toBeTruthy();
  });
});

describe("the two Tickets surfaces stay separate", () => {
  it("the ADMIN shell offers Global Bets and never My Bets", () => {
    render(
      <AdminShell section="dashboard" onSection={() => {}}>
        <div />
      </AdminShell>
    );
    const nav = screen.getByLabelText("Admin");

    const tickets = within(nav).getByRole("group", { name: "Tickets" });
    expect(within(tickets).getByRole("button", { name: "Global Bets" })).toBeTruthy();

    // My Bets is the user's surface and must not appear in the admin sidebar,
    // where it would read as an admin capability over someone's own bets.
    expect(within(nav).queryByText(/My Bets/i)).toBeNull();
    expect(within(nav).queryByText(/My Tickets/i)).toBeNull();
  });

  it("both live under a Tickets group, in their own shells", () => {
    // Admin: Betting -> Tickets -> Global Bets
    const admin = render(
      <AdminShell section="dashboard" onSection={() => {}}>
        <div />
      </AdminShell>
    );
    const betting = within(screen.getByLabelText("Admin")).getByRole("group", { name: "Betting" });
    expect(within(betting).getByRole("group", { name: "Tickets" })).toBeTruthy();
    admin.unmount();

    // User: Tickets -> My Bets
    renderMyBets();
    const surface = screen.getByTestId("my-bets");
    expect(within(surface).getByText(TICKETS)).toBeTruthy();
    expect(within(surface).getByRole("heading", { level: 1 }).textContent).toContain(MY_BETS);
  });
});

describe("entitlement copy is unchanged", () => {
  it("still explains the lock when the user cannot build", () => {
    renderMyBets({ canUseGlobalSpecialBet: false });
    expect(screen.getByTestId("tickets-locked")).toBeTruthy();
  });
});
