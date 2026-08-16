import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminInboxError } from "../../services/adminInboxService";
import AdminInboxPanel from "./AdminInboxPanel";

/**
 * The admin reply composer.
 *
 * What is asserted is what an admin can and cannot do: reply to an open ticket, see the
 * stored message appear, and find no composer at all on a closed ticket or on feedback.
 * The wire contract is covered by tests/adminInboxApi.test.js.
 */

const fetchInboxPage = vi.fn();
const replyToTicket = vi.fn();
const updateTicketStatus = vi.fn();

vi.mock("../../services/adminInboxService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/adminInboxService")>();
  return {
    ...actual,
    fetchInboxPage: (...a: unknown[]) => fetchInboxPage(...a),
    replyToTicket: (...a: unknown[]) => replyToTicket(...a),
    updateTicketStatus: (...a: unknown[]) => updateTicketStatus(...a)
  };
});

const message = (o: Record<string, unknown> = {}) => ({
  id: "m-1",
  author_role: "user",
  body: "it broke",
  is_internal_note: false,
  created_at: "2026-08-15T05:50:00.000Z",
  ...o
});

const ticket = (o: Record<string, unknown> = {}) => ({
  id: "t-1",
  kind: "support",
  user_id: "user-1",
  category: "general",
  subject: "Something broke",
  status: "open",
  priority: "normal",
  contact_requested: false,
  page_route: null,
  app_version: null,
  created_at: "2026-08-15T05:50:00.000Z",
  updated_at: "2026-08-15T05:50:00.000Z",
  context: null,
  messages: [message()],
  ...o
});

const page = (items: unknown[]) => ({ kind: "support", items, hasMore: false });
const expand = async () => fireEvent.click(await screen.findByRole("button", { name: /Something broke/ }));

describe("AdminInboxPanel — reply", () => {
  beforeEach(() => {
    fetchInboxPage.mockReset();
    replyToTicket.mockReset();
  });
  afterEach(cleanup);

  it("shows a composer on an open ticket and appends the server's message", async () => {
    fetchInboxPage.mockResolvedValue(page([ticket()]));
    replyToTicket.mockResolvedValue(message({ id: "m-2", author_role: "admin", body: "stored reply" }));
    render(<AdminInboxPanel />);
    await expand();

    const box = await screen.findByRole("textbox");
    fireEvent.change(box, { target: { value: "  typed reply  " } });
    fireEvent.click(screen.getByRole("button", { name: /Send reply/ }));

    // The message that appears is the one the database returned, not the text typed.
    await waitFor(() => expect(screen.getByText("stored reply")).toBeTruthy());
    expect(screen.queryByText("typed reply")).toBeNull();
    expect(replyToTicket).toHaveBeenCalledWith({ kind: "support", id: "t-1", body: "typed reply" });
    // And the composer is cleared.
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(""));
  });

  it("never invents a message before the server confirms one", async () => {
    let resolve: (v: unknown) => void = () => {};
    fetchInboxPage.mockResolvedValue(page([ticket()]));
    replyToTicket.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<AdminInboxPanel />);
    await expand();

    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "pending reply" } });
    fireEvent.click(screen.getByRole("button", { name: /Send reply/ }));

    // While in flight: the button is disabled and no optimistic message exists.
    await waitFor(() => expect(screen.getByRole("button", { name: /Sending/ })).toBeTruthy());
    expect((screen.getByRole("button", { name: /Sending/ }) as HTMLButtonElement).disabled).toBe(true);
    // Scoped to the thread: the draft is legitimately still in the textarea, but no message
    // may exist in the conversation until the server has created one.
    const threadBefore = Array.from(document.querySelectorAll("li li")).map((n) => n.textContent);
    expect(threadBefore.some((text) => text?.includes("pending reply"))).toBe(false);

    resolve(message({ id: "m-2", author_role: "admin", body: "confirmed" }));
    await waitFor(() => expect(screen.getByText("confirmed")).toBeTruthy());
  });

  it("shows a safe error and keeps the draft when the send fails", async () => {
    fetchInboxPage.mockResolvedValue(page([ticket()]));
    replyToTicket.mockRejectedValue(new AdminInboxError(500, 'relation "support_messages" does not exist'));
    render(<AdminInboxPanel />);
    await expand();

    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: /Send reply/ }));

    expect(await screen.findByText(/could not be sent/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("support_messages");
    // The draft survives so the reply is not lost.
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("keep me");
  });

  describe("closed tickets offer no composer at all", () => {
    it("hides the composer on a closed Support ticket, which stays readable", async () => {
      fetchInboxPage.mockResolvedValue(page([ticket({ status: "closed" })]));
      const { container } = render(<AdminInboxPanel />);
      await expand();

      await waitFor(() => expect(screen.getByText("it broke")).toBeTruthy());
      expect(container.querySelector("textarea")).toBeNull();
      expect(screen.queryByRole("button", { name: /Send reply/ })).toBeNull();
      // Not a disabled Send: a control that cannot work should not be shown at all, so the
      // ticket says why instead.
      expect(screen.getByText(/Change its status to reply/)).toBeTruthy();
    });

    it("hides the composer on a closed Report too", async () => {
      fetchInboxPage.mockResolvedValue({
        kind: "report",
        items: [ticket({ kind: "report", category: "prediction", status: "closed" })],
        hasMore: false
      });
      const { container } = render(<AdminInboxPanel />);
      await expand();
      await waitFor(() => expect(screen.getByText("it broke")).toBeTruthy());
      expect(container.querySelector("textarea")).toBeNull();
      expect(screen.queryByRole("button", { name: /Send reply/ })).toBeNull();
    });

    it("offers no composer on feedback, whatever it contains", async () => {
      fetchInboxPage.mockResolvedValue({
        kind: "feedback",
        items: [
          {
            id: "f-1",
            kind: "feedback",
            user_id: "user-1",
            category: "ux",
            message: "a thought",
            rating: null,
            would_recommend: null,
            contact_requested: false,
            created_at: "2026-08-15T05:50:00.000Z",
            context: null
          }
        ],
        hasMore: false
      });
      const { container } = render(<AdminInboxPanel />);
      fireEvent.click(await screen.findByRole("button", { name: /a thought/ }));
      await waitFor(() => expect(screen.getAllByText("a thought").length).toBeGreaterThan(0));
      expect(container.querySelector("textarea")).toBeNull();
      expect(screen.queryByRole("button", { name: /Send reply/ })).toBeNull();
    });
  });

  it("renders a script tag in a message as literal text", async () => {
    const payload = "<script>alert(1)</script>";
    fetchInboxPage.mockResolvedValue(page([ticket({ messages: [message({ body: payload })] })]));
    const { container } = render(<AdminInboxPanel />);
    await expand();
    await waitFor(() => expect(screen.getByText(payload)).toBeTruthy());
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).toContain("&lt;script&gt;");
  });
});
