import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupportApiError } from "../../services/supportService";
import MyTicketsPanel from "./MyTicketsPanel";

/**
 * The user's own tickets and their threads.
 *
 * Tested against a mocked transport, so what is asserted is what the user sees:
 * which tickets appear, in what order the conversation reads, and that a message
 * body is text no matter what it contains. The wire format itself is covered by
 * tests/supportApi.test.js.
 *
 * `t` is mocked to return the key, so the assertions read as contracts rather than
 * as copy translators are free to change.
 */

const listSupportTickets = vi.fn();

vi.mock("../../services/supportService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/supportService")>();
  return { ...actual, listSupportTickets: (...args: unknown[]) => listSupportTickets(...args) };
});

vi.mock("../../context/LocaleContext", () => ({
  useLocale: () => ({ t: (key: string) => key, locale: "en" })
}));

const message = (overrides: Record<string, unknown> = {}) => ({
  id: "m-1",
  ticket_id: "t-1",
  author_role: "user" as const,
  body: "the original message",
  created_at: "2026-08-15T05:50:00.000Z",
  ...overrides
});

const ticket = (overrides: Record<string, unknown> = {}) => ({
  id: "t-1",
  category: "general",
  subject: "Something broke",
  status: "open",
  priority: "normal",
  contact_requested: false,
  created_at: "2026-08-15T05:50:00.000Z",
  updated_at: "2026-08-15T05:50:00.000Z",
  messages: [message()],
  ...overrides
});

describe("MyTicketsPanel", () => {
  beforeEach(() => listSupportTickets.mockReset());
  afterEach(cleanup);

  describe("data boundary", () => {
    it("asks the server for the tickets without telling it whose they are", async () => {
      listSupportTickets.mockResolvedValue([ticket()]);
      render(<MyTicketsPanel />);
      await screen.findByText("Something broke");
      // The server derives the owner from the session; a client-supplied id would be
      // a request to be trusted about whose messages these are.
      expect(listSupportTickets).toHaveBeenCalledTimes(1);
      expect(listSupportTickets).toHaveBeenCalledWith();
    });

    it("shows both a support ticket and a prediction report", async () => {
      listSupportTickets.mockResolvedValue([
        ticket({ id: "t-report", category: "prediction", subject: "Bad pick" }),
        ticket({ id: "t-support", category: "technical", subject: "Cannot sign in" })
      ]);
      render(<MyTicketsPanel />);
      expect(await screen.findByText("Bad pick")).toBeTruthy();
      expect(screen.getByText("Cannot sign in")).toBeTruthy();
      // A report is a ticket with that category — told apart by label, not by table.
      expect(screen.getByText(/myTickets\.kindReport/)).toBeTruthy();
      expect(screen.getByText(/myTickets\.kindSupport/)).toBeTruthy();
    });

    it("renders the tickets in the order the server returned them", async () => {
      listSupportTickets.mockResolvedValue([
        ticket({ id: "newest", subject: "Newest" }),
        ticket({ id: "oldest", subject: "Oldest" })
      ]);
      const { container } = render(<MyTicketsPanel />);
      await screen.findByText("Newest");
      const subjects = Array.from(container.querySelectorAll("li > button")).map((b) => b.textContent);
      expect(subjects[0]).toContain("Newest");
      expect(subjects[1]).toContain("Oldest");
    });
  });

  describe("the thread", () => {
    it("expands to show the conversation oldest first, and collapses again", async () => {
      listSupportTickets.mockResolvedValue([
        ticket({
          messages: [
            message({ id: "m-1", author_role: "user", body: "I asked first" }),
            message({ id: "m-2", author_role: "admin", body: "We answered second" })
          ]
        })
      ]);
      const { container } = render(<MyTicketsPanel />);
      const row = await screen.findByRole("button", { name: /Something broke/ });

      expect(screen.queryByText("I asked first")).toBeNull();
      fireEvent.click(row);

      await waitFor(() => expect(screen.getByText("I asked first")).toBeTruthy());
      expect(screen.getByText("We answered second")).toBeTruthy();
      // The exchange must read forward, not backwards like a log.
      const bodies = Array.from(container.querySelectorAll("li li p:last-child")).map((p) => p.textContent);
      expect(bodies).toEqual(["I asked first", "We answered second"]);

      fireEvent.click(row);
      await waitFor(() => expect(screen.queryByText("I asked first")).toBeNull());
    });

    it("distinguishes a reply from the team from the user's own message", async () => {
      listSupportTickets.mockResolvedValue([
        ticket({ messages: [message({ author_role: "admin", body: "Sorted, sorry about that." })] })
      ]);
      render(<MyTicketsPanel />);
      fireEvent.click(await screen.findByRole("button", { name: /Something broke/ }));
      await waitFor(() => expect(screen.getByText("Sorted, sorry about that.")).toBeTruthy());
      expect(screen.getByText(/myTickets\.fromTeam/)).toBeTruthy();
      expect(screen.queryByText(/myTickets\.fromYou/)).toBeNull();
    });

    it("says so when a ticket has no visible messages", async () => {
      // What a user sees if every message on their ticket is an internal note: the
      // server sends none, and the panel does not pretend otherwise.
      listSupportTickets.mockResolvedValue([ticket({ messages: [] })]);
      render(<MyTicketsPanel />);
      fireEvent.click(await screen.findByRole("button", { name: /Something broke/ }));
      await waitFor(() => expect(screen.getByText("myTickets.noMessages")).toBeTruthy());
    });
  });

  describe("status and priority", () => {
    it("shows the stored status and priority, using the vocabulary from migration 051", async () => {
      listSupportTickets.mockResolvedValue([ticket({ status: "waiting_user", priority: "high" })]);
      render(<MyTicketsPanel />);
      expect(await screen.findByText("myTickets.status.waiting_user")).toBeTruthy();
      expect(screen.getByText("myTickets.priority.high")).toBeTruthy();
    });
  });

  describe("read-only", () => {
    it("offers no way to reply, change a status, or delete anything", async () => {
      listSupportTickets.mockResolvedValue([ticket()]);
      const { container } = render(<MyTicketsPanel />);
      fireEvent.click(await screen.findByRole("button", { name: /Something broke/ }));
      await waitFor(() => expect(screen.getByText("the original message")).toBeTruthy());

      // A user has INSERT and SELECT on these tables and no UPDATE policy at all, so
      // any control here could only produce a button that fails.
      expect(container.querySelector("textarea")).toBeNull();
      expect(container.querySelector("select")).toBeNull();
      expect(container.querySelector("input")).toBeNull();
      // The only buttons are the expand/collapse rows.
      const buttons = Array.from(container.querySelectorAll("button"));
      expect(buttons.every((b) => b.getAttribute("aria-expanded") !== null)).toBe(true);
    });
  });

  describe("hostile content is content", () => {
    it("renders a script tag in a message body as literal text", async () => {
      const payload = "<script>alert(1)</script>";
      listSupportTickets.mockResolvedValue([
        ticket({ subject: payload, messages: [message({ body: payload })] })
      ]);
      const { container } = render(<MyTicketsPanel />);
      fireEvent.click(await screen.findByRole("button", { name: /alert/ }));

      await waitFor(() => expect(screen.getAllByText(payload).length).toBeGreaterThan(0));
      // No element was created from it, and nothing was injected as markup.
      expect(container.querySelector("script")).toBeNull();
      expect(container.innerHTML).toContain("&lt;script&gt;");
      expect(container.innerHTML).not.toContain("<script>");
    });
  });

  describe("states", () => {
    it("shows a skeleton while loading, then the tickets once they arrive", async () => {
      // A deferred rather than a never-settling promise: the pending state is what is
      // asserted, but the fetch still has to finish or the test would hang on it.
      let resolve: (value: unknown[]) => void = () => {};
      listSupportTickets.mockReturnValue(
        new Promise<unknown[]>((r) => {
          resolve = r;
        })
      );
      const { container } = render(<MyTicketsPanel />);
      expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();

      resolve([ticket()]);
      await waitFor(() => expect(screen.getByText("Something broke")).toBeTruthy());
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    });

    it("shows the empty state when there is nothing to read", async () => {
      listSupportTickets.mockResolvedValue([]);
      render(<MyTicketsPanel />);
      expect(await screen.findByText("myTickets.empty")).toBeTruthy();
    });

    it("shows an error with a retry that refetches, and never the server's own words", async () => {
      listSupportTickets.mockRejectedValueOnce(
        new SupportApiError(500, "column support_tickets.foo does not exist", null)
      );
      render(<MyTicketsPanel />);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("myTickets.error");
      expect(alert.textContent).not.toContain("support_tickets");

      listSupportTickets.mockResolvedValue([ticket()]);
      fireEvent.click(screen.getByRole("button", { name: "myTickets.retry" }));
      await waitFor(() => expect(screen.getByText("Something broke")).toBeTruthy());
      expect(listSupportTickets).toHaveBeenCalledTimes(2);
    });
  });
});
