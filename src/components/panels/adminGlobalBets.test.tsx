import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminGlobalBetsPanel from "./AdminGlobalBetsPanel";
import AdminShell from "../ux/AdminShell";
import { GlobalTicketAdminError } from "../../services/globalTicketAdminService";

/**
 * Admin → Betting → Global Bets.
 *
 * What is asserted is what an admin can see and do, and — just as importantly —
 * what the browser is incapable of deciding. The wire contract is covered by
 * tests/globalTicketAdminApi.test.js; this covers the surface on top of it.
 *
 * The empty and thin-pool states get equal weight with the happy path, because a
 * thin candidate pool is the NORMAL answer today (the historical backfill has
 * never been run) and an operator who cannot tell "run the backfill" from "wait
 * for more fixtures" will do the wrong one.
 */

const fetchGlobalTickets = vi.fn();
const generateGlobalTicket = vi.fn();
const publishGlobalTicket = vi.fn();

vi.mock("../../services/globalTicketAdminService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/globalTicketAdminService")>();
  return {
    ...actual,
    fetchGlobalTickets: (...a: unknown[]) => fetchGlobalTickets(...a),
    generateGlobalTicket: (...a: unknown[]) => generateGlobalTicket(...a),
    publishGlobalTicket: (...a: unknown[]) => publishGlobalTicket(...a)
  };
});

const selection = (o: Record<string, unknown> = {}) => ({
  id: "s-1",
  fixtureId: 901,
  leagueId: 39,
  kickoffAt: "2026-09-05T18:00:00.000Z",
  market: "ou",
  selection: "Over 2.5",
  side: "over",
  line: 2.5,
  odds: 1.85,
  confidence: 80,
  probability: 0.72,
  fixtureLabel: "Arsenal – Chelsea",
  leagueName: "Premier League",
  status: "pending",
  ...o
});

const ticket = (o: Record<string, unknown> = {}) => ({
  id: "bet-1",
  betDate: "2026-09-05",
  variant: 3,
  betKind: "combo",
  systemK: null,
  status: "pending",
  betType: "GLOBAL",
  betSource: "ADMIN_PREDICTIONS",
  publishedAt: null,
  createdAt: "2026-09-05T00:30:00.000Z",
  settledAt: null,
  totalOdds: 2.422,
  averageConfidence: 80,
  ticketProbability: 0.8754,
  modelVersion: "v3.1",
  selections: [selection(), selection({ id: "s-2", fixtureId: 902, fixtureLabel: "Leeds – Everton" })],
  ...o
});

beforeEach(() => {
  fetchGlobalTickets.mockReset();
  generateGlobalTicket.mockReset();
  publishGlobalTicket.mockReset();
  fetchGlobalTickets.mockResolvedValue([]);
});

afterEach(cleanup);

describe("admin navigation", () => {
  it("nests Global Bets under Tickets under Betting", () => {
    render(
      <AdminShell section="dashboard" onSection={() => {}}>
        <div />
      </AdminShell>
    );
    const nav = screen.getByLabelText("Admin");

    // Three levels, asserted by CONTAINMENT rather than by reading three labels
    // off a flat list — the latter would still pass if the nesting were faked.
    const betting = within(nav).getByRole("group", { name: "Betting" });
    const tickets = within(betting).getByRole("group", { name: "Tickets" });
    expect(within(tickets).getByRole("button", { name: "Global Bets" })).toBeTruthy();

    expect(within(betting).getByText("Betting")).toBeTruthy();
    expect(within(tickets).getByText("Tickets")).toBeTruthy();
  });

  it("treats Betting and Tickets as captions, never as controls", () => {
    render(
      <AdminShell section="dashboard" onSection={() => {}}>
        <div />
      </AdminShell>
    );
    const nav = screen.getByLabelText("Admin");

    // Neither level is selectable. "Tickets" has no id, no panel and no state —
    // a grouping caption, not a page that exists to be passed through.
    expect(within(nav).queryByRole("button", { name: "Betting" })).toBeNull();
    expect(within(nav).queryByRole("button", { name: "Tickets" })).toBeNull();

    // Global Bets remains the one functional screen under that branch.
    const tickets = within(nav).getByRole("group", { name: "Tickets" });
    expect(within(tickets).getAllByRole("button")).toHaveLength(1);
  });

  it("selects the section and marks it current", () => {
    const onSection = vi.fn();
    const { rerender } = render(
      <AdminShell section="dashboard" onSection={onSection}>
        <div />
      </AdminShell>
    );
    fireEvent.click(screen.getByRole("button", { name: "Global Bets" }));
    expect(onSection).toHaveBeenCalledWith("global-bets");

    rerender(
      <AdminShell section="global-bets" onSection={onSection}>
        <div />
      </AdminShell>
    );
    expect(screen.getByRole("button", { name: "Global Bets" }).getAttribute("aria-current")).toBe("page");
  });

  it("opens the existing Global Bets panel when the nested entry is chosen", () => {
    const onSection = vi.fn();
    render(
      <AdminShell section="dashboard" onSection={onSection}>
        <div />
      </AdminShell>
    );
    const tickets = within(screen.getByLabelText("Admin")).getByRole("group", { name: "Tickets" });
    fireEvent.click(within(tickets).getByRole("button", { name: "Global Bets" }));
    // The same flat section id as before: nesting is a rendering concern, and
    // AdminSection stays a flat union so every existing caller is untouched.
    expect(onSection).toHaveBeenCalledWith("global-bets");
  });

  it("leaves Support -> My Tickets alone: it is not an admin nav entry", () => {
    render(
      <AdminShell section="dashboard" onSection={() => {}}>
        <div />
      </AdminShell>
    );
    const nav = screen.getByLabelText("Admin");

    // "Tickets" here groups GLOBAL bets. Support's own My Tickets is a separate
    // user-side surface (SupportEntry -> MyTicketsPanel) and must NOT be pulled
    // into this hierarchy or renamed by it.
    expect(within(nav).queryByText(/My Tickets/i)).toBeNull();
    expect(within(nav).queryByText(/Support/i)).toBeNull();

    const tickets = within(nav).getByRole("group", { name: "Tickets" });
    expect(within(tickets).getAllByRole("button").map((b) => b.textContent)).toEqual(["Global Bets"]);
  });

  it("keeps every pre-existing section reachable", () => {
    render(
      <AdminShell section="dashboard" onSection={() => {}}>
        <div />
      </AdminShell>
    );
    for (const label of [
      "Dashboard",
      "Model Lab",
      "Backtesting",
      "Benchmark",
      "Meta Learning",
      "Health",
      "Diagnostics",
      "Inbox",
      "Users",
      "Referrals"
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });
});

describe("loading and empty", () => {
  it("shows a loading placeholder before the list resolves", () => {
    let resolve: (v: unknown) => void = () => {};
    fetchGlobalTickets.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<AdminGlobalBetsPanel />);
    expect(screen.getByTestId("global-bets-loading")).toBeTruthy();
    resolve([]);
  });

  it("shows an empty state when no Global tickets exist", async () => {
    render(<AdminGlobalBetsPanel />);
    expect(await screen.findByText("Niciun bilet Global")).toBeTruthy();
  });
});

describe("variant selector", () => {
  it("offers exactly the variants the backend builds, and no System option", async () => {
    render(<AdminGlobalBetsPanel />);
    await screen.findByText("Niciun bilet Global");

    const select = screen.getByLabelText("Variantă") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["3", "5", "8"]);
    // A System option must not be offerable: the backend refuses bet_kind
    // "system", so an option that cannot succeed is worse than no option.
    // Scoped to the SELECT — the panel's own prose contains "de sistem".
    expect([...select.options].some((o) => /sistem/i.test(o.textContent || ""))).toBe(false);
  });

  it("sends only the chosen variant — never leagues, a user or selections", async () => {
    generateGlobalTicket.mockResolvedValue({
      available: true,
      created: true,
      duplicate: false,
      ticket: ticket({ variant: 5 }),
      candidatesAvailable: 12,
      fixturesConsidered: 40,
      leaguesConsidered: 6
    });
    render(<AdminGlobalBetsPanel />);
    await screen.findByText("Niciun bilet Global");

    fireEvent.change(screen.getByLabelText("Variantă"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Generează/ }));

    await waitFor(() => expect(generateGlobalTicket).toHaveBeenCalled());
    // One argument, and it is the variant. The eligibility universe is the
    // server's; the client has no way to express an opinion about it.
    expect(generateGlobalTicket.mock.calls[0]).toEqual([5]);
  });
});

describe("generation outcomes", () => {
  it("reports a successful draft and reloads the list", async () => {
    generateGlobalTicket.mockResolvedValue({
      available: true,
      created: true,
      duplicate: false,
      ticket: ticket(),
      candidatesAvailable: 12,
      fixturesConsidered: 40,
      leaguesConsidered: 6
    });
    fetchGlobalTickets.mockResolvedValueOnce([]).mockResolvedValueOnce([ticket()]);

    render(<AdminGlobalBetsPanel />);
    await screen.findByText("Niciun bilet Global");
    fireEvent.click(screen.getByRole("button", { name: /Generează/ }));

    expect(await screen.findByText(/Bilet Global creat ca draft din 40 meciuri și 6 ligi/)).toBeTruthy();
    expect(await screen.findByText("Draft")).toBeTruthy();
  });

  it("distinguishes an un-backfilled pool from a merely thin one", async () => {
    generateGlobalTicket.mockResolvedValue({
      available: false,
      poolState: "no_populated_predictions",
      variant: 3,
      required: 3,
      candidatesAvailable: 0,
      fixturesConsidered: 0,
      leaguesConsidered: 0,
      rejected: {}
    });
    render(<AdminGlobalBetsPanel />);
    await screen.findByText("Niciun bilet Global");
    fireEvent.click(screen.getByRole("button", { name: /Generează/ }));

    // The action is "run the backfill", and the copy has to say so.
    expect(await screen.findByText(/Backfill-ul istoric nu a fost rulat/)).toBeTruthy();
  });

  it("explains an insufficient pool with the count that was required", async () => {
    generateGlobalTicket.mockResolvedValue({
      available: false,
      poolState: "insufficient_candidates",
      variant: 8,
      required: 8,
      candidatesAvailable: 6,
      fixturesConsidered: 30,
      leaguesConsidered: 4,
      rejected: { probabilityBelowFloor: 12 }
    });
    render(<AdminGlobalBetsPanel />);
    await screen.findByText("Niciun bilet Global");
    fireEvent.click(screen.getByRole("button", { name: /Generează/ }));

    // Never a downgrade offer: the 8 that was asked for stays the subject.
    expect(await screen.findByText(/Doar 6 selecții.*sunt necesare 8/)).toBeTruthy();
  });

  it("reports an existing ticket as a duplicate rather than a failure", async () => {
    generateGlobalTicket.mockResolvedValue({
      available: true,
      created: false,
      duplicate: true,
      ticket: ticket(),
      candidatesAvailable: 12,
      fixturesConsidered: 40,
      leaguesConsidered: 6
    });
    render(<AdminGlobalBetsPanel />);
    await screen.findByText("Niciun bilet Global");
    fireEvent.click(screen.getByRole("button", { name: /Generează/ }));

    expect(await screen.findByText(/Există deja un bilet Global/)).toBeTruthy();
  });
});

describe("ticket rendering and details", () => {
  it("renders a draft with its date, odds and state", async () => {
    fetchGlobalTickets.mockResolvedValue([ticket()]);
    render(<AdminGlobalBetsPanel />);

    expect(await screen.findByText("Combo 3")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("2026-09-05")).toBeTruthy();
    expect(screen.getByText(/Cotă totală 2\.42/)).toBeTruthy();
  });

  it("marks a published ticket and offers no publish control for it", async () => {
    fetchGlobalTickets.mockResolvedValue([ticket({ publishedAt: "2026-09-05T01:00:00.000Z" })]);
    render(<AdminGlobalBetsPanel />);

    expect(await screen.findByText("Publicat")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publică" })).toBeNull();
  });

  it("exposes the stored selections on demand, and no candidate internals", async () => {
    fetchGlobalTickets.mockResolvedValue([ticket()]);
    render(<AdminGlobalBetsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Detalii" }));

    expect(await screen.findByText("Arsenal – Chelsea")).toBeTruthy();
    expect(screen.getByText("Leeds – Everton")).toBeTruthy();
    expect(screen.getAllByText("Over 2.5").length).toBeGreaterThan(0);
    // The projection is a server concern and must never surface here.
    expect(screen.queryByText(/ticket_candidates|valueEngine|raw_payload/)).toBeNull();
  });
});

describe("publishing", () => {
  it("publishes a draft and reports the new visibility", async () => {
    fetchGlobalTickets
      .mockResolvedValueOnce([ticket()])
      .mockResolvedValueOnce([ticket({ publishedAt: "2026-09-05T01:00:00.000Z" })]);
    publishGlobalTicket.mockResolvedValue(ticket({ publishedAt: "2026-09-05T01:00:00.000Z" }));

    render(<AdminGlobalBetsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Publică" }));

    await waitFor(() => expect(publishGlobalTicket).toHaveBeenCalledWith("bet-1"));
    expect(await screen.findByText(/vizibil pentru utilizatorii autentificați/)).toBeTruthy();
  });

  it("surfaces an already-published conflict without inventing a failure", async () => {
    fetchGlobalTickets.mockResolvedValue([ticket()]);
    publishGlobalTicket.mockRejectedValue(new GlobalTicketAdminError("already_published", 409, "already_published"));

    render(<AdminGlobalBetsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Publică" }));

    expect(await screen.findByText("Biletul a fost deja publicat.")).toBeTruthy();
  });
});

describe("error states", () => {
  it("names an authorization failure as one", async () => {
    fetchGlobalTickets.mockRejectedValue(new GlobalTicketAdminError("forbidden", 403, null));
    render(<AdminGlobalBetsPanel />);
    expect(await screen.findByText("Este necesar acces de administrator.")).toBeTruthy();
  });

  it("never renders a raw server message", async () => {
    fetchGlobalTickets.mockRejectedValue(
      new GlobalTicketAdminError('column "secret_column" does not exist', 500, 'column "secret_column" does not exist')
    );
    render(<AdminGlobalBetsPanel />);

    expect(await screen.findByText(/Nu am putut contacta serverul/)).toBeTruthy();
    expect(screen.queryByText(/secret_column/)).toBeNull();
  });

  it("offers a retry that re-reads the list", async () => {
    fetchGlobalTickets
      .mockRejectedValueOnce(new GlobalTicketAdminError("boom", 500, null))
      .mockResolvedValueOnce([ticket()]);
    render(<AdminGlobalBetsPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Reîncearcă" }));
    expect(await screen.findByText("Combo 3")).toBeTruthy();
  });
});

/**
 * Status, category and counters.
 *
 * The defect these cover is a specific one: the card used to show only where a
 * ticket sat in its RELEASE lifecycle ("Închis" once settled_at was written), in
 * the slot where an operator reads a RESULT — so a won ticket and a lost one
 * were the same word. Every assertion below keeps those two vocabularies apart,
 * and keeps a missing value from becoming a win.
 */
describe("ticket settlement status", () => {
  const settled = (status: string) =>
    ticket({ status, publishedAt: "2026-09-05T01:00:00.000Z", settledAt: "2026-09-05T22:00:00.000Z" });

  it("names a won ticket as won", async () => {
    fetchGlobalTickets.mockResolvedValue([settled("won")]);
    render(<AdminGlobalBetsPanel />);
    expect((await screen.findByTestId("ticket-settlement")).textContent).toContain("Câștigat");
  });

  it("names a lost ticket as lost", async () => {
    fetchGlobalTickets.mockResolvedValue([settled("lost")]);
    render(<AdminGlobalBetsPanel />);
    expect((await screen.findByTestId("ticket-settlement")).textContent).toContain("Pierdut");
  });

  it("names a void ticket as void", async () => {
    fetchGlobalTickets.mockResolvedValue([settled("void")]);
    render(<AdminGlobalBetsPanel />);
    expect((await screen.findByTestId("ticket-settlement")).textContent).toContain("Anulat");
  });

  it("shows a pending ticket as awaiting a result", async () => {
    fetchGlobalTickets.mockResolvedValue([ticket({ status: "pending" })]);
    render(<AdminGlobalBetsPanel />);
    expect((await screen.findByTestId("ticket-settlement")).textContent).toContain("În așteptare");
  });

  it("shows settlement and lifecycle as two separate facts", async () => {
    fetchGlobalTickets.mockResolvedValue([settled("lost")]);
    render(<AdminGlobalBetsPanel />);

    expect((await screen.findByTestId("ticket-settlement")).textContent).toContain("Pierdut");
    expect(screen.getByTestId("ticket-lifecycle").textContent).toContain("Închis");
  });

  it("NEVER labels a closed-but-ungraded ticket as won", async () => {
    // settled_at is written, status is still pending. This is the exact shape
    // that used to read as a finished, successful ticket.
    fetchGlobalTickets.mockResolvedValue([settled("pending")]);
    render(<AdminGlobalBetsPanel />);

    expect((await screen.findByTestId("ticket-lifecycle")).textContent).toContain("Închis");
    expect(screen.getByTestId("ticket-settlement").textContent).toContain("În așteptare");
    expect(screen.queryByText("Câștigat")).toBeNull();
  });

  it("renders no result at all for a status it does not model", async () => {
    fetchGlobalTickets.mockResolvedValue([settled("finalised")]);
    render(<AdminGlobalBetsPanel />);

    await screen.findByTestId("ticket-lifecycle");
    expect(screen.queryByTestId("ticket-settlement")).toBeNull();
    expect(screen.queryByText("Câștigat")).toBeNull();
  });
});

describe("selection status", () => {
  const open = async () => fireEvent.click(await screen.findByRole("button", { name: "Detalii" }));

  it("grades each leg on its own stored status, not on the ticket's", async () => {
    // A LOST ticket containing a WON leg: inferring the legs from the ticket
    // would mislabel the winner, and inferring the ticket from the legs would
    // mislabel the ticket.
    fetchGlobalTickets.mockResolvedValue([
      ticket({
        status: "lost",
        selections: [
          selection({ id: "s-1", fixtureId: 901, fixtureLabel: "Arsenal – Chelsea", status: "won" }),
          selection({ id: "s-2", fixtureId: 902, fixtureLabel: "Leeds – Everton", status: "lost" })
        ]
      })
    ]);
    render(<AdminGlobalBetsPanel />);
    await open();

    const won = (await screen.findByText("Arsenal – Chelsea")).closest("tr") as HTMLElement;
    const lost = screen.getByText("Leeds – Everton").closest("tr") as HTMLElement;
    expect(within(won).getByText("Câștigat")).toBeTruthy();
    expect(within(lost).getByText("Pierdut")).toBeTruthy();
  });

  it("leaves an ungraded leg pending even when others have settled", async () => {
    fetchGlobalTickets.mockResolvedValue([
      ticket({
        status: "pending",
        selections: [
          selection({ id: "s-1", fixtureId: 901, fixtureLabel: "Arsenal – Chelsea", status: "won" }),
          selection({ id: "s-2", fixtureId: 902, fixtureLabel: "Leeds – Everton", status: "pending" })
        ]
      })
    ]);
    render(<AdminGlobalBetsPanel />);
    await open();

    const pending = (await screen.findByText("Leeds – Everton")).closest("tr") as HTMLElement;
    expect(within(pending).getByText("În așteptare")).toBeTruthy();
  });

  it("says nothing rather than inventing a result for a leg with no status", async () => {
    fetchGlobalTickets.mockResolvedValue([
      ticket({ selections: [selection({ id: "s-1", fixtureLabel: "Arsenal – Chelsea", status: null })] })
    ]);
    render(<AdminGlobalBetsPanel />);
    await open();

    const row = (await screen.findByText("Arsenal – Chelsea")).closest("tr") as HTMLElement;
    expect(within(row).getByText("—")).toBeTruthy();
    expect(within(row).queryByText("Câștigat")).toBeNull();
  });

  it("keeps the stored snapshot visible alongside the new result column", async () => {
    // Regression: Details must still show everything it always showed.
    fetchGlobalTickets.mockResolvedValue([ticket()]);
    render(<AdminGlobalBetsPanel />);
    await open();

    expect(await screen.findByText("Arsenal – Chelsea")).toBeTruthy();
    expect(screen.getAllByText("Premier League").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Over 2.5").length).toBeGreaterThan(0);
    expect(screen.getByText("Rezultat")).toBeTruthy();
  });
});

describe("category is a price, not a leg count", () => {
  it("labels a ticket by its total odds", async () => {
    fetchGlobalTickets.mockResolvedValue([ticket({ variant: 3, totalOdds: 16.08 })]);
    render(<AdminGlobalBetsPanel />);
    // Three legs, but a 16.08 price: the headline follows the price.
    expect((await screen.findByTestId("ticket-category")).textContent).toContain("Cota 8+");
  });

  it("does not read the leg count as a price", async () => {
    // Eight legs at a short total. A category derived from `variant` would say
    // "8"; the correct answer is the 2+ band.
    fetchGlobalTickets.mockResolvedValue([ticket({ variant: 8, totalOdds: 2.4 })]);
    render(<AdminGlobalBetsPanel />);
    expect((await screen.findByTestId("ticket-category")).textContent).toContain("Cota 2+");
  });

  it("gives one exclusive category, never three overlapping ones", async () => {
    fetchGlobalTickets.mockResolvedValue([ticket({ totalOdds: 16.08 })]);
    render(<AdminGlobalBetsPanel />);

    const category = await screen.findByTestId("ticket-category");
    expect(category.textContent).toContain("Cota 8+");
    expect(category.textContent).not.toContain("Cota 4+");
    expect(category.textContent).not.toContain("Cota 2+");
  });

  it("still states the leg count, separately from the price", async () => {
    fetchGlobalTickets.mockResolvedValue([ticket({ variant: 3, totalOdds: 16.08 })]);
    render(<AdminGlobalBetsPanel />);
    expect(await screen.findByText(/2 selecții \(Combo 3\)/)).toBeTruthy();
  });

  it("falls back to the leg count when the price cannot place the ticket", async () => {
    fetchGlobalTickets.mockResolvedValue([ticket({ variant: 3, totalOdds: null })]);
    render(<AdminGlobalBetsPanel />);
    expect((await screen.findByTestId("ticket-category")).textContent).toContain("Combo 3");
  });
});

describe("won-ticket counters", () => {
  // "Today" in the same zone the counter uses, so these never straddle midnight
  // in a way that moves a row out of the week under test.
  const today = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Bucharest",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

  it("counts only tickets the settlement engine calls won", async () => {
    const day = today();
    fetchGlobalTickets.mockResolvedValue([
      ticket({ id: "w", betDate: day, status: "won", totalOdds: 9.5 }),
      ticket({ id: "l", betDate: day, status: "lost", totalOdds: 9.5 }),
      ticket({ id: "p", betDate: day, status: "pending", totalOdds: 9.5 }),
      // Old enough to prove the page covers both windows.
      ticket({ id: "old", betDate: "2020-01-01", status: "lost", totalOdds: 9.5 })
    ]);
    render(<AdminGlobalBetsPanel />);

    expect((await screen.findByTestId("kpi-week")).textContent).toContain("1");
    expect(screen.getByTestId("kpi-month").textContent).toContain("1");
  });

  it("breaks winners down by cumulative odds threshold", async () => {
    const day = today();
    fetchGlobalTickets.mockResolvedValue([
      ticket({ id: "a", betDate: day, status: "won", totalOdds: 16.08 }),
      ticket({ id: "b", betDate: day, status: "won", totalOdds: 2.4 }),
      ticket({ id: "old", betDate: "2020-01-01", status: "lost", totalOdds: 3 })
    ]);
    render(<AdminGlobalBetsPanel />);

    // The 16.08 winner is counted in all three; the 2.40 winner only in 2+.
    expect((await screen.findByTestId("kpi-cota2")).textContent).toContain("2");
    expect(screen.getByTestId("kpi-cota4").textContent).toContain("1");
    expect(screen.getByTestId("kpi-cota8").textContent).toContain("1");
  });

  it("marks a count as a floor when the list does not cover the window", async () => {
    fetchGlobalTickets.mockResolvedValue([ticket({ id: "w", betDate: today(), status: "won" })]);
    render(<AdminGlobalBetsPanel />);

    // No row older than the month start, so the month count cannot be proven
    // complete and must not be printed as if it were.
    expect((await screen.findByTestId("kpi-month")).textContent).toContain("≥");
  });

  it("is absent while the first list is still loading", () => {
    let resolve: (v: unknown) => void = () => {};
    fetchGlobalTickets.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<AdminGlobalBetsPanel />);

    expect(screen.queryByTestId("global-bets-kpi")).toBeNull();
    resolve([]);
  });
});
