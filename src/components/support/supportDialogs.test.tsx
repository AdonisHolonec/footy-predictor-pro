import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupportApiError } from "../../services/supportService";
import SupportDialog from "./SupportDialog";
import FeedbackDialog from "./FeedbackDialog";
import ReportPredictionDialog, { contextFromRow } from "./ReportPredictionDialog";
import { errorKeyForStatus } from "./useSupportSubmit";
import type { PredictionRow } from "../../types";

/**
 * The dialogs are tested against a mocked transport, so what is asserted is the
 * behaviour the user sees: what is sent, what is refused, and what is said when
 * the server says no. The wire format itself is covered by tests/supportApi.test.js.
 *
 * `t` is mocked to return the key. That makes the assertions read as contracts
 * ("this is the rate-limit message") instead of coupling them to copy that
 * translators are free to change.
 */

const submitSupportTicket = vi.fn();
const submitFeedback = vi.fn();
const submitPredictionReport = vi.fn();

vi.mock("../../services/supportService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/supportService")>();
  return {
    ...actual,
    submitSupportTicket: (...args: unknown[]) => submitSupportTicket(...args),
    submitFeedback: (...args: unknown[]) => submitFeedback(...args),
    submitPredictionReport: (...args: unknown[]) => submitPredictionReport(...args)
  };
});

vi.mock("../../context/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: () => {}
  })
}));

beforeEach(() => {
  submitSupportTicket.mockReset().mockResolvedValue(undefined);
  submitFeedback.mockReset().mockResolvedValue(undefined);
  submitPredictionReport.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

const row = {
  id: 12345,
  leagueId: 283,
  league: "SuperLiga",
  teams: { home: "Rapid", away: "FCSB" },
  kickoff: "2026-08-20T18:00:00Z",
  modelVersion: "v3.1",
  recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 71 }
} as unknown as PredictionRow;

const send = (name: string) => screen.getByRole("button", { name });

// ============================================================ SUPPORT ======

describe("SupportDialog", () => {
  it("[1] renders its fields when open and nothing when closed", () => {
    const { unmount } = render(<SupportDialog open onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText(/support\.category/)).toBeTruthy();
    expect(screen.getByLabelText(/support\.subject/)).toBeTruthy();
    expect(screen.getByLabelText(/support\.message/)).toBeTruthy();
    unmount();

    render(<SupportDialog open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("[2] refuses to submit an empty form and names every missing field", async () => {
    render(<SupportDialog open onClose={() => {}} />);
    fireEvent.click(send("support.send"));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    const messages = screen.getAllByRole("alert").map((n) => n.textContent);
    expect(messages).toContain("support.errorCategoryRequired");
    expect(messages).toContain("support.errorSubjectRequired");
    expect(messages).toContain("support.errorMessageTooShort");
    expect(submitSupportTicket).not.toHaveBeenCalled();
  });

  it("[3] sends what the user typed and confirms", async () => {
    const onSubmitted = vi.fn();
    render(<SupportDialog open onClose={() => {}} onSubmitted={onSubmitted} />);
    fireEvent.change(screen.getByLabelText(/support\.category/), { target: { value: "technical" } });
    fireEvent.change(screen.getByLabelText(/support\.subject/), { target: { value: "Blank screen" } });
    fireEvent.change(screen.getByLabelText(/support\.message/), {
      target: { value: "The dashboard stays empty after signing in." }
    });
    fireEvent.click(send("support.send"));

    await waitFor(() => expect(submitSupportTicket).toHaveBeenCalledTimes(1));
    const payload = submitSupportTicket.mock.calls[0][0];
    expect(payload.category).toBe("technical");
    expect(payload.subject).toBe("Blank screen");
    expect(payload.message).toBe("The dashboard stays empty after signing in.");
    // Identity is the server's to decide — the client must not offer one.
    expect(payload.user_id).toBeUndefined();

    await waitFor(() => expect(screen.getByText("support.successMessage")).toBeTruthy());
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it("[4] reports a server failure without leaking its detail", async () => {
    submitSupportTicket.mockRejectedValue(new SupportApiError(500, "column support_tickets.foo does not exist"));
    render(<SupportDialog open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/support\.category/), { target: { value: "general" } });
    fireEvent.change(screen.getByLabelText(/support\.subject/), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText(/support\.message/), { target: { value: "A long enough message." } });
    fireEvent.click(send("support.send"));

    await waitFor(() => expect(screen.getByText("support.errorServer")).toBeTruthy());
    expect(screen.queryByText(/column support_tickets/)).toBeNull();
  });

  it("[5] says a rate limit is a rate limit, not a generic failure", async () => {
    submitSupportTicket.mockRejectedValue(new SupportApiError(429, "Prea multe cereri.", 3600));
    render(<SupportDialog open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/support\.category/), { target: { value: "general" } });
    fireEvent.change(screen.getByLabelText(/support\.subject/), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText(/support\.message/), { target: { value: "A long enough message." } });
    fireEvent.click(send("support.send"));

    await waitFor(() => expect(screen.getByText("support.errorRateLimited")).toBeTruthy());
    expect(screen.queryByText("support.errorGeneric")).toBeNull();
    expect(screen.queryByText("support.errorServer")).toBeNull();
  });
});

// =========================================================== FEEDBACK ======

describe("FeedbackDialog", () => {
  it("[6] renders a shorter form than support — no subject field", () => {
    render(<FeedbackDialog open onClose={() => {}} />);
    expect(screen.getByLabelText(/feedback\.category/)).toBeTruthy();
    expect(screen.getByLabelText(/feedback\.message/)).toBeTruthy();
    expect(screen.queryByLabelText(/subject/i)).toBeNull();
    expect(screen.getByRole("radiogroup")).toBeTruthy();
  });

  it("[7] refuses an empty form", async () => {
    render(<FeedbackDialog open onClose={() => {}} />);
    fireEvent.click(send("feedback.send"));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("alert").map((n) => n.textContent)).toContain("feedback.errorCategoryRequired");
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it("[8] sends category, message and the optional rating", async () => {
    render(<FeedbackDialog open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/feedback\.category/), { target: { value: "ux" } });
    fireEvent.change(screen.getByLabelText(/feedback\.message/), { target: { value: "The chart is hard to read." } });
    fireEvent.click(screen.getAllByRole("radio")[3]);
    fireEvent.click(send("feedback.send"));

    await waitFor(() => expect(submitFeedback).toHaveBeenCalledTimes(1));
    expect(submitFeedback.mock.calls[0][0]).toMatchObject({ category: "ux", rating: 4 });
    await waitFor(() => expect(screen.getByText("feedback.successMessage")).toBeTruthy());
  });

  it("[8b] omits the rating entirely when the user skips it", async () => {
    render(<FeedbackDialog open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/feedback\.category/), { target: { value: "feature" } });
    fireEvent.change(screen.getByLabelText(/feedback\.message/), { target: { value: "Add a compare view." } });
    fireEvent.click(send("feedback.send"));
    await waitFor(() => expect(submitFeedback).toHaveBeenCalledTimes(1));
    expect(submitFeedback.mock.calls[0][0].rating).toBeUndefined();
  });

  it("[9] reports an API failure", async () => {
    submitFeedback.mockRejectedValue(new SupportApiError(500, null));
    render(<FeedbackDialog open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/feedback\.category/), { target: { value: "ux" } });
    fireEvent.change(screen.getByLabelText(/feedback\.message/), { target: { value: "Something." } });
    fireEvent.click(send("feedback.send"));
    await waitFor(() => expect(screen.getByText("support.errorServer")).toBeTruthy());
  });

  it("[10] reports a rate limit", async () => {
    submitFeedback.mockRejectedValue(new SupportApiError(429, null, 3600));
    render(<FeedbackDialog open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/feedback\.category/), { target: { value: "ux" } });
    fireEvent.change(screen.getByLabelText(/feedback\.message/), { target: { value: "Something." } });
    fireEvent.click(send("feedback.send"));
    await waitFor(() => expect(screen.getByText("support.errorRateLimited")).toBeTruthy());
  });
});

// ================================================== PREDICTION REPORT ======

describe("ReportPredictionDialog", () => {
  it("[11] stays closed without a row and opens with one", () => {
    const { unmount } = render(<ReportPredictionDialog open row={null} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    render(<ReportPredictionDialog open row={row} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("[12] pre-fills the context and shows the match back to the user", () => {
    const context = contextFromRow(row);
    expect(context).toMatchObject({
      fixtureId: 12345,
      leagueId: 283,
      recommendation: "Over 2.5",
      family: "Over/Under",
      modelVersion: "v3.1",
      kickoffAt: "2026-08-20T18:00:00Z"
    });

    render(<ReportPredictionDialog open row={row} onClose={() => {}} />);
    expect(screen.getByText(/Rapid/)).toBeTruthy();
    expect(screen.getByText(/FCSB/)).toBeTruthy();
    expect(screen.getByText(/Over 2\.5/)).toBeTruthy();
    // The user never retypes what the app already knows.
    expect(screen.queryByLabelText(/fixture/i)).toBeNull();
  });

  it("[12b] omits context keys the row does not carry", () => {
    const bare = { id: 7, leagueId: 39, teams: { home: "A", away: "B" } } as unknown as PredictionRow;
    const context = contextFromRow(bare);
    expect(context).toEqual({ fixtureId: 7, leagueId: 39 });
    expect("recommendation" in context).toBe(false);
  });

  it("[13] sends the reason and the gathered context", async () => {
    render(<ReportPredictionDialog open row={row} onClose={() => {}} />);
    fireEvent.click(send("predictionReport.send"));
    await waitFor(() => expect(screen.getByText("predictionReport.errorReasonRequired")).toBeTruthy());
    expect(submitPredictionReport).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/predictionReport\.reason/), { target: { value: "wrong_odds" } });
    fireEvent.click(send("predictionReport.send"));

    await waitFor(() => expect(submitPredictionReport).toHaveBeenCalledTimes(1));
    const payload = submitPredictionReport.mock.calls[0][0];
    expect(payload.category).toBe("prediction");
    expect(payload.message).toContain("predictionReport.reasons.wrong_odds");
    expect(payload.context.fixtureId).toBe(12345);
    await waitFor(() => expect(screen.getByText("predictionReport.successMessage")).toBeTruthy());
  });

  it("[14] reports an API failure", async () => {
    submitPredictionReport.mockRejectedValue(new SupportApiError(400, null));
    render(<ReportPredictionDialog open row={row} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/predictionReport\.reason/), { target: { value: "other" } });
    fireEvent.click(send("predictionReport.send"));
    await waitFor(() => expect(screen.getByText("support.errorInvalid")).toBeTruthy());
  });

  it("[15] reports a rate limit", async () => {
    submitPredictionReport.mockRejectedValue(new SupportApiError(429, null, 3600));
    render(<ReportPredictionDialog open row={row} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/predictionReport\.reason/), { target: { value: "other" } });
    fireEvent.click(send("predictionReport.send"));
    await waitFor(() => expect(screen.getByText("support.errorRateLimited")).toBeTruthy());
  });
});

// ================================================ ACCESSIBILITY / UX ======

describe("dialog behaviour", () => {
  it("[16] every support surface is a labelled modal", () => {
    for (const node of [
      <SupportDialog key="s" open onClose={() => {}} />,
      <FeedbackDialog key="f" open onClose={() => {}} />,
      <ReportPredictionDialog key="r" open row={row} onClose={() => {}} />
    ]) {
      const { unmount } = render(node);
      const dialog = screen.getByRole("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      const labelledBy = dialog.getAttribute("aria-labelledby");
      expect(labelledBy).toBeTruthy();
      expect(document.getElementById(labelledBy as string)?.textContent).toBeTruthy();
      unmount();
    }
  });

  it("[17] Escape closes, and a backdrop click does not discard a half-written form", () => {
    const onClose = vi.fn();
    const { container, unmount } = render(<SupportDialog open onClose={onClose} />);
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("[17b] every control is reachable and the send button carries a name", () => {
    render(<SupportDialog open onClose={() => {}} />);
    expect(send("support.send")).toBeTruthy();
    expect(send("support.cancel")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    // Focus starts inside the dialog, not behind it.
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("[18] the panel is capped and scrolls internally, so 390px cannot overflow", () => {
    render(<SupportDialog open onClose={() => {}} />);
    const panel = screen.getByRole("dialog");
    expect(panel.className).toContain("max-h-[90vh]");
    expect(panel.className).toContain("overflow-y-auto");
    expect(panel.className).toContain("w-full");
    // Horizontal growth is what breaks a narrow viewport; the width is capped.
    expect(panel.className).toMatch(/max-w-/);
  });

  it("[18b] failure copy is distinct per status", () => {
    const keys = [400, 401, 403, 405, 429, 500].map(errorKeyForStatus);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
